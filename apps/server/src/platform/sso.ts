import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { type CacheProvider, type Profile, SAML, SamlStatusError, ValidateInResponseTo } from '@node-saml/node-saml';
import { type OidcSettings, type PublicSsoProvider, type SamlSettings, type SsoErrorReason, type SsoProvider, type SsoProviderType, ssoUrls } from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import { badRequest, conflict, notFound, nowIso } from '../util.ts';
import { type ChallengeStore, hashToken } from './challenges.ts';
import { isSafeIdpUrl, OidcClient } from './oidc.ts';
import type { SecretBox } from './secret-box.ts';
import type { UserService } from './users.ts';

const FLOW_TTL_MS = 10 * 60_000;
const COMPLETE_TTL_MS = 2 * 60_000;
const CLOCK_SKEW_MS = 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
const TRANSIENT_NAME_ID = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';
const SAML_EMAIL_ATTRIBUTES = ['email', 'mail', 'urn:oid:0.9.2342.19200300.100.1.3', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'Email', 'EmailAddress'];
const SAML_NAME_ATTRIBUTES = ['displayName', 'name', 'urn:oid:2.16.840.1.113730.3.1.241', 'http://schemas.microsoft.com/identity/claims/displayname', 'cn'];
const SAML_GIVEN_NAME = ['givenName', 'firstName', 'urn:oid:2.5.4.42', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'];
const SAML_SURNAME = ['sn', 'surname', 'lastName', 'urn:oid:2.5.4.4', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'];

/** A failed sign-in; `reason` is shown on the sign-in page, `message` only goes to the server log. */
export class SsoError extends Error {
  reason: SsoErrorReason;

  constructor(reason: SsoErrorReason, message: string = reason) {
    super(message);
    this.reason = reason;
  }
}

/** Provider settings as validated by the API schema. */
export interface SsoProviderInput {
  type: SsoProviderType;
  name: string;
  enabled: boolean;
  oidc?: { issuer: string; clientId: string; scopes: string; tokenAuthMethod: OidcSettings['tokenAuthMethod'] } | null;
  saml?: {
    entryPoint: string;
    idpIssuer?: string | null;
    idpCert: string;
    spEntityId?: string | null;
    emailAttribute?: string | null;
    nameAttribute?: string | null;
  } | null;
  clientSecret?: string;
  jit: boolean;
  defaultRole?: string | null;
  allowedDomains: string[];
}

interface ProviderRow {
  id: string;
  type: SsoProviderType;
  name: string;
  enabled: number;
  config: string;
  secret: string | null;
  jit: number;
  default_role: string | null;
  allowed_domains: string;
  created_at: string;
  updated_at: string;
}

/** Sign-in state between sending the browser to the identity provider and its answer. */
interface FlowState {
  providerId: string;
  /** SHA-256 of the cookie set on the browser that started the sign-in. */
  binding: string;
  next: string;
  baseUrl: string;
  nonce?: string;
  verifier?: string;
  requestId?: string;
  requestedAt?: string;
}

interface Identity {
  issuer: string;
  subject: string | null;
  email: string | null;
  name: string | null;
}

const str = (value: unknown): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/** Accepts one or more PEM certificates, or a bare base64 certificate. Returns them as PEM. */
export function parseCertificates(text: string): string[] {
  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  const bodies = blocks ? blocks.map((b) => b.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')) : [text];
  return bodies.map((body) => {
    const b64 = body.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw badRequest('saml.idpCert: Paste the identity provider certificate in PEM format');
    const pem = `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----`;
    try {
      new X509Certificate(pem);
    } catch {
      throw badRequest('saml.idpCert: The certificate could not be read');
    }
    return pem;
  });
}

function samlIdentity(profile: Profile, settings: SamlSettings): Identity {
  const attributes = (profile.attributes && typeof profile.attributes === 'object' ? profile.attributes : {}) as Record<string, unknown>;
  const first = (names: string[]) => names.map((n) => str(attributes[n])).find((v) => v) ?? null;
  const emailAttr = settings.emailAttribute ? str(attributes[settings.emailAttribute]) : first(SAML_EMAIL_ATTRIBUTES);
  const nameID = str(profile.nameID);
  const email = emailAttr ?? (nameID && EMAIL_RE.test(nameID) ? nameID : null);
  const name =
    (settings.nameAttribute ? str(attributes[settings.nameAttribute]) : first(SAML_NAME_ATTRIBUTES)) ??
    ([first(SAML_GIVEN_NAME), first(SAML_SURNAME)].filter(Boolean).join(' ') || null);
  // A transient NameID changes on every sign-in, so the email address identifies the user instead.
  const subject = nameID && profile.nameIDFormat !== TRANSIENT_NAME_ID ? nameID : email ? `email:${email.toLowerCase()}` : null;
  return { issuer: str(profile.issuer) ?? '', subject, email, name };
}

/** Request IDs for one sign-in: only the request this browser started is accepted. Assertion IDs are remembered for replay checks. */
function flowCache(challenges: ChallengeStore, requestId: string | null, requestedAt: string): CacheProvider {
  let pending: string | null = requestId ? requestedAt : null;
  const take = async (key: string | null) => {
    if (key !== requestId || pending === null) return null;
    const value = pending;
    pending = null;
    return value;
  };
  return {
    saveAsync: async (_key, value) => ({ value, createdAt: Date.now() }),
    getAsync: async (key) => (key === requestId ? pending : null),
    removeAsync: take,
    consumeAsync: take,
    saveIfAbsentAsync: (key, _value, expiresAtMs) => challenges.claim('saml_assertion', key, new Date(expiresAtMs)),
  };
}

export class SsoService {
  private db: Db;
  private users: UserService;
  private secrets: SecretBox;
  private challenges: ChallengeStore;
  readonly oidc = new OidcClient();

  constructor(db: Db, users: UserService, secrets: SecretBox, challenges: ChallengeStore) {
    this.db = db;
    this.users = users;
    this.secrets = secrets;
    this.challenges = challenges;
  }

  // ---------- administration ----------

  private dto(row: ProviderRow, baseUrl: string): SsoProvider {
    const config = parseJson<OidcSettings | SamlSettings>(row.config, {} as OidcSettings);
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      enabled: !!Number(row.enabled),
      config,
      hasSecret: !!row.secret,
      jit: !!Number(row.jit),
      defaultRole: row.default_role,
      allowedDomains: parseJson<string[]>(row.allowed_domains, []),
      urls: ssoUrls(baseUrl, row.id, row.type, row.type === 'saml' ? (config as SamlSettings).spEntityId : null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private row(id: string): Promise<ProviderRow | undefined> {
    return this.db.get<ProviderRow>('SELECT * FROM sso_providers WHERE id = ?', [id]);
  }

  async list(baseUrl: string): Promise<SsoProvider[]> {
    const rows = await this.db.all<ProviderRow>('SELECT * FROM sso_providers ORDER BY name');
    return rows.map((r) => this.dto(r, baseUrl));
  }

  async get(id: string, baseUrl: string): Promise<SsoProvider> {
    const row = await this.row(id);
    if (!row) throw notFound('Single sign-on provider not found');
    return this.dto(row, baseUrl);
  }

  /** Providers shown on the sign-in page. */
  async publicList(): Promise<PublicSsoProvider[]> {
    return this.db.all<PublicSsoProvider>('SELECT id, name, type FROM sso_providers WHERE enabled = 1 ORDER BY name');
  }

  private async validate(input: SsoProviderInput, existing?: ProviderRow) {
    let config: OidcSettings | SamlSettings;
    let secret: string | null = null;
    if (input.type === 'oidc') {
      const o = input.oidc;
      if (!o) throw badRequest('oidc: OpenID Connect settings are required');
      const issuer = o.issuer.trim();
      if (!isSafeIdpUrl(issuer)) throw badRequest('oidc.issuer: Use the https:// address of the identity provider');
      const scopes = new Set(o.scopes.split(/\s+/).filter(Boolean));
      scopes.add('openid');
      config = { issuer, clientId: o.clientId.trim(), scopes: ['openid', ...[...scopes].filter((x) => x !== 'openid')].join(' '), tokenAuthMethod: o.tokenAuthMethod };
      secret = input.clientSecret === undefined ? (existing?.secret ?? null) : input.clientSecret === '' ? null : this.secrets.seal(input.clientSecret);
    } else {
      const sm = input.saml;
      if (!sm) throw badRequest('saml: SAML settings are required');
      const entryPoint = sm.entryPoint.trim();
      if (!isSafeIdpUrl(entryPoint)) throw badRequest('saml.entryPoint: Use the https:// single sign-on URL of the identity provider');
      config = {
        entryPoint,
        idpIssuer: sm.idpIssuer?.trim() || null,
        idpCert: parseCertificates(sm.idpCert).join('\n'),
        spEntityId: sm.spEntityId?.trim() || null,
        emailAttribute: sm.emailAttribute?.trim() || null,
        nameAttribute: sm.nameAttribute?.trim() || null,
      };
    }
    const defaultRole = input.defaultRole || null;
    if (input.jit && !defaultRole) throw badRequest('defaultRole: Choose the role that new users get');
    if (defaultRole) {
      const role = await this.users.getRole(defaultRole);
      if (!role) throw badRequest(`defaultRole: Unknown role ${defaultRole}`);
      if (role.permissions.setup) throw badRequest('defaultRole: Choose a role without Setup access for new users');
    }
    const allowedDomains = [...new Set(input.allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
    const invalid = allowedDomains.find((d) => !DOMAIN_RE.test(d));
    if (invalid) throw badRequest(`allowedDomains: "${invalid}" is not a domain name`);
    return { config, secret, defaultRole, allowedDomains };
  }

  async create(id: string, input: SsoProviderInput, baseUrl: string): Promise<SsoProvider> {
    if (await this.row(id)) throw conflict(`A single sign-on provider with the id ${id} already exists`);
    const v = await this.validate(input);
    const now = nowIso();
    await this.db.run(
      `INSERT INTO sso_providers (id, type, name, enabled, config, secret, jit, default_role, allowed_domains, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.type, input.name.trim(), input.enabled ? 1 : 0, JSON.stringify(v.config), v.secret, input.jit ? 1 : 0, v.defaultRole, JSON.stringify(v.allowedDomains), now, now],
    );
    return this.get(id, baseUrl);
  }

  async update(id: string, input: SsoProviderInput, baseUrl: string): Promise<SsoProvider> {
    const existing = await this.row(id);
    if (!existing) throw notFound('Single sign-on provider not found');
    if (existing.type !== input.type) throw badRequest('type: The type of a provider cannot be changed');
    const v = await this.validate(input, existing);
    await this.db.run(
      `UPDATE sso_providers SET name = ?, enabled = ?, config = ?, secret = ?, jit = ?, default_role = ?, allowed_domains = ?, updated_at = ? WHERE id = ?`,
      [input.name.trim(), input.enabled ? 1 : 0, JSON.stringify(v.config), v.secret, input.jit ? 1 : 0, v.defaultRole, JSON.stringify(v.allowedDomains), nowIso(), id],
    );
    return this.get(id, baseUrl);
  }

  /** Deletes a provider and its links to users; users keep their accounts. */
  async remove(id: string): Promise<void> {
    if (!(await this.row(id))) throw notFound('Single sign-on provider not found');
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM user_identities WHERE provider_id = ?', [id]);
      await tx.run('DELETE FROM sso_providers WHERE id = ?', [id]);
    });
  }

  // ---------- sign-in ----------

  private async enabledProvider(id: string, type?: SsoProviderType) {
    const row = await this.row(id);
    if (!row || !Number(row.enabled) || (type && row.type !== type)) throw new SsoError('disabled', `Provider ${id} does not exist or is turned off`);
    return { row, config: parseJson<OidcSettings | SamlSettings>(row.config, {} as OidcSettings) };
  }

  private saml(row: ProviderRow, settings: SamlSettings, baseUrl: string, cache: CacheProvider, requestId?: string): SAML {
    const urls = ssoUrls(baseUrl, row.id, 'saml', settings.spEntityId);
    return new SAML({
      entryPoint: settings.entryPoint,
      issuer: urls.entityId!,
      audience: urls.entityId!,
      callbackUrl: urls.acs!,
      idpCert: parseCertificates(settings.idpCert),
      idpIssuer: settings.idpIssuer ?? undefined,
      // Let the identity provider choose the NameID format and how users authenticate (e.g. with its own MFA).
      identifierFormat: null,
      disableRequestedAuthnContext: true,
      // Either the response or the assertion must carry a valid signature; node-saml requires one when neither is demanded.
      wantAuthnResponseSigned: false,
      wantAssertionsSigned: false,
      acceptedClockSkewMs: CLOCK_SKEW_MS,
      // Only responses to a request this browser started are accepted (no identity-provider-initiated sign-in).
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: FLOW_TTL_MS,
      rejectReplayedAssertions: true,
      cacheProvider: cache,
      ...(requestId ? { generateUniqueId: () => requestId } : {}),
    });
  }

  /** Starts a sign-in and returns the identity provider URL to send the browser to. `cookie` is set on that browser. */
  async start(id: string, baseUrl: string, next: string, cookie: string): Promise<string> {
    const { row, config } = await this.enabledProvider(id);
    const state: FlowState = { providerId: id, binding: hashToken(cookie), next, baseUrl };
    if (row.type === 'oidc') {
      const settings = config as OidcSettings;
      const doc = await this.oidc.discover(settings.issuer);
      const verifier = randomBytes(32).toString('base64url');
      const nonce = randomBytes(16).toString('base64url');
      const token = await this.challenges.create('sso_state', null, { ...state, verifier, nonce }, FLOW_TTL_MS);
      return this.oidc.authorizationUrl(doc, settings, {
        redirectUri: ssoUrls(baseUrl, id, 'oidc').redirect!,
        state: token,
        nonce,
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      });
    }
    const requestId = `_${randomBytes(20).toString('hex')}`;
    const token = await this.challenges.create('sso_state', null, { ...state, requestId, requestedAt: nowIso() }, FLOW_TTL_MS);
    return this.saml(row, config as SamlSettings, baseUrl, flowCache(this.challenges, null, ''), requestId).getAuthorizeUrlAsync(token, {});
  }

  private bound(binding: unknown, cookie: string | undefined): boolean {
    if (!cookie || typeof binding !== 'string') return false;
    const a = Buffer.from(hashToken(cookie));
    const b = Buffer.from(binding);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Takes the sign-in state for an answer from the identity provider; it can be used once. */
  private async takeFlow(token: string | undefined, providerId: string, cookie: string | undefined | false): Promise<FlowState> {
    const ch = token ? await this.challenges.find<FlowState>(token, 'sso_state') : null;
    if (!ch || ch.data.providerId !== providerId) throw new SsoError('expired', 'Unknown or expired sign-in state');
    // The SAML response arrives in a cross-site POST without our cookie; the browser is checked at completeSaml instead.
    if (cookie !== false && !this.bound(ch.data.binding, cookie)) throw new SsoError('expired', 'The sign-in was started in another browser');
    if (!(await this.challenges.consume(ch.id))) throw new SsoError('expired', 'The sign-in response was already used');
    return ch.data;
  }

  /** OpenID Connect redirect back from the identity provider. */
  async oidcCallback(id: string, query: Record<string, string | undefined>, cookie: string | undefined): Promise<{ userId: string; next: string }> {
    const flow = await this.takeFlow(query.state, id, cookie);
    if (query.error) {
      throw new SsoError(query.error === 'access_denied' ? 'denied' : 'failed', `The identity provider answered ${query.error}${query.error_description ? `: ${query.error_description}` : ''}`);
    }
    if (!query.code || !flow.verifier || !flow.nonce) throw new SsoError('failed', 'The identity provider sent no authorization code');
    const { row, config } = await this.enabledProvider(id, 'oidc');
    const settings = config as OidcSettings;
    const doc = await this.oidc.discover(settings.issuer);
    const secret = row.secret ? this.secrets.open(row.secret) : null;
    const tokens = await this.oidc.exchangeCode(doc, settings, secret, { code: query.code, redirectUri: ssoUrls(flow.baseUrl, id, 'oidc').redirect!, verifier: flow.verifier });
    const claims = await this.oidc.verifyIdToken(doc, settings, tokens.idToken, flow.nonce);
    let email = str(claims.email);
    let verified = claims.email_verified;
    let name = str(claims.name) ?? ([str(claims.given_name), str(claims.family_name)].filter(Boolean).join(' ') || null);
    if (!email && tokens.accessToken) {
      const info = await this.oidc.userinfo(doc, tokens.accessToken);
      if (info.sub === claims.sub) {
        email = str(info.email);
        verified = info.email_verified;
        name ??= str(info.name);
      }
    }
    if (email && (verified === false || verified === 'false')) throw new SsoError('unverified_email', `The identity provider has not verified ${email}`);
    const userId = await this.resolveUser(row, { issuer: doc.issuer, subject: claims.sub, email, name });
    return { userId, next: flow.next };
  }

  /** SAML response posted by the identity provider. Returns a token for completeSaml. */
  async samlResponse(id: string, samlResponse: string, relayState: string): Promise<string> {
    const flow = await this.takeFlow(relayState, id, false);
    if (!flow.requestId) throw new SsoError('expired', 'The sign-in state has no SAML request');
    const { row, config } = await this.enabledProvider(id, 'saml');
    const settings = config as SamlSettings;
    if (!samlResponse) throw new SsoError('failed', 'The form has no SAMLResponse');
    let profile: Profile | null;
    try {
      ({ profile } = await this.saml(row, settings, flow.baseUrl, flowCache(this.challenges, flow.requestId, flow.requestedAt ?? nowIso())).validatePostResponseAsync({
        SAMLResponse: samlResponse,
      }));
    } catch (err) {
      throw new SsoError(err instanceof SamlStatusError ? 'denied' : 'failed', `SAML response rejected: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!profile || profile.inResponseTo !== flow.requestId) throw new SsoError('failed', 'The SAML response does not answer this sign-in request');
    const userId = await this.resolveUser(row, samlIdentity(profile, settings));
    return this.challenges.create('sso_complete', userId, { binding: flow.binding, next: flow.next }, COMPLETE_TTL_MS);
  }

  /** Finishes a SAML sign-in in the browser that started it (the response itself was posted without our cookies). */
  async completeSaml(token: string, cookie: string | undefined): Promise<{ userId: string; next: string }> {
    const ch = token ? await this.challenges.find<{ binding: string; next: string }>(token, 'sso_complete') : null;
    if (!ch?.userId || !this.bound(ch.data.binding, cookie)) throw new SsoError('expired', 'Unknown or expired sign-in, or another browser');
    if (!(await this.challenges.consume(ch.id))) throw new SsoError('expired', 'The sign-in was already completed');
    return { userId: ch.userId, next: ch.data.next };
  }

  /** Service provider metadata to import into the identity provider. Served while the provider is off, for setup. */
  async samlMetadata(id: string, baseUrl: string): Promise<string> {
    const row = await this.row(id);
    if (!row || row.type !== 'saml') throw notFound('SAML provider not found');
    return this.saml(row, parseJson<SamlSettings>(row.config, {} as SamlSettings), baseUrl, flowCache(this.challenges, null, '')).generateServiceProviderMetadata(null, null);
  }

  /**
   * The user for an identity: the linked one, else the user with the same email address (which is then linked),
   * else a new user when the provider creates users on first sign-in.
   */
  private async resolveUser(row: ProviderRow, identity: Identity): Promise<string> {
    const email = identity.email && EMAIL_RE.test(identity.email) ? identity.email.toLowerCase() : null;
    const domains = parseJson<string[]>(row.allowed_domains, []);
    if (domains.length) {
      if (!email) throw new SsoError('no_email', 'The identity provider sent no email address');
      if (!domains.includes(email.slice(email.lastIndexOf('@') + 1))) throw new SsoError('domain_not_allowed', `${email} is not in an allowed domain`);
    }
    if (!identity.subject) throw new SsoError('no_email', 'The identity provider sent neither a stable user id nor an email address');
    // Qualified by issuer, so links do not carry over if the provider is pointed at another identity provider.
    const subject = `${identity.issuer}|${identity.subject}`;
    const now = nowIso();
    const assertActive = async (userId: string) => {
      const user = await this.db.get<{ active: number; is_agent: number }>('SELECT active, is_agent FROM users WHERE id = ?', [userId]);
      if (!user || !Number(user.active) || Number(user.is_agent)) throw new SsoError('inactive', `User ${userId} is deactivated`);
    };
    const linked = await this.db.get<{ user_id: string }>('SELECT user_id FROM user_identities WHERE provider_id = ? AND subject = ?', [row.id, subject]);
    if (linked) {
      await assertActive(linked.user_id);
      await this.db.run('UPDATE user_identities SET last_login_at = ?, email = COALESCE(?, email) WHERE provider_id = ? AND subject = ?', [now, email, row.id, subject]);
      return linked.user_id;
    }
    if (!email) throw new SsoError('no_email', 'The identity provider sent no email address');
    const byEmail = async () => (await this.db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]))?.id;
    let userId = await byEmail();
    if (!userId) {
      if (!Number(row.jit) || !row.default_role) throw new SsoError('not_provisioned', `No user has the email ${email}`);
      try {
        const name = (identity.name || email.slice(0, email.indexOf('@'))).slice(0, 100);
        userId = (await this.users.createUser({ email, name, roleId: row.default_role, password: null })).id;
      } catch (err) {
        // Another sign-in may have just created the user.
        userId = await byEmail();
        if (!userId) throw err;
      }
    }
    await assertActive(userId);
    await this.db.run(
      'INSERT INTO user_identities (provider_id, subject, user_id, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (provider_id, subject) DO NOTHING',
      [row.id, subject, userId, email, now, now],
    );
    return userId;
  }
}
