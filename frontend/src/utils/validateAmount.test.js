/**
 * Tests for validateAmount (#1421)
 *
 * The reserve logic must use a single spendable cap:
 *   spendable = availableBalance - BASE_FEE - MIN_RESERVE
 * rather than a two-step check that allowed amounts that still left
 * the account underfunded once the network fee was deducted.
 */
import { describe, it, expect } from 'vitest';
import { validateAmount } from './validateAmount.ts';

const BASE_FEE = 0.00001;
const MIN_RESERVE = 1;

describe('validateAmount', () => {
  // ── basic validation ────────────────────────────────────────────────────

  it('returns null for a valid amount with no balance constraint', () => {
    expect(validateAmount('10', null)).toBeNull();
  });

  it('returns null for an empty value', () => {
    expect(validateAmount('', null)).toBeNull();
  });

  it('rejects zero', () => {
    expect(validateAmount('0', null)).toBe('Amount must be a positive number');
  });

  it('rejects negative numbers', () => {
    expect(validateAmount('-1', null)).toBe('Amount must be a positive number');
  });

  it('rejects scientific notation', () => {
    expect(validateAmount('1e5', null)).toBe('Scientific notation is not allowed');
  });

  it('rejects more than 7 decimal places', () => {
    expect(validateAmount('1.00000001', null)).toBe('Maximum 7 decimal places allowed');
  });

  it('accepts exactly 7 decimal places', () => {
    expect(validateAmount('0.0000001', null)).toBeNull();
  });

  it('rejects amounts below the minimum (1 stroop)', () => {
    expect(validateAmount('0.00000005', null)).toMatch(/Minimum amount/);
  });

  // ── #1421 reserve logic ─────────────────────────────────────────────────

  it('accepts an amount equal to spendable cap (balance - BASE_FEE - MIN_RESERVE)', () => {
    const balance = 10;
    const spendable = balance - BASE_FEE - MIN_RESERVE; // 8.99999
    expect(validateAmount(String(spendable), balance)).toBeNull();
  });

  it('rejects an amount one stroop above the spendable cap', () => {
    const balance = 10;
    const overSpendable = balance - BASE_FEE - MIN_RESERVE + 0.0000001;
    expect(validateAmount(String(overSpendable), balance)).toMatch(
      /Insufficient balance.*minimum reserve/i,
    );
  });

  it('rejects an amount equal to the full balance (ignores fee + reserve)', () => {
    // Sending the entire balance would leave 0 XLM — both fee and reserve
    // requirements would be violated.
    const balance = 5;
    expect(validateAmount(String(balance), balance)).toMatch(
      /Insufficient balance.*minimum reserve/i,
    );
  });

  it('rejects when balance minus amount minus BASE_FEE would drop below MIN_RESERVE', () => {
    // balance=1.5, send=0.5 → remaining=1.0, after fee=0.99999 < 1 MIN_RESERVE
    expect(validateAmount('0.5', 1.5)).toMatch(/Insufficient balance.*minimum reserve/i);
  });

  it('accepts when balance is exactly BASE_FEE + MIN_RESERVE + MIN amount above zero', () => {
    // Tiny send that still satisfies the reserve after fees
    const balance = MIN_RESERVE + BASE_FEE + 0.0000001;
    expect(validateAmount('0.0000001', balance)).toBeNull();
  });

  it('returns null for a valid amount well within balance', () => {
    expect(validateAmount('5', 100)).toBeNull();
  });

  it('returns null when availableBalance is null (no constraint)', () => {
    expect(validateAmount('999999', null)).toBeNull();
  });
});
