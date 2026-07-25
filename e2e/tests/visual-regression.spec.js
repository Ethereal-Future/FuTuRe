/**
 * Visual Regression Tests
 * 
 * Tests for visual consistency across different pages and components
 */

import { test, expect } from '@playwright/test';

test.describe('Visual Regression Tests @visual', () => {
  test('should match homepage screenshot', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveScreenshot('homepage.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match dashboard screenshot', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    await expect(page).toHaveScreenshot('dashboard.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match account creation page screenshot', async ({ page }) => {
    await page.goto('/account/create');
    await expect(page).toHaveScreenshot('account-create.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match payment page screenshot', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    await page.goto('/payment/send');
    await expect(page).toHaveScreenshot('payment-send.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match payment confirmation dialog screenshot', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    await page.goto('/payment/send');
    
    // Fill payment form
    await page.fill('[data-testid="destination"]', 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6');
    await page.fill('[data-testid="amount"]', '10');
    await page.selectOption('[data-testid="asset"]', 'XLM');

    // Click send to show confirmation
    await page.click('[data-testid="send-payment-btn"]');

    await expect(page).toHaveScreenshot('payment-confirmation.png', {
      animations: 'disabled',
    });
  });

  test('should match error state screenshot', async ({ page }) => {
    await page.goto('/account/create');
    
    // Submit empty form to show errors
    await page.click('[data-testid="create-account-btn"]');

    await expect(page).toHaveScreenshot('validation-errors.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match loading state screenshot', async ({ page }) => {
    // Mock slow response
    await page.route('**/api/stellar/account/create', route => {
      return new Promise(resolve => {
        setTimeout(() => resolve(route.continue()), 2000);
      });
    });

    await page.goto('/account/create');
    
    // Fill form
    await page.fill('[data-testid="account-name"]', 'Test Account');
    await page.fill('[data-testid="account-email"]', 'test@example.com');
    
    // Click submit to show loading
    await page.click('[data-testid="create-account-btn"]');

    // Capture loading state
    await expect(page).toHaveScreenshot('loading-state.png', {
      animations: 'disabled',
    });
  });
});

test.describe('Component Visual Tests @visual', () => {
  test('should match button styles', async ({ page }) => {
    await page.goto('/components/buttons');
    await expect(page).toHaveScreenshot('buttons.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match form styles', async ({ page }) => {
    await page.goto('/components/forms');
    await expect(page).toHaveScreenshot('forms.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match card styles', async ({ page }) => {
    await page.goto('/components/cards');
    await expect(page).toHaveScreenshot('cards.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match modal styles', async ({ page }) => {
    await page.goto('/components/modals');
    await page.click('[data-testid="open-modal-btn"]');
    await expect(page).toHaveScreenshot('modal.png', {
      animations: 'disabled',
    });
  });
});

test.describe('Responsive Visual Tests @visual', () => {
  test('should match mobile homepage screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page).toHaveScreenshot('homepage-mobile.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match tablet homepage screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await expect(page).toHaveScreenshot('homepage-tablet.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match desktop homepage screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page).toHaveScreenshot('homepage-desktop.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match mobile payment page screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Login
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="login-btn"]');
    await page.waitForURL('/dashboard');

    await page.goto('/payment/send');
    await expect(page).toHaveScreenshot('payment-send-mobile.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });
});

test.describe('Theme Visual Tests @visual', () => {
  test('should match light theme screenshot', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="theme-toggle"]');
    await expect(page).toHaveScreenshot('homepage-light.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('should match dark theme screenshot', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="theme-toggle"]');
    await page.click('[data-testid="theme-toggle"]');
    await expect(page).toHaveScreenshot('homepage-dark.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });
});
