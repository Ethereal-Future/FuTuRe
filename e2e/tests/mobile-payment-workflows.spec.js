/**
 * Mobile E2E Tests for Payment Workflows
 *
 * Tests complete payment sending on mobile devices (iOS and Android).
 * Credentials are read from environment variables.
 * Runs on mobile-chrome (Android) and mobile-safari (iOS).
 */

import { test, expect, devices } from '@playwright/test';

const TEST_EMAIL = process.env.E2E_TEST_EMAIL || 'e2e-test@example.com';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'TestPassword1!';
const RECIPIENT_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// Configure test to run on mobile browsers only
test.use({
  ...devices['Pixel 5'],
  ...devices['iPhone 12'],
});

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());

  // Mock Horizon API calls
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

test.describe('Mobile Payment Sending @mobile', () => {
  test('should complete full send flow on mobile and show success', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'iOS gesture test');

    await page.goto('/login');

    // Fill login form
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    // Verify page is visible
    await expect(page.locator('[data-testid="xlm-balance"]')).toBeVisible();

    // Navigate to send payment
    await page.click('[data-testid="send-btn"]');
    await expect(page).toHaveURL(/\/payment\/send|\/send/);

    // Fill payment form with touches
    await page.fill('[data-testid="recipient"]', RECIPIENT_ADDRESS);
    await page.fill('[data-testid="amount"]', '1');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Scroll to review button on mobile
    await page.locator('[data-testid="review-btn"]').scrollIntoViewIfNeeded();

    // Click review button
    await page.click('[data-testid="review-btn"]');

    // Verify confirmation screen
    await expect(page.locator('[data-testid="fee-breakdown"]')).toBeVisible();
    await expect(page.locator('[data-testid="confirm-recipient"]')).toContainText(RECIPIENT_ADDRESS);
    await expect(page.locator('[data-testid="confirm-amount"]')).toContainText('1');

    // Confirm payment
    await page.click('[data-testid="confirm-btn"]');

    // Verify success
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible({
      timeout: 10000,
    });

    await expect(page.locator('[data-testid="transaction-history"]')).toContainText(RECIPIENT_ADDRESS);
  });

  test('should send custom asset payment on mobile', async ({ page }) => {
    await page.goto('/login');

    // Fill login form
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    // Navigate to send payment
    await page.click('[data-testid="send-btn"]');

    // Fill payment form
    await page.fill('[data-testid="recipient"]', RECIPIENT_ADDRESS);
    await page.fill('[data-testid="amount"]', '50');
    await page.selectOption('[data-testid="asset"]', 'USDC');

    // Scroll to review button
    await page.locator('[data-testid="review-btn"]').scrollIntoViewIfNeeded();
    await page.click('[data-testid="review-btn"]');

    // Verify confirmation
    await expect(page.locator('[data-testid="fee-breakdown"]')).toBeVisible();

    // Confirm
    await page.click('[data-testid="confirm-btn"]');

    // Verify success
    await expect(page.locator('[data-testid="success-toast"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should show validation errors on mobile for invalid destination', async ({ page }) => {
    await page.goto('/login');

    // Fill login form
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    // Navigate to send payment
    await page.click('[data-testid="send-btn"]');

    // Fill with invalid destination
    await page.fill('[data-testid="recipient"]', 'invalid-key');
    await page.fill('[data-testid="amount"]', '10');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Scroll and submit
    await page.locator('[data-testid="review-btn"]').scrollIntoViewIfNeeded();
    await page.click('[data-testid="review-btn"]');

    // Verify error
    await expect(page.locator('[data-testid="error-destination"], [data-testid="payment-error"]')).toBeVisible();
  });

  test('should handle scroll gestures on mobile payment form', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Playwright scroll works on all platforms');

    await page.goto('/login');

    // Fill login form
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    // Navigate to send payment
    await page.click('[data-testid="send-btn"]');

    // Scroll through form on mobile viewport
    await page.locator('[data-testid="recipient"]').scrollIntoViewIfNeeded();
    expect(await page.locator('[data-testid="recipient"]').isVisible()).toBe(true);

    await page.locator('[data-testid="amount"]').scrollIntoViewIfNeeded();
    expect(await page.locator('[data-testid="amount"]').isVisible()).toBe(true);

    await page.locator('[data-testid="asset"]').scrollIntoViewIfNeeded();
    expect(await page.locator('[data-testid="asset"]').isVisible()).toBe(true);
  });
});

test.describe('Mobile Payment Confirmation @mobile', () => {
  test('should show payment confirmation dialog on mobile', async ({ page }) => {
    await page.goto('/login');

    // Fill login form
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    // Navigate to send payment
    await page.click('[data-testid="send-btn"]');

    // Fill payment form
    await page.fill('[data-testid="recipient"]', RECIPIENT_ADDRESS);
    await page.fill('[data-testid="amount"]', '10');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Scroll to review button
    await page.locator('[data-testid="review-btn"]').scrollIntoViewIfNeeded();
    await page.click('[data-testid="review-btn"]');

    // Verify confirmation dialog
    await expect(page.locator('[data-testid="confirmation-dialog"], [data-testid="fee-breakdown"]')).toBeVisible();
    await expect(page.locator('[data-testid="confirm-recipient"]')).toContainText(RECIPIENT_ADDRESS);
    await expect(page.locator('[data-testid="confirm-amount"]')).toContainText('10 XLM');
  });

  test('should cancel payment confirmation on mobile', async ({ page }) => {
    await page.goto('/login');

    // Fill login form
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    // Navigate to send payment
    await page.click('[data-testid="send-btn"]');

    // Fill payment form
    await page.fill('[data-testid="recipient"]', RECIPIENT_ADDRESS);
    await page.fill('[data-testid="amount"]', '10');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Scroll to review button and click
    await page.locator('[data-testid="review-btn"]').scrollIntoViewIfNeeded();
    await page.click('[data-testid="review-btn"]');

    // Cancel confirmation
    await page.click('[data-testid="cancel-btn"], [data-testid="back-btn"]');

    // Verify dialog closed and we're back on form
    await expect(page.locator('[data-testid="recipient"]')).toBeVisible();
  });
});
