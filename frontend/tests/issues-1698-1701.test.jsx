/**
 * Tests for #1698 (submit lock), #1700 (issuer-aware asset search) and
 * #1701 (BigInt fee formatting). #1699 is covered in persistence.test.js.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../src/api/client.js', () => ({ default: { get: vi.fn() } }));
vi.mock('../src/utils/formatAmount', () => ({
  formatAmount: (v, c) => `${c} ${Number(v).toFixed(2)}`,
  formatAssetAmount: (v) => String(v),
}));

import apiClient from '../src/api/client.js';
import { usePaymentForm } from '../src/hooks/usePaymentForm';
import {
  AssetSelector,
  filterAssets,
  isVerifiedAsset,
  truncateIssuer,
} from '../src/components/AssetSelector.jsx';
import { FeeDisplay } from '../src/components/FeeDisplay.jsx';
import { xlmToStroops, parseStroops, formatStroopsAsXLM } from '../src/utils/stroops.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── #1698 ───────────────────────────────────────────────────────────────────
describe('usePaymentForm submit lock (#1698)', () => {
  it('rejects concurrent invocations synchronously', async () => {
    const { result } = renderHook(() => usePaymentForm());
    let resolve;
    const submit = vi.fn(() => new Promise((r) => { resolve = r; }));
    const guarded = result.current.withSubmitLock(submit);

    const first = guarded();
    const second = guarded();
    guarded();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.current.isSubmittingRef.current).toBe(true);
    resolve('ok');
    await expect(first).resolves.toBe('ok');
    await expect(second).resolves.toBeUndefined();
    expect(result.current.isSubmittingRef.current).toBe(false);
  });

  it('releases the lock after a failed submission', async () => {
    const { result } = renderHook(() => usePaymentForm());
    const submit = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    const guarded = result.current.withSubmitLock(submit);

    await expect(guarded()).rejects.toThrow('boom');
    await expect(guarded()).resolves.toBe('ok');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('double-clicking a guarded submit button fires only one request', () => {
    const request = vi.fn(() => new Promise(() => {}));
    function Form() {
      const { withSubmitLock } = usePaymentForm();
      return <button onClick={withSubmitLock(request)}>Send</button>;
    }
    render(<Form />);
    const btn = screen.getByRole('button', { name: 'Send' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

// ─── #1700 ───────────────────────────────────────────────────────────────────
const CIRCLE = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const SCAM = 'GBSCAMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const OTHER = 'GDOTHERISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ASSETS = [
  { code: 'USDC', issuer: SCAM },
  { code: 'XLM', issuer: null },
  { code: 'USDC', issuer: CIRCLE, domain: 'centre.io' },
  { code: 'EURT', issuer: OTHER, domain: 'tempo.eu.com' },
];

describe('AssetSelector (#1700)', () => {
  it('matches by asset code and ranks the verified issuer first', () => {
    const res = filterAssets(ASSETS, 'usdc');
    expect(res.map((a) => a.issuer)).toEqual([CIRCLE, SCAM]);
  });

  it('matches by full 56-character issuer public key exactly', () => {
    const res = filterAssets(ASSETS, CIRCLE);
    expect(res).toHaveLength(1);
    expect(res[0].issuer).toBe(CIRCLE);
  });

  it('matches by partial issuer key and home domain', () => {
    expect(filterAssets(ASSETS, 'GDOTHER').map((a) => a.code)).toEqual(['EURT']);
    expect(filterAssets(ASSETS, 'tempo').map((a) => a.code)).toEqual(['EURT']);
  });

  it('only verifies when both code and issuer match', () => {
    expect(isVerifiedAsset({ code: 'USDC', issuer: CIRCLE })).toBe(true);
    expect(isVerifiedAsset({ code: 'USDC', issuer: SCAM })).toBe(false);
    expect(isVerifiedAsset({ code: 'FAKE', issuer: CIRCLE })).toBe(false);
    expect(isVerifiedAsset({ code: 'XLM', issuer: null })).toBe(true);
  });

  it('truncates issuer keys for display', () => {
    expect(truncateIssuer(CIRCLE)).toBe('GA5Z…KZVN');
  });

  it('renders issuer, verified and unverified badges for identical codes', () => {
    const onChange = vi.fn();
    render(<AssetSelector assets={ASSETS} onChange={onChange} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'USDC' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('GA5Z…KZVN');
    expect(options[0].textContent).toContain('Verified');
    expect(options[1].textContent).toContain('Unverified');

    fireEvent.click(options[1]);
    expect(onChange).toHaveBeenCalledWith(`USDC:${SCAM}`, ASSETS[0]);
  });
});

// ─── #1701 ───────────────────────────────────────────────────────────────────
describe('stroop utilities (#1701)', () => {
  it('converts XLM strings to exact BigInt stroops', () => {
    expect(xlmToStroops('0.0000100')).toBe(100n);
    expect(xlmToStroops('100')).toBe(1_000_000_000n);
    expect(xlmToStroops('1.123456789')).toBe(11_234_567n);
    expect(xlmToStroops('1e+21')).toBe(10_000_000_000_000_000_000_000_000_000n);
    expect(xlmToStroops('abc')).toBeNull();
    expect(xlmToStroops(NaN)).toBeNull();
  });

  it('parses stroop integers beyond Number.MAX_SAFE_INTEGER', () => {
    expect(parseStroops('900719925474099312345')).toBe(900719925474099312345n);
    expect(parseStroops(Infinity)).toBeNull();
  });

  it('formats huge stroop values without NaN or exponent notation', () => {
    const out = formatStroopsAsXLM(900719925474099312345n, 'en-US');
    expect(out).toBe('90,071,992,547,409.9312345');
    expect(out).not.toMatch(/NaN|e\+|Infinity/);
    expect(formatStroopsAsXLM(100n, 'en-US')).toBe('0.00001');
    expect(formatStroopsAsXLM(100n, 'de-DE')).toBe('0,00001');
  });
});

describe('FeeDisplay surge fees (#1701)', () => {
  it('renders accurate totals during extreme congestion', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        feeStroops: '900719925474099312345',
        feeXLM: '9.007199254740993e+13',
        feeUsd: null,
        xlmUsd: null,
        traditionalFeeUsd: 25,
      },
    });
    const { container } = render(<FeeDisplay amount="1" visible />);
    await waitFor(() => expect(container.querySelector('.fee-box')).not.toBeNull());

    const text = container.textContent;
    expect(text).not.toMatch(/NaN|Infinity|e\+/);
    expect(text).toContain('90,071,992,547,409.9312345 XLM');
    expect(text).toContain('90,071,992,547,410.9312345 XLM');
  });

  it('shows a placeholder instead of NaN when fee data is malformed', async () => {
    apiClient.get.mockResolvedValue({
      data: { feeStroops: 'oops', feeXLM: 'NaN', feeUsd: 'NaN', xlmUsd: 'x', traditionalFeeUsd: 25 },
    });
    const { container } = render(<FeeDisplay amount="5" visible />);
    await waitFor(() => expect(container.querySelector('.fee-box')).not.toBeNull());
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.textContent).toContain('— XLM');
  });
});
