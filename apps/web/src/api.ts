import type { ApiErrorBody, EditConflictDetails, OrganizationKind } from '@titoforce/shared';
import { getLocale, t, tryT } from './i18n/index.ts';

// ---------- organization, native app and device tokens ----------

const ORG_KEY = 'tf.org';
const RECENT_ORGS_KEY = 'tf.recentOrgs';
const SERVER_KEY = 'tf.server';
const TOKENS_KEY = 'tf.tokens';

type StorageKind = 'local' | 'session';

function readStorage(kind: StorageKind, key: string): string | null {
  try {
    return (kind === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(kind: StorageKind, key: string, value: string | null): void {
  try {
    const storage = kind === 'local' ? localStorage : sessionStorage;
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts until the page is reloaded.
  }
}

/** Whether the UI runs inside the titoForce iOS/Android app (Capacitor), which calls a remote server with a bearer token. */
export function isNativeApp(): boolean {
  return (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;
}

/**
 * The organization this tab works in: `?org=` in the address (e.g. a sandbox opened from Setup), else this tab's choice,
 * else the production organization signed in to last. Null means the server decides (its default, or the subdomain's).
 * Read once at startup, before the router reads the address, so `?org=` can be removed from it.
 */
let organization: string | null = initialOrganization();

function initialOrganization(): string | null {
  if (typeof location === 'undefined') return null;
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('org')?.trim().toLowerCase();
  if (fromUrl) {
    url.searchParams.delete('org');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    writeStorage('session', ORG_KEY, fromUrl);
    return fromUrl;
  }
  return readStorage('session', ORG_KEY) ?? readStorage('local', ORG_KEY);
}

export const currentOrganization = (): string | null => organization;

/** Switches this tab to another organization; `remember` also makes it the one new tabs start in. */
export function setOrganization(slug: string | null, { remember = false }: { remember?: boolean } = {}): void {
  organization = slug?.trim().toLowerCase() || null;
  writeStorage('session', ORG_KEY, organization);
  if (remember) writeStorage('local', ORG_KEY, organization);
}

/**
 * Address that opens an organization (e.g. in a new tab): its subdomain when the server routes organizations by host
 * (`baseDomain`, from the public config), else `/?org=`.
 */
export function organizationHref(slug: string, baseDomain: string | null): string {
  if (baseDomain && !isNativeApp()) return `${location.protocol}//${slug}.${baseDomain}${location.port ? `:${location.port}` : ''}/`;
  return `/?org=${encodeURIComponent(slug)}`;
}

/** Reloads the app in another organization; its sign-in page shows if there is no session there. */
export function openOrganization(slug: string, baseDomain: string | null = null): void {
  if (!baseDomain || isNativeApp()) setOrganization(slug);
  location.assign(organizationHref(slug, baseDomain));
}

export interface RecentOrganization {
  slug: string;
  name: string;
  kind: OrganizationKind;
}

/** Organizations signed in to on this device, most recent first (for the organization switcher). */
export function recentOrganizations(): RecentOrganization[] {
  try {
    const list: unknown = JSON.parse(readStorage('local', RECENT_ORGS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((o): o is RecentOrganization => typeof o?.slug === 'string' && typeof o?.name === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberOrganization(org: RecentOrganization): void {
  const list = [{ slug: org.slug, name: org.name, kind: org.kind }, ...recentOrganizations().filter((o) => o.slug !== org.slug)].slice(0, 6);
  writeStorage('local', RECENT_ORGS_KEY, JSON.stringify(list));
}

/** Address of the titoForce server the native app talks to; empty on the web, where the API is on the same origin. */
export function serverUrl(): string {
  return isNativeApp() ? (readStorage('local', SERVER_KEY) ?? '') : '';
}

export function setServerUrl(url: string | null): void {
  writeStorage('local', SERVER_KEY, url?.trim().replace(/\/+$/, '') || null);
}

/** Normalizes what someone typed as their server's address ("crm.example.com" → "https://crm.example.com"); null if it is not a web address. */
export function normalizeServerUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function deviceTokens(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readStorage('local', TOKENS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The native app signs in with bearer tokens (one per organization) instead of cookies, which a remote server cannot set for it. */
export function storeDeviceToken(org: string, token: string | null): void {
  const tokens = deviceTokens();
  if (token) tokens[org] = token;
  else delete tokens[org];
  writeStorage('local', TOKENS_KEY, JSON.stringify(tokens));
}

function deviceToken(org: string | null): string | null {
  return isNativeApp() ? (deviceTokens()[org ?? ''] ?? null) : null;
}

/** WebSocket address of the realtime endpoint for this tab's organization. */
export function realtimeUrl(): string {
  const url = new URL(`${serverUrl() || location.origin}/api/realtime`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (organization) url.searchParams.set('org', organization);
  return url.toString();
}

/** Token the realtime connection authenticates with (native app only; browsers send the session cookie). */
export const realtimeToken = (): string | null => deviceToken(organization);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

let unauthorizedHandler: (() => void) | null = null;

/** Called when a signed-in request gets a 401 (expired or revoked session). */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export interface RequestOptions {
  /** Organization for this request instead of the tab's (null: the server's default). Used to sign in to another one. */
  org?: string | null;
}

async function request<T>(method: Method, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', 'x-tito-locale': getLocale() };
  const org = opts.org !== undefined ? opts.org : organization;
  if (org) headers['x-tito-org'] = org;
  const native = isNativeApp();
  if (native && !serverUrl()) throw new ApiError(401, 'unauthenticated', t('errors.api.unauthenticated'));
  const token = deviceToken(org);
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: string | undefined;
  // The server rejects state-changing requests that are not JSON (CSRF defence), so always send a JSON body.
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(serverUrl() + path, { method, headers, body: payload, credentials: native ? 'omit' : 'same-origin' });
  } catch {
    throw new ApiError(0, 'network_error', t('errors.network'));
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401 && !path.startsWith('/api/auth/')) unauthorizedHandler?.();
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body, opts),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Signs out of this tab's organization on the server and forgets this device's token for it. */
export async function signOut(): Promise<void> {
  try {
    await api.post('/api/auth/logout');
  } finally {
    storeDeviceToken(organization ?? '', null);
  }
}

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Text to show for an error. Server messages are English, so other languages use the message for a known error code. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && getLocale() !== 'en') {
    const translated = tryT(`errors.api.${err.code}`);
    if (translated) return translated;
  }
  if (err instanceof Error) return err.message;
  return t('common.somethingWentWrong');
}

/** The fields someone else changed meanwhile, when a save failed with 409 `edit_conflict`. */
export function editConflict(err: unknown): EditConflictDetails | null {
  if (!(err instanceof ApiError) || err.code !== 'edit_conflict' || !err.details || typeof err.details !== 'object') return null;
  const details = err.details as Partial<EditConflictDetails>;
  return typeof details.updatedAt === 'string' && Array.isArray(details.fields) ? (details as EditConflictDetails) : null;
}

/** Field api name a server validation error refers to, if any. */
export function errorField(err: unknown): string | null {
  if (err instanceof ApiError && err.details && typeof err.details === 'object' && 'field' in err.details) {
    const f = (err.details as { field?: unknown }).field;
    return typeof f === 'string' ? f : null;
  }
  return null;
}
