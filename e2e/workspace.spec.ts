import { expect, test } from '@playwright/test';
import { signIn, snap } from './helpers.ts';

test('answers a pipeline question with the offline agent engine', async ({ page }) => {
  await signIn(page, 'maria');
  await page.goto('/app/sales');
  await page.getByRole('banner').getByRole('button', { name: 'Ask AI' }).click();

  const panel = page.getByRole('complementary', { name: 'AI assistant' });
  await expect(panel.getByText('Offline mode')).toBeVisible();
  await panel.getByRole('button', { name: "What's our pipeline?" }).click();
  await expect(panel.getByText(/Open pipeline: \$[\d,]+/)).toBeVisible();
  await expect(panel.getByText(/tool calls? · offline/)).toBeVisible();
  await snap(page, '07-agent-chat');
});

test('lists agents and their recent runs', async ({ page }) => {
  await signIn(page, 'maria');
  await page.goto('/agents');
  await expect(page.getByRole('heading', { name: 'titoForce Copilot' }).first()).toBeVisible();
  await expect(page.getByText('Deal Coach').first()).toBeVisible();
  await snap(page, '08-agents');
});

test('shows the org chart and finds people by name', async ({ page }) => {
  await signIn(page, 'hannah');
  await page.goto('/org-chart');
  await expect(page.getByRole('heading', { name: 'Org chart' })).toBeVisible();
  await expect(page.getByRole('tree').getByText('Olivia Bennett')).toBeVisible();
  await snap(page, '09-org-chart');

  await page.getByPlaceholder('Search people…').fill('Priya');
  await expect(page.getByText('Priya Patel')).toBeVisible();
  await expect(page.getByText('Olivia Bennett')).toBeVisible(); // manager chain breadcrumb
});
