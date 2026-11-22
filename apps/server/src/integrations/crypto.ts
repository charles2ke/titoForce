import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { Db } from '../db/database.ts';
import { AppError } from '../util.ts';

const FORMAT = 'v1';
const GENERATED_KEY_SETTING = 'integration_secret_key';

export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/**
 * Encrypts stored integration credentials (OAuth tokens, mailbox passwords) with AES-256-GCM.
 * The key is derived from TITO_SECRET_KEY. Without it, production refuses to store credentials and other
 * environments generate a key kept in the settings table (convenient for local use, but not a real secret).
 */
export class SecretBox {
  private db: Db;
  private secret: string | null;
  private required: boolean;
  private key: Buffer | null = null;
  warn: (message: string) => void = () => {};

  constructor(db: Db, secret: string | null, required: boolean) {
    this.db = db;
    this.secret = secret;
    this.required = required;
  }

  get configured(): boolean {
    return !!this.secret;
  }

  private async getKey(): Promise<Buffer> {
    if (this.key) return this.key;
    let secret = this.secret;
    if (!secret) {
      if (this.required) throw new AppError(503, 'secret_key_missing', 'Set TITO_SECRET_KEY on the server before connecting accounts');
      await this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [GENERATED_KEY_SETTING, randomBytes(32).toString('base64url')]);
      secret = (await this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [GENERATED_KEY_SETTING]))!.value;
      this.warn('TITO_SECRET_KEY is not set: connected-account credentials are encrypted with a key stored in the database. Set TITO_SECRET_KEY in production.');
    }
    this.key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'titoforce-credentials', 32));
    return this.key;
  }

  /** Throws when credentials cannot be stored (production without TITO_SECRET_KEY). */
  async ready(): Promise<void> {
    await this.getKey();
  }

  /** Encrypts a JSON value. `context` (e.g. the account id) is authenticated, so a ciphertext cannot be moved to another row. */
  async seal(value: unknown, context: string): Promise<string> {
    const key = await this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [FORMAT, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  async open<T>(sealed: string, context: string): Promise<T> {
    const [format, iv, tag, data] = sealed.split('.');
    const key = await this.getKey();
    try {
      if (format !== FORMAT || !iv || !tag || data === undefined) throw new Error('format');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
      return JSON.parse(plain.toString('utf8')) as T;
    } catch {
      throw new AppError(409, 'credentials_unreadable', 'Stored credentials cannot be decrypted (was TITO_SECRET_KEY changed?). Reconnect the account.');
    }
  }
}
