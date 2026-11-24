import { expect, type Page, test } from '@playwright/test';
import { email, PASSWORD, signIn, snap } from './helpers.ts';

async function fieldLabels(page: Page, object: string): Promise<string[]> {
  const res = await page.request.get(`/api/objects/${object}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { fields: { label: string }[] }).fields.map((f) => f.label);
}

test('signing up creates an organization with its own database', async ({ page }) => {
  const stamp = Date.now() % 1_000_000;
  const orgName = `Lumen Labs ${stamp}`;
  const slug = `lumen-labs-${stamp}`;
  const founder = `lena-${stamp}@lumen.example`;
  const password = 'lumen-secret-1';

  await page.goto('/login');
  await page.getByRole('link', { name: 'Create an organization' }).click();
  await expect(page.getByRole('heading', { name: 'Create your organization' })).toBeVisible();
  await page.getByLabel('Organization name').fill(orgName);
  await expect(page.getByLabel('Organization ID')).toHaveValue(slug);
  await page.getByLabel('Your name').fill('Lena Novak');
  await page.getByLabel('Email').fill(founder);
  await page.getByLabel('Password').fill(password);
  await page.getByLabel('Add sample records so you can explore').uncheck();
  await snap(page, '20-signup');
  await page.getByRole('button', { name: 'Create organization' }).click();

  const userMenu = page.getByRole('button', { name: 'User menu' });
  await expect(userMenu).toBeVisible({ timeout: 30_000 });
  const inOrg = { 'x-tito-org': slug };
  const session = await page.request.get('/api/auth/session', { headers: inOrg });
  expect(await session.json()).toMatchObject({ organization: { slug, name: orgName, kind: 'production' }, user: { name: 'Lena Novak' }, permissions: { setup: true } });
  // A new database: no sample records, and none of the demo company's.
  const accounts = await page.request.post('/api/records/account/query', { headers: inOrg, data: { pageSize: 5 } });
  expect(((await accounts.json()) as { records: unknown[] }).records).toEqual([]);
  // Accounts live in one organization only.
  expect((await page.request.post('/api/auth/login', { data: { email: founder, password } })).status()).toBe(401);
  expect((await page.request.post('/api/auth/login', { data: { email: email('admin'), password: PASSWORD, organization: slug } })).status()).toBe(401);

  await userMenu.click();
  await expect(page.getByText(orgName, { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  // The sign-in page remembers the organization.
  await expect(page.getByLabel('Organization')).toHaveValue(slug);
  await expect(page.getByText(`Signing in to ${orgName}`)).toBeVisible();
  await page.getByLabel('Email').fill(founder);
  await page.getByLabel('Password').fill(password);
  await snap(page, '21-sign-in-organization');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(userMenu).toBeVisible();
  await page.goto('/o/account');
  await expect(page.getByText(/No accounts found/i)).toBeVisible();
});

test('an administrator builds a change in a sandbox and deploys it to production', async ({ page, context }) => {
  test.setTimeout(120_000);
  const name = `qa${Date.now() % 100_000}`;
  const slug = `default--${name}`;
  const field = `Renewal Risk ${name}`;

  await signIn(page, 'admin');
  await page.goto('/setup/sandboxes');
  // The header's button (an empty list has another one).
  await page.getByRole('button', { name: 'New sandbox' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New sandbox' });
  await dialog.getByLabel('Name').fill(name);
  await expect(dialog.getByRole('radio', { name: /^Developer/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Create sandbox' }).click();
  await expect(page.getByText(`Copying production into sandbox ${name}…`)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: slug });
  await expect(row.getByText('Ready')).toBeVisible({ timeout: 60_000 });
  await snap(page, '22-sandboxes');

  // The sandbox opens in a new tab; people sign in with their production email and password.
  const open = row.getByRole('link', { name: 'Open' });
  await expect(open).toHaveAttribute('href', `/?org=${slug}`);
  const [sandbox] = await Promise.all([context.waitForEvent('page'), open.click()]);
  await expect(sandbox.getByText(`Signing in to ${name}`)).toBeVisible();
  await expect(sandbox.getByText('Sandbox', { exact: true })).toBeVisible();
  await sandbox.getByLabel('Email').fill(email('admin'));
  await sandbox.getByLabel('Password').fill(PASSWORD);
  await sandbox.getByRole('button', { name: 'Sign in' }).click();
  await expect(sandbox.getByText(new RegExp(`^Sandbox ${name} of .+\\. Changes here do not affect production\\.$`))).toBeVisible();

  await sandbox.goto('/setup/objects/account');
  await sandbox.getByRole('button', { name: 'New field' }).click();
  const newField = sandbox.getByRole('dialog', { name: 'New field on Account' });
  await newField.getByLabel('Field label').fill(field);
  await newField.getByLabel('Type').selectOption('Number');
  await newField.getByRole('button', { name: 'Create field' }).click();
  await expect(sandbox.getByRole('row', { name: new RegExp(field) })).toBeVisible();
  await snap(sandbox, '23-sandbox');
  await sandbox.close();
  expect(await fieldLabels(page, 'account')).not.toContain(field);

  await row.getByRole('link', { name: 'Compare and deploy' }).click();
  await expect(page.getByRole('heading', { name: `Deploy from ${name}` })).toBeVisible();
  const account = page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: 'Select Account', exact: true }) });
  await expect(account).toContainText('Changed');
  await expect(account).toContainText('1 new field');
  await account.getByRole('checkbox').check();
  await snap(page, '24-sandbox-deploy');
  await page.getByRole('button', { name: 'Deploy to production' }).click();
  await page.getByRole('dialog', { name: 'Deploy to production?' }).getByRole('button', { name: 'Deploy', exact: true }).click();
  await expect(page.getByText('Deployed 1 component to production')).toBeVisible();
  expect(await fieldLabels(page, 'account')).toContain(field);

  await page.goto('/setup/sandboxes');
  const history = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Deployment history' }) });
  await expect(history.getByRole('row').filter({ hasText: name })).toContainText('1 component');

  await row.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: `Delete sandbox ${name}?` }).getByRole('button', { name: 'Delete sandbox' }).click();
  await expect(page.getByText(`Sandbox ${name} deleted`)).toBeVisible();
  await expect(row).toHaveCount(0);
  // Deployed changes stay in production.
  expect(await fieldLabels(page, 'account')).toContain(field);
});
