import { expect, test } from '@playwright/test';
import { signIn, snap } from './helpers.ts';

test('an admin adds a custom field that is immediately available on records', async ({ page }) => {
  const label = `Health Score ${Date.now() % 1_000_000}`;
  await signIn(page, 'admin');
  await page.goto('/setup/objects/account');
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'New field' }).click();
  const dialog = page.getByRole('dialog', { name: 'New field on Account' });
  await dialog.getByLabel('Field label').fill(label);
  await dialog.getByLabel('Type').selectOption('Number');
  await dialog.getByRole('button', { name: 'Create field' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('row', { name: new RegExp(label) })).toContainText('Custom');
  await snap(page, '10-setup-custom-field');

  await page.goto('/o/account');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Account' }).getByLabel(label)).toBeVisible();
});

test('opens a dashboard and drills into one of its reports', async ({ page }) => {
  await signIn(page, 'maria');
  await page.goto('/dashboards');
  await page.getByRole('link', { name: 'Sales Overview' }).first().click();
  await expect(page).toHaveURL(/\/dashboards\/[^/]+$/);
  const widget = page.getByRole('link', { name: 'Pipeline by stage' });
  await expect(widget).toBeVisible();
  await snap(page, '11-dashboard');

  await widget.click();
  await expect(page).toHaveURL(/\/reports\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Pipeline by stage' })).toBeVisible();
  await snap(page, '12-report');
});

test('hides setup from users without setup access', async ({ page }) => {
  await signIn(page, 'james');
  await page.goto('/app/sales');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Opportunities' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Setup' })).toHaveCount(0);
});
