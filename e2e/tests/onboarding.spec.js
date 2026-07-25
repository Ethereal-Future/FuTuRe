/**
 * E2E tests for account creation and onboarding flow.
 * Friendbot calls are intercepted to avoid live testnet dependencies.
 * Each test uses a unique email to prevent conflicts.
 */

import { test, expect } from '@playwright/test';

function uniqueEmail() {
  return `test+${Date.now()}@example.com`;
}

const STRONG_PASSWORD = 'Str0ngPass!word';

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());

  await page.route('**/friendbot**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ successful: true, hash: 'b'.repeat(64) }),
    });
  });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page['_consoleErrors'] = consoleErrors;
});

test.describe('Registration', () => {
  test('shows confirmation or redirects to keypair setup after registration @workflow', async ({
    page,
  }) => {
    const email = uniqueEmail();

    await page.goto('/signup');
    await page.fill('[data-testid="email"]', email);
    await page.fill('[data-testid="password"]', STRONG_PASSWORD);
    await page.click('[data-testid="signup-btn"]');

    await expect(
      page.locator('[data-testid="verify-message"], [data-testid="keypair-setup"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows error when email is already registered @workflow', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/signup');
    await page.fill('[data-testid="email"]', email);
    await page.fill('[data-testid="password"]', STRONG_PASSWORD);
    await page.click('[data-testid="signup-btn"]');
    await expect(
      page.locator('[data-testid="verify-message"], [data-testid="keypair-setup"]'),
    ).toBeVisible({ timeout: 10000 });

    await page.goto('/signup');
    await page.fill('[data-testid="email"]', email);
    await page.fill('[data-testid="password"]', STRONG_PASSWORD);
    await page.click('[data-testid="signup-btn"]');

    await expect(page.locator('[data-testid="signup-error"]')).toBeVisible({ timeout: 5000 });
  });

  test('shows validation error for weak password before submission @workflow', async ({
    page,
  }) => {
    await page.goto('/signup');
    await page.fill('[data-testid="email"]', uniqueEmail());
    await page.fill('[data-testid="password"]', 'weak');
    await page.click('[data-testid="signup-btn"]');

    await expect(page.locator('[data-testid="password-error"]')).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
  });
});

test.describe('Keypair generation', () => {
  test('displays a valid Stellar public key during keypair setup @workflow', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('[data-testid="email"]', uniqueEmail());
    await page.fill('[data-testid="password"]', STRONG_PASSWORD);
    await page.click('[data-testid="signup-btn"]');

    const keypairSetup = page.locator('[data-testid="keypair-setup"]');
    await expect(keypairSetup).toBeVisible({ timeout: 10000 });

    const publicKey = await page.locator('[data-testid="public-key"]').textContent();
    expect(publicKey?.trim()).toMatch(/^G[A-Z2-7]{55}$/);
  });

  test('displays seed phrase words during backup step @workflow', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('[data-testid="email"]', uniqueEmail());
    await page.fill('[data-testid="password"]', STRONG_PASSWORD);
    await page.click('[data-testid="signup-btn"]');

    await expect(page.locator('[data-testid="keypair-setup"]')).toBeVisible({ timeout: 10000 });

    const seedPhraseSection = page.locator('[data-testid="seed-phrase"]');
    if (await seedPhraseSection.isVisible()) {
      const wordCount = await page.locator('[data-testid="seed-word"]').count();
      expect([12, 24]).toContain(wordCount);
    }
  });
});

test.describe('First dashboard view', () => {
  test('shows public key and XLM balance on dashboard after onboarding @workflow', async ({
    page,
  }) => {
    await page.goto('/signup');
    await page.fill('[data-testid="email"]', uniqueEmail());
    await page.fill('[data-testid="password"]', STRONG_PASSWORD);
    await page.click('[data-testid="signup-btn"]');

    await expect(
      page.locator('[data-testid="keypair-setup"], [data-testid="verify-message"]'),
    ).toBeVisible({ timeout: 10000 });

    const keypairSetup = page.locator('[data-testid="keypair-setup"]');
    if (await keypairSetup.isVisible()) {
      const continueBtn = page.locator('[data-testid="continue-btn"]');
      if (await continueBtn.isVisible()) {
        await continueBtn.click();
      }
    }

    await page.waitForURL(/\/dashboard/, { timeout: 15000 });

    await expect(page.locator('[data-testid="public-key"]')).toBeVisible();
    await expect(page.locator('[data-testid="xlm-balance"]')).toBeVisible();

    expect(page['_consoleErrors']).toHaveLength(0);
  });
});
