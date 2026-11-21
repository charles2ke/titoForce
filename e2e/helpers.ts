import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'titoforce';
export const email = (user: string) => `${user}@titoforce.example`;

/** Signs in through the API; the session cookie is shared with the page's browser context. */
export async function signIn(page: Page, user: string): Promise<void> {
  const res = await page.request.post('/api/auth/login', { data: { email: email(user), password: PASSWORD } });
  expect(res.ok(), `sign in as ${user}`).toBe(true);
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
