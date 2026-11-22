import { randomBytes } from 'node:crypto';
import type { ConnectedAccountDTO, ConnectedAccountSettings, IntegrationProvider, UnmatchedMailAction } from '@titoforce/shared';
import type { IntegrationsConfig } from '../config.ts';
import { type Db, parseJson } from '../db/database.ts';
import { badRequest, conflict, newId, notFound, nowIso } from '../util.ts';
import { type SecretBox, sha256 } from './crypto.ts';
import {
  assertOAuthConfigured,
  authorizationUrl,
  type Capabilities,
  capabilitiesFromScope,
  exchangeCode,
  fetchIdentity,
  type OAuthCredentials,
  type OAuthProvider,
  pkcePair,
  ReconnectRequired,
  refreshTokens,
  revokeGoogle,
} from './oauth.ts';

export interface PasswordCredentials {
  kind: 'password';
  password: string;
}

export interface FeedCredentials {
  kind: 'feed';
  url: string;
}

export type Credentials = OAuthCredentials | PasswordCredentials | FeedCredentials;

/** Settings column: the public settings plus the scopes granted to an OAuth account. */
export interface StoredSettings extends ConnectedAccountSettings {
  scope?: string;
  /** Hash of a subscribed calendar URL, to refuse subscribing twice. */
  feedHash?: string;
}

/** Sync cursors, per provider. */
export interface SyncState {
  imap?: Record<string, { uidValidity: string; lastUid: number }>;
  /** Gmail history cursor; `offset` counts the changes after it already read when a run stopped early. */
  gmail?: { historyId: string; offset?: number };
  /** Microsoft Graph delta (or next page) links per mail folder. */
  graph?: Record<string, string>;
  /** When mail was last fetched (fallback window for lost cursors). */
  mailSyncedAt?: string;
}

export interface Account {
  id: string;
  userId: string;
  provider: IntegrationProvider;
  label: string;
  address: string | null;
  settings: StoredSettings;
  syncState: SyncState;
  status: 'active' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  sealed: string | null;
}

interface AccountRow {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  address: string | null;
  settings: unknown;
  credentials: string | null;
  sync_state: unknown;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
}

const SELECT = 'SELECT id, user_id, provider, label, address, settings, credentials, sync_state, status, last_sync_at, last_error, created_at FROM connected_accounts';
const STATE_TTL_MS = 10 * 60 * 1000;

/** Addresses of all users and connected mailboxes: colleagues, never matched as customers. */
export async function internalAddresses(db: Db): Promise<Set<string>> {
  const rows = await db.all<{ a: string | null }>('SELECT email AS a FROM users UNION SELECT address AS a FROM connected_accounts WHERE address IS NOT NULL');
  return new Set(rows.map((r) => r.a?.toLowerCase()).filter((a): a is string => !!a));
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  userId: r.user_id,
  provider: r.provider as IntegrationProvider,
  label: r.label,
  address: r.address,
  settings: parseJson<StoredSettings>(r.settings, { syncEmail: false, syncCalendar: false, unmatched: 'ignore' }),
  syncState: parseJson<SyncState>(r.sync_state, {}),
  status: r.status === 'error' ? 'error' : 'active',
  lastSyncAt: r.last_sync_at,
  lastError: r.last_error,
  createdAt: r.created_at,
  sealed: r.credentials,
});

export interface NewAccount {
  userId: string;
  provider: IntegrationProvider;
  label: string;
  address: string | null;
  settings: StoredSettings;
  credentials: Credentials;
}

export interface AccountPatch {
  label?: string;
  syncEmail?: boolean;
  syncCalendar?: boolean;
  unmatched?: UnmatchedMailAction;
}

/** Mailboxes and calendars users connect; credentials are stored encrypted. */
export class AccountService {
  private db: Db;
  private cfg: IntegrationsConfig;
  private secrets: SecretBox;
  fetchImpl: typeof fetch;
  /** Accounts with a sync in progress (in this process). */
  readonly syncing = new Set<string>();
  private refreshing = new Map<string, Promise<string>>();

  constructor(db: Db, cfg: IntegrationsConfig, secrets: SecretBox, fetchImpl: typeof fetch) {
    this.db = db;
    this.cfg = cfg;
    this.secrets = secrets;
    this.fetchImpl = fetchImpl;
  }

  async get(id: string): Promise<Account | undefined> {
    const row = await this.db.get<AccountRow>(`${SELECT} WHERE id = ?`, [id]);
    return row ? toAccount(row) : undefined;
  }

  /** An account of the user (other users' accounts are reported as not found). */
  async own(userId: string, id: string): Promise<Account> {
    const a = await this.get(id);
    if (!a || a.userId !== userId) throw notFound('Account not found');
    return a;
  }

  async list(userId: string): Promise<Account[]> {
    return (await this.db.all<AccountRow>(`${SELECT} WHERE user_id = ? ORDER BY created_at`, [userId])).map(toAccount);
  }

