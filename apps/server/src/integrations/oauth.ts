import { createHash, randomBytes } from 'node:crypto';
import type { IntegrationsConfig } from '../config.ts';
import { AppError } from '../util.ts';

export type OAuthProvider = 'google' | 'microsoft';

export interface OAuthCredentials {
  kind: 'oauth';
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
}

export interface Capabilities {
  sendEmail: boolean;
  syncEmail: boolean;
  calendar: boolean;
  exportEvents: boolean;
}

const GOOGLE_API = 'https://www.googleapis.com/auth/';
const GOOGLE_SCOPES = ['openid', 'email', 'profile', `${GOOGLE_API}gmail.send`, `${GOOGLE_API}gmail.readonly`, `${GOOGLE_API}calendar.events`];
const MICROSOFT_SCOPES = ['offline_access', 'openid', 'email', 'profile', 'User.Read', 'Mail.Read', 'Mail.Send', 'Calendars.ReadWrite'];

export const providerLabel = (provider: string): string => (provider === 'google' ? 'Google' : provider === 'microsoft' ? 'Microsoft' : provider === 'twilio' ? 'Twilio' : provider);

/** The provider no longer accepts the stored grant: the user has to connect the account again. */
export class ReconnectRequired extends AppError {
  constructor(message = 'Reconnect required: the provider no longer accepts the stored sign-in.') {
    super(409, 'reconnect_required', message);
  }
}

/** A call to an external provider failed. `upstream` is the provider's HTTP status (0 for network errors). */
export class ProviderError extends AppError {
  upstream: number;
  /** The provider's own error code, when it sent one (e.g. Graph's "syncStateNotFound"). */
  upstreamCode: string | null;

