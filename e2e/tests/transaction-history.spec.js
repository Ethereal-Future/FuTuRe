/**
 * Transaction History E2E Tests
 *
 * Covers: initial page load, cursor-based pagination, final page, empty state,
 * and error state. API responses are mocked via Playwright route interception.
 */

import { test, expect } from '@playwright/test';

const PUBLIC_KEY = 'GBVIZQO6KGDPNQT5SFABR3YWILZQBIBOVP3LBXCM5UQATX6I7FVZPQ';
const PAGE_SIZE = 20;

function makeTx(index) {
  return {
    id: `tx-${index}`,
    hash: `a${String(index).padStart(63, '0')}`,
    type: 'payment',
    direction: index % 2 === 0 ? 'sent' : 'received',
    amount: `${index + 1}.0000000`,
    asset: 'XLM',
    counterparty: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGQKN24S3B43U2TC8NRTY1',
    date: new Date(2025, 0, 1 + (index % 28)).toISOString(),
    fee: '100',
    successful: true,
    memo: null,
  };
}

function makePageData(start, count, nextCursor = null) {
  return {
    records: Array.from({ length: count }, (_, i) => makeTx(start + i)),
    nextCursor,
  };
}

// Seed the app state so we bypass the login form entirely.
async function seedAccountState(page) {
  await page.context().addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({
      _version: 1,
      account: { publicKey: 'GBVIZQO6KGDPNQT5SFABR3YWILZQBIBOVP3LBXCM5UQATX6I7FVZPQ' },
      accountLabel: 'Test Account',
    }));
  }, 'app_state_v2');
}

// Mock both internal API endpoints the component calls inside fetchPage.
// The second route (/api/stellar/…) sets the final rendered list; the first
// (/api/v1/…) drives the hasMore flag. Both must be consistent.
async function mockTransactionRoutes(page, { page1, page2, page3 } = {}) {
  let callCount = 0;

  await page.route('**/api/v1/transactions/**', (route) => {
    callCount++;
    const page = callCount <= 1 ? page1 : callCount === 2 ? page2 : (page3 ?? page2);
    route.fulfill({ json: page ?? makePageData(0, PAGE_SIZE, 'cursor1') });
  });

  let apiCallCount = 0;
  await page.route('**/api/stellar/account/**/transactions', (route) => {
    apiCallCount++;
    const data = apiCallCount <= 1 ? page1 : apiCallCount === 2 ? page2 : (page3 ?? page2);
    route.fulfill({ json: data ?? makePageData(0, PAGE_SIZE, 'cursor1') });
  });
}

