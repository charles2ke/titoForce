import { createHash, generateKeyPairSync, type KeyObject, randomUUID, sign } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import type { RoleDef, RolePermissions, UserDTO } from '@titoforce/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { buildApp } from '../src/app.ts';
import { SecretBox } from '../src/platform/secret-box.ts';
import { base32Decode, base32Encode, hotp, matchTotp, totp } from '../src/platform/totp.ts';
import { safeNext } from '../src/routes/sso.ts';
import type { Services } from '../src/services.ts';
import { AppError } from '../src/util.ts';
import { createTestServices, demoUser } from './helpers.ts';

const BASE = 'https://crm.example.com';
const PASSWORD = 'titoforce';
const JSON_HEADERS = { 'content-type': 'application/json' };

let s: Services;
let app: FastifyInstance;
let admin: string;
/** Clock for one-time passwords; advanced a 30-second step whenever a test needs a new code. */
let clock = Date.now();
const tick = () => {
  clock += 30_000;
};

beforeAll(async () => {
  s = await createTestServices({ env: { TITO_SECRET_KEY: 'security-test-key', TITO_PUBLIC_URL: BASE } });
  s.mfa.now = () => clock;
  app = await buildApp(s);
  admin = await login('admin');
});
afterAll(async () => {
  await app?.close();
  await s?.close();
});

const cookieOf = (res: LightMyRequestResponse, name: string) => res.cookies.find((c) => c.name === name)?.value;

function post(url: string, payload: object, cookie?: string) {
  return app.inject({ method: 'POST', url, headers: { ...JSON_HEADERS, ...(cookie ? { cookie } : {}) }, payload });
}

async function login(key: string): Promise<string> {
  const res = await post('/api/auth/login', { email: `${key}@titoforce.example`, password: PASSWORD });
  expect(res.statusCode).toBe(200);
  return `tf_session=${cookieOf(res, 'tf_session')}`;
}

/** A well-formed code that the authenticator would not show now. */
function wrongCode(secret: string): string {
  for (let n = 0; ; n++) {
    const code = String(n).padStart(6, '0');
    if (matchTotp(secret, code, clock) === null) return code;
  }
}

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
  } catch (err) {
    return err instanceof AppError ? err.code : String(err);
  }
  return null;
}

describe('one-time passwords and stored secrets', () => {
  it('match the RFC 4226 and RFC 6238 test vectors', () => {
    const key = Buffer.from('12345678901234567890');
    expect([0, 1, 2, 9].map((counter) => hotp(key, counter))).toEqual(['755224', '287082', '359152', '520489']);
    const secret = base32Encode(key);
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret.toLowerCase())).toEqual(key);
    expect([59, 1_111_111_109, 1_234_567_890].map((t) => totp(secret, t * 1000))).toEqual(['287082', '081804', '005924']);
  });

  it('are encrypted at rest when TITO_SECRET_KEY is set, and rejected when tampered with or the key is wrong', () => {
    const box = new SecretBox('key-one');
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).toMatch(/^enc1:/);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.seal('JBSWY3DPEHPK3PXP')).not.toBe(sealed);
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    // Values stored before a key was configured stay readable.
    expect(box.open('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
    const raw = Buffer.from(sealed.slice('enc1:'.length), 'base64url');
    raw[raw.length - 1]! ^= 1;
    expect(errorCode(() => box.open(`enc1:${raw.toString('base64url')}`))).toBe('secret_key_mismatch');
    expect(errorCode(() => new SecretBox('key-two').open(sealed))).toBe('secret_key_mismatch');
    expect(errorCode(() => new SecretBox(null).open(sealed))).toBe('secret_key_missing');
    expect(new SecretBox(null).seal('plain')).toBe('plain');
  });
});

