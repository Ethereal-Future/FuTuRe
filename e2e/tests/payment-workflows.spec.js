/**
 * Payment Workflows E2E Tests
 * 
 * Tests complete payment sending process and error scenarios
 */

import { test, expect } from '@playwright/test';

test.describe('Payment Sending Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to payments
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');
    
    await page.click('text=Send Payment');
    await expect(page).toHaveURL('/payment/send');
  });

  test('should send XLM payment successfully @workflow', async ({ page }) => {
    // Fill payment form
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '10');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Submit payment
    await page.click('[data-testid="send-payment-btn"]');

    // Verify success
    await expect(page.locator('[data-testid="payment-success"]')).toBeVisible();
    await expect(page.locator('[data-testid="transaction-hash"]')).toBeVisible();
    
    // Verify hash format
    const hash = await page.locator('[data-testid="transaction-hash"]').textContent();
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('should send custom asset payment @workflow', async ({ page }) => {
    // Fill payment form for USDC
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '50');
    await page.selectOption('[data-testid="asset"]', 'USDC');

    // Submit payment
    await page.click('[data-testid="send-payment-btn"]');

    // Verify success
    await expect(page.locator('[data-testid="payment-success"]')).toBeVisible();
  });

  test('should show validation errors for invalid destination @workflow', async ({ page }) => {
    // Fill with invalid destination
    await page.fill('[data-testid="destination"]', 'invalid-key');
    await page.fill('[data-testid="amount"]', '10');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Submit payment
    await page.click('[data-testid="send-payment-btn"]');

    // Verify error
    await expect(page.locator('[data-testid="error-destination"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-destination"]')).toContainText('Invalid Stellar address');
  });

  test('should show validation errors for invalid amount @workflow', async ({ page }) => {
    // Fill with invalid amount
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '-5');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Submit payment
    await page.click('[data-testid="send-payment-btn"]');

    // Verify error
    await expect(page.locator('[data-testid="error-amount"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-amount"]')).toContainText('Amount must be positive');
  });

  test('should show error for insufficient balance @workflow', async ({ page }) => {
    // Fill with amount exceeding balance
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '999999999');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Submit payment
    await page.click('[data-testid="send-payment-btn"]');

    // Verify error
    await expect(page.locator('[data-testid="payment-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="payment-error"]')).toContainText('Insufficient balance');
  });

  test('should require trustline for custom assets @workflow', async ({ page }) => {
    // Try to send USDC without trustline
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '50');
    await page.selectOption('[data-testid="asset"]', 'USDC');

    // Submit payment
    await page.click('[data-testid="send-payment-btn"]');

    // Verify trustline prompt
    await expect(page.locator('[data-testid="trustline-required"]')).toBeVisible();
    await expect(page.locator('[data-testid="create-trustline-btn"]')).toBeVisible();
  });
});

test.describe('Payment Confirmation Workflow', () => {
  test('should show payment confirmation dialog @workflow', async ({ page }) => {
    await page.goto('/payment/send');
    
    // Fill payment form
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '10');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Click send
    await page.click('[data-testid="send-payment-btn"]');

    // Verify confirmation dialog
    await expect(page.locator('[data-testid="confirmation-dialog"]')).toBeVisible();
    await expect(page.locator('[data-testid="confirm-destination"]')).toContainText('GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await expect(page.locator('[data-testid="confirm-amount"]')).toContainText('10 XLM');
  });

  test('should cancel payment confirmation @workflow', async ({ page }) => {
    await page.goto('/payment/send');
    
    // Fill payment form
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '10');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Click send
    await page.click('[data-testid="send-payment-btn"]');

    // Cancel confirmation
    await page.click('[data-testid="cancel-btn"]');

    // Verify dialog closed
    await expect(page.locator('[data-testid="confirmation-dialog"]')).not.toBeVisible();
  });
});

test.describe('Payment History Workflow', () => {
  test('should display payment history @workflow', async ({ page }) => {
    await page.goto('/payments');

    // Verify history list
    await expect(page.locator('[data-testid="payments-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="payment-item"]')).toHaveCount(5);
  });

  test('should filter payments by type @workflow', async ({ page }) => {
    await page.goto('/payments');

    // Filter by sent
    await page.selectOption('[data-testid="filter-type"]', 'sent');
    await expect(page.locator('[data-testid="payment-item"]')).toHaveCount(3);

    // Filter by received
    await page.selectOption('[data-testid="filter-type"]', 'received');
    await expect(page.locator('[data-testid="payment-item"]')).toHaveCount(2);
  });

  test('should view payment details @workflow', async ({ page }) => {
    await page.goto('/payments');

    // Click on payment
    await page.click('[data-testid="payment-item"]:first-child');

    // Verify details
    await expect(page.locator('[data-testid="payment-details"]')).toBeVisible();
    await expect(page.locator('[data-testid="payment-hash"]')).toBeVisible();
    await expect(page.locator('[data-testid="payment-amount"]')).toBeVisible();
    await expect(page.locator('[data-testid="payment-date"]')).toBeVisible();
  });

  test('should export payment history @workflow', async ({ page }) => {
    await page.goto('/payments');

    // Download export
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="export-btn"]');
    const download = await downloadPromise;

    // Verify download
    expect(download.suggestedFilename()).toMatch(/payments-.*\.csv/);
  });
});

test.describe('Error Scenarios', () => {
  test('should handle network timeout @workflow', async ({ page }) => {
    // Mock network timeout
    await page.route('**/api/stellar/payment/send', route => {
      return new Promise(() => {
        // Never resolve to simulate timeout
      });
    });

    await page.goto('/payment/send');
    
    // Fill and submit
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '10');
    await page.click('[data-testid="send-payment-btn"]');

    // Verify timeout error
    await expect(page.locator('[data-testid="timeout-error"]')).toBeVisible({ timeout: 15000 });
  });

  test('should handle server error @workflow', async ({ page }) => {
    // Mock server error
    await page.route('**/api/stellar/payment/send', route => {
      return route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await page.goto('/payment/send');
    
    // Fill and submit
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '10');
    await page.click('[data-testid="send-payment-btn"]');

    // Verify error message
    await expect(page.locator('[data-testid="server-error"]')).toBeVisible();
  });

  test('should retry failed payment @workflow', async ({ page }) => {
    // Mock first request to fail, second to succeed
    let callCount = 0;
    await page.route('**/api/stellar/payment/send', route => {
      callCount++;
      if (callCount === 1) {
        return route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Temporary failure' }),
        });
      }
      return route.continue();
    });

    await page.goto('/payment/send');
    
    // Fill and submit
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '10');
    await page.click('[data-testid="send-payment-btn"]');

    // Verify error
    await expect(page.locator('[data-testid="payment-error"]')).toBeVisible();

    // Retry
    await page.click('[data-testid="retry-btn"]');

    // Verify success
    await expect(page.locator('[data-testid="payment-success"]')).toBeVisible();
  });
});
