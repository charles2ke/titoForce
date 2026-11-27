import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { CrmRecord, QueryResponse, RoleDef, SharingRule, UserDTO } from '@titoforce/shared';
import { email, PASSWORD, signIn, signInRequest, snap, totp } from './helpers.ts';

// These tests change shared security settings, so each one restores them through the API, even when it fails.

async function role(request: APIRequestContext, id: string): Promise<RoleDef> {
  const roles = (await (await request.get('/api/roles')).json()) as RoleDef[];
  const found = roles.find((r) => r.id === id);
  if (!found) throw new Error(`No role ${id}`);
  return found;
}

async function restoreRole(request: APIRequestContext, original: RoleDef): Promise<void> {
  const res = await request.put(`/api/roles/${original.id}`, { data: { name: original.name, description: original.description, permissions: original.permissions } });
  expect(res.ok(), `restore role ${original.id}`).toBe(true);
}

/** Records the signed-in user of `page` can see that match a field value. */
async function find(page: Page, object: string, rules: { field: string; op: string; value: unknown }[]): Promise<CrmRecord[]> {
  const res = await page.request.post(`/api/records/${object}/query`, { data: { filters: { match: 'all', rules }, pageSize: 50 } });
  expect(res.ok(), `query ${object}`).toBe(true);
  return ((await res.json()) as QueryResponse).records;
}

async function switchUser(page: Page, user: string): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, user);
}

/** Signs out, then fills in the sign-in form. */
async function signInWithPassword(page: Page, user: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email(user));
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function resetMfa(request: APIRequestContext, user: string): Promise<void> {
  const users = (await (await request.get('/api/users')).json()) as UserDTO[];
  const id = users.find((u) => u.email === email(user))?.id;
  expect(id, `user ${user}`).toBeTruthy();
  const res = await request.delete(`/api/users/${id}/mfa`);
  // 400: two-factor authentication is already off.
  expect([200, 400], `reset two-factor authentication for ${user}`).toContain(res.status());
}

const mfaCard = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Two-factor authentication', exact: true }) });

