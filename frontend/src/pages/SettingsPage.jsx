import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppState } from '../store/index.js';
import { makeVariants } from '../utils/animations';
import { useReducedMotion } from 'framer-motion';
import { MultiSigTransactions } from '../components/MultiSigTransactions';
import { KYCForm } from '../components/KYCForm';
import { NotificationPreferences } from '../components/NotificationPreferences';
import { BackupSettings } from '../components/BackupSettings';
import { AccountSettings } from '../components/AccountSettings';

export function SettingsPage() {
  const { account } = useAppState();
  const [activeSection, setActiveSection] = useState(null);
  const [showBackup, setShowBackup] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);

  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);

  if (!account) {
    return (
      <motion.section className="section" variants={v.fadeSlide}>
        <p>No account loaded. Create or import an account to access settings.</p>
      </motion.section>
    );
  }

  const sections = [
    { id: 'multisig', label: '🔐 Multi-Sig' },
    { id: 'kyc', label: '📋 KYC' },
    { id: 'notifications', label: '🔔 Notifications' },
    { id: 'backup', label: '💾 Backup', action: () => setShowBackup(true) },
    { id: 'account', label: '⚙️ Account', action: () => setShowAccountSettings(true) },
  ];

  return (
    <motion.section className="section" variants={v.fadeSlide}>
      <h2>Settings</h2>

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