describe('two-factor authentication', () => {
  const signIn = async (email: string) => (await post('/api/auth/login', { email, password: PASSWORD })).json();

  it('is turned on with a code and the password, then asked for at every password sign-in', async () => {
    const liam = await login('liam');
    const otherDevice = await login('liam');
    expect((await app.inject({ url: '/api/auth/mfa', headers: { cookie: liam } })).json()).toEqual({
      enabled: false,
      required: false,
      recoveryCodesLeft: 0,
      enabledAt: null,
      hasPassword: true,
    });
    const setup = (await post('/api/auth/mfa/setup', {}, liam)).json();
    expect(setup.uri).toBe(`otpauth://totp/titoForce:liam%40titoforce.example?secret=${setup.secret}&issuer=titoForce&algorithm=SHA1&digits=6&period=30`);
    expect((await post('/api/auth/mfa/enable', { code: wrongCode(setup.secret), password: PASSWORD }, liam)).json().error.code).toBe('invalid_code');
    const enabled = await post('/api/auth/mfa/enable', { code: totp(setup.secret, clock), password: PASSWORD }, liam);
    expect(enabled.statusCode).toBe(200);
    const { recoveryCodes } = enabled.json() as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    // Sessions that did not use the second factor are signed out; the current one stays.
    expect((await app.inject({ url: '/api/auth/session', headers: { cookie: otherDevice } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/session', headers: { cookie: liam } })).statusCode).toBe(200);
    const stored = await s.db.get<{ secret: string }>('SELECT secret FROM user_mfa WHERE user_id = ?', [(await demoUser(s, 'liam')).id]);
    expect(stored!.secret).toMatch(/^enc1:/);

    const first = await post('/api/auth/login', { email: 'liam@titoforce.example', password: PASSWORD });
    expect(first.json()).toEqual({ mfaRequired: true, challenge: expect.any(String) });
    expect(cookieOf(first, 'tf_session')).toBeUndefined();
    const { challenge } = first.json();
    // The code that turned MFA on cannot be used again.
    expect((await post('/api/auth/mfa/verify', { challenge, code: totp(setup.secret, clock) })).json().error.code).toBe('invalid_code');
    tick();
    const verified = await post('/api/auth/mfa/verify', { challenge, code: totp(setup.secret, clock) });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().user.email).toBe('liam@titoforce.example');
    expect(cookieOf(verified, 'tf_session')).toBeTruthy();
    tick();
    expect((await post('/api/auth/mfa/verify', { challenge, code: totp(setup.secret, clock) })).json().error.code).toBe('challenge_expired');

    // Each recovery code works once.
    const withRecoveryCode = async () => post('/api/auth/mfa/verify', { challenge: (await signIn('liam@titoforce.example')).challenge, code: recoveryCodes[0]!.toUpperCase() });
    expect((await withRecoveryCode()).statusCode).toBe(200);
    expect((await withRecoveryCode()).json().error.code).toBe('invalid_code');
    expect((await app.inject({ url: '/api/auth/mfa', headers: { cookie: liam } })).json()).toMatchObject({ enabled: true, recoveryCodesLeft: 9 });

    tick();
    const regenerated = await post('/api/auth/mfa/recovery-codes', { code: totp(setup.secret, clock), password: PASSWORD }, liam);
    expect(regenerated.json().recoveryCodes).toHaveLength(10);
    tick();
    expect((await post('/api/auth/mfa/disable', { code: totp(setup.secret, clock), password: PASSWORD }, liam)).statusCode).toBe(200);
    expect(await signIn('liam@titoforce.example')).toMatchObject({ user: { email: 'liam@titoforce.example' } });
  });

  it('ends a sign-in attempt after five wrong codes and then pauses the account', async () => {
    const sofia = await demoUser(s, 'sofia');
    const { secret } = await s.mfa.beginEnrollment(sofia.id, sofia.email);
    await s.mfa.completeEnrollment(sofia.id, totp(secret, clock));
    tick();
    const { challenge } = await signIn(sofia.email);
    const wrong = wrongCode(secret);
    for (let i = 0; i < 4; i++) expect((await post('/api/auth/mfa/verify', { challenge, code: wrong })).json().error.code).toBe('invalid_code');
    expect((await post('/api/auth/mfa/verify', { challenge, code: wrong })).json().error.code).toBe('challenge_expired');
    expect((await post('/api/auth/mfa/verify', { challenge, code: totp(secret, clock) })).json().error.code).toBe('challenge_expired');
    const again = await post('/api/auth/mfa/verify', { challenge: (await signIn(sofia.email)).challenge, code: totp(secret, clock) });
    expect(again.statusCode).toBe(429);
  });

  it('is set up while signing in when the role requires it, and can be reset by administrators', async () => {
    const role = (await s.users.getRole('hr_manager'))!;
    const before = await login('hannah');
    const put = await app.inject({
      method: 'PUT',
      url: '/api/roles/hr_manager',
      headers: { cookie: admin, ...JSON_HEADERS },
      payload: { name: role.name, description: role.description, permissions: { ...role.permissions, requireMfa: true } },
    });
    expect(put.statusCode).toBe(200);
    const first = await signIn('hannah@titoforce.example');
    expect(first).toEqual({ mfaSetupRequired: true, challenge: expect.any(String) });
    const { secret } = (await post('/api/auth/mfa/enroll', { challenge: first.challenge })).json();
    const done = await post('/api/auth/mfa/verify', { challenge: first.challenge, code: totp(secret, clock) });
    expect(done.statusCode).toBe(200);
    expect(done.json().recoveryCodes).toHaveLength(10);
    // Sessions from before the second factor was set up end, as when it is turned on in settings.
    expect((await app.inject({ url: '/api/auth/session', headers: { cookie: before } })).statusCode).toBe(401);
    const hannah = `tf_session=${cookieOf(done, 'tf_session')}`;
    expect((await app.inject({ url: '/api/auth/mfa', headers: { cookie: hannah } })).json()).toMatchObject({ enabled: true, required: true });
    tick();
    expect((await post('/api/auth/mfa/disable', { code: totp(secret, clock), password: PASSWORD }, hannah)).statusCode).toBe(403);
    expect(await signIn('hannah@titoforce.example')).toMatchObject({ mfaRequired: true });

    // Administrators see who uses two-factor sign-in and can reset it, e.g. after a lost phone.
    const hannahId = (await demoUser(s, 'hannah')).id;
    const users = (await app.inject({ url: '/api/users', headers: { cookie: admin } })).json() as UserDTO[];
    expect(users.find((u) => u.id === hannahId)?.mfaEnabled).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${hannahId}/mfa`, headers: { cookie: await login('maria') } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${hannahId}/mfa`, headers: { cookie: admin } })).statusCode).toBe(200);
    expect(await signIn('hannah@titoforce.example')).toMatchObject({ mfaSetupRequired: true });
    await s.users.upsertRole(role);
  });

  it('ends sign-ins waiting for a second factor when the password changes or the user is deactivated', async () => {
    const noah = await demoUser(s, 'noah');
    const session = await login('noah');
    const role = (await s.users.getRole(noah.roleId))!;
    const challengeFor = async (password: string) => (await post('/api/auth/login', { email: noah.email, password })).json().challenge as string;
    const enroll = async (challenge: string) => (await post('/api/auth/mfa/enroll', { challenge })).json().error?.code;
    const update = (payload: object) => app.inject({ method: 'PATCH', url: `/api/users/${noah.id}`, headers: { cookie: admin, ...JSON_HEADERS }, payload });
    await s.users.upsertRole({ ...role, permissions: { ...role.permissions, requireMfa: true } });
    try {
      let challenge = await challengeFor(PASSWORD);
      expect((await post('/api/auth/password', { current: PASSWORD, next: 'changed-password' }, session)).statusCode).toBe(200);
      expect(await enroll(challenge)).toBe('challenge_expired');

      challenge = await challengeFor('changed-password');
      expect((await update({ password: PASSWORD })).statusCode).toBe(200);
      expect(await enroll(challenge)).toBe('challenge_expired');

      challenge = await challengeFor(PASSWORD);
      expect((await update({ active: false })).statusCode).toBe(200);
      expect((await update({ active: true })).statusCode).toBe(200);
      expect(await enroll(challenge)).toBe('challenge_expired');
      expect(await enroll(await challengeFor(PASSWORD))).toBeUndefined();
    } finally {
      await s.users.upsertRole(role);
      await s.users.updateUser(noah.id, { password: PASSWORD, active: true });
    }
  });
});

