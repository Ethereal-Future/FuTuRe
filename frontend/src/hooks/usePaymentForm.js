/**
 * usePaymentForm — manages the form-level state for single and batch payments:
 * confirmClear, trustline prompts, batch mode, and the offline replay prompt.
 *
 * Fixes #1418: removes confirmClear, trustlineAsset, trustlineLoading,
 * batchMode, batchRecipients, replaySecret, showReplayPrompt from App.jsx
 * so that each domain only triggers re-renders in its own consumers.
 */
import { useState, useCallback } from 'react';

/**
 * @returns {{
 *   confirmClear: boolean,
 *   showClearConfirm: () => void,
 *   hideClearConfirm: () => void,
 *   trustlineAsset: string|null,
 *   setTrustlineAsset: Function,
 *   trustlineLoading: boolean,
 *   setTrustlineLoading: Function,
 *   batchMode: boolean,
 *   setBatchMode: Function,
 *   batchRecipients: Array,
 *   setBatchRecipients: Function,
 *   addBatchRecipient: (recipient: object) => void,
 *   removeBatchRecipient: (index: number) => void,
 *   replaySecret: string,
 *   setReplaySecret: Function,
 *   showReplayPrompt: boolean,
 *   setShowReplayPrompt: Function,
 *   deepLinkHash: string,
 *   setDeepLinkHash: Function,
 *   recoveryCode: string,
 *   setRecoveryCode: Function,
 * }}
 */
export function usePaymentForm() {
  const [confirmClear, setConfirmClear] = useState(false);
  const [trustlineAsset, setTrustlineAsset] = useState(null);
  const [trustlineLoading, setTrustlineLoading] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchRecipients, setBatchRecipients] = useState([]);
  const [replaySecret, setReplaySecret] = useState('');
  const [showReplayPrompt, setShowReplayPrompt] = useState(false);
  const [deepLinkHash, setDeepLinkHash] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');

  const showClearConfirm = useCallback(() => setConfirmClear(true), []);
  const hideClearConfirm = useCallback(() => setConfirmClear(false), []);

  const addBatchRecipient = useCallback((recipient) => {
    setBatchRecipients((prev) => [...prev, recipient]);
  }, []);

  const removeBatchRecipient = useCallback((index) => {
    setBatchRecipients((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return {
    confirmClear,
    showClearConfirm,
    hideClearConfirm,
    trustlineAsset,
    setTrustlineAsset,
    trustlineLoading,
    setTrustlineLoading,
    batchMode,
    setBatchMode,
    batchRecipients,
    setBatchRecipients,
    addBatchRecipient,
    removeBatchRecipient,
    replaySecret,
    setReplaySecret,
    showReplayPrompt,
    setShowReplayPrompt,
    deepLinkHash,
    setDeepLinkHash,
    recoveryCode,
    setRecoveryCode,
  };
}
