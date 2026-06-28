/**
 * E2E tests for the full send-payment flow.
 * Credentials are read from environment variables.
 * Horizon API calls are intercepted to avoid live network dependencies.
 */

import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.E2E_TEST_EMAIL || 'e2e-test@example.com';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'TestPassword1!';
const RECIPIENT_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const UNFUNDED_ADDRESS = 'GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP';

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());

  await page.route('**/horizon-testnet.stellar.org/**', (route) => {
    const url = route.request().url();

    if (url.includes('/accounts/')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: RECIPIENT_ADDRESS,
          sequence: '123456789',
          balances: [
            { asset_type: 'native', balance: '100.0000000' },
          ],
        }),
      });
    } else if (url.includes('/transactions') || url.includes('/submit')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hash: 'a'.repeat(64),
          successful: true,
        }),
      });
    } else {
      route.continue();
    }
  });
});

test.describe('Send Payment — happy path', () => {
  test('completes full send flow and shows success @workflow', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    await page.click('[data-testid="send-btn"]');
    await expect(page).toHaveURL(/\/payment\/send|\/send/);

    await page.fill('[data-testid="recipient"]', RECIPIENT_ADDRESS);
    await page.fill('[data-testid="amount"]', '1');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    await page.click('[data-testid="review-btn"]');

    await expect(page.locator('[data-testid="fee-breakdown"]')).toBeVisible();
    await expect(page.locator('[data-testid="confirm-recipient"]')).toContainText(
      RECIPIENT_ADDRESS,
    );
    await expect(page.locator('[data-testid="confirm-amount"]')).toContainText('1');

    await page.click('[data-testid="confirm-btn"]');

    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible({
      timeout: 10000,
    });

    await expect(page.locator('[data-testid="transaction-history"]')).toContainText(
      RECIPIENT_ADDRESS,
    );

    const balanceText = await page
      .locator('[data-testid="xlm-balance"]')
      .textContent();
    expect(Number(balanceText?.replace(/[^0-9.]/g, ''))).toBeLessThan(100);
  });
});

test.describe('Send Payment — error path', () => {
  test('shows error and keeps user on confirmation screen for unfunded address @workflow', async ({
    page,
  }) => {
    await page.route('**/horizon-testnet.stellar.org/accounts/**', (route) => {
      if (route.request().url().includes(UNFUNDED_ADDRESS)) {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ type: 'https://stellar.org/horizon-errors/not_found' }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/login');
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    await page.click('[data-testid="send-btn"]');
    await page.fill('[data-testid="recipient"]', UNFUNDED_ADDRESS);
    await page.fill('[data-testid="amount"]', '1');
    await page.selectOption('[data-testid="asset"]', 'XLM');
    await page.click('[data-testid="review-btn"]');
    await page.click('[data-testid="confirm-btn"]');

    await expect(page.locator('[data-testid="payment-error"]')).toBeVisible({
      timeout: 10000,
    });

    await expect(page).toHaveURL(/\/payment\/send|\/send|\/confirm/);
  });
});
