/**
 * Tests for AmountInput (#1422)
 *
 * The MAX button must set the value to:
 *   availableBalance - BASE_FEE - MIN_RESERVE
 * instead of the raw balance, so the resulting payment doesn't leave the
 * account underfunded after the network fee is deducted.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AmountInput } from './AmountInput.jsx';

afterEach(() => cleanup());

// react-i18next is not installed in the test environment — provide a minimal stub.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts?.amount != null ? `Max: ${opts.amount}` : key),
    i18n: { language: 'en' },
  }),
}));

// Stub formatAmount utils to keep tests focused on MAX logic.
vi.mock('../utils/formatAmount', () => ({
  formatAssetAmount: (v) => v,
  normalizeAmountInput: (v) => v,
}));

const BASE_FEE = 0.00001;
const MIN_RESERVE = 1;

describe('AmountInput MAX button', () => {
  it('does not render the MAX button when availableBalance is not provided', () => {
    render(<AmountInput value="" onChange={() => {}} />);
    expect(screen.queryByText('MAX')).toBeNull();
  });

  it('renders the MAX button when availableBalance is provided', () => {
    render(<AmountInput value="" onChange={() => {}} availableBalance={10} />);
    expect(screen.getByRole('button', { name: /max/i })).toBeInTheDocument();
  });

  it('sets value to balance - BASE_FEE - MIN_RESERVE when MAX is clicked (#1422)', () => {
    const onChange = vi.fn();
    const balance = 10;
    const expectedMax = balance - BASE_FEE - MIN_RESERVE; // 8.99999

    render(<AmountInput value="" onChange={onChange} availableBalance={balance} />);
    fireEvent.click(screen.getByRole('button', { name: /max/i }));

    expect(onChange).toHaveBeenCalledWith(String(expectedMax));
  });

  it('does not produce a negative MAX value for very low balances', () => {
    const onChange = vi.fn();
    // balance = 0.5, which is less than BASE_FEE + MIN_RESERVE
    render(<AmountInput value="" onChange={onChange} availableBalance={0.5} />);
    fireEvent.click(screen.getByRole('button', { name: /max/i }));

    const called = onChange.mock.calls[0][0];
    expect(parseFloat(called)).toBeGreaterThanOrEqual(0);
  });

  it('calls onChange with "0" when balance exactly equals BASE_FEE + MIN_RESERVE', () => {
    const onChange = vi.fn();
    const balance = BASE_FEE + MIN_RESERVE; // 1.00001
    render(<AmountInput value="" onChange={onChange} availableBalance={balance} />);
    fireEvent.click(screen.getByRole('button', { name: /max/i }));

    const val = parseFloat(onChange.mock.calls[0][0]);
    // Floating-point: should be effectively 0
    expect(val).toBeCloseTo(0, 5);
  });
});