describe('field permission checks', () => {
  const asAdmin = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: admin, ...(payload ? JSON_HEADERS : {}) }, payload });
  const errorOf = (res: LightMyRequestResponse) => (res.json() as { error?: { message: string } }).error?.message;
  const saveRole = (role: RoleDef, fields: RolePermissions['fields'], description = role.description) =>
    asAdmin('PUT', `/api/roles/${role.id}`, { name: role.name, description, permissions: { ...role.permissions, fields } });

  it('rejects role settings that would show hidden values through a roll-up, its filter or its relationship', async () => {
    const marketing = (await s.users.getRole('marketing'))!;
    try {
      // Open Cases counts the cases of an account that are not closed.
      expect(errorOf(await saveRole(marketing, { case: { status: 'none' } }))).toBe(
        'Roll-up Account Open Cases is calculated from Case Status, which this role cannot see; hide it as well',
      );
      expect(errorOf(await saveRole(marketing, { case: { account: 'none' } }))).toBe(
        'Roll-up Account Open Cases is calculated from Case Account, which this role cannot see; hide it as well',
      );
      expect((await saveRole(marketing, { case: { status: 'none', account: 'none' }, account: { open_cases: 'none' } })).statusCode).toBe(200);
      // Problems saved before these checks existed do not block unrelated changes.
      await s.users.upsertRole({ ...marketing, permissions: { ...marketing.permissions, fields: { case: { status: 'none' } } } });
      expect((await saveRole(marketing, { case: { status: 'none' } }, 'Runs campaigns.')).statusCode).toBe(200);
    } finally {
      await s.users.upsertRole(marketing);
    }
  });

  it('rejects field and object changes that would show a role values it cannot see', async () => {
    // Annual Salary is sensitive, so roles that cannot view sensitive fields do not see it.
    const payBand = { label: 'Pay Band', apiName: 'pay_band', type: 'formula', formulaType: 'number', formula: 'salary / 1000' };
    expect(errorOf(await asAdmin('POST', '/api/objects/employee/fields', payBand))).toMatch(
      /^Formula Employee Pay Band is calculated from Annual Salary, which the .+ role cannot see; mark it as sensitive or hide it as well$/,
    );
    expect((await asAdmin('POST', '/api/objects/employee/fields', { ...payBand, sensitive: true })).statusCode).toBe(201);
    try {
      const marketing = (await s.users.getRole('marketing'))!;
      expect(errorOf(await saveRole(marketing, { employee: { pay_band: 'read' } }))).toBe(
        'Formula Employee Pay Band is calculated from Annual Salary, which this role cannot see; hide it as well',
      );
      expect(errorOf(await asAdmin('PATCH', '/api/objects/employee/fields/pay_band', { sensitive: false }))).toMatch(/^Formula Employee Pay Band is calculated from Annual Salary/);
      expect(errorOf(await asAdmin('PATCH', '/api/objects/employee', { nameTemplate: '{first_name} {last_name} {salary}' }))).toMatch(
        /^Employee Annual Salary is part of the record name, so the .+ role must be able to see it$/,
      );
    } finally {
      expect((await asAdmin('DELETE', '/api/objects/employee/fields/pay_band')).statusCode).toBe(200);
    }
  });
});

