import { expect, type Page, test } from '@playwright/test';
import { settled, signIn } from './helpers.ts';

/** Cards in the main content whose content is wider than the card itself (spilling out or clipped). */
function overflowingCards(page: Page): Promise<string[]> {
  return page.locator('main').evaluate((main) => {
    const found: string[] = [];
    if (main.scrollWidth > main.clientWidth + 1) found.push('main content scrolls sideways');
    for (const card of main.querySelectorAll<HTMLElement>('.card')) {
      const { overflowX } = getComputedStyle(card);
      if (overflowX === 'auto' || overflowX === 'scroll') continue;
      if (card.scrollWidth > card.clientWidth + 1) found.push((card.querySelector('h2')?.textContent ?? card.textContent ?? '').trim().slice(0, 60));
    }
    return found;
  });
}

/** Loads a page and checks it with the AI panel closed, then with the panel open (docked beside the content on wide screens). */
async function expectFits(page: Page, path: string, prepare?: () => Promise<void>): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await settled(page);
  await prepare?.();
  await expect(page.locator('main .card').first()).toBeVisible();
  await expect.poll(() => overflowingCards(page), { message: `${path} with the AI panel closed` }).toEqual([]);
  await page.getByRole('banner').getByRole('button', { name: 'Ask AI' }).click();
  await expect(page.getByRole('complementary', { name: 'AI assistant' })).toBeVisible();
  await settled(page);
  await expect.poll(() => overflowingCards(page), { message: `${path} with the AI panel open` }).toEqual([]);
}

async function idOf(page: Page, url: string, name: string): Promise<string> {
  const list = (await (await page.request.get(url)).json()) as { id: string; name: string }[];
  const found = list.find((x) => x.name === name);
  expect(found, `${name} in ${url}`).toBeTruthy();
  return found!.id;
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`fits content beside the AI panel at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);

    await signIn(page, 'maria');
    const opportunities = await page.request.post('/api/records/opportunity/query', { data: { pageSize: 1 } });
    const recordId = ((await opportunities.json()) as { records: { id: string }[] }).records[0]!.id;
    const salesOverview = await idOf(page, '/api/dashboards', 'Sales Overview');
    for (const path of ['/app/sales', `/r/${recordId}`, '/forecast', `/dashboards/${salesOverview}`, '/dashboards', '/settings']) {
      await expectFits(page, path);
    }

    await signIn(page, 'admin');
    const leadsBySource = await idOf(page, '/api/reports', 'Leads by source');
    await expectFits(page, `/reports/${leadsBySource}/edit`);
    await expectFits(page, '/setup/agents');
    // With the panel docked the Setup nav turns into a sideways-scrolling tab bar; the current section's tab stays in view.
    await expect(page.getByRole('navigation', { name: 'Setup' }).getByRole('link', { name: 'Agents' })).toBeInViewport({ ratio: 1 });
    await expectFits(page, '/setup/roles');
    await expectFits(page, '/setup/objects/opportunity', () => page.getByRole('tab', { name: 'Details & behavior' }).click());
  });
}
