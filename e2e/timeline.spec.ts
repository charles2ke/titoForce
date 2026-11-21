import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

test('timeline includes overlapping records and only in-window starts without an end', async ({ page }) => {
  await signIn(page, 'admin');
  const cases = [
    { name: 'Timeline range before no end', start_date: '2030-12-31', visible: false },
    { name: 'Timeline range before blank end', start_date: '2030-12-31', end_date: '', visible: false },
    { name: 'Timeline range first no end', start_date: '2031-01-01', visible: true },
    { name: 'Timeline range last no end', start_date: '2031-03-31', visible: true },
    { name: 'Timeline range after no end', start_date: '2031-04-01', visible: false },
    { name: 'Timeline range overlap first', start_date: '2030-12-01', end_date: '2031-01-01', visible: true },
    { name: 'Timeline range overlap last', start_date: '2031-03-31', end_date: '2031-04-10', visible: true },
    { name: 'Timeline range spans window', start_date: '2030-12-01', end_date: '2031-04-10', visible: true },
    { name: 'Timeline range ends before', start_date: '2030-12-01', end_date: '2030-12-31', visible: false },
    { name: 'Timeline range starts after', start_date: '2031-04-01', end_date: '2031-04-10', visible: false },
    { name: 'Timeline range no start', end_date: '2031-02-01', visible: false },
  ];
  for (const { visible: _visible, ...fields } of cases) {
    const response = await page.request.post('/api/records/campaign', { data: { fields } });
    expect(response.status(), fields.name).toBe(201);
  }

  await page.goto('/o/campaign?vt=timeline&m=2031-01&q=Timeline%20range');
  await expect(page.getByRole('heading', { name: /Jan 2031.*Mar 2031/ })).toBeVisible();
  for (const item of cases) {
    const row = page.getByRole('listitem').filter({ hasText: item.name });
    if (item.visible) await expect(row).toBeVisible();
    else await expect(row).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: 'Timeline range first no end', exact: true }).last()).toHaveAttribute('title', /no end date$/);
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Timeline range first no end' })).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'Timeline range after no end' })).toBeVisible();
});

test('timeline renders system dates as start and end endpoints', async ({ page }) => {
  await signIn(page, 'admin');
  const name = 'Timeline system dates';
  const created = await page.request.post('/api/records/campaign', { data: { fields: { name, start_date: '2000-01-01', end_date: '2099-12-31' } } });
  expect(created.status()).toBe(201);
  const { record } = (await created.json()) as { record: { createdAt: string } };
  const month = record.createdAt.slice(0, 7);
  const createdDate = await page.evaluate((date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), record.createdAt);
  const [startDate, endDate] = await page.evaluate(() =>
    [new Date(2000, 0, 1), new Date(2099, 11, 31)].map((date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })),
  );

  for (const timeline of [{ start: 'created_at', end: 'end_date' }, { start: 'start_date', end: 'created_at' }]) {
    const updated = await page.request.patch('/api/objects/campaign', { data: { timeline } });
    expect(updated.status()).toBe(200);
    await page.goto(`/o/campaign?vt=timeline&m=${month}&q=Timeline%20system%20dates`);
    const row = page.getByRole('listitem').filter({ hasText: name });
    await expect(row).toBeVisible();
    const bar = row.getByRole('link', { name, exact: true }).last();
    await expect(bar).toHaveAttribute('title', timeline.start === 'created_at' ? `${name}: ${createdDate} – ${endDate}` : `${name}: ${startDate} – ${createdDate}`);
    await expect(page.getByText(timeline.start === 'created_at' ? 'Created → End Date' : 'Start Date → Created')).toBeVisible();
  }
});
