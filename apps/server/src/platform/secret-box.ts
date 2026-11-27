import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { AppError } from '../util.ts';

const PREFIX = 'enc1:';

/**
 * Encrypts stored secrets (TOTP seeds, OIDC client secrets) with AES-256-GCM when TITO_SECRET_KEY is set.
 * Without a key, values are stored as given; values stored before a key was configured remain readable.
 */
export class SecretBox {
  private key: Buffer | null;

  constructor(secretKey: string | null) {
    this.key = secretKey ? Buffer.from(hkdfSync('sha256', secretKey, 'titoforce', 'secret-box v1', 32)) : null;
  }

  get encrypting(): boolean {
    return this.key !== null;
  }

  seal(plain: string): string {
    if (!this.key) return plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
  }

  open(stored: string): string {
    if (!stored.startsWith(PREFIX)) return stored;
    if (!this.key) throw new AppError(500, 'secret_key_missing', 'TITO_SECRET_KEY is required to read encrypted secrets');
    const buf = Buffer.from(stored.slice(PREFIX.length), 'base64url');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
      decipher.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      throw new AppError(500, 'secret_key_mismatch', 'A stored secret could not be decrypted; check TITO_SECRET_KEY');
    }
  }
}