// ---------- single sign-on ----------

/** Each sign-in starts from its own address so the per-address limit on starting sign-ins stays out of the way. */
let addresses = 0;
const nextAddress = () => `10.0.${Math.floor(++addresses / 250)}.${(addresses % 250) + 1}`;

/** The sign-in page error a failed sign-in redirects to, or null when it succeeded. */
function ssoError(res: LightMyRequestResponse): string | null {
  expect(res.statusCode).toBe(303);
  const location = String(res.headers.location);
  return location.startsWith('/login?sso_error=') ? location.slice('/login?sso_error='.length) : null;
}

async function sessionUser(res: LightMyRequestResponse): Promise<UserDTO> {
  const token = cookieOf(res, 'tf_session');
  expect(token).toBeTruthy();
  const me = await app.inject({ url: '/api/auth/session', headers: { cookie: `tf_session=${token}` } });
  expect(me.statusCode).toBe(200);
  return me.json().user;
}

it('only redirects to paths on this site after signing in', () => {
  expect(safeNext('/app/sales?view=mine#top')).toBe('/app/sales?view=mine#top');
  for (const unsafe of ['https://evil.example', '//evil.example', '/\\evil.example', '/..//evil.example', '/./\t/evil.example', '/api/auth/logout', 'app', '/\r\nx', undefined]) {
    expect(safeNext(unsafe)).toBe('/');
  }
});

