import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppState } from '../store/index.js';
import { makeVariants } from '../utils/animations';
import { useReducedMotion } from 'framer-motion';
import { MultiSigTransactions } from '../components/MultiSigTransactions';
import { KYCForm } from '../components/KYCForm';
import { NotificationPreferences } from '../components/NotificationPreferences';
import { BackupSettings } from '../components/BackupSettings';
import { AccountSettings } from '../components/AccountSettings';
import { BumpSequenceOperation } from '../components/BumpSequenceOperation';
import { Breadcrumb } from '../components/Breadcrumb';
import { getAccountSettings, updateAccountSettings } from '../api/stellar.js';

const SETTINGS_BREADCRUMB = { label: 'Home', path: '/' };

export function SettingsPage() {
  const { account } = useAppState();
  const [activeSection, setActiveSection] = useState(null);
  const [showBackup, setShowBackup] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [biometricThreshold, setBiometricThreshold] = useState('');
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdSaved, setThresholdSaved] = useState(false);

  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);

  useEffect(() => {
    if (!account?.publicKey) return;
    getAccountSettings(account.publicKey)
      .then((data) => {
        if (typeof data?.biometricReauthThreshold === 'number') {
          setBiometricThreshold(String(data.biometricReauthThreshold));
        }
      })
      .catch(() => {
        /* keep the placeholder empty; server default still applies */
      });
  }, [account?.publicKey]);

  const saveBiometricThreshold = async () => {
    const value = parseFloat(biometricThreshold);
    if (!Number.isFinite(value) || value <= 0) return;
    setThresholdSaving(true);
    setThresholdSaved(false);
    try {
      await updateAccountSettings(account.publicKey, { biometricReauthThreshold: value });
      setThresholdSaved(true);
    } finally {
      setThresholdSaving(false);
    }
  };

  if (!account) {
    return (
      <motion.section className="section" variants={v.fadeSlide}>
        <Breadcrumb items={[SETTINGS_BREADCRUMB, { label: 'Settings', path: null }]} />
        <p>No account loaded. Create or import an account to access settings.</p>
      </motion.section>
    );
  }

  const sections = [
    { id: 'multisig', label: '🔐 Multi-Sig' },
    { id: 'kyc', label: '📋 KYC' },
    { id: 'notifications', label: '🔔 Notifications' },
    { id: 'security', label: '🛡️ Security' },
    { id: 'backup', label: '💾 Backup', action: () => setShowBackup(true) },
    { id: 'account', label: '⚙️ Account', action: () => setShowAccountSettings(true) },
    { id: 'advanced', label: '⚡ Advanced' },
  ];

  const activeSectionLabel = sections.find((s) => s.id === activeSection)?.label;
  const breadcrumbTrail = [
    SETTINGS_BREADCRUMB,
    { label: 'Settings', path: activeSectionLabel ? '/settings' : null },
    ...(activeSectionLabel ? [{ label: activeSectionLabel, path: null }] : []),
  ];

  return (
    <motion.section className="section" variants={v.fadeSlide}>
      <h2>Settings</h2>
      <Breadcrumb items={breadcrumbTrail} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => {
              if (section.action) {
                section.action();
              } else {
                setActiveSection(activeSection === section.id ? null : section.id);
              }
            }}
            style={{
              padding: '10px 16px',
              background: activeSection === section.id ? '#2563eb' : '#f3f4f6',
              color: activeSection === section.id ? '#fff' : '#333',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
              transition: 'all 0.2s',
            }}
          >
            {section.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeSection === 'multisig' && (
          <motion.div key="multisig" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
            <MultiSigTransactions publicKey={account.publicKey} />
          </motion.div>
        )}
        {activeSection === 'kyc' && (
          <motion.div key="kyc" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
            <KYCForm />
          </motion.div>
        )}
        {activeSection === 'notifications' && (
          <motion.div key="notifications" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
            <NotificationPreferences />
          </motion.div>
        )}
        {activeSection === 'security' && (
          <motion.div key="security" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
            <h3>Biometric re-authentication</h3>
            <p>
              Payments above this amount require a Face ID / Touch ID / Windows Hello (or
              recovery code) confirmation before they can be sent.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label htmlFor="biometric-threshold-input">Threshold (XLM)</label>
              <input
                id="biometric-threshold-input"
                type="number"
                min="0.01"
                step="0.01"
                value={biometricThreshold}
                onChange={(e) => {
                  setBiometricThreshold(e.target.value);
                  setThresholdSaved(false);
                }}
                style={{ width: 120 }}
              />
              <button type="button" onClick={saveBiometricThreshold} disabled={thresholdSaving}>
                {thresholdSaving ? 'Saving…' : 'Save'}
              </button>
              {thresholdSaved && <span role="status">Saved</span>}
            </div>
          </motion.div>
        )}
        {activeSection === 'advanced' && (
          <motion.div key="advanced" variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit">
            <BumpSequenceOperation publicKey={account.publicKey} />
          </motion.div>
        )}
      </AnimatePresence>

      {showBackup && (
        <BackupSettings onClose={() => setShowBackup(false)} />
      )}

      {showAccountSettings && (
        <AccountSettings
          publicKey={account.publicKey}
          onClose={() => setShowAccountSettings(false)}
        />
      )}
    </motion.section>
  );
}