  constructor(message: string, upstream = 0, upstreamCode: string | null = null) {
    super(502, 'provider_error', message);
    this.upstream = upstream;
    this.upstreamCode = upstreamCode;
  }
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const redirectUri = (cfg: IntegrationsConfig, provider: OAuthProvider): string => `${cfg.publicUrl}/api/integrations/oauth/${provider}/callback`;

function endpoints(cfg: IntegrationsConfig, provider: OAuthProvider) {
  if (provider === 'google') {
    if (!cfg.google) throw new AppError(400, 'not_configured', 'Google accounts are not configured on this server');
    return {
      client: cfg.google,
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      scopes: GOOGLE_SCOPES,
      extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' } as Record<string, string>,
    };
  }
  if (!cfg.microsoft) throw new AppError(400, 'not_configured', 'Microsoft accounts are not configured on this server');
  const base = `https://login.microsoftonline.com/${encodeURIComponent(cfg.microsoft.tenant)}/oauth2/v2.0`;
  return { client: cfg.microsoft, authorize: `${base}/authorize`, token: `${base}/token`, scopes: MICROSOFT_SCOPES, extra: { prompt: 'select_account' } as Record<string, string> };
}

export function assertOAuthConfigured(cfg: IntegrationsConfig, provider: OAuthProvider): void {
  endpoints(cfg, provider);
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function authorizationUrl(cfg: IntegrationsConfig, provider: OAuthProvider, state: string, challenge: string): string {
  const e = endpoints(cfg, provider);
  const url = new URL(e.authorize);
  const p: Record<string, string> = {
    client_id: e.client.clientId,
    redirect_uri: redirectUri(cfg, provider),
    response_type: 'code',
    scope: e.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...e.extra,
  };
  for (const [k, v] of Object.entries(p)) url.searchParams.set(k, v);
  return url.toString();
}

async function tokenRequest(fetchImpl: typeof fetch, cfg: IntegrationsConfig, provider: OAuthProvider, body: Record<string, string>): Promise<OAuthCredentials> {
  const e = endpoints(cfg, provider);
  const form = new URLSearchParams({ client_id: e.client.clientId, client_secret: e.client.clientSecret, ...body });
  if (provider === 'microsoft') form.set('scope', e.scopes.join(' '));
  let res: Response;
  try {
    res = await fetchImpl(e.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ProviderError(`Could not reach ${providerLabel(provider)}: ${errorMessage(err)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    const detail = (data.error_description ?? data.error ?? `HTTP ${res.status}`).split(/\r?\n/)[0]!.trim().slice(0, 300);
    if (data.error === 'invalid_grant') throw new ReconnectRequired(`Reconnect required: ${providerLabel(provider)} no longer accepts the stored sign-in (${detail})`);
    throw new ProviderError(`${providerLabel(provider)} sign-in failed: ${detail}`, res.status);
  }
  return {
    kind: 'oauth',
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    scope: data.scope ?? '',
  };
}

export const exchangeCode = (fetchImpl: typeof fetch, cfg: IntegrationsConfig, provider: OAuthProvider, code: string, verifier: string) =>
  tokenRequest(fetchImpl, cfg, provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(cfg, provider), code_verifier: verifier });

export const refreshTokens = (fetchImpl: typeof fetch, cfg: IntegrationsConfig, provider: OAuthProvider, refreshToken: string) =>
  tokenRequest(fetchImpl, cfg, provider, { grant_type: 'refresh_token', refresh_token: refreshToken });

/** What a token can do, from the scopes the user actually granted (Google lets users untick individual scopes). */
export function capabilitiesFromScope(provider: OAuthProvider, scope: string): Capabilities {
  const granted = new Set(
    scope
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase()),
  );
  if (provider === 'google') {
    const has = (...names: string[]) => names.some((n) => granted.has(n.startsWith('https://') ? n : `${GOOGLE_API}${n}`));
    const fullMail = has('https://mail.google.com/');
    return {
      sendEmail: fullMail || has('gmail.send', 'gmail.compose', 'gmail.modify'),
      syncEmail: fullMail || has('gmail.readonly', 'gmail.modify'),
      calendar: has('calendar.events', 'calendar', 'calendar.readonly', 'calendar.events.readonly'),
      exportEvents: has('calendar.events', 'calendar'),
    };
  }
  return {
    sendEmail: granted.has('mail.send'),
    syncEmail: granted.has('mail.read') || granted.has('mail.readwrite'),
    calendar: granted.has('calendars.read') || granted.has('calendars.readwrite'),
    exportEvents: granted.has('calendars.readwrite'),
  };
}

export interface ApiRequest {
  method?: string;
  token?: string;
  /** Sent as JSON. */
  json?: unknown;
  body?: RequestInit['body'];
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Calls a provider API; non-2xx responses become ProviderErrors carrying the provider's message. */
export async function providerFetch(fetchImpl: typeof fetch, provider: string, url: string, req: ApiRequest = {}): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
  if (req.token) headers.authorization = `Bearer ${req.token}`;
  let body = req.body;
  if (req.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(req.json);
  }
  let res: Response;
  try {
    res = await fetchImpl(url, { method: req.method ?? 'GET', headers, body, signal: AbortSignal.timeout(req.timeoutMs ?? 30_000) });
  } catch (err) {
    throw new ProviderError(`Could not reach ${providerLabel(provider)}: ${errorMessage(err)}`);
  }
  if (res.ok) return res;
  const text = await res.text().catch(() => '');
  let detail = '';
  let code: string | null = null;
  try {
    const data = JSON.parse(text) as { error?: { message?: string; code?: string } | string; message?: string; error_description?: string };
    detail = typeof data.error === 'object' ? (data.error.message ?? data.error.code ?? '') : (data.error_description ?? data.message ?? data.error ?? '');
    code = (typeof data.error === 'object' ? data.error.code : data.error) ?? null;
  } catch {
    detail = text.slice(0, 200);
  }
  throw new ProviderError(`${providerLabel(provider)} returned HTTP ${res.status}${detail ? `: ${String(detail).split(/\r?\n/)[0]!.trim().slice(0, 300)}` : ''}`, res.status, code);
}

export async function providerJson<T>(fetchImpl: typeof fetch, provider: string, url: string, req: ApiRequest = {}): Promise<T> {
  const res = await providerFetch(fetchImpl, provider, url, req);
  if (res.status === 204) return {} as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(`${providerLabel(provider)} returned an unreadable response`, res.status);
  }
}

export async function fetchIdentity(fetchImpl: typeof fetch, provider: OAuthProvider, accessToken: string): Promise<{ email: string; name: string | null }> {
  if (provider === 'google') {
    const me = await providerJson<{ email?: string; name?: string }>(fetchImpl, provider, 'https://openidconnect.googleapis.com/v1/userinfo', { token: accessToken });
    if (!me.email) throw new ProviderError('Google did not return the account email address');
    return { email: me.email.toLowerCase(), name: me.name ?? null };
  }
  const me = await providerJson<{ mail?: string | null; userPrincipalName?: string; displayName?: string }>(
    fetchImpl,
    provider,
    'https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName',
    { token: accessToken },
  );
  const email = me.mail || me.userPrincipalName;
  if (!email) throw new ProviderError('Microsoft did not return the account email address');
  return { email: email.toLowerCase(), name: me.displayName ?? null };
}

/** Best effort: tells Google to forget the grant when an account is removed. */
export async function revokeGoogle(fetchImpl: typeof fetch, token: string): Promise<void> {
  try {
    await fetchImpl('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // The grant stays listed in the user's Google account; they can remove it there.
  }
}
