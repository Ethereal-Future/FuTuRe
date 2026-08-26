/**
 * Authentication Helper for E2E Tests
 *
 * Provides shared login functionality using environment variables.
 * Credentials are read from E2E_TEST_EMAIL and E2E_TEST_PASSWORD.
 */

const TEST_EMAIL = process.env.E2E_TEST_EMAIL || 'e2e-test@example.com';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'TestPassword1!';

/**
 * Log in as the test user and wait for dashboard.
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function loginAsTestUser(page) {
  await page.goto('/login');
  await page.fill('[data-testid="email"]', TEST_EMAIL);
  await page.fill('[data-testid="password"]', TEST_PASSWORD);
  await page.click('[data-testid="login-btn"]');
  await page.waitForURL('/dashboard');
}

/**
 * Get the test email for assertions.
 * @returns {string} The test email address
 */
export function getTestEmail() {
  return TEST_EMAIL;
}

/**
 * Get the test password for assertions.
 * @returns {string} The test password
 */
export function getTestPassword() {
  return TEST_PASSWORD;
}
