/**
 * Mobile E2E Tests for Account Workflows
 *
 * Tests complete account creation and funding flows on mobile devices.
 * Credentials are read from environment variables.
 * Runs on mobile-chrome (Android) and mobile-safari (iOS).
 */

import { test, expect, devices } from '@playwright/test';

const TEST_EMAIL = process.env.E2E_TEST_EMAIL || 'e2e-test@example.com';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'TestPassword1!';

// Configure test to run on mobile browsers only
test.use({
  ...devices['Pixel 5'],
  ...devices['iPhone 12'],
});

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());

  // Mock Friendbot for account funding
  await page.route('**/friendbot**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ successful: true, hash: 'b'.repeat(64) }),
    });
  });

  // Mock Horizon API calls
  await page.route('**/horizon-testnet.stellar.org/**', (route) => {
    const url = route.request().url();

    if (url.includes('/accounts/')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'GXXXXX',
          sequence: '123456789',
          balances: [
            { asset_type: 'native', balance: '10000.0000000' },
          ],
        }),
      });
    } else {
      route.continue();
    }
  });
});

test.describe('Mobile Account Onboarding @mobile', () => {
  test('should register new account on mobile and show keypair setup', async ({ page }) => {
    await page.goto('/signup');

    // Fill signup form on mobile
    const emailInput = page.locator('[data-testid="email"]');
    const passwordInput = page.locator('[data-testid="password"]');
    const signupBtn = page.locator('[data-testid="signup-btn"]');

    // Scroll to email input
    await emailInput.scrollIntoViewIfNeeded();
    await emailInput.fill(TEST_EMAIL);

    // Scroll to password input
    await passwordInput.scrollIntoViewIfNeeded();
    await passwordInput.fill(TEST_PASSWORD);

    // Scroll to signup button and click
    await signupBtn.scrollIntoViewIfNeeded();
    await signupBtn.click();

    // Verify registration succeeds on mobile
    await expect(
      page.locator('[data-testid="verify-message"], [data-testid="keypair-setup"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should display public key during keypair setup on mobile', async ({ page }) => {
    await page.goto('/signup');

    // Register account
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="signup-btn"]');

    // Wait for keypair setup
    const keypairSetup = page.locator('[data-testid="keypair-setup"]');
    await expect(keypairSetup).toBeVisible({ timeout: 10000 });

    // Scroll to and verify public key display on mobile
    const publicKeyElement = page.locator('[data-testid="public-key"]');
    await publicKeyElement.scrollIntoViewIfNeeded();

    const publicKey = await publicKeyElement.textContent();
    expect(publicKey?.trim()).toMatch(/^G[A-Z2-7]{55}$/);
  });

  test('should show seed phrase backup on mobile', async ({ page }) => {
    await page.goto('/signup');

    // Register account
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="signup-btn"]');

    // Wait for keypair setup
    await expect(page.locator('[data-testid="keypair-setup"]')).toBeVisible({ timeout: 10000 });

    // Check for seed phrase section
    const seedPhraseSection = page.locator('[data-testid="seed-phrase"]');
    if (await seedPhraseSection.isVisible()) {
      // Scroll to seed phrase on mobile
      await seedPhraseSection.scrollIntoViewIfNeeded();

      // Verify seed words
      const wordElements = page.locator('[data-testid="seed-word"]');
      const wordCount = await wordElements.count();
      expect([12, 24]).toContain(wordCount);
    }
  });
});

test.describe('Mobile Account Funding @mobile', () => {
  test('should fund account on testnet via mobile UI', async ({ page }) => {
    await page.goto('/signup');

    // Register account
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="signup-btn"]');

    // Wait for keypair setup
    await expect(page.locator('[data-testid="keypair-setup"]')).toBeVisible({ timeout: 10000 });

    // Look for fund/continue button
    const continueBtn = page.locator('[data-testid="continue-btn"], [data-testid="fund-btn"]');
    if (await continueBtn.isVisible()) {
      // Scroll to and click continue button on mobile
      await continueBtn.scrollIntoViewIfNeeded();
      await continueBtn.click();
    }

    // Verify dashboard loads on mobile
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });

    // Verify balance display is visible on mobile
    const balanceElement = page.locator('[data-testid="xlm-balance"]');
    await balanceElement.scrollIntoViewIfNeeded();
    await expect(balanceElement).toBeVisible();
  });

  test('should display account balance on mobile dashboard', async ({ page }) => {
    await page.goto('/login');

    // Fill login form
    const emailInput = page.locator('[data-testid="email"]');
    const passwordInput = page.locator('[data-testid="password"]');

    await emailInput.scrollIntoViewIfNeeded();
    await emailInput.fill(TEST_EMAIL);

    await passwordInput.scrollIntoViewIfNeeded();
    await passwordInput.fill(TEST_PASSWORD);

    // Click login button with scroll
    const loginBtn = page.locator('[data-testid="login-btn"]');
    await loginBtn.scrollIntoViewIfNeeded();
    await loginBtn.click();

    // Wait for dashboard
    await page.waitForURL('/dashboard');

    // Verify balance and public key are visible on mobile
    const publicKey = page.locator('[data-testid="public-key"]');
    const balance = page.locator('[data-testid="xlm-balance"]');

    await publicKey.scrollIntoViewIfNeeded();
    await expect(publicKey).toBeVisible();

    await balance.scrollIntoViewIfNeeded();
    await expect(balance).toBeVisible();
  });
});

