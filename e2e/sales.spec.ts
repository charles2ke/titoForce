import { expect, test } from '@playwright/test';
import { email, PASSWORD, signIn, snap } from './helpers.ts';

test('signs in through the login form and lands on the Sales home', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email').fill(email('maria'));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/app\/sales$/);
  await expect(page.getByRole('heading', { name: /, Maria$/ })).toBeVisible();
  await expect(page.getByText('Open pipeline')).toBeVisible();
  await snap(page, '01-sales-home');
});

test('shows opportunities as a table and as a kanban board', async ({ page }) => {
  await signIn(page, 'maria');
  await page.goto('/o/opportunity');
  await expect(page.getByRole('link', { name: 'Globex Financial — Service Rollout' })).toBeVisible();
  await snap(page, '02-opportunities-table');

  await page.getByRole('radio', { name: 'Kanban' }).click();
  await expect(page).toHaveURL(/vt=kanban/);
  for (const stage of ['Prospecting', 'Proposal', 'Closed Won']) await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
  await snap(page, '03-opportunities-kanban');
});

test('creates an account and logs a call on it', async ({ page }) => {
  const name = `Playwright Labs ${Date.now()}`;
  await signIn(page, 'maria');
  await page.goto('/o/account');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Account' });
  await dialog.getByLabel('Account Name').fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/r\/acc_/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByLabel('Subject').fill('Discovery call with the CTO');
  await page.getByRole('button', { name: 'Log call' }).click();
  await expect(page.getByText('Discovery call with the CTO')).toBeVisible();
  await snap(page, '04-record-page');
});

test('approves a quote discount from the approvals inbox', async ({ page, browser }) => {
  // Priya creates a quote with a 30% discount; an automation submits it to the quote discount process (approver: Maria).
  const priya = await browser.newPage();
  await signIn(priya, 'priya');
  const quoteName = `Q-E2E ${Date.now()}`;
  const created = await priya.request.post('/api/records/quote', { data: { fields: { name: quoteName, discount: 30 } } });
  expect(created.status()).toBe(201);
  const { record } = (await created.json()) as { record: { id: string; fields: Record<string, unknown> } };
  expect(record.fields.status).toBe('In Review');
  await priya.close();

  await signIn(page, 'maria');
  await page.goto('/approvals');
  const item = page.getByRole('listitem').filter({ hasText: quoteName });
  await expect(item).toBeVisible();
  await expect(item.getByText('Discount of 30% requires approval.')).toBeVisible();
  await snap(page, '05-approvals-inbox');

  await item.getByRole('button', { name: 'Approve' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Comment').fill('Approved for the multi-year term');
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(item).toHaveCount(0);

  await page.goto(`/r/${record.id}`);
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
});

test('shows the sales forecast by month and by owner', async ({ page }) => {
  await signIn(page, 'maria');
  await page.goto('/forecast');
  await expect(page.getByRole('heading', { name: 'Sales forecast' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Forecast chart by close month' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Total' })).toBeVisible();
  await snap(page, '06-forecast');

  await page.getByRole('radio', { name: 'By owner' }).click();
  await expect(page).toHaveURL(/by=owner/);
  await expect(page.getByRole('cell', { name: /Priya Patel/ })).toBeVisible();
});
