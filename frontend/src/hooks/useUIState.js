/**
 * useUIState — consolidates every UI-overlay / modal boolean that previously
 * lived as independent useState calls scattered across App.jsx.
 *
 * Fixes #1418: extracts unrelated state into a focused custom hook so that
 * toggling a single overlay (e.g. showScanner) never causes the entire
 * App component tree to re-evaluate.
 *
 * Consumers that only read, say, `showSettings` can memoize their subtree
 * against that single value rather than being tied to the monolithic App
 * component's render cycle.
 */
import { useState, useCallback } from 'react';

/**
 * @returns {{
 *   showConfirm: boolean,         setShowConfirm: Function,
 *   showBiometricConfirm: boolean, setShowBiometricConfirm: Function,
 *   showScanner: boolean,          setShowScanner: Function,
 *   showCelebration: boolean,      setShowCelebration: Function,
 *   showComplianceDashboard: boolean, setShowComplianceDashboard: Function,
 *   showBackupSettings: boolean,   setShowBackupSettings: Function,
 *   showTxLookup: boolean,         setShowTxLookup: Function,
 *   showSettings: boolean,         setShowSettings: Function,
 *   showPaymentConfirmation: boolean, setShowPaymentConfirmation: Function,
 *   showRecoveryCodeEntry: boolean, setShowRecoveryCodeEntry: Function,
 *   activeSettingsSection: string|null, setActiveSettingsSection: Function,
 *   openSettings: (section?: string|null) => void,
 *   closeSettings: () => void,
 * }}
 */
export function useUIState() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showBiometricConfirm, setShowBiometricConfirm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [showComplianceDashboard, setShowComplianceDashboard] = useState(false);
  const [showBackupSettings, setShowBackupSettings] = useState(false);
  const [showTxLookup, setShowTxLookup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);
  const [showRecoveryCodeEntry, setShowRecoveryCodeEntry] = useState(false);
  // null | 'multisig' | 'kyc' | 'notifications'
  const [activeSettingsSection, setActiveSettingsSection] = useState(null);

  const openSettings = useCallback((section = null) => {
    setActiveSettingsSection(section);
    setShowSettings(true);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    setActiveSettingsSection(null);
  }, []);

  return {
    showConfirm, setShowConfirm,
    showBiometricConfirm, setShowBiometricConfirm,
    showScanner, setShowScanner,
    showCelebration, setShowCelebration,
    showComplianceDashboard, setShowComplianceDashboard,
    showBackupSettings, setShowBackupSettings,
    showTxLookup, setShowTxLookup,
    showSettings, setShowSettings,
    showPaymentConfirmation, setShowPaymentConfirmation,
    showRecoveryCodeEntry, setShowRecoveryCodeEntry,
    activeSettingsSection, setActiveSettingsSection,
    openSettings,
    closeSettings,
  };
}
