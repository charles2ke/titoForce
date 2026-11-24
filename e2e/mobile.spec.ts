import { expect, type Page, test } from '@playwright/test';
import { settled, signIn, snap } from './helpers.ts';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

/** Parts of the page wider than the screen: the page or its main content scrolling sideways, or cards spilling out. */
function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) found.push('page scrolls sideways');
    const main = document.querySelector('main');
    if (main && main.scrollWidth > main.clientWidth + 1) found.push('main content scrolls sideways');
    for (const card of document.querySelectorAll<HTMLElement>('main .card')) {
      const { overflowX } = getComputedStyle(card);
      if (overflowX === 'auto' || overflowX === 'scroll') continue;
      if (card.scrollWidth > card.clientWidth + 1) found.push((card.querySelector('h2')?.textContent ?? card.textContent ?? '').trim().slice(0, 60));
    }
    return found;
  });
}

test('fits a phone screen', async ({ page }) => {
  await signIn(page, 'maria');
  const accounts = await page.request.post('/api/records/account/query', { data: { pageSize: 1 } });
  const account = ((await accounts.json()) as { records: { id: string; name: string }[] }).records[0]!;

  const main = page.getByRole('main');
  for (const [path, ready, shot] of [
    ['/', main.getByRole('heading').first(), '32-mobile-home'],
    ['/o/account', main.getByText('Accounts', { exact: true }), ''],
    [`/r/${account.id}`, main.getByRole('heading', { name: account.name, exact: true }), '33-mobile-record'],
    ['/settings', main.getByRole('heading', { name: 'My settings' }), ''],
  ] as const) {
    await page.goto(path);
    await settled(page);
    await expect(ready).toBeVisible();
    await expect.poll(() => overflowing(page), { message: path }).toEqual([]);
    await expect(page.getByRole('button', { name: 'User menu' })).toBeInViewport({ ratio: 1 });
    if (shot) await snap(page, shot);
  }

  // The sidebar becomes a drawer.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer.getByRole('navigation', { name: 'Main' })).toBeInViewport();
  await snap(page, '34-mobile-navigation');
  await drawer.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/o\/account$/);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await drawer.getByRole('button', { name: 'Close navigation' }).click();
  await expect(drawer).toHaveCount(0);
});

test('installs as an app and opens without a network', async ({ page, context }) => {
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ name: 'titoForce', display: 'standalone', start_url: expect.any(String), icons: expect.arrayContaining([expect.objectContaining({ sizes: '512x512' })]) });

  await signIn(page, 'maria');
  await page.goto('/');
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/manifest.webmanifest');
  // The service worker takes control of the page and keeps the app's files.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.reload();
  await settled(page);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByText('Cannot reach the titoForce server. Check your connection and try again.')).toBeVisible({ timeout: 15_000 });
    await snap(page, '35-mobile-offline');
  } finally {
    await context.setOffline(false);
  }
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
});
