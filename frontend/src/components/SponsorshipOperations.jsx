import { useState } from 'react';
import apiClient from '../api/client.js';
import { useMessages } from '../hooks/useMessages';
import { CopyButton } from './CopyButton';

export function SponsorshipOperations({ publicKey }) {
  const [activeTab, setActiveTab] = useState('create-sponsored');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [sponsoredAccount, setSponsoredAccount] = useState('');
  const [initialBalance, setInitialBalance] = useState('2');
  const [trustlineAsset, setTrustlineAsset] = useState('USDC');
  const [trustlineIssuer, setTrustlineIssuer] = useState('');
  const [sponsoredSecret, setSponsoredSecret] = useState('');
  const msg = useMessages();

  const handleCreateSponsoredAccount = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!sponsoredAccount || sponsoredAccount.length < 40) {
      setError('Please enter a valid account public key');
      return;
    }

    if (parseFloat(initialBalance) < 0) {
      setError('Initial balance must be non-negative');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post('/api/stellar/account/sponsored-create', {
        sourceSecret: localStorage.getItem('secretKey'),
        sponsoredAccount,
        initialBalance,
      });
      setSuccess(`Sponsored account created! Transaction: ${response.data.hash}`);
      setSponsoredAccount('');
      setInitialBalance('2');
      msg.success('Sponsored account created successfully!');
    } catch (e) {
      const errorMsg = e?.response?.data?.error ?? e.message;
      setError(errorMsg);
      msg.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSponsoredTrustline = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!sponsoredAccount || sponsoredAccount.length < 40) {
      setError('Please enter a valid account public key');
      return;
    }

    if (!trustlineAsset || trustlineAsset.length === 0) {
      setError('Please enter an asset code');
      return;
    }

    if (!sponsoredSecret || sponsoredSecret.length < 56) {
      setError("Please enter the sponsored account's secret key (both signatures are required)");
      return;
    }

    setLoading(true);
    try {
      // The Stellar protocol requires BOTH the sponsoring account and the
      // sponsored account to sign transactions that introduce sponsored
      // entries. The backend builds the transaction and returns an unsigned
      // XDR; we then sign it with both keypairs client-side and submit the
      // fully-signed envelope.
      const buildResponse = await apiClient.post('/api/stellar/trustline/sponsored-create/build', {
        sourceSecret: localStorage.getItem('secretKey'),
        sponsoredAccount,
        sponsoredSecret,
        assetCode: trustlineAsset,
        assetIssuer: trustlineIssuer || undefined,
      });

      const { xdr: unsignedXdr } = buildResponse.data;
      if (!unsignedXdr) {
        throw new Error('Backend did not return a transaction to sign');
      }

      const { TransactionBuilder, Networks, Keypair } = await import('@stellar/stellar-sdk');
      const networkPassphrase =
        buildResponse.data.networkPassphrase ||
        (buildResponse.data.network === 'public' ? Networks.PUBLIC : Networks.TESTNET);

      const transaction = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase);
      transaction.sign(Keypair.fromSecret(localStorage.getItem('secretKey')));
      transaction.sign(Keypair.fromSecret(sponsoredSecret));

      const signedXdr = transaction.toXDR();

      const response = await apiClient.post('/api/stellar/trustline/sponsored-create/submit', {
        signedXdr,
      });
      setSuccess(`Sponsored trustline created! Transaction: ${response.data.hash}`);
      setSponsoredAccount('');
      setSponsoredSecret('');
      setTrustlineAsset('USDC');
      setTrustlineIssuer('');
      msg.success('Sponsored trustline created successfully!');
    } catch (e) {
      const errorMsg = e?.response?.data?.error ?? e.message;
      setError(errorMsg);
      msg.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginBottom: 20, padding: 16, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
      <h3 style={{ margin: '0 0 16px 0' }}>🤝 Sponsorship Operations</h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid #d1d5db' }}>
        <button
          type="button"
          onClick={() => { setActiveTab('create-sponsored'); setError(null); setSuccess(null); }}
          style={{
            padding: '10px 16px',
            background: activeTab === 'create-sponsored' ? '#22c55e' : '#f3f4f6',
            color: activeTab === 'create-sponsored' ? '#fff' : '#333',
            border: 'none',
            borderRadius: '4px 4px 0 0',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Create Sponsored Account
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('create-trustline'); setError(null); setSuccess(null); }}
          style={{
            padding: '10px 16px',
            background: activeTab === 'create-trustline' ? '#22c55e' : '#f3f4f6',
            color: activeTab === 'create-trustline' ? '#fff' : '#333',
            border: 'none',
            borderRadius: '4px 4px 0 0',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Create Sponsored Trustline
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, marginBottom: 12, color: '#991b1b', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: 12, background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, marginBottom: 12, color: '#166534', fontSize: '0.9rem' }}>
          {success}
        </div>
      )}

      {activeTab === 'create-sponsored' && (
        <form onSubmit={handleCreateSponsoredAccount} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            Create a new Stellar account where you pay for the base reserve. The sponsored account will be created with no initial trustlines or offers.
          </p>

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Sponsored Account Public Key
            </label>
            <input
              type="text"
              value={sponsoredAccount}
              onChange={(e) => setSponsoredAccount(e.target.value)}
              placeholder="GXXXXXXXXXX..."
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.9rem' }}
            />
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
              The public key of the account to sponsor
            </p>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Initial XLM Balance (Optional)
            </label>
            <input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
              placeholder="2.0"
              step="0.0001"
              min="0"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
            />
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
              Optional initial XLM balance for the account (minimum 0 with sponsorship)
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '10px 16px',
              background: loading ? '#d1d5db' : '#22c55e',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {loading ? 'Processing…' : 'Create Sponsored Account'}
          </button>
        </form>
      )}

      {activeTab === 'create-trustline' && (
        <form onSubmit={handleCreateSponsoredTrustline} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            Create a trustline for an asset on an existing account where you pay for the trustline reserve.
          </p>

          <div style={{ padding: 12, background: '#fef9c3', border: '1px solid #fde047', borderRadius: 4, color: '#854d0e', fontSize: '0.85rem' }}>
            ⚠️ Both signatures are required: the sponsoring account (your connected wallet) and the sponsored account must each sign this transaction, or it will fail on-chain with <code>tx_bad_auth</code>.
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Account to Sponsor Trustline
            </label>
            <input
              type="text"
              value={sponsoredAccount}
              onChange={(e) => setSponsoredAccount(e.target.value)}
              placeholder="GXXXXXXXXXX..."
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.9rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Sponsored Account Secret Key
            </label>
            <input
              type="password"
              value={sponsoredSecret}
              onChange={(e) => setSponsoredSecret(e.target.value)}
              placeholder="SXXXXXXXXXX..."
              autoComplete="off"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.9rem' }}
            />
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
              Required so the sponsored account can co-sign the transaction. Never sent to the server.
            </p>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Asset Code
            </label>
            <select
              value={trustlineAsset}
              onChange={(e) => setTrustlineAsset(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
            >
              <option value="USDC">USDC</option>
              <option value="EURC">EURC</option>
              <option value="custom">Other Asset</option>
            </select>
          </div>

          {trustlineAsset === 'custom' && (
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                Custom Asset Code
              </label>
              <input
                type="text"
                value={trustlineAsset}
                onChange={(e) => setTrustlineAsset(e.target.value)}
                placeholder="USD"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Asset Issuer (Optional)
            </label>
            <input
              type="text"
              value={trustlineIssuer}
              onChange={(e) => setTrustlineIssuer(e.target.value)}
              placeholder="GXXXXXXXXXX..."
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.9rem' }}
            />
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
              Leave empty for standard assets
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !sponsoredSecret}
            style={{
              padding: '10px 16px',
              background: loading || !sponsoredSecret ? '#d1d5db' : '#22c55e',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: loading || !sponsoredSecret ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {loading ? 'Processing…' : 'Sign & Create Sponsored Trustline'}
          </button>
        </form>
      )}
    </div>
  );
}
