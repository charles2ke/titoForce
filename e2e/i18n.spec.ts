import { expect, test } from '@playwright/test';
import { signIn, snap } from './helpers.ts';

test.describe('in a French browser', () => {
  test.use({ locale: 'fr-FR' });

  test('the sign-in page follows the browser language until someone picks another', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    await page.getByLabel('Langue').selectOption('Deutsch');
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
    await snap(page, '25-sign-in-german');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  });
});

test('people choose their language in My settings and keep it on every device', async ({ page }) => {
  await signIn(page, 'sofia');
  try {
    await page.goto('/settings');
    await page.getByLabel('Language').selectOption('es');
    await expect(page.getByRole('heading', { name: 'Mi configuración' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    await snap(page, '26-settings-spanish');

    // The choice is saved on the account, not in the browser.
    await page.evaluate(() => localStorage.clear());
    await page.goto('/o/case');
    const main = page.getByRole('main');
    await expect(main.getByText('Casos', { exact: true })).toBeVisible();
    // Dates follow the language too.
    await expect(main.getByText(/\b\d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\.? \d{4}\b/).first()).toBeVisible();
  } finally {
    await page.request.put('/api/auth/locale', { data: { locale: null } });
  }
});

test('administrators translate the labels of their configuration', async ({ page }) => {
  const label = `Urgencia ${Date.now() % 10_000}`;
  await signIn(page, 'admin');
  await page.goto('/setup/translations');
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('es');
  await page.getByLabel('Type', { exact: true }).selectOption('field');
  await page.getByLabel('Object', { exact: true }).selectOption('case');
  await page.getByLabel('Search labels').fill('Priority');
  const input = page.getByLabel('Translation of “Priority”', { exact: true });
  await expect(input).toHaveAttribute('placeholder', 'Prioridad');
  await input.fill(label);
  await expect(page.getByText('1 unsaved change')).toBeVisible();
  await snap(page, '27-translations');
  await page.getByRole('button', { name: 'Save translations' }).click();
  await expect(page.getByText('1 translation saved')).toBeVisible();

  await signIn(page, 'sofia');
  await page.request.put('/api/auth/locale', { data: { locale: 'es' } });
  try {
    await page.goto('/o/case');
    await expect(page.getByRole('columnheader', { name: label })).toBeVisible();
  } finally {
    await page.request.put('/api/auth/locale', { data: { locale: null } });
  }
});