  async all(): Promise<Account[]> {
    return (await this.db.all<AccountRow>(`${SELECT} ORDER BY created_at`)).map(toAccount);
  }

  capabilities(a: Account): Capabilities {
    switch (a.provider) {
      case 'google':
      case 'microsoft':
        return capabilitiesFromScope(a.provider, a.settings.scope ?? '');
      case 'imap':
        return { sendEmail: !!a.settings.smtpHost, syncEmail: true, calendar: false, exportEvents: false };
      default:
        return { sendEmail: false, syncEmail: false, calendar: true, exportEvents: false };
    }
  }

  toDTO(a: Account): ConnectedAccountDTO {
    const { scope: _scope, feedHash: _feedHash, ...settings } = a.settings;
    return {
      id: a.id,
      provider: a.provider,
      label: a.label,
      address: a.address,
      capabilities: this.capabilities(a),
      settings,
      status: a.status,
      syncing: this.syncing.has(a.id),
      lastSyncAt: a.lastSyncAt,
      lastError: a.lastError,
      createdAt: a.createdAt,
    };
  }

  async credentials<T extends Credentials>(a: Account): Promise<T> {
    if (!a.sealed) throw new ReconnectRequired('Reconnect required: this account has no stored credentials.');
    return this.secrets.open<T>(a.sealed, a.id);
  }

  async insert(input: NewAccount): Promise<Account> {
    const id = newId('cac');
    const now = nowIso();
    const sealed = await this.secrets.seal(input.credentials, id);
    await this.db.run(
      `INSERT INTO connected_accounts (id, user_id, provider, label, address, settings, credentials, sync_state, status, last_sync_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?)`,
      [id, input.userId, input.provider, input.label.slice(0, 80), input.address, JSON.stringify(input.settings), sealed, '{}', now, now],
    );
    return (await this.get(id))!;
  }

  async saveCredentials(id: string, creds: Credentials, settings?: StoredSettings): Promise<void> {
    const sealed = await this.secrets.seal(creds, id);
    if (settings) await this.db.run('UPDATE connected_accounts SET credentials = ?, settings = ?, updated_at = ? WHERE id = ?', [sealed, JSON.stringify(settings), nowIso(), id]);
    else await this.db.run('UPDATE connected_accounts SET credentials = ?, updated_at = ? WHERE id = ?', [sealed, nowIso(), id]);
  }

  async update(userId: string, id: string, patch: AccountPatch): Promise<Account> {
    const a = await this.own(userId, id);
    const caps = this.capabilities(a);
    if (patch.syncEmail && !caps.syncEmail) throw badRequest('This account cannot sync email');
    if (patch.syncCalendar && !caps.calendar) throw badRequest('This account cannot sync a calendar');
    const settings: StoredSettings = { ...a.settings };
    if (patch.syncEmail !== undefined) settings.syncEmail = patch.syncEmail;
    if (patch.syncCalendar !== undefined) settings.syncCalendar = patch.syncCalendar;
    if (patch.unmatched !== undefined) settings.unmatched = patch.unmatched;
    const label = patch.label?.trim() || a.label;
    await this.db.run('UPDATE connected_accounts SET label = ?, settings = ?, updated_at = ? WHERE id = ?', [label.slice(0, 80), JSON.stringify(settings), nowIso(), id]);
    return (await this.get(id))!;
  }

  /** Fails early when credentials could not be stored (no secret key where one is required). */
  ready(): Promise<void> {
    return this.secrets.ready();
  }

  /** Clears an error that needed the user, after they fixed the account (e.g. a new password). */
  async markActive(id: string): Promise<void> {
    await this.db.run("UPDATE connected_accounts SET status = 'active', last_error = NULL, updated_at = ? WHERE id = ?", [nowIso(), id]);
  }

  async setSyncState(id: string, state: SyncState): Promise<void> {
    await this.db.run('UPDATE connected_accounts SET sync_state = ?, updated_at = ? WHERE id = ?', [JSON.stringify(state), nowIso(), id]);
  }

  /** Records the outcome of a sync. Errors that need the user (revoked access, unreadable credentials) stop scheduled syncs. */
  async recordSync(id: string, error: string | null, needsUser = false): Promise<void> {
    const now = nowIso();
    if (!error) await this.db.run("UPDATE connected_accounts SET status = 'active', last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?", [now, now, id]);
    else if (needsUser) await this.db.run("UPDATE connected_accounts SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?", [error.slice(0, 500), now, id]);
    else await this.db.run('UPDATE connected_accounts SET last_sync_at = ?, last_error = ?, updated_at = ? WHERE id = ?', [now, error.slice(0, 500), now, id]);
  }

  async remove(userId: string, id: string): Promise<void> {
    const a = await this.own(userId, id);
    if (a.provider === 'google' && a.sealed) {
      try {
        const creds = await this.credentials<OAuthCredentials>(a);
        await revokeGoogle(this.fetchImpl, creds.refreshToken ?? creds.accessToken);
      } catch {
        // Unreadable credentials cannot be revoked; the account is removed regardless.
      }
    }
    await this.db.transaction(async (tx) => {
      // Logged events stay known, so connecting the calendar again does not import them twice.
      await tx.run('UPDATE calendar_events SET account_id = NULL WHERE account_id = ?', [id]);
      await tx.run('DELETE FROM connected_accounts WHERE id = ?', [id]);
    });
  }