test('field permissions make fields read only or hidden for a role', async ({ page, request }) => {
  await signInRequest(request, 'admin');
  const original = await role(request, 'sales_rep');
  try {
    await signIn(page, 'admin');
    await page.goto('/setup/roles');
    await page.getByRole('navigation', { name: 'Roles' }).getByRole('button', { name: /Sales Representative/ }).click();
    const fls = page.getByRole('region', { name: 'Field permissions' });
    const object = fls.getByRole('button', { name: 'Opportunity', exact: true });
    await object.click();
    const fields = fls.getByRole('group', { name: 'Opportunity', exact: true });
    await fields.getByRole('combobox', { name: 'Amount access' }).selectOption('Read only');
    await fields.getByRole('combobox', { name: 'Next Step access' }).selectOption('Hidden');
    await expect(object).toHaveAccessibleDescription('1 hidden · 1 read only');
    // A role that creates opportunities must be able to fill in the name.
    const name = fields.getByRole('combobox', { name: 'Opportunity Name access' });
    await expect(name).toBeDisabled();
    await expect(name).toHaveAccessibleDescription('Part of the record name and required to create opportunities, so it must stay editable.');
    await object.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await snap(page, '13-setup-field-permissions');
    // Expected Revenue is calculated from Probability, so hiding only Probability would still give its value away.
    const probability = fields.getByRole('combobox', { name: 'Probability access' });
    await probability.selectOption('Hidden');
    await page.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Formula Opportunity Expected Revenue is calculated from Probability, which this role cannot see; hide it as well')).toBeInViewport();
    await snap(page, '28-setup-field-permissions-rejected');
    await probability.selectOption('Edit');
    await page.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Sales Representative saved')).toBeVisible();

    // James is a sales representative: on his own opportunity, Amount is read only and Next Step is gone.
    await switchUser(page, 'james');
    const mine = (await find(page, 'opportunity', [{ field: 'owner_id', op: 'eq', value: 'CURRENT_USER' }])).filter((r) => r.access?.edit);
    expect(mine.length, 'James has an opportunity he can edit').toBeGreaterThan(0);
    expect(mine[0]!.fields).not.toHaveProperty('next_step');
    await page.goto(`/r/${mine[0]!.id}`);
    await expect(page.getByRole('button', { name: 'Edit Close Date' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Amount' })).toHaveCount(0);
    await expect(page.getByText('Next Step', { exact: true })).toHaveCount(0);
    await snap(page, '14-record-field-permissions');

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const form = page.getByRole('dialog', { name: `Edit ${mine[0]!.name}` });
    await expect(form.getByLabel('Close Date')).toBeVisible();
    await expect(form.getByLabel('Amount')).toHaveCount(0);
    await expect(form.getByLabel('Next Step')).toHaveCount(0);
  } finally {
    await restoreRole(request, original);
  }
});

test('a sharing rule gives a role edit access to matching records, but not delete or owner changes', async ({ page, request }) => {
  const name = 'Energy accounts for sales reps';
  await signInRequest(request, 'admin');
  try {
    // Northstar Energy belongs to Priya. James, also a sales representative, can read it but not edit it.
    await signIn(page, 'james');
    const [account] = await find(page, 'account', [{ field: 'name', op: 'eq', value: 'Northstar Energy' }]);
    expect(account, 'James sees Northstar Energy').toBeTruthy();
    expect(account!.access).toEqual({ edit: false, delete: false });

    await switchUser(page, 'admin');
    await page.goto('/setup/sharing');
    await expect(page.getByRole('heading', { name: 'Sharing Rules', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'New sharing rule' }).click();
    const dialog = page.getByRole('dialog', { name: 'New sharing rule' });
    await dialog.getByRole('textbox', { name: 'Name (required)' }).fill(name);
    await dialog.getByRole('combobox', { name: 'Object (required)' }).selectOption({ label: 'Account' });
    await dialog.getByRole('radio', { name: 'Records matching conditions' }).check();
    await dialog.getByRole('button', { name: 'Add condition' }).click();
    await dialog.getByRole('combobox', { name: 'Field', exact: true }).selectOption({ label: 'Industry' });
    await dialog.getByRole('combobox', { name: 'Value', exact: true }).selectOption('Energy');
    await dialog.getByRole('group', { name: 'Share with (required)' }).getByRole('checkbox', { name: 'Sales Representative' }).check();
    await dialog.getByRole('combobox', { name: 'Access', exact: true }).selectOption({ label: 'Read and edit' });
    await snap(page, '15-setup-sharing-rule');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible();
    await expect(page.getByText('Records where Industry equals Energy')).toBeVisible();
    await snap(page, '16-setup-sharing-rules');

    await switchUser(page, 'james');
    await page.goto(`/r/${account!.id}`);
    await expect(page.getByRole('heading', { name: 'Northstar Energy', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Industry' })).toBeVisible();
    // Sharing never grants delete, and only owners (or roles that edit all accounts) can give a record away.
    await expect(page.getByRole('button', { name: 'Change owner' })).toHaveCount(0);
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('button', { name: 'Show related records' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await snap(page, '17-record-shared');
  } finally {
    const rules = (await (await request.get('/api/sharing-rules')).json()) as SharingRule[];
    for (const r of rules.filter((x) => x.name === name)) expect((await request.delete(`/api/sharing-rules/${r.id}`)).ok()).toBe(true);
  }
});

test('an admin connects a single sign-on provider that appears on the sign-in page', async ({ page, request }) => {
  await signInRequest(request, 'admin');
  try {
    await signIn(page, 'admin');
    await page.goto('/setup/sso');
    await expect(page.getByRole('heading', { name: 'Single Sign-On', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'New provider' }).click();
    const dialog = page.getByRole('dialog', { name: 'New single sign-on provider' });
    await expect(dialog.getByRole('radio', { name: 'OpenID Connect' })).toBeChecked();
    await dialog.getByRole('textbox', { name: 'Name (required)' }).fill('Okta');
    await expect(dialog.getByRole('textbox', { name: 'ID', exact: true })).toHaveValue('okta');
    await dialog.getByRole('textbox', { name: 'Issuer URL (required)' }).fill('https://titoforce.okta.example');
    await dialog.getByRole('textbox', { name: 'Client ID (required)' }).fill('0oa1titoforce');
    await dialog.getByLabel('Client secret').fill('example-client-secret');
    await dialog.getByRole('switch', { name: 'Create users on first sign-in' }).click();
    await dialog.getByRole('combobox', { name: 'Default role (required)' }).selectOption({ label: 'Sales Representative' });
    await dialog.getByRole('textbox', { name: 'Allowed email domains' }).fill('titoforce.example');
    await expect(dialog).toContainText('/api/auth/sso/okta/callback');
    await snap(page, '18-setup-sso-provider');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);

    const card = page.getByRole('region', { name: 'Okta' });
    await expect(card).toContainText('/api/auth/sso/okta/callback');
    await expect(card).toContainText('Creates users with role Sales Representative');
    await expect(card).toContainText('Stored');
    await snap(page, '19-setup-sso');

    await page.context().clearCookies();
    await page.goto('/login');
    const sso = page.getByRole('button', { name: 'Sign in with Okta' });
    await expect(sso).toBeVisible();
    await snap(page, '20-login-sso');
    // The issuer doesn't exist, so the server can't reach it and sends the browser back with an error.
    await sso.click();
    await expect(page).toHaveURL(/\/login\?sso_error=failed$/);
    await expect(page.getByRole('alert')).toHaveText('Single sign-on failed. Please try again, or ask your administrator to check the provider settings.');
  } finally {
    const res = await request.delete('/api/sso-providers/okta');
    expect([200, 204, 404]).toContain(res.status());
  }
});

test('a role that requires two-factor authentication has its users set it up when they sign in', async ({ page, request }) => {
  await signInRequest(request, 'admin');
  const original = await role(request, 'employee');
  try {
    await signIn(page, 'admin');
    await page.goto('/setup/roles');
    await page.getByRole('navigation', { name: 'Roles' }).getByRole('button', { name: /^Employee/ }).click();
    const required = page.getByRole('switch', { name: 'Require two-factor authentication' });
    await required.click();
    await expect(required).toBeChecked();
    await page.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Employee saved')).toBeVisible();
    await snap(page, '21-setup-role-mfa');

    // Noah is the only employee, and he hasn't set up an authenticator app yet.
    await signInWithPassword(page, 'noah');
    await expect(page.getByRole('heading', { name: 'Set up two-factor authentication' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
    const secret = (await page.getByLabel('Setup key', { exact: true }).innerText()).replace(/\s/g, '');
    await snap(page, '22-login-mfa-setup');
    await page.getByLabel('Authentication code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
    await snap(page, '23-login-recovery-codes');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: /, Noah$/ })).toBeVisible();

    await page.goto('/settings');
    const card = mfaCard(page);
    await expect(card.getByText('On', { exact: true })).toBeVisible();
    await expect(card).toContainText('10 recovery codes left');
    await expect(card.getByRole('button', { name: 'Turn off' })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Turn off' })).toHaveAccessibleDescription('Your role requires two-factor authentication.');
    await card.scrollIntoViewIfNeeded();
    await snap(page, '24-settings-mfa');

    // Signing in now takes a code. Each code works once, so use the next one.
    await signInWithPassword(page, 'noah');
    await expect(page.getByRole('heading', { name: 'Two-factor authentication', exact: true })).toBeVisible();
    await page.getByLabel('Authentication code').fill(totp(secret, Date.now() + 30_000));
    await snap(page, '25-login-mfa-code');
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page.getByRole('heading', { name: /, Noah$/ })).toBeVisible();

    // An admin resets it, for example after Noah loses his phone.
    await switchUser(page, 'admin');
    await page.goto('/setup/users');
    const row = page.getByRole('row', { name: /Noah Williams/ });
    await expect(row.getByText('2FA', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Edit Noah Williams' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Noah Williams' });
    await expect(dialog).toContainText('Two-factor authentication is on');
    await snap(page, '26-setup-user-mfa');
    await dialog.getByRole('button', { name: 'Reset two-factor authentication' }).click();
    await page.getByRole('dialog', { name: 'Reset two-factor authentication for Noah Williams?' }).getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByText('Two-factor authentication reset', { exact: true })).toBeVisible();
    await expect(dialog).toContainText('Two-factor authentication was reset.');
  } finally {
    await restoreRole(request, original);
    await resetMfa(request, 'noah');
  }
});

test('people turn on two-factor authentication in their settings', async ({ page, request }) => {
  await signInRequest(request, 'admin');
  try {
    await signIn(page, 'sofia');
    await page.goto('/settings');
    const card = mfaCard(page);
    await expect(card.getByText('Off', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Set up two-factor authentication' }).click();
    const setup = page.getByRole('dialog', { name: 'Set up two-factor authentication' });
    const secret = (await setup.getByLabel('Setup key', { exact: true }).innerText()).replace(/\s/g, '');
    await setup.getByLabel('Authentication code').fill(totp(secret));
    await setup.getByLabel('Current password').fill(PASSWORD);
    await snap(page, '27-settings-mfa-setup');
    await setup.getByRole('button', { name: 'Turn on' }).click();
    await expect(setup.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
    await setup.getByRole('button', { name: 'Done' }).click();
    await expect(card.getByText('On', { exact: true })).toBeVisible();

    // Signing in with just the password isn't enough any more.
    const login = await request.post('/api/auth/login', { data: { email: email('sofia'), password: PASSWORD } });
    expect(await login.json()).toEqual({ mfaRequired: true, challenge: expect.any(String) });

    // Turning it off takes the next code.
    await card.getByRole('button', { name: 'Turn off' }).click();
    const off = page.getByRole('dialog', { name: 'Turn off two-factor authentication' });
    await off.getByLabel('Authentication code').fill(totp(secret, Date.now() + 30_000));
    await off.getByLabel('Current password').fill(PASSWORD);
    await off.getByRole('button', { name: 'Turn off' }).click();
    await expect(off).toHaveCount(0);
    await expect(card.getByText('Off', { exact: true })).toBeVisible();
  } finally {
    await signInRequest(request, 'admin');
    await resetMfa(request, 'sofia');
  }
});
