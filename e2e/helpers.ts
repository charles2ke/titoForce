import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { type APIRequestContext, expect, type Page } from '@playwright/test';

export const PASSWORD = 'titoforce';
export const email = (user: string) => `${user}@titoforce.example`;

/** Signs in through the API; the session cookie is shared with the page's browser context. */
export async function signIn(page: Page, user: string): Promise<void> {
  await signInRequest(page.request, user);
}

/** Signs an API request context in, e.g. Playwright's `request` fixture for setup and clean-up as another user. */
export async function signInRequest(request: APIRequestContext, user: string): Promise<void> {
  const res = await request.post('/api/auth/login', { data: { email: email(user), password: PASSWORD } });
  expect(res.ok(), `sign in as ${user}`).toBe(true);
  expect(await res.json(), `${user} signs in without a second factor`).toHaveProperty('user');
}

/** The authenticator-app code for a base32 secret (RFC 6238: SHA-1, 6 digits, 30-second steps). */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/[\s=]/g, '').toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Waits until no loading indicators are visible. */
export async function settled(page: Page): Promise<void> {
  await expect(page.getByText('Loading…')).toHaveCount(0);
}

/** Saves a named screenshot to e2e/screenshots (uploaded by CI for review). */
export async function snap(page: Page, name: string): Promise<void> {
  await settled(page);
  await page.screenshot({ path: resolve(import.meta.dirname, 'screenshots', `${name}.png`), animations: 'disabled' });
}