  // ---------- OAuth ----------

  /** Starts a Google or Microsoft sign-in; returns the provider URL to send the browser to. */
  async startOAuth(userId: string, provider: OAuthProvider): Promise<string> {
    // Fail before the user signs in when the provider is not configured or credentials could not be stored.
    assertOAuthConfigured(this.cfg, provider);
    await this.secrets.ready();
    await this.db.run('DELETE FROM oauth_states WHERE created_at < ?', [new Date(Date.now() - STATE_TTL_MS).toISOString()]);
    const state = randomBytes(32).toString('base64url');
    const { verifier, challenge } = pkcePair();
    await this.db.run('INSERT INTO oauth_states (id, user_id, provider, code_verifier, created_at) VALUES (?, ?, ?, ?, ?)', [sha256(state), userId, provider, verifier, nowIso()]);
    return authorizationUrl(this.cfg, provider, state, challenge);
  }

  /** Completes a sign-in started by the same user: stores the tokens on a new or the existing account for that mailbox. */
  async finishOAuth(userId: string, provider: OAuthProvider, code: string, state: string): Promise<Account> {
    const key = sha256(state);
    const row = await this.db.get<{ user_id: string; provider: string; code_verifier: string; created_at: string }>(
      'SELECT user_id, provider, code_verifier, created_at FROM oauth_states WHERE id = ?',
      [key],
    );
    const { changes } = await this.db.run('DELETE FROM oauth_states WHERE id = ?', [key]);
    if (!row || !changes || Date.parse(row.created_at) < Date.now() - STATE_TTL_MS) {
      throw badRequest('This sign-in has expired or was already used. Start again from Settings.');
    }
    if (row.user_id !== userId || row.provider !== provider) throw badRequest('This sign-in was started by another user. Start again from Settings.');

    const creds = await exchangeCode(this.fetchImpl, this.cfg, provider, code, row.code_verifier);
    const identity = await fetchIdentity(this.fetchImpl, provider, creds.accessToken);
    const caps = capabilitiesFromScope(provider, creds.scope);
    if (!caps.sendEmail && !caps.syncEmail && !caps.calendar) {
      throw badRequest('No mail or calendar access was granted. Connect again and allow the requested permissions.');
    }

    const existing = await this.db.get<AccountRow>(`${SELECT} WHERE user_id = ? AND provider = ? AND address = ?`, [userId, provider, identity.email]);
    if (existing) {
      const a = toAccount(existing);
      let refreshToken = creds.refreshToken;
      if (!refreshToken) {
        try {
          refreshToken = (await this.credentials<OAuthCredentials>(a)).refreshToken;
        } catch {
          refreshToken = null;
        }
      }
      const settings: StoredSettings = { ...a.settings, scope: creds.scope };
      if (!caps.syncEmail) settings.syncEmail = false;
      if (!caps.calendar) settings.syncCalendar = false;
      await this.saveCredentials(a.id, { ...creds, refreshToken }, settings);
      await this.db.run("UPDATE connected_accounts SET status = 'active', last_error = NULL WHERE id = ?", [a.id]);
      return (await this.get(a.id))!;
    }
    return this.insert({
      userId,
      provider,
      label: identity.email,
      address: identity.email,
      settings: { syncEmail: caps.syncEmail, syncCalendar: caps.calendar, unmatched: 'ignore', scope: creds.scope },
      credentials: creds,
    });
  }

  /** A valid access token, refreshed when it is about to expire (one refresh at a time per account). */
  accessToken(a: Account): Promise<string> {
    const pending = this.refreshing.get(a.id);
    if (pending) return pending;
    const p = this.loadToken(a.id).finally(() => this.refreshing.delete(a.id));
    this.refreshing.set(a.id, p);
    return p;
  }

  private async loadToken(id: string): Promise<string> {
    const a = await this.get(id);
    if (!a) throw notFound('Account not found');
    if (a.provider !== 'google' && a.provider !== 'microsoft') throw conflict('Not an OAuth account');
    const creds = await this.credentials<OAuthCredentials>(a);
    if (creds.expiresAt - 60_000 > Date.now()) return creds.accessToken;
    if (!creds.refreshToken) throw new ReconnectRequired();
    const next = await refreshTokens(this.fetchImpl, this.cfg, a.provider, creds.refreshToken);
    // Microsoft rotates refresh tokens; Google keeps the original one.
    const merged: OAuthCredentials = { ...next, refreshToken: next.refreshToken ?? creds.refreshToken, scope: next.scope || creds.scope };
    await this.saveCredentials(a.id, merged, { ...a.settings, scope: merged.scope });
    return merged.accessToken;
  }
}
