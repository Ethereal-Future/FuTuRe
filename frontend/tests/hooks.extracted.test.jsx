/**
 * Tests for the custom hooks extracted from App.jsx in #1418.
 *
 * Each hook is tested in isolation to confirm that:
 *  - State is initialized correctly
 *  - Provided callbacks update the right slice of state
 *  - Hooks are independent — updating one doesn't affect others
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ─── useUIState ───────────────────────────────────────────────────────────────
import { useUIState } from '../../src/hooks/useUIState';

describe('useUIState', () => {
  it('initialises all boolean flags to false', () => {
    const { result } = renderHook(() => useUIState());
    const s = result.current;
    expect(s.showConfirm).toBe(false);
    expect(s.showBiometricConfirm).toBe(false);
    expect(s.showScanner).toBe(false);
    expect(s.showCelebration).toBe(false);
    expect(s.showComplianceDashboard).toBe(false);
    expect(s.showBackupSettings).toBe(false);
    expect(s.showTxLookup).toBe(false);
    expect(s.showSettings).toBe(false);
    expect(s.showPaymentConfirmation).toBe(false);
    expect(s.showRecoveryCodeEntry).toBe(false);
    expect(s.activeSettingsSection).toBeNull();
  });

  it('setShowConfirm toggles showConfirm independently', () => {
    const { result } = renderHook(() => useUIState());
    act(() => result.current.setShowConfirm(true));
    expect(result.current.showConfirm).toBe(true);
    // Other flags must remain false
    expect(result.current.showSettings).toBe(false);
  });

  it('openSettings sets both showSettings=true and activeSettingsSection', () => {
    const { result } = renderHook(() => useUIState());
    act(() => result.current.openSettings('kyc'));
    expect(result.current.showSettings).toBe(true);
    expect(result.current.activeSettingsSection).toBe('kyc');
  });

  it('openSettings with no argument sets section to null', () => {
    const { result } = renderHook(() => useUIState());
    act(() => result.current.openSettings());
    expect(result.current.showSettings).toBe(true);
    expect(result.current.activeSettingsSection).toBeNull();
  });

  it('closeSettings resets showSettings and activeSettingsSection', () => {
    const { result } = renderHook(() => useUIState());
    act(() => result.current.openSettings('multisig'));
    act(() => result.current.closeSettings());
    expect(result.current.showSettings).toBe(false);
    expect(result.current.activeSettingsSection).toBeNull();
  });
});

// ─── usePaymentForm ───────────────────────────────────────────────────────────
import { usePaymentForm } from '../../src/hooks/usePaymentForm';

describe('usePaymentForm', () => {
  it('initialises with empty / false state', () => {
    const { result } = renderHook(() => usePaymentForm());
    const s = result.current;
    expect(s.confirmClear).toBe(false);
    expect(s.trustlineAsset).toBeNull();
    expect(s.trustlineLoading).toBe(false);
    expect(s.batchMode).toBe(false);
    expect(s.batchRecipients).toEqual([]);
    expect(s.replaySecret).toBe('');
    expect(s.showReplayPrompt).toBe(false);
    expect(s.deepLinkHash).toBe('');
    expect(s.recoveryCode).toBe('');
  });

  it('showClearConfirm / hideClearConfirm toggle confirmClear', () => {
    const { result } = renderHook(() => usePaymentForm());
    act(() => result.current.showClearConfirm());
    expect(result.current.confirmClear).toBe(true);
    act(() => result.current.hideClearConfirm());
    expect(result.current.confirmClear).toBe(false);
  });

  it('addBatchRecipient appends to batchRecipients', () => {
    const { result } = renderHook(() => usePaymentForm());
    const r1 = { destination: 'GA1', amount: '10', assetCode: 'XLM' };
    const r2 = { destination: 'GB2', amount: '20', assetCode: 'XLM' };
    act(() => result.current.addBatchRecipient(r1));
    act(() => result.current.addBatchRecipient(r2));
    expect(result.current.batchRecipients).toHaveLength(2);
    expect(result.current.batchRecipients[0]).toEqual(r1);
  });

  it('removeBatchRecipient removes by index', () => {
    const { result } = renderHook(() => usePaymentForm());
    act(() => result.current.addBatchRecipient({ destination: 'GA1', amount: '10', assetCode: 'XLM' }));
    act(() => result.current.addBatchRecipient({ destination: 'GB2', amount: '20', assetCode: 'XLM' }));
    act(() => result.current.removeBatchRecipient(0));
    expect(result.current.batchRecipients).toHaveLength(1);
    expect(result.current.batchRecipients[0].destination).toBe('GB2');
  });

  it('setTrustlineAsset + setTrustlineLoading are independent', () => {
    const { result } = renderHook(() => usePaymentForm());
    act(() => result.current.setTrustlineAsset('USDC'));
    act(() => result.current.setTrustlineLoading(true));
    expect(result.current.trustlineAsset).toBe('USDC');
    expect(result.current.trustlineLoading).toBe(true);
    // Clearing asset doesn't affect loading flag
    act(() => result.current.setTrustlineAsset(null));
    expect(result.current.trustlineLoading).toBe(true);
  });
});

// ─── useKycState ─────────────────────────────────────────────────────────────
// Mock the compliance API to avoid network calls.
vi.mock('../../src/api/compliance.js', () => ({
  getKycStatus: vi.fn(),
}));

import { useKycState } from '../../src/hooks/useKycState';
import { getKycStatus } from '../../src/api/compliance.js';

describe('useKycState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('initialises with null status and no loading', () => {
    getKycStatus.mockResolvedValue(null);
    const { result } = renderHook(() => useKycState({ publicKey: null }));
    expect(result.current.kycStatus).toBeNull();
    expect(result.current.kycLoading).toBe(false);
    expect(result.current.kycError).toBeNull();
  });

  it('fetches and sets kycStatus on mount when publicKey is provided', async () => {
    getKycStatus.mockResolvedValue('APPROVED');
    const { result } = renderHook(() => useKycState({ publicKey: 'GABC' }));

    // Wait for the async fetchKycStatus to complete
    await act(async () => {});

    expect(result.current.kycStatus).toBe('APPROVED');
    expect(result.current.kycLoading).toBe(false);
    expect(result.current.kycError).toBeNull();
  });

  it('sets kycError when API throws a non-404 error', async () => {
    getKycStatus.mockRejectedValue({ response: { status: 500, data: { error: 'Server error' } } });
    const { result } = renderHook(() => useKycState({ publicKey: 'GABC' }));
    await act(async () => {});
    expect(result.current.kycError).toBe('Server error');
    expect(result.current.kycStatus).toBeNull();
  });

  it('sets kycStatus to null (no error) when API returns 404', async () => {
    getKycStatus.mockRejectedValue({ response: { status: 404 } });
    const { result } = renderHook(() => useKycState({ publicKey: 'GABC' }));
    await act(async () => {});
    expect(result.current.kycStatus).toBeNull();
    expect(result.current.kycError).toBeNull();
  });
});

// ─── useAccountSettings ───────────────────────────────────────────────────────
vi.mock('../../src/api/client.js', () => ({
  default: {
    get: vi.fn(),
  },
}));

import { useAccountSettings } from '../../src/hooks/useAccountSettings';
import apiClient from '../../src/api/client.js';

describe('useAccountSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns USD / 100 defaults when no publicKey', () => {
    const { result } = renderHook(() => useAccountSettings({ publicKey: null }));
    expect(result.current.fiatCurrency).toBe('USD');
    expect(result.current.biometricThreshold).toBe(100);
    expect(result.current.userRole).toBeNull();
  });

  it('updates fiatCurrency from account settings', async () => {
    apiClient.get.mockResolvedValue({ data: { defaultAsset: 'EUR', biometricReauthThreshold: 50 } });
    const { result } = renderHook(() => useAccountSettings({ publicKey: 'GABC' }));
    await act(async () => {});
    expect(result.current.fiatCurrency).toBe('EUR');
    expect(result.current.biometricThreshold).toBe(50);
  });

  it('maps EURC defaultAsset to EUR fiatCurrency', async () => {
    apiClient.get.mockResolvedValue({ data: { defaultAsset: 'EURC' } });
    const { result } = renderHook(() => useAccountSettings({ publicKey: 'GABC' }));
    await act(async () => {});
    expect(result.current.fiatCurrency).toBe('EUR');
  });

  it('keeps USD when defaultAsset is a Stellar native asset (XLM)', async () => {
    apiClient.get.mockResolvedValue({ data: { defaultAsset: 'XLM' } });
    const { result } = renderHook(() => useAccountSettings({ publicKey: 'GABC' }));
    await act(async () => {});
    expect(result.current.fiatCurrency).toBe('USD');
  });
});