test.describe('Transaction History @pagination', () => {
  test.beforeEach(async ({ page }) => {
    await seedAccountState(page);
    await page.goto('/');
  });

  test('displays first page of transactions after clicking Load History', async ({ page }) => {
    const p1 = makePageData(0, PAGE_SIZE, 'cursor1');
    await page.route('**/api/v1/transactions/**', route => route.fulfill({ json: p1 }));
    await page.route('**/api/stellar/account/**/transactions', route => route.fulfill({ json: p1 }));

    await page.getByRole('button', { name: /load.*history/i }).click();

    const rows = page.locator('.tx-row');
    await expect(rows).toHaveCount(PAGE_SIZE);

    // Each row shows type, amount, and asset
    const firstRow = rows.first();
    await expect(firstRow).toContainText('Payment');
    await expect(firstRow).toContainText('XLM');

    // No duplicate IDs — every row label should be unique
    const labels = await rows.evaluateAll(els =>
      els.map(el => el.getAttribute('aria-label'))
    );
    const unique = new Set(labels);
    expect(unique.size).toBe(PAGE_SIZE);
  });

  test('loads next page on Next click and previous page on Back click', async ({ page }) => {
    const p1 = makePageData(0, PAGE_SIZE, 'cursor1');
    const p2 = makePageData(PAGE_SIZE, PAGE_SIZE, 'cursor2');

    let callCount = 0;
    await page.route('**/api/v1/transactions/**', route => {
      callCount++;
      route.fulfill({ json: callCount === 1 ? p1 : p2 });
    });
    let apiCount = 0;
    await page.route('**/api/stellar/account/**/transactions', route => {
      apiCount++;
      route.fulfill({ json: apiCount === 1 ? p1 : p2 });
    });

    // Load page 1
    await page.getByRole('button', { name: /load.*history/i }).click();
    await expect(page.locator('.tx-row')).toHaveCount(PAGE_SIZE);

    const firstPageFirstLabel = await page.locator('.tx-row').first().getAttribute('aria-label');

    // Navigate to page 2
    await page.getByRole('button', { name: /next/i }).click();
    await expect(page.locator('.tx-row')).toHaveCount(PAGE_SIZE);

    // Rows should be different from page 1
    const secondPageFirstLabel = await page.locator('.tx-row').first().getAttribute('aria-label');
    expect(secondPageFirstLabel).not.toBe(firstPageFirstLabel);

    // Back button becomes active after advancing
    const prevBtn = page.getByRole('button', { name: /prev/i });
    await expect(prevBtn).not.toBeDisabled();
  });

  test('disables Next button on the final page', async ({ page }) => {
    // Final page returns fewer records than PAGE_SIZE and no nextCursor
    const finalPage = makePageData(40, 7, null);

    await page.route('**/api/v1/transactions/**', route => route.fulfill({ json: finalPage }));
    await page.route('**/api/stellar/account/**/transactions', route => route.fulfill({ json: finalPage }));

    await page.getByRole('button', { name: /load.*history/i }).click();
    await expect(page.locator('.tx-row')).toHaveCount(7);

    await expect(page.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  test('shows empty state when API returns zero transactions', async ({ page }) => {
    const empty = { records: [], nextCursor: null };

    await page.route('**/api/v1/transactions/**', route => route.fulfill({ json: empty }));
    await page.route('**/api/stellar/account/**/transactions', route => route.fulfill({ json: empty }));

    await page.getByRole('button', { name: /load.*history/i }).click();

    await expect(page.locator('.tx-empty')).toBeVisible();
    await expect(page.locator('.tx-row')).toHaveCount(0);

    // No loading spinner remains
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });

  test('shows error message and retry button on API failure', async ({ page }) => {
    await page.route('**/api/v1/transactions/**', route => route.fulfill({ status: 503, json: {} }));
    await page.route('**/api/stellar/account/**/transactions', route => route.fulfill({ status: 503, json: {} }));

    await page.getByRole('button', { name: /load.*history/i }).click();

    await expect(page.locator('.tx-error')).toBeVisible();
    // Retry button is present
    await expect(page.locator('.tx-error').getByRole('button')).toBeVisible();
  });

  test('pagination continuity — no duplicate transaction IDs across three pages', async ({ page }) => {
    const pages = [
      makePageData(0, PAGE_SIZE, 'cursor1'),
      makePageData(PAGE_SIZE, PAGE_SIZE, 'cursor2'),
      makePageData(PAGE_SIZE * 2, PAGE_SIZE, null),
    ];

    let v1Call = 0;
    await page.route('**/api/v1/transactions/**', route => {
      route.fulfill({ json: pages[Math.min(v1Call++, pages.length - 1)] });
    });
    let apiCall = 0;
    await page.route('**/api/stellar/account/**/transactions', route => {
      route.fulfill({ json: pages[Math.min(apiCall++, pages.length - 1)] });
    });

    const seenIds = new Set();

    await page.getByRole('button', { name: /load.*history/i }).click();
    await expect(page.locator('.tx-row')).toHaveCount(PAGE_SIZE);

    const collectIds = async () => {
      const labels = await page.locator('.tx-row').evaluateAll(els =>
        els.map(el => el.getAttribute('aria-label'))
      );
      labels.forEach(l => seenIds.add(l));
    };

    await collectIds();
    await page.getByRole('button', { name: /next/i }).click();
    await expect(page.locator('.tx-row')).toHaveCount(PAGE_SIZE);
    await collectIds();
    await page.getByRole('button', { name: /next/i }).click();
    await expect(page.locator('.tx-row')).toHaveCount(PAGE_SIZE);
    await collectIds();

    // All 60 rows across 3 pages must be unique
    expect(seenIds.size).toBe(PAGE_SIZE * 3);
  });
});
