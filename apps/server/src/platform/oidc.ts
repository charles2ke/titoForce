import { constants, createPublicKey, verify as cryptoVerify, type JsonWebKeyInput } from 'node:crypto';
import type { OidcSettings } from '@titoforce/shared';

/** OpenID Connect discovery document fields used for the authorization code flow. */
export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

export type OidcClaims = Record<string, unknown> & { sub: string };

export class OidcError extends Error {}

type JsonWebKey = JsonWebKeyInput['key'] & { kid?: string; use?: string; alg?: string };

const CACHE_MS = 60 * 60_000;
const CLOCK_SKEW_S = 60;
const TIMEOUT_MS = 10_000;

// Asymmetric algorithms only: "none" and shared-secret HS* tokens are refused.
const ALGS: Record<string, { hash: string; kty: 'RSA' | 'EC'; pss?: boolean }> = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  RS384: { hash: 'sha384', kty: 'RSA' },
  RS512: { hash: 'sha512', kty: 'RSA' },
  PS256: { hash: 'sha256', kty: 'RSA', pss: true },
  PS384: { hash: 'sha384', kty: 'RSA', pss: true },
  PS512: { hash: 'sha512', kty: 'RSA', pss: true },
  ES256: { hash: 'sha256', kty: 'EC' },
  ES384: { hash: 'sha384', kty: 'EC' },
  ES512: { hash: 'sha512', kty: 'EC' },
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Identity provider URLs must use HTTPS; plain HTTP is accepted on this machine only, for development and tests. */
export function isSafeIdpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  } catch {
    return false;
  }
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // reported below
  }
  throw new OidcError('The ID token is malformed');
}

export class OidcClient {
  /** Replaced in tests with a fake identity provider. */
  fetchImpl: typeof fetch = (...args) => fetch(...args);
  private discoveries = new Map<string, { doc: OidcDiscovery; at: number }>();
  private jwks = new Map<string, { keys: JsonWebKey[]; at: number }>();