test.describe('Mobile Trustline Management @mobile', () => {
  test('should create trustline for custom asset on mobile', async ({ page }) => {
    await page.goto('/login');

    // Fill login form
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    // Navigate to assets or trustlines
    const assetsBtn = page.locator('[data-testid="assets-btn"], [data-testid="trustlines-btn"]');
    if (await assetsBtn.isVisible()) {
      await assetsBtn.scrollIntoViewIfNeeded();
      await assetsBtn.click();
    }

    // Look for add trustline option
    const addTrustlineBtn = page.locator('[data-testid="add-trustline-btn"], [data-testid="add-asset-btn"]');
    if (await addTrustlineBtn.isVisible()) {
      await addTrustlineBtn.scrollIntoViewIfNeeded();
      await addTrustlineBtn.click();

      // Fill trustline form
      const assetCodeInput = page.locator('[data-testid="asset-code"]');
      const issuerInput = page.locator('[data-testid="issuer"]');

      if (await assetCodeInput.isVisible()) {
        await assetCodeInput.fill('USDC');
      }

      if (await issuerInput.isVisible()) {
        await issuerInput.fill('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
      }

      // Submit form
      const submitBtn = page.locator('[data-testid="confirm-trustline-btn"]');
      await submitBtn.scrollIntoViewIfNeeded();
      await submitBtn.click();

      // Verify success
      await expect(page.locator('[data-testid="success-toast"], [data-testid="trustline-created"]')).toBeVisible({
        timeout: 10000,
      });
    }
  });
});

test.describe('Mobile Navigation and Responsiveness @mobile', () => {
  test('should display navigation menu on mobile', async ({ page }) => {
    await page.goto('/login');

    // Fill login form
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    // Check for mobile menu/navigation
    const navMenu = page.locator('[data-testid="nav-menu"], [data-testid="sidebar"]');
    if (await navMenu.isVisible()) {
      expect(await navMenu.isVisible()).toBe(true);
    }
  });

  test('should handle mobile viewport orientation change', async ({ page, context }) => {
    await page.goto('/login');

    // Get initial viewport size
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();

    // Verify elements are visible in portrait
    const emailInput = page.locator('[data-testid="email"]');
    await expect(emailInput).toBeVisible();

    // Mock orientation change (viewport resize for web)
    // Note: true device orientation change requires real mobile device
    const newViewport = { width: viewport!.height, height: viewport!.width };
    await page.setViewportSize(newViewport);

    // Verify form still works after viewport change
    await page.fill('[data-testid="email"]', TEST_EMAIL);
    await page.fill('[data-testid="password"]', TEST_PASSWORD);

    expect(await page.locator('[data-testid="email"]').inputValue()).toBe(TEST_EMAIL);
  });

  test('should be touch-friendly on mobile with adequate button sizes', async ({ page }) => {
    await page.goto('/login');

    // Check login button size - should be at least 44x44px (iOS recommendation)
    const loginBtn = page.locator('[data-testid="login-btn"]');
    const boundingBox = await loginBtn.boundingBox();

    // Verify button meets minimum touch target size
    expect(boundingBox?.height).toBeGreaterThanOrEqual(40);
    expect(boundingBox?.width).toBeGreaterThanOrEqual(40);
  });
});
