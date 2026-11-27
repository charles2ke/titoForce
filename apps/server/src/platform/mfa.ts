import type { MfaEnrollment } from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import { AppError, badRequest, conflict, nowIso } from '../util.ts';
import type { SecretBox } from './secret-box.ts';
import { hashRecoveryCode, isTotpFormat, matchTotp, newRecoveryCodes, newTotpSecret, otpauthUri } from './totp.ts';

interface MfaRow {
  user_id: string;
  secret: string;
  enabled: number;
  last_step: number;
  recovery_codes: string;
  enabled_at: string | null;
}

export const invalidCode = () => new AppError(400, 'invalid_code', 'That code is not valid. Check your authenticator app and try again.');

/** Two-factor authentication with authenticator-app codes (TOTP) and single-use recovery codes. */
export class MfaService {
  private db: Db;
  private box: SecretBox;
  /** Clock for one-time passwords (tests replace it). */
  now: () => number = () => Date.now();

  constructor(db: Db, box: SecretBox) {
    this.db = db;
    this.box = box;
  }

  private row(userId: string): Promise<MfaRow | undefined> {
    return this.db.get<MfaRow>('SELECT user_id, secret, enabled, last_step, recovery_codes, enabled_at FROM user_mfa WHERE user_id = ?', [userId]);
  }

  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.row(userId);
    return !!row && !!Number(row.enabled);
  }

  async enabledUserIds(): Promise<Set<string>> {
    const rows = await this.db.all<{ user_id: string }>('SELECT user_id FROM user_mfa WHERE enabled = 1');
    return new Set(rows.map((r) => r.user_id));
  }

  async state(userId: string): Promise<{ enabled: boolean; recoveryCodesLeft: number; enabledAt: string | null }> {
    const row = await this.row(userId);
    if (!row || !Number(row.enabled)) return { enabled: false, recoveryCodesLeft: 0, enabledAt: null };
    return { enabled: true, recoveryCodesLeft: parseJson<string[]>(row.recovery_codes, []).length, enabledAt: row.enabled_at };
  }

  /** Starts (or restarts) enrollment with a new secret; it takes effect once a code from it is confirmed. */
  async beginEnrollment(userId: string, account: string): Promise<MfaEnrollment> {
    const secret = newTotpSecret();
    const { changes } = await this.db.run(
      `INSERT INTO user_mfa (user_id, secret, enabled, last_step, recovery_codes, created_at) VALUES (?, ?, 0, 0, '[]', ?)
       ON CONFLICT (user_id) DO UPDATE SET secret = excluded.secret, last_step = 0, created_at = excluded.created_at WHERE user_mfa.enabled = 0`,
      [userId, this.box.seal(secret), nowIso()],
    );
    if (!changes) throw conflict('Two-factor authentication is already turned on');
    return { secret, uri: otpauthUri(secret, account) };
  }

  /** Turns MFA on when `code` matches the pending secret. Returns the new recovery codes (shown once). */
  async completeEnrollment(userId: string, code: string): Promise<string[]> {
    const row = await this.row(userId);
    if (!row) throw badRequest('Start two-factor setup first');
    if (Number(row.enabled)) throw conflict('Two-factor authentication is already turned on');
    const step = matchTotp(this.box.open(row.secret), code, this.now());
    if (step === null) throw invalidCode();
    const codes = newRecoveryCodes();
    const { changes } = await this.db.run(
      'UPDATE user_mfa SET enabled = 1, enabled_at = ?, last_step = ?, recovery_codes = ? WHERE user_id = ? AND enabled = 0 AND secret = ?',
      [nowIso(), step, JSON.stringify(codes.map(hashRecoveryCode)), userId, row.secret],
    );
    if (!changes) throw conflict('Two-factor setup changed in the meantime. Please start again.');
    return codes;
  }

  /**
   * Checks a second-factor code: an authenticator code (each accepted once) or an unused recovery code, which is
   * consumed. Returns which kind matched, or null.
   */
  async verify(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
    let row = await this.row(userId);
    if (!row || !Number(row.enabled)) return null;
    if (isTotpFormat(code)) {
      const step = matchTotp(this.box.open(row.secret), code, this.now());
      if (step === null) return null;
      // Replay protection: a code (or an older one) that was already used is rejected.
      const { changes } = await this.db.run('UPDATE user_mfa SET last_step = ? WHERE user_id = ? AND enabled = 1 AND last_step < ?', [step, userId, step]);
      return changes ? 'totp' : null;
    }
    const hash = hashRecoveryCode(code);
    for (let attempt = 0; attempt < 3 && row; attempt++) {
      const codes = parseJson<string[]>(row.recovery_codes, []);
      if (!codes.includes(hash)) return null;
      const { changes } = await this.db.run('UPDATE user_mfa SET recovery_codes = ? WHERE user_id = ? AND enabled = 1 AND recovery_codes = ?', [
        JSON.stringify(codes.filter((c) => c !== hash)),
        userId,
        row.recovery_codes,
      ]);
      if (changes) return 'recovery';
      row = await this.row(userId);
    }
    return null;
  }

  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    const { changes } = await this.db.run('UPDATE user_mfa SET recovery_codes = ? WHERE user_id = ? AND enabled = 1', [JSON.stringify(codes.map(hashRecoveryCode)), userId]);
    if (!changes) throw badRequest('Two-factor authentication is not turned on');
    return codes;
  }

  /** Turns MFA off (self-service or an administrator reset). Returns whether anything was removed. */
  async disable(userId: string): Promise<boolean> {
    const { changes } = await this.db.run('DELETE FROM user_mfa WHERE user_id = ?', [userId]);
    return changes > 0;
  }
}
