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
 * Regression tests for #1698, #1699, #1700, #1701.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ─── #1698 usePaymentForm submit lock ────────────────────────────────────────
import { usePaymentForm } from '../src/hooks/usePaymentForm';

describe('#1698 usePaymentForm.guardSubmit', () => {
  it('runs only one submission when invoked twice synchronously (double-click)', async () => {
    const { result } = renderHook(() => usePaymentForm());
    let resolve;
    const request = vi.fn(() => new Promise((r) => { resolve = r; }));

    let p1, p2;
    act(() => {
      p1 = result.current.guardSubmit(request);
      p2 = result.current.guardSubmit(request);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.isSubmittingRef.current).toBe(true);

    resolve('ok');
    await expect(p1).resolves.toBe('ok');
    await expect(p2).resolves.toBeUndefined();
    expect(result.current.isSubmittingRef.current).toBe(false);
  });

  it('releases the lock after a failed submission so retry works', async () => {
    const { result } = renderHook(() => usePaymentForm());
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(result.current.guardSubmit(failing)).rejects.toThrow('boom');
    const ok = vi.fn().mockResolvedValue('second');
    await expect(result.current.guardSubmit(ok)).resolves.toBe('second');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('a rapidly double-clicked button fires one network request', async () => {
    const network = vi.fn(() => new Promise((r) => setTimeout(r, 20)));
    function SubmitButton() {
      const { guardSubmit } = usePaymentForm();
      return <button onClick={() => guardSubmit(network)}>Send</button>;
    }
    render(<SubmitButton />);
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
    expect(network).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

// ─── #1699 persistence slice isolation ───────────────────────────────────────
import { loadState, saveState, sliceKey } from '../src/store/persistence.js';
import { initialState } from '../src/store/reducer.js';

describe('#1699 persistence', () => {
  beforeEach(() => localStorage.clear());

  it('a corrupted slice does not purge unrelated stored data', () => {
    saveState({ ...initialState, account: { publicKey: 'GPK', secretKey: 'S' }, accountLabel: 'Main' });
    localStorage.setItem(sliceKey('accountLabel'), '{not json');

    const loaded = loadState();
    expect(loaded.account).toEqual({ publicKey: 'GPK' });
    expect(loaded.accountLabel).toBe(initialState.accountLabel);
    // Only the malformed key was reset; the intact one is preserved.
    expect(localStorage.getItem(sliceKey('accountLabel'))).toBeNull();
    expect(localStorage.getItem(sliceKey('account'))).toBe(JSON.stringify({ publicKey: 'GPK' }));
  });

  it('applies a fallback only to the malformed account slice', () => {
    saveState({ ...initialState, account: { publicKey: 'GPK' }, accountLabel: 'Keep me' });
    localStorage.setItem(sliceKey('account'), '}}}');
    const loaded = loadState();
    expect(loaded.account).toBeNull();
    expect(loaded.accountLabel).toBe('Keep me');
  });

  it('never persists secretKey', () => {
    saveState({ ...initialState, account: { publicKey: 'GPK', secretKey: 'SSECRET' } });
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i))).not.toContain('SSECRET');
    }
  });
});

// ─── #1700 AssetSelector ─────────────────────────────────────────────────────
import { AssetSelector, filterAssets, truncateIssuer } from '../src/components/AssetSelector.jsx';

const CIRCLE = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const SCAM = 'GBSCAMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'.slice(0, 56);
const ASSETS = [
  { code: 'XLM' },
  { code: 'USDC', issuer: SCAM },
  { code: 'USDC', issuer: CIRCLE, domain: 'centre.io' },
];

describe('#1700 AssetSelector', () => {
  it('matches by asset code and by full issuer public key', () => {
    expect(filterAssets(ASSETS, 'usdc', [CIRCLE]).map((r) => r.asset.issuer)).toEqual([CIRCLE, SCAM]);
    const byIssuer = filterAssets(ASSETS, CIRCLE, [CIRCLE]);
    expect(byIssuer).toHaveLength(1);
    expect(byIssuer[0].asset.issuer).toBe(CIRCLE);
    expect(filterAssets(ASSETS, CIRCLE.toLowerCase())).toHaveLength(1);
  });

  it('matches by issuer fragment and home domain', () => {
    expect(filterAssets(ASSETS, 'GA5ZSE')[0].asset.issuer).toBe(CIRCLE);
    expect(filterAssets(ASSETS, 'centre')[0].asset.issuer).toBe(CIRCLE);
  });

  it('truncates issuer keys', () => {
    expect(truncateIssuer(CIRCLE)).toBe('GA5Z…KZVN');
  });

  it('renders verified badge, truncated issuer and ambiguity warning', () => {
    const onSelect = vi.fn();
    render(<AssetSelector assets={ASSETS} verifiedIssuers={[CIRCLE]} onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText('Search assets'), { target: { value: 'USDC' } });

    const verified = screen.getByTestId(`asset-option-USDC:${CIRCLE}`);
    const scam = screen.getByTestId(`asset-option-USDC:${SCAM}`);
    expect(verified).toHaveTextContent('Verified');
    expect(verified).toHaveTextContent('GA5Z…KZVN');
    expect(scam).toHaveTextContent('Unverified');
    expect(scam).toHaveTextContent(/check the issuer/);

    fireEvent.click(verified.querySelector('button'));
    expect(onSelect).toHaveBeenCalledWith(ASSETS[2]);
    cleanup();
  });
});

// ─── #1701 FeeDisplay BigInt ─────────────────────────────────────────────────
import { toStroops, xlmToStroops, formatStroopsAsXlm } from '../src/utils/stroops.js';

// Avoid loading every locale bundle; formatting only needs a language tag.
vi.mock('../src/i18n/index.js', () => ({ default: { language: 'en-US' } }));
vi.mock('../src/api/client.js', () => ({ default: { get: vi.fn() } }));
import apiClient from '../src/api/client.js';
import { FeeDisplay } from '../src/components/FeeDisplay.jsx';

describe('#1701 stroop BigInt math', () => {
  it('formats values beyond MAX_SAFE_INTEGER exactly', () => {
    const huge = '123456789012345678901'; // > 2^53
    expect(toStroops(huge)).toBe(123456789012345678901n);
    expect(formatStroopsAsXlm(huge, { locale: 'en-US' })).toBe('12,345,678,901,234.5678901');
  });

  it('formats small fees', () => {
    expect(formatStroopsAsXlm(100, { locale: 'en-US' })).toBe('0.00001');
    expect(formatStroopsAsXlm(10_000_000n, { locale: 'en-US' })).toBe('1');
  });

  it('parses XLM decimal strings without float error', () => {
    expect(xlmToStroops('0.1')).toBe(1_000_000n);
    expect(xlmToStroops('12.34567891')).toBe(123_456_789n);
    expect(xlmToStroops('abc')).toBeNull();
  });

  it('rejects unsafe / invalid inputs instead of producing NaN', () => {
    expect(toStroops(Number.MAX_SAFE_INTEGER + 10)).toBeNull();
    expect(toStroops(NaN)).toBeNull();
    expect(toStroops('-5')).toBeNull();
    expect(formatStroopsAsXlm(null)).toBe('—');
  });
});

describe('#1701 FeeDisplay', () => {
  it('renders a surge fee with no NaN text', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        feeStroops: 1e21,
        feeStroopsExact: '1000000000000000000000',
        feeXLM: '1e+14',
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
    const { container } = render(<FeeDisplay amount="1" visible assetCode="XLM" />);
    await waitFor(() => expect(container.querySelector('.fee-box')).not.toBeNull());
    expect(container.textContent).not.toMatch(/NaN|Infinity|e\+/);
    expect(container.textContent).toMatch(/100,000,000,000,000 XLM/);
    expect(container.textContent).toMatch(/100,000,000,000,001 XLM/);
    cleanup();
  });
});
