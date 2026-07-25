/**
 * Account Workflows E2E Tests
 * 
 * Tests complete user workflows for account creation, funding, and management
 */

import { test, expect } from '@playwright/test';

test.describe('Account Creation Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should create a new Stellar account @workflow', async ({ page }) => {
    // Navigate to account creation page
    await page.click('text=Create Account');
    await expect(page).toHaveURL('/account/create');

    // Fill in account details
    await page.fill('[data-testid="account-name"]', 'Test Account');
    await page.fill('[data-testid="account-email"]', 'test@example.com');

    // Submit form
    await page.click('[data-testid="create-account-btn"]');

    // Verify success
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="public-key"]')).toBeVisible();
    await expect(page.locator('[data-testid="secret-key"]')).toBeVisible();

    // Verify keypair format
    const publicKey = await page.locator('[data-testid="public-key"]').textContent();
    expect(publicKey).toMatch(/^G[A-Z2-7]{55}$/);
  });

  test('should display validation errors for invalid input @workflow', async ({ page }) => {
    await page.click('text=Create Account');
    
    // Submit empty form
    await page.click('[data-testid="create-account-btn"]');

    // Verify validation errors
    await expect(page.locator('[data-testid="error-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-email"]')).toBeVisible();
  });

  test('should fund account on testnet @workflow', async ({ page }) => {
    await page.click('text=Create Account');
    
    // Create account
    await page.fill('[data-testid="account-name"]', 'Test Account');
    await page.fill('[data-testid="account-email"]', 'test@example.com');
    await page.click('[data-testid="create-account-btn"]');

    // Wait for account creation
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();

    // Fund account
    await page.click('[data-testid="fund-account-btn"]');

    // Verify funding success
    await expect(page.locator('[data-testid="funding-success"]')).toBeVisible();
    await expect(page.locator('[data-testid="balance"]')).toContainText('10000');
  });

  test('should view account balance @workflow', async ({ page }) => {
    // Navigate to accounts page
    await page.click('text=My Accounts');
    await expect(page).toHaveURL('/accounts');

    // Select account
    await page.click('[data-testid="account-item"]:first-child');

    // Verify balance display
    await expect(page.locator('[data-testid="balance-xlm"]')).toBeVisible();
    await expect(page.locator('[data-testid="balance-usdc"]')).toBeVisible();
  });
});

test.describe('Account Security Workflow', () => {
  test('should backup account keys @workflow', async ({ page }) => {
    await page.goto('/account/create');
    
    // Create account
    await page.fill('[data-testid="account-name"]', 'Test Account');
    await page.fill('[data-testid="account-email"]', 'test@example.com');
    await page.click('[data-testid="create-account-btn"]');

    // Download backup
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="download-keys-btn"]');
    const download = await downloadPromise;

    // Verify download
    expect(download.suggestedFilename()).toMatch(/stellar-keys-.*\.json/);
  });

  test('should show security warning for secret key @workflow', async ({ page }) => {
    await page.goto('/account/create');
    
    // Create account
    await page.fill('[data-testid="account-name"]', 'Test Account');
    await page.fill('[data-testid="account-email"]', 'test@example.com');
    await page.click('[data-testid="create-account-btn"]');

    // Verify warning is displayed
    await expect(page.locator('[data-testid="security-warning"]')).toBeVisible();
    await expect(page.locator('[data-testid="security-warning"]')).toContainText('never share');
  });
});

test.describe('Account Management Workflow', () => {
  test('should list all accounts @workflow', async ({ page }) => {
    await page.goto('/accounts');

    // Verify accounts list
    await expect(page.locator('[data-testid="accounts-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="account-item"]')).toHaveCount(3);
  });

  test('should view account details @workflow', async ({ page }) => {
    await page.goto('/accounts');
    
    // Click on account
    await page.click('[data-testid="account-item"]:first-child');

    // Verify details page
    await expect(page).toHaveURL(/\/account\/.*/);
    await expect(page.locator('[data-testid="account-public-key"]')).toBeVisible();
    await expect(page.locator('[data-testid="account-balance"]')).toBeVisible();
    await expect(page.locator('[data-testid="account-transactions"]')).toBeVisible();
  });

  test('should delete account @workflow', async ({ page }) => {
    await page.goto('/accounts');
    
    // Click delete button
    await page.click('[data-testid="delete-account-btn"]:first-child');

    // Confirm deletion
    await page.click('[data-testid="confirm-delete-btn"]');

    // Verify account removed
    await expect(page.locator('[data-testid="success-message"]')).toContainText('Account deleted');
  });
});
