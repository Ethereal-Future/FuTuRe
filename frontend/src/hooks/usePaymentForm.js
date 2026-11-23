/**
 * usePaymentForm — manages the form-level state for single and batch payments:
 * confirmClear, trustline prompts, batch mode, and the offline replay prompt.
 *
 * Fixes #1418: removes confirmClear, trustlineAsset, trustlineLoading,
 * batchMode, batchRecipients, replaySecret, showReplayPrompt from App.jsx
 * so that each domain only triggers re-renders in its own consumers.
 */
import { useState, useCallback, useRef } from 'react';

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
 *   isSubmittingRef: { current: boolean },
 *   guardSubmit: <T>(fn: () => Promise<T>|T) => Promise<T|undefined>,
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

  // Fixes #1698: synchronous lock so a rapid double-click cannot start two
  // signing/submission requests before React re-renders the disabled button.
  const isSubmittingRef = useRef(false);

  /**
   * Run `fn` only if no other submission is in flight. A second call made
   * while the first is pending is rejected synchronously and resolves to
   * `undefined` without invoking `fn`.
   */
  const guardSubmit = useCallback(async (fn) => {
    if (isSubmittingRef.current) return undefined;
    isSubmittingRef.current = true;
    try {
      return await fn();
    } finally {
      isSubmittingRef.current = false;
    }
  }, []);

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
    isSubmittingRef,
    guardSubmit,
  };
}
