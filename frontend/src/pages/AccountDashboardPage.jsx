import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { getFriendlyError } from '../utils/errorMessages';
import { formatBalanceWithAsset } from '../utils/formatBalance';
import { useAppState, useAppDispatch, A } from '../store/index.js';
import { useMessages } from '../hooks/useMessages';
import { makeVariants } from '../utils/animations';
import { useReducedMotion } from 'framer-motion';
import { CopyButton } from '../components/CopyButton';
import { QRCodeModal } from '../components/QRCodeModal';
import { FeeDisplay } from '../components/FeeDisplay';
import { logError } from '../utils/errorLogger';

const TIMEOUT_MS = 30000;

function withTimeout(promiseFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return promiseFn(controller.signal).finally(() => clearTimeout(timer));
}

export function AccountDashboardPage() {
  const { account, balance, loading, accountLabel } = useAppState();
  const dispatch = useAppDispatch();
  const msg = useMessages();

  const [showQR, setShowQR] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(accountLabel || '');

  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);

  useEffect(() => {
    setLabelDraft(accountLabel || '');
  }, [accountLabel]);

  const checkBalance = useCallback(async () => {
    if (!account) return;
    dispatch({ type: A.SET_LOADING, payload: 'balance' });
    try {
      const { data } = await withTimeout(signal =>
        axios.get(`/api/stellar/account/${account.publicKey}`, { signal })
      );
      dispatch({ type: A.SET_BALANCE, payload: data });
    } catch (error) {
      logError(error, { context: 'checkBalance' });
      msg.error(getFriendlyError(error), { retry: checkBalance });
    } finally {
      dispatch({ type: A.SET_LOADING, payload: '' });
    }
  }, [account, dispatch, msg]);

  const saveLabel = async () => {
    if (!account) return;
    try {
      await axios.put(`/api/stellar/account/${account.publicKey}/label`, { accountLabel: labelDraft });
      dispatch({ type: A.SET_LABEL, payload: labelDraft });
      setEditingLabel(false);
    } catch (error) {
      msg.error('Failed to save label');
    }
  };

  if (!account) {
    return (
      <motion.section className="section" variants={v.fadeSlide}>
        <p>No account loaded. Create or import an account to get started.</p>
      </motion.section>
    );
  }

  return (
    <motion.section className="section" variants={v.fadeSlide}>
      <h2>Account Dashboard</h2>

      <div style={{ marginBottom: 20, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Account</h3>
          <button
            type="button"
            onClick={() => setShowQR(true)}
            style={{ padding: '6px 12px', background: '#0066cc', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >
            📱 Show QR
          </button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Public Key</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, padding: 8, background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, wordBreak: 'break-all' }}>
              {account.publicKey}
            </code>
            <CopyButton text={account.publicKey} />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Label</label>
          {editingLabel ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
              />
              <button
                type="button"
                onClick={saveLabel}
                style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingLabel(false)}
                style={{ padding: '8px 16px', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ flex: 1, padding: '8px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4 }}>
                {accountLabel || '(no label)'}
              </span>
              <button
                type="button"
                onClick={() => setEditingLabel(true)}
                style={{ padding: '8px 16px', background: '#0066cc', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Edit
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 20, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Balance</h3>
          <button
            type="button"
            onClick={checkBalance}
            disabled={loading === 'balance'}
            style={{
              padding: '6px 12px',
              background: loading === 'balance' ? '#d1d5db' : '#0066cc',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: loading === 'balance' ? 'not-allowed' : 'pointer',
              fontSize: 12,
            }}
          >
            {loading === 'balance' ? 'Refreshing…' : '🔄 Refresh'}
          </button>
        </div>

        {balance?.balances && balance.balances.length > 0 ? (
          <div>
            {balance.balances.map((b, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: i < balance.balances.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 500 }}>{b.asset}</span>
                  <span>{formatBalanceWithAsset(b.balance, b.asset)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#666', fontSize: 14 }}>No balances loaded</p>
        )}
      </div>

      <FeeDisplay />

      {showQR && account && (
        <QRCodeModal publicKey={account.publicKey} onClose={() => setShowQR(false)} />
      )}
    </motion.section>
  );
}
