import { expect, test } from '@playwright/test';
import { signIn, snap } from './helpers.ts';

test('two people edit the same record at the same time', async ({ page, browser, baseURL }) => {
  await signIn(page, 'admin');
  const created = await page.request.post('/api/records/account', { data: { fields: { name: `Harbor Freight Lines ${Date.now() % 100_000}` } } });
  expect(created.status()).toBe(201);
  const { record } = (await created.json()) as { record: { id: string; name: string } };

  // Maria works in her own browser.
  const other = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    const maria = await other.newPage();
    await signIn(maria, 'maria');
    await page.goto(`/r/${record.id}`);
    await maria.goto(`/r/${record.id}`);
    const othersForAlex = page.getByRole('group', { name: '1 other person on this record' });
    await expect(othersForAlex).toContainText('Maria Garcia is viewing');
    await expect(maria.getByRole('group', { name: '1 other person on this record' })).toContainText('Alex Morgan is viewing');

    await maria.getByRole('button', { name: 'Edit', exact: true }).click();
    const form = maria.getByRole('dialog', { name: `Edit ${record.name}` });
    await form.getByLabel('Phone', { exact: true }).fill('+1 415 555 0101');
    await expect(othersForAlex).toContainText('Maria Garcia is editing');
    await snap(page, '30-presence');

    // Alex changes the record meanwhile: Maria's open form shows the change to a field she has not touched…
    await page.getByRole('button', { name: 'Edit Billing City' }).click();
    await page.locator('#inline-billing_city').fill('Lisbon');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#inline-billing_city')).toHaveCount(0);
    await expect(form.getByRole('status')).toContainText('Alex Morgan just changed this record.');
    await expect(form.getByLabel('Billing City', { exact: true })).toHaveValue('Lisbon');

    // …and warns about a field they both changed.
    await page.getByRole('button', { name: 'Edit Phone' }).click();
    await page.locator('#inline-phone').fill('+1 415 555 0199');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#inline-phone')).toHaveCount(0);
    await expect(form.getByRole('status')).toContainText('They also changed Phone, which you edited.');
    await expect(form.getByLabel('Phone', { exact: true })).toHaveValue('+1 415 555 0101');

    // Saving does not silently overwrite Alex's phone number: Maria chooses.
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    const conflict = form.getByRole('alert');
    await expect(conflict).toContainText('Someone else changed the same fields');
    await expect(conflict).toContainText('+1 415 555 0199');
    await expect(conflict).toContainText('+1 415 555 0101');
    await snap(maria, '31-edit-conflict');
    await conflict.getByRole('button', { name: 'Save mine anyway' }).click();
    await expect(form).toHaveCount(0);

    // Alex's page updates without a reload.
    await expect(page.getByRole('link', { name: '+1 415 555 0101', exact: true })).toBeVisible();
    const address = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Address', exact: true }) });
    await expect(address.getByText('Lisbon', { exact: true })).toBeVisible();
    const saved = (await (await page.request.get(`/api/records/account/${record.id}`)).json()) as { record: { fields: Record<string, unknown> } };
    expect(saved.record.fields).toMatchObject({ phone: '+1 415 555 0101', billing_city: 'Lisbon' });
  } finally {
    await other.close();
  }
});
