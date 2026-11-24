import { expect, test } from '@playwright/test';
import { signIn, snap } from './helpers.ts';

test('limits localized label-sorted groups in previews, reports and dashboards', async ({ page }) => {
  await signIn(page, 'admin');
  const suffix = Date.now() % 1_000_000;
  const created = await page.request.post('/api/objects', { data: { label: `Sorting ${suffix}`, pluralLabel: `Sortings ${suffix}` } });
  expect(created.ok()).toBe(true);
  const { apiName: object } = (await created.json()) as { apiName: string };
  let reportId = '';
  let dashboardId = '';
  try {
    expect((await page.request.post(`/api/objects/${object}/fields`, {
      data: { label: 'Category', type: 'picklist', options: [{ value: 'Alpha' }, { value: 'Beta' }] },
    })).ok()).toBe(true);
    for (const value of ['Alpha', 'Beta']) {
      expect((await page.request.post(`/api/records/${object}`, { data: { fields: { name: value, category: value } } })).ok()).toBe(true);
    }
    expect((await page.request.put('/api/translations/es', {
      data: { entries: [{ key: `picklist.${object}.category.Alpha`, value: 'Zulu' }, { key: `picklist.${object}.category.Beta`, value: 'Apple' }] },
    })).ok()).toBe(true);

    const spec = { object, groupBy: { field: 'category' }, metric: { fn: 'count' }, sort: 'label', limit: 1 };
    const report = await page.request.post('/api/reports', { data: { ...spec, name: `Localized ${suffix}`, chart: 'table' } });
    expect(report.ok()).toBe(true);
    reportId = ((await report.json()) as { id: string }).id;
    const dashboard = await page.request.post('/api/dashboards', { data: { name: `Localized ${suffix}`, widgets: [{ reportId }] } });
    expect(dashboard.ok()).toBe(true);
    dashboardId = ((await dashboard.json()) as { id: string }).id;

    const ordinary = await page.request.post('/api/reports/preview', { data: spec });
    expect((await ordinary.json()).rows.map((r: { key: string }) => r.key)).toEqual(['Alpha']);
    const localized = await page.request.post('/api/reports/preview?deferLabelLimit=1', { data: spec });
    expect((await localized.json()).rows.map((r: { key: string }) => r.key)).toEqual(['Alpha', 'Beta']);
    const byValue = await page.request.post('/api/reports/preview?deferLabelLimit=1', { data: { ...spec, sort: 'value_desc' } });
    expect((await byValue.json()).rows).toHaveLength(1);

    await page.addInitScript(() => localStorage.setItem('tf.locale', 'es'));
    for (const path of [`/reports/${reportId}`, `/reports/${reportId}/edit`, `/dashboards/${dashboardId}`]) {
      await page.goto(path);
      await expect(page.locator('tbody').getByText('Apple', { exact: true })).toBeVisible();
      await expect(page.locator('tbody').getByText('Zulu', { exact: true })).toHaveCount(0);
      if (path === `/reports/${reportId}`) await snap(page, '36-localized-report');
    }
  } finally {
    if (dashboardId) expect((await page.request.delete(`/api/dashboards/${dashboardId}`)).ok()).toBe(true);
    if (reportId) expect((await page.request.delete(`/api/reports/${reportId}`)).ok()).toBe(true);
    expect((await page.request.delete(`/api/objects/${object}`)).ok()).toBe(true);
  }
});