describe('OpenID Connect sign-in', () => {
  const ISSUER = 'https://idp.test';
  const idpKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const grants = new Map<string, { idToken: string; redirectUri: string; challenge: string }>();
  let userinfo: Record<string, unknown> = {};

  function jwt(claims: Record<string, unknown>, key: KeyObject = idpKey.privateKey): string {
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const data = `${enc({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${enc(claims)}`;
    return `${data}.${sign('sha256', Buffer.from(data), key).toString('base64url')}`;
  }

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  /** A fake identity provider: discovery, keys, the token endpoint (checking client authentication and PKCE) and userinfo. */
  const fakeIdp: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    switch (`${init?.method ?? 'GET'} ${url.origin}${url.pathname}`) {
      case `GET ${ISSUER}/.well-known/openid-configuration`:
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: `${ISSUER}/jwks`,
          userinfo_endpoint: `${ISSUER}/userinfo`,
        });
      case `GET ${ISSUER}/jwks`:
        return json({ keys: [{ ...idpKey.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] });
      case `POST ${ISSUER}/token`: {
        const form = new URLSearchParams(String(init?.body));
        const grant = grants.get(form.get('code') ?? '');
        grants.delete(form.get('code') ?? '');
        const authorized = new Headers(init?.headers).get('authorization') === `Basic ${Buffer.from('titoforce:s3cret').toString('base64')}`;
        const pkce = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === grant?.challenge;
        if (!grant || !authorized || !pkce || form.get('redirect_uri') !== grant.redirectUri) return json({ error: 'invalid_grant' }, 400);
        return json({ id_token: grant.idToken, access_token: 'access-token', token_type: 'Bearer' });
      }
      case `GET ${ISSUER}/userinfo`:
        return json(userinfo);
    }
    return json({ error: 'not_found' }, 404);
  };

  interface Started {
    cookie: string;
    state: string;
    nonce: string;
    challenge: string;
    redirectUri: string;
  }

  async function start(next = '/'): Promise<Started> {
    const res = await app.inject({ url: `/api/auth/sso/acme/start?next=${encodeURIComponent(next)}`, remoteAddress: nextAddress() });
    expect(res.statusCode).toBe(302);
    const url = new URL(String(res.headers.location));
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', client_id: 'titoforce', scope: 'openid email profile', code_challenge_method: 'S256' });
    const p = url.searchParams;
    return { cookie: `tf_sso=${cookieOf(res, 'tf_sso')}`, state: p.get('state')!, nonce: p.get('nonce')!, challenge: p.get('code_challenge')!, redirectUri: p.get('redirect_uri')! };
  }

  /** The identity provider signs the user in and sends the browser back with a code for an ID token with these claims. */
  function callback(flow: Started, claims: Record<string, unknown>, opts: { cookie?: string | null; idToken?: string } = {}) {
    const code = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const idToken = opts.idToken ?? jwt({ iss: ISSUER, aud: 'titoforce', iat: now, exp: now + 300, nonce: flow.nonce, ...claims });
    grants.set(code, { idToken, redirectUri: flow.redirectUri, challenge: flow.challenge });
    const cookie = opts.cookie === undefined ? flow.cookie : opts.cookie;
    return app.inject({ url: `/api/auth/sso/acme/callback?code=${code}&state=${encodeURIComponent(flow.state)}`, headers: cookie ? { cookie } : {} });
  }

  const provider = (body: Record<string, unknown>) =>
    app.inject({
      method: 'PUT',
      url: '/api/sso-providers/acme',
      headers: { cookie: admin, ...JSON_HEADERS },
      payload: { type: 'oidc', name: 'Acme SSO', oidc: { issuer: ISSUER, clientId: 'titoforce' }, ...body },
    });

  beforeAll(async () => {
    s.sso.oidc.fetchImpl = fakeIdp;
    const res = await post(
      '/api/sso-providers',
      { id: 'acme', type: 'oidc', name: 'Acme SSO', oidc: { issuer: ISSUER, clientId: 'titoforce' }, clientSecret: 's3cret' },
      admin,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ hasSecret: true, urls: { redirect: `${BASE}/api/auth/sso/acme/callback` } });
    expect(res.body).not.toContain('s3cret');
  });

  it('is managed by administrators and listed on the sign-in page while turned on', async () => {
    expect((await app.inject({ url: '/api/sso-providers', headers: { cookie: await login('maria') } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/sso-providers', headers: { cookie: admin } })).json()).toMatchObject({ baseUrl: BASE, providers: [{ id: 'acme' }] });
    const stored = await s.db.get<{ secret: string }>("SELECT secret FROM sso_providers WHERE id = 'acme'");
    expect(stored!.secret).toMatch(/^enc1:/);
    expect((await app.inject('/api/config')).json().sso).toEqual([{ id: 'acme', name: 'Acme SSO', type: 'oidc' }]);
    expect((await provider({ enabled: false })).json()).toMatchObject({ enabled: false, hasSecret: true });
    expect((await app.inject('/api/config')).json().sso).toEqual([]);
    expect(ssoError(await app.inject({ url: '/api/auth/sso/acme/start', remoteAddress: nextAddress() }))).toBe('disabled');
    // New users never get a role with setup access automatically.
    expect((await provider({ jit: true, defaultRole: 'admin' })).statusCode).toBe(400);
    expect((await provider({ enabled: true })).statusCode).toBe(200);
  });

  it('signs in the user with the same email and links the identity', async () => {
    const flow = await start('/app/sales?view=mine');
    expect(flow.redirectUri).toBe(`${BASE}/api/auth/sso/acme/callback`);
    const res = await callback(flow, { sub: 'james-1', email: 'James@titoforce.example', email_verified: true });
    expect(res.headers.location).toBe('/app/sales?view=mine');
    expect((await sessionUser(res)).email).toBe('james@titoforce.example');
    // The link holds when the email address changes at the identity provider.
    expect((await sessionUser(await callback(await start(), { sub: 'james-1', email: 'jchen@elsewhere.example' }))).email).toBe('james@titoforce.example');
    // Without an email in the ID token, the userinfo endpoint is asked, for the same subject only.
    userinfo = { sub: 'maria-1', email: 'maria@titoforce.example', email_verified: true };
    expect((await sessionUser(await callback(await start(), { sub: 'maria-1' }))).email).toBe('maria@titoforce.example');
    userinfo = { sub: 'someone-else', email: 'maria@titoforce.example' };
    expect(ssoError(await callback(await start(), { sub: 'maria-2' }))).toBe('no_email');
  });

  it('finishes a sign-in only once, in the browser that started it', async () => {
    const flow = await start();
    expect(ssoError(await callback(flow, { sub: 'james-1' }, { cookie: null }))).toBe('expired');
    expect(ssoError(await callback(flow, { sub: 'james-1' }, { cookie: 'tf_sso=another-browser' }))).toBe('expired');
    expect(ssoError(await callback(flow, { sub: 'james-1' }))).toBeNull();
    expect(ssoError(await callback(flow, { sub: 'james-1' }))).toBe('expired');
  });

  it('rejects forged, expired or misdirected ID tokens and reports refusals', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forgedFlow = await start();
    const forged = jwt({ iss: ISSUER, aud: 'titoforce', sub: 'james-1', iat: now, exp: now + 300, nonce: forgedFlow.nonce }, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey);
    expect(ssoError(await callback(forgedFlow, {}, { idToken: forged }))).toBe('failed');
    expect(ssoError(await callback(await start(), { sub: 'james-1', nonce: 'from-another-sign-in' }))).toBe('failed');
    expect(ssoError(await callback(await start(), { sub: 'james-1', aud: 'another-app' }))).toBe('failed');
    expect(ssoError(await callback(await start(), { sub: 'james-1', iss: 'https://evil.example' }))).toBe('failed');
    expect(ssoError(await callback(await start(), { sub: 'james-1', exp: now - 3600 }))).toBe('failed');
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: ISSUER, aud: 'titoforce', sub: 'james-1', exp: now + 300 })).toString('base64url')}.`;
    expect(ssoError(await callback(await start(), {}, { idToken: unsigned }))).toBe('failed');
    const refused = await start();
    const res = await app.inject({ url: `/api/auth/sso/acme/callback?error=access_denied&state=${encodeURIComponent(refused.state)}`, headers: { cookie: refused.cookie } });
    expect(ssoError(res)).toBe('denied');
  });

  it('creates users on first sign-in only when allowed, within the allowed domains', async () => {
    const newcomer = { sub: 'new-1', email: 'new.person@acme.example', email_verified: true, name: 'New Person' };
    expect(ssoError(await callback(await start(), newcomer))).toBe('not_provisioned');
    const updated = await provider({ jit: true, defaultRole: 'employee', allowedDomains: ['@Acme.example'] });
    expect(updated.json()).toMatchObject({ jit: true, defaultRole: 'employee', allowedDomains: ['acme.example'], hasSecret: true });
    const created = await callback(await start(), newcomer);
    const user = await sessionUser(created);
    expect(user).toMatchObject({ email: 'new.person@acme.example', name: 'New Person', roleId: 'employee' });
    // Users without a password leave two-factor authentication to the identity provider.
    const cookie = `tf_session=${cookieOf(created, 'tf_session')}`;
    expect((await app.inject({ url: '/api/auth/mfa', headers: { cookie } })).json()).toMatchObject({ hasPassword: false });
    expect((await post('/api/auth/mfa/setup', {}, cookie)).statusCode).toBe(400);
    expect((await post('/api/auth/login', { email: 'new.person@acme.example', password: 'anything' })).statusCode).toBe(401);

    // The domain list applies to linked identities too, and unverified addresses are refused.
    expect(ssoError(await callback(await start(), { sub: 'james-1', email: 'james@titoforce.example' }))).toBe('domain_not_allowed');
    expect(ssoError(await callback(await start(), { sub: 'new-2', email: 'other@acme.example', email_verified: false }))).toBe('unverified_email');
    await s.users.updateUser(user.id, { active: false });
    expect(ssoError(await callback(await start(), newcomer))).toBe('inactive');
    expect((await provider({ jit: false, defaultRole: null, allowedDomains: [] })).statusCode).toBe(200);
  });
});

describe('SAML sign-in', () => {
  const IDP = 'https://idp.test/saml';
  const SP = `${BASE}/api/auth/sso/corp/metadata`;
  const ACS = `${BASE}/api/auth/sso/corp/acs`;
  const idpKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

  /** DER encoding of one ASN.1 element. */
  function der(tag: number, ...content: Buffer[]): Buffer {
    const body = Buffer.concat(content);
    let length = Buffer.from([body.length]);
    if (body.length >= 0x80) {
      const hex = body.length.toString(16);
      const bytes = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
      length = Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]);
    }
    return Buffer.concat([Buffer.from([tag]), length, body]);
  }

  /** A self-signed X.509 certificate for the identity provider key (node:crypto reads certificates but cannot create them). */
  function selfSignedCertificate(): string {
    const seq = (...content: Buffer[]) => der(0x30, ...content);
    const sha256WithRsa = seq(der(0x06, Buffer.from('2a864886f70d01010b', 'hex')), der(0x05));
    const name = der(0x30, der(0x31, seq(der(0x06, Buffer.from('550403', 'hex')), der(0x0c, Buffer.from('idp.test')))));
    const utcTime = (ms: number) => der(0x17, Buffer.from(`${new Date(ms).toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`));
    const tbs = seq(
      der(0xa0, der(0x02, Buffer.from([2]))),
      der(0x02, Buffer.from([1])),
      sha256WithRsa,
      name,
      seq(utcTime(Date.now() - 86_400_000), utcTime(Date.now() + 365 * 86_400_000)),
      name,
      idpKey.publicKey.export({ type: 'spki', format: 'der' }),
    );
    const certificate = seq(tbs, sha256WithRsa, der(0x03, Buffer.from([0]), sign('sha256', tbs, idpKey.privateKey)));
    return `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  }

  async function start(next = '/') {
    const res = await app.inject({ url: `/api/auth/sso/corp/start?next=${encodeURIComponent(next)}`, remoteAddress: nextAddress() });
    expect(res.statusCode).toBe(302);
    const url = new URL(String(res.headers.location));
    expect(`${url.origin}${url.pathname}`).toBe(`${IDP}/sso`);
    const request = inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest')!, 'base64')).toString('utf8');
    expect(request).toContain(`AssertionConsumerServiceURL="${ACS}"`);
    expect(request).toContain(`>${SP}</saml:Issuer>`);
    return { cookie: `tf_sso=${cookieOf(res, 'tf_sso')}`, relayState: url.searchParams.get('RelayState')!, requestId: /\sID="([^"]+)"/.exec(request)![1]! };
  }

  interface ResponseOptions {
    requestId: string;
    email?: string;
    nameId?: string;
    audience?: string;
    assertionId?: string;
    /** null leaves the assertion unsigned. */
    signWith?: KeyObject | null;
    status?: string;
  }

  /** A base64 SAML response from the identity provider, with a signed assertion. */
  function samlResponse(o: ResponseOptions): string {
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 5 * 60_000).toISOString();
    const assertionId = o.assertionId ?? `_a${randomUUID().replaceAll('-', '')}`;
    const assertion =
      `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${now}">` +
      `<saml:Issuer>${IDP}</saml:Issuer>` +
      `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${o.nameId ?? 'corp-james'}</saml:NameID>` +
      `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${o.requestId}" NotOnOrAfter="${later}" Recipient="${ACS}"/></saml:SubjectConfirmation></saml:Subject>` +
      `<saml:Conditions NotBefore="${now}" NotOnOrAfter="${later}"><saml:AudienceRestriction><saml:Audience>${o.audience ?? SP}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
      `<saml:AuthnStatement AuthnInstant="${now}" SessionIndex="${assertionId}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
      `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${o.email ?? 'james@titoforce.example'}</saml:AttributeValue></saml:Attribute>` +
      `<saml:Attribute Name="displayName"><saml:AttributeValue>James Chen</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>` +
      `</saml:Assertion>`;
    const xml =
      `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomUUID().replaceAll('-', '')}" Version="2.0" IssueInstant="${now}" Destination="${ACS}" InResponseTo="${o.requestId}">` +
      `<saml:Issuer>${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="${o.status ?? 'urn:oasis:names:tc:SAML:2.0:status:Success'}"/></samlp:Status>` +
      `${o.status ? '' : assertion}</samlp:Response>`;
    if (o.status || o.signWith === null) return Buffer.from(xml).toString('base64');
    const sig = new SignedXml({
      privateKey: (o.signWith ?? idpKey.privateKey).export({ type: 'pkcs8', format: 'pem' }),
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    sig.addReference({
      xpath: "//*[local-name(.)='Assertion']",
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
    sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } });
    return Buffer.from(sig.getSignedXml()).toString('base64');
  }

  /** The identity provider posts the response from its own site, so without our cookies. */
  const postResponse = (response: string, relayState: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sso/corp/acs',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ SAMLResponse: response, RelayState: relayState }).toString(),
    });

  async function complete(posted: LightMyRequestResponse, cookie: string | null) {
    expect(posted.statusCode).toBe(303);
    const location = String(posted.headers.location);
    expect(location).toMatch(/^\/api\/auth\/sso\/complete\?token=/);
    return app.inject({ url: location, headers: cookie ? { cookie } : {} });
  }

  beforeAll(async () => {
    const res = await post(
      '/api/sso-providers',
      { id: 'corp', type: 'saml', name: 'Corp SAML', saml: { entryPoint: `${IDP}/sso`, idpIssuer: IDP, idpCert: selfSignedCertificate() } },
      admin,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().urls).toEqual({ acs: ACS, entityId: SP, metadata: SP });
  });

  it('publishes service provider metadata', async () => {
    const res = await app.inject('/api/auth/sso/corp/metadata');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.body).toContain(`entityID="${SP}"`);
    expect(res.body).toContain(`Location="${ACS}"`);
    expect((await app.inject('/api/auth/sso/nope/metadata')).statusCode).toBe(404);
  });

  it('signs in with a signed assertion that answers the request of this browser', async () => {
    const flow = await start('/app/service');
    const posted = await postResponse(samlResponse({ requestId: flow.requestId }), flow.relayState);
    // The session is only created in the browser that started the sign-in.
    expect(ssoError(await complete(posted, null))).toBe('expired');
    const done = await complete(posted, flow.cookie);
    expect(done.headers.location).toBe('/app/service');
    expect((await sessionUser(done)).email).toBe('james@titoforce.example');
    expect(ssoError(await complete(posted, flow.cookie))).toBe('expired');
  });

  it('rejects replayed, unsigned, forged and misdirected responses', async () => {
    const flow = await start();
    const response = samlResponse({ requestId: flow.requestId, assertionId: '_replayed-assertion' });
    expect(ssoError(await complete(await postResponse(response, flow.relayState), flow.cookie))).toBeNull();
    expect(ssoError(await postResponse(response, flow.relayState))).toBe('expired');

    const attempt = async (make: (requestId: string) => string) => {
      const f = await start();
      return ssoError(await postResponse(make(f.requestId), f.relayState));
    };
    // The same assertion id again, even for a new request, is a replay.
    expect(await attempt((requestId) => samlResponse({ requestId, assertionId: '_replayed-assertion' }))).toBe('failed');
    expect(await attempt((requestId) => samlResponse({ requestId, signWith: null }))).toBe('failed');
    expect(await attempt((requestId) => samlResponse({ requestId, signWith: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey }))).toBe('failed');
    expect(await attempt((requestId) => samlResponse({ requestId, audience: 'https://another-app.example' }))).toBe('failed');
    expect(await attempt(() => samlResponse({ requestId: '_a-request-from-another-browser' }))).toBe('failed');
    expect(await attempt((requestId) => samlResponse({ requestId, status: 'urn:oasis:names:tc:SAML:2.0:status:Responder' }))).toBe('denied');
    expect(await attempt((requestId) => samlResponse({ requestId, email: 'nobody@corp.example', nameId: 'corp-nobody' }))).toBe('not_provisioned');
  });

  it('accepts form posts only at the assertion consumer service', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'email=a%40b.example&password=x' });
    expect(res.statusCode).toBe(415);
  });
});