  private async fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    if (!isSafeIdpUrl(url)) throw new OidcError(`Refusing to call ${url}: identity provider URLs must use HTTPS`);
    const res = await this.fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // handled below
    }
    if (!res.ok) {
      const err = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      throw new OidcError(`${url} answered ${res.status}${err.error ? ` (${String(err.error)}${err.error_description ? `: ${String(err.error_description)}` : ''})` : ''}`);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OidcError(`${url} did not return a JSON object`);
    return body as Record<string, unknown>;
  }

  async discover(issuer: string): Promise<OidcDiscovery> {
    const cached = this.discoveries.get(issuer);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.doc;
    const doc = await this.fetchJson(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`);
    // The issuer a discovery document names must be the one configured (OpenID Connect Discovery 1.0, section 4.3).
    if (doc.issuer !== issuer && doc.issuer !== issuer.replace(/\/+$/, '')) throw new OidcError(`The discovery document names issuer ${String(doc.issuer)}, not ${issuer}`);
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      if (typeof doc[key] !== 'string' || !isSafeIdpUrl(doc[key])) throw new OidcError(`The discovery document has no usable ${key}`);
    }
    const result: OidcDiscovery = {
      issuer: doc.issuer as string,
      authorization_endpoint: doc.authorization_endpoint as string,
      token_endpoint: doc.token_endpoint as string,
      jwks_uri: doc.jwks_uri as string,
      userinfo_endpoint: typeof doc.userinfo_endpoint === 'string' && isSafeIdpUrl(doc.userinfo_endpoint) ? doc.userinfo_endpoint : undefined,
    };
    this.discoveries.set(issuer, { doc: result, at: Date.now() });
    return result;
  }

  authorizationUrl(doc: OidcDiscovery, settings: OidcSettings, p: { redirectUri: string; state: string; nonce: string; codeChallenge: string }): string {
    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', settings.clientId);
    url.searchParams.set('redirect_uri', p.redirectUri);
    url.searchParams.set('scope', settings.scopes);
    url.searchParams.set('state', p.state);
    url.searchParams.set('nonce', p.nonce);
    url.searchParams.set('code_challenge', p.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(doc: OidcDiscovery, settings: OidcSettings, secret: string | null, p: { code: string; redirectUri: string; verifier: string }) {
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier });
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    if (settings.tokenAuthMethod === 'client_secret_post' || !secret) {
      form.set('client_id', settings.clientId);
      if (secret) form.set('client_secret', secret);
    } else {
      // RFC 6749 section 2.3.1: both parts are form-encoded before Basic encoding.
      const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, '+');
      headers.authorization = `Basic ${Buffer.from(`${enc(settings.clientId)}:${enc(secret)}`).toString('base64')}`;
    }
    const body = await this.fetchJson(doc.token_endpoint, { method: 'POST', headers, body: form.toString() });
    if (typeof body.id_token !== 'string') throw new OidcError('The token response has no ID token');
    return { idToken: body.id_token, accessToken: typeof body.access_token === 'string' ? body.access_token : null };
  }

  private async keys(jwksUri: string, refresh: boolean): Promise<JsonWebKey[]> {
    const cached = this.jwks.get(jwksUri);
    // A refresh (for a key id we do not know, e.g. after key rotation) happens at most once a minute.
    if (cached && Date.now() - cached.at < (refresh ? 60_000 : CACHE_MS)) return cached.keys;
    const body = await this.fetchJson(jwksUri);
    const keys = Array.isArray(body.keys) ? (body.keys as JsonWebKey[]).filter((k) => k && typeof k === 'object') : [];
    this.jwks.set(jwksUri, { keys, at: Date.now() });
    return keys;
  }

  /** Verifies an ID token's signature and claims (OpenID Connect Core 1.0, section 3.1.3.7). */
  async verifyIdToken(doc: OidcDiscovery, settings: OidcSettings, token: string, nonce: string, nowMs = Date.now()): Promise<OidcClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new OidcError('The ID token is malformed');
    const [h, p, sig] = parts as [string, string, string];
    const header = decodeSegment(h);
    const alg = typeof header.alg === 'string' ? ALGS[header.alg] : undefined;
    if (!alg) throw new OidcError(`ID tokens signed with ${String(header.alg)} are not accepted`);
    const kid = typeof header.kid === 'string' ? header.kid : null;
    const signed = Buffer.from(`${h}.${p}`);
    const signature = Buffer.from(sig, 'base64url');
    const check = (keys: JsonWebKey[]) =>
      keys
        .filter((k) => k.kty === alg.kty && (!kid || k.kid === kid) && (!k.use || k.use === 'sig') && (!k.alg || k.alg === header.alg))
        .some((jwk) => {
          try {
            const key = createPublicKey({ key: jwk, format: 'jwk' });
            if (alg.kty === 'EC') return cryptoVerify(alg.hash, signed, { key, dsaEncoding: 'ieee-p1363' }, signature);
            if (alg.pss) return cryptoVerify(alg.hash, signed, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, signature);
            return cryptoVerify(alg.hash, signed, key, signature);
          } catch {
            return false;
          }
        });
    let keys = await this.keys(doc.jwks_uri, false);
    let valid = check(keys);
    if (!valid && kid && !keys.some((k) => k.kid === kid)) {
      keys = await this.keys(doc.jwks_uri, true);
      valid = check(keys);
    }
    if (!valid) throw new OidcError('The ID token signature is not valid');

    const claims = decodeSegment(p);
    const now = nowMs / 1000;
    if (claims.iss !== doc.issuer) throw new OidcError('The ID token was issued by another issuer');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(settings.clientId)) throw new OidcError('The ID token is meant for another client');
    if ((aud.length > 1 || claims.azp !== undefined) && claims.azp !== settings.clientId) throw new OidcError('The ID token is meant for another client');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new OidcError('The ID token has expired');
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > now) throw new OidcError('The ID token was issued in the future');
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > now) throw new OidcError('The ID token is not valid yet');
    if (claims.nonce !== nonce) throw new OidcError('The ID token does not belong to this sign-in');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new OidcError('The ID token has no subject');
    return claims as OidcClaims;
  }

  async userinfo(doc: OidcDiscovery, accessToken: string): Promise<Record<string, unknown>> {
    if (!doc.userinfo_endpoint) return {};
    return this.fetchJson(doc.userinfo_endpoint, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
  }
}
