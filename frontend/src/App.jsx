import { useState } from 'react';
import axios from 'axios';
import { isValidStellarAddress } from './utils/validateStellarAddress';
import { validateAmount, formatAmount } from './utils/validateAmount';
import { getFriendlyError } from './utils/errorMessages';

function App() {
  const [account, setAccount] = useState(null);
  const [balance, setBalance] = useState(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState(null); // { type: 'success'|'error', message, retry? }

  const setError = (error, retry) => setStatus({ type: 'error', message: getFriendlyError(error), retry });
  const setSuccess = (message) => setStatus({ type: 'success', message });

  const createAccount = async () => {
    try {
      const { data } = await axios.post('/api/stellar/account/create');
      setAccount(data);
      setSuccess('Account created! Save your secret key securely.');
    } catch (error) {
      setError(error, createAccount);
    }
  };

  const checkBalance = async () => {
    if (!account) return;
    try {
      const { data } = await axios.get(`/api/stellar/account/${account.publicKey}`);
      setBalance(data);
    } catch (error) {
      setError(error, checkBalance);
    }
  };

  const recipientValid = isValidStellarAddress(recipient);
  const recipientTouched = recipient.length > 0;

  const xlmBalance = balance?.balances?.find(b => b.asset === 'XLM')?.balance ?? null;
  const amountTouched = amount.length > 0;
  const amountError = validateAmount(amount, xlmBalance !== null ? parseFloat(xlmBalance) : null);
  const amountValid = amountTouched && !amountError;

  const sendPayment = async () => {
    if (!account || !recipientValid || !amountValid) return;
    try {
      const { data } = await axios.post('/api/stellar/payment/send', {
        sourceSecret: account.secretKey,
        destination: recipient,
        amount,
        assetCode: 'XLM'
      });
      setSuccess(`Payment sent! Hash: ${data.hash}`);
      checkBalance();
    } catch (error) {
      setError(error, sendPayment);
    }
  };

  return (
    <div className="app">
      <h1>Stellar Remittance Platform</h1>

      <div className="section">
        <button onClick={createAccount}>Create Account</button>
        {account && (
          <div className="account-info">
            <p><strong>Public Key:</strong> {account.publicKey}</p>
            <p><strong>Secret Key:</strong> {account.secretKey}</p>
          </div>
        )}
      </div>

      {account && (
        <>
          <div className="section">
            <button onClick={checkBalance}>Check Balance</button>
            {balance && (
              <div style={{ marginTop: '10px' }}>
                {balance.balances.map((b, i) => (
                  <p key={i}>{b.asset}: {b.balance}</p>
                ))}
              </div>
            )}
          </div>

          <div className="section">
            <h3>Send Payment</h3>
            <div className="input-wrap">
              <input
                type="text"
                placeholder="Recipient Public Key"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                style={{ border: `2px solid ${recipientTouched ? (recipientValid ? '#22c55e' : '#ef4444') : '#ccc'}` }}
              />
              {recipientTouched && <span className="input-icon">{recipientValid ? '✅' : '❌'}</span>}
            </div>
            {recipientTouched && !recipientValid && (
              <p className="field-error">Invalid Stellar address format (must start with G and be 56 characters)</p>
            )}
            <div className="input-wrap">
              <input
                type="text"
                placeholder="Amount (XLM)"
                value={amount}
                onChange={(e) => setAmount(formatAmount(e.target.value))}
                style={{ border: `2px solid ${amountTouched ? (amountValid ? '#22c55e' : '#ef4444') : '#ccc'}` }}
              />
              {amountTouched && <span className="input-icon">{amountValid ? '✅' : '❌'}</span>}
            </div>
            {amountTouched && amountError && <p className="field-error">{amountError}</p>}
            <button onClick={sendPayment} disabled={!recipientValid || !amountValid}>Send</button>
          </div>
        </>
      )}

      {status && (
        <div className={`status-banner ${status.type}`}>
          <span>{status.type === 'error' ? '⚠️' : '✅'}</span>
          <span className="msg">{status.message}</span>
          {status.retry && <button onClick={status.retry}>Retry</button>}
        </div>
      )}
    </div>
  );
}

export default App;
