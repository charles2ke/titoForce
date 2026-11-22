import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP) with the settings every authenticator app supports:
// HMAC-SHA1, 6 digits, 30-second steps.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_S = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const totpStep = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_PERIOD_S);

export const totp = (secret: string, nowMs: number): string => hotp(base32Decode(secret), totpStep(nowMs));

/** The time step a code matches, allowing one step of clock drift either way, or null. */
export function matchTotp(secret: string, code: string, nowMs: number): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const key = base32Decode(secret);
  const step = totpStep(nowMs);
  for (const s of [step, step - 1, step + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(clean))) return s;
  }
  return null;
}

export const isTotpFormat = (code: string): boolean => /^\d{6}$/.test(code.replace(/\s/g, ''));

export function otpauthUri(secret: string, account: string, issuer = 'titoForce'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_PERIOD_S}`;
}

// Recovery codes: single-use, about 59 bits each, shown once and stored as SHA-256 hashes.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    let s = '';
    for (let i = 0; i < 12; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  });
}

export const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(code.toLowerCase().replace(/[\s-]/g, '')).digest('hex');
