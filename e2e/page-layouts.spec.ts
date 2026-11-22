import { expect, test } from '@playwright/test';
import { signIn, snap } from './helpers.ts';

test('open related lists refresh when the layout changes', async ({ page }) => {
  await signIn(page, 'admin');
  const { layouts } = (await (await page.request.get('/api/objects/account/layouts')).json()) as {
    layouts: { id: string; isDefault: boolean; relatedLists: string[] }[];
  };
  const layout = layouts.find((l) => l.isDefault)!;
  expect(layout.relatedLists).toContain('contact.account');
  const account = ((await (await page.request.post('/api/records/account/query', { data: { pageSize: 1 } })).json()) as { records: { id: string }[] }).records[0]!;
  const socket = page.waitForEvent('websocket');
  await page.goto(`/r/${account.id}?tab=related`);
  await socket;
  const contacts = page.getByRole('heading', { name: /Contacts/ });
  await expect(contacts).toBeVisible();
  let savedId = layout.id;
  try {
    const updated = await page.request.put(`/api/objects/account/layouts/${layout.id}`, {
      data: { ...layout, relatedLists: layout.relatedLists.filter((id) => id !== 'contact.account') },
    });
    expect(updated.ok()).toBe(true);
    savedId = ((await updated.json()) as { id: string }).id;
    await expect(contacts).toHaveCount(0);
  } finally {
    expect((await page.request.put(`/api/objects/account/layouts/${savedId}`, { data: layout })).ok()).toBe(true);
  }
});

test('an administrator drags fields into a page layout for one team', async ({ page }) => {
  const layoutName = `Marketing leads ${Date.now() % 10_000}`;
  await signIn(page, 'admin');
  // Start from the default layout only, also when the test is retried.
  const existing = (await (await page.request.get('/api/objects/lead/layouts')).json()) as { layouts: { id: string; isDefault: boolean }[] };
  for (const l of existing.layouts.filter((x) => !x.isDefault)) expect((await page.request.delete(`/api/objects/lead/layouts/${l.id}`)).ok()).toBe(true);
  const lead = ((await (await page.request.post('/api/records/lead/query', { data: { pageSize: 1 } })).json()) as { records: { id: string; name: string }[] }).records[0]!;

  await page.goto('/setup/objects/lead?tab=pageLayouts');
  await page.getByRole('button', { name: 'New layout' }).click();
  const dialog = page.getByRole('dialog', { name: 'New page layout' });
  await dialog.getByLabel('Layout name').fill(layoutName);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Marketing', exact: true }).check();

  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('region', { name: 'New Section' }).getByLabel('Section title').fill('Campaign details');
  const section = page.getByRole('region', { name: 'Campaign details' });
  const leadInfo = page.getByRole('region', { name: 'Lead Information' });
  // Right after the main section (Lead sections: main, Company, Qualification, Conversion).
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Move section “Campaign details” up' }).click();
  await expect(page.locator('section[data-section]').nth(1)).toHaveAttribute('aria-label', 'Campaign details');

  // Drag a field from one section to another…
  await leadInfo.locator('[data-field=lead_source]').dragTo(section.getByText('Drag fields here'));
  await expect(section.locator('[data-field=lead_source]')).toBeVisible();
  await expect(leadInfo.locator('[data-field=lead_source]')).toHaveCount(0);
  // …or move it with the field's menu.
  await leadInfo.getByRole('button', { name: 'Actions for Campaign', exact: true }).click();
  await page.getByRole('button', { name: 'Move to “Campaign details”' }).click();
  await expect(section.locator('[data-field=campaign]')).toBeVisible();
  // Fields dragged to the list of fields leave the layout.
  const palette = page.getByRole('complementary', { name: 'Fields' });
  await leadInfo.locator('[data-field=website]').dragTo(palette);
  await expect(palette.locator('[data-field=website]')).toBeVisible();
  await expect(leadInfo.locator('[data-field=website]')).toHaveCount(0);
  await snap(page, '28-page-layout-editor');
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Layout saved')).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toHaveCount(0);

  // Marketing sees the new layout on record pages and in the edit form.
  await signIn(page, 'liam');
  await page.goto(`/r/${lead.id}`);
  const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Campaign details' }) });
  await expect(card.getByText('Lead Source', { exact: true })).toBeVisible();
  await expect(card.getByText('Campaign', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText('Website', { exact: true })).toHaveCount(0);
  await snap(page, '29-page-layout-record');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('dialog', { name: `Edit ${lead.name}` });
  await expect(form.getByRole('group', { name: 'Campaign details' }).getByLabel('Lead Source')).toBeVisible();
  await expect(form.getByLabel('Website')).toHaveCount(0);
  await form.getByRole('button', { name: 'Cancel' }).click();

  // Other roles keep the default layout.
  await signIn(page, 'maria');
  await page.goto(`/r/${lead.id}`);
  await expect(page.getByRole('main').getByText('Website', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Campaign details' })).toHaveCount(0);
});
