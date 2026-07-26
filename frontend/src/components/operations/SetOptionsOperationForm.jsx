import { useState } from 'react';

export function SetOptionsOperationForm({ onAdd, publicKey }) {
  const [inflationDest, setInflationDest] = useState('');
  const [clearFlags, setClearFlags] = useState('');
  const [setFlags, setSetFlags] = useState('');
  const [masterWeight, setMasterWeight] = useState('');
  const [lowThreshold, setLowThreshold] = useState('');
  const [medThreshold, setMedThreshold] = useState('');
  const [highThreshold, setHighThreshold] = useState('');
  const [homeDomain, setHomeDomain] = useState('');
  const [error, setError] = useState('');

  const validateThresholds = () => {
    const med = medThreshold ? parseInt(medThreshold) : null;
    const high = highThreshold ? parseInt(highThreshold) : null;

    if (med !== null && high !== null && med > high) {
      setError('Medium threshold cannot be greater than high threshold');
      return false;
    }

    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!validateThresholds()) {
      return;
    }

    const data = {};

    if (inflationDest) {
      if (inflationDest === publicKey) {
        setError('Cannot set inflation destination to own account (use omitSource)');
        return;
      }
      data.inflationDest = inflationDest;
    }

    if (clearFlags) {
      const num = parseInt(clearFlags);
      if (isNaN(num) || num < 0) {
        setError('Clear flags must be a valid number');
        return;
      }
      data.clearFlags = num;
    }

    if (setFlags) {
      const num = parseInt(setFlags);
      if (isNaN(num) || num < 0) {
        setError('Set flags must be a valid number');
        return;
      }
      data.setFlags = num;
    }

    if (masterWeight !== '' && masterWeight !== null) {
      const num = parseInt(masterWeight);
      if (isNaN(num) || num < 0 || num > 255) {
        setError('Master weight must be 0-255');
        return;
      }
      data.masterWeight = num;
    }

    if (lowThreshold !== '' && lowThreshold !== null) {
      const num = parseInt(lowThreshold);
      if (isNaN(num) || num < 0 || num > 255) {
        setError('Low threshold must be 0-255');
        return;
      }
      data.lowThreshold = num;
    }

    if (medThreshold !== '' && medThreshold !== null) {
      const num = parseInt(medThreshold);
      if (isNaN(num) || num < 0 || num > 255) {
        setError('Medium threshold must be 0-255');
        return;
      }
      data.medThreshold = num;
    }

    if (highThreshold !== '' && highThreshold !== null) {
      const num = parseInt(highThreshold);
      if (isNaN(num) || num < 0 || num > 255) {
        setError('High threshold must be 0-255');
        return;
      }
      data.highThreshold = num;
    }

    if (homeDomain) {
      data.homeDomain = homeDomain;
    }

    if (Object.keys(data).length === 0) {
      setError('At least one option must be set');
      return;
    }

    onAdd(data);

    setInflationDest('');
    setClearFlags('');
    setSetFlags('');
    setMasterWeight('');
    setLowThreshold('');
    setMedThreshold('');
    setHighThreshold('');
    setHomeDomain('');
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <p role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>
          {error}
        </p>
      )}

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="inflation-dest" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          Inflation Destination (optional)
        </label>
        <input
          id="inflation-dest"
          type="text"
          value={inflationDest}
          onChange={(e) => setInflationDest(e.target.value)}
          placeholder="G..."
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label htmlFor="clear-flags" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
            Clear Flags (optional)
          </label>
          <input
            id="clear-flags"
            type="number"
            value={clearFlags}
            onChange={(e) => setClearFlags(e.target.value)}
            placeholder="0"
            min="0"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label htmlFor="set-flags" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
            Set Flags (optional)
          </label>
          <input
            id="set-flags"
            type="number"
            value={setFlags}
            onChange={(e) => setSetFlags(e.target.value)}
            placeholder="0"
            min="0"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="master-weight" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          Master Weight (0-255, optional)
        </label>
        <input
          id="master-weight"
          type="number"
          value={masterWeight}
          onChange={(e) => setMasterWeight(e.target.value)}
          placeholder="1"
          min="0"
          max="255"
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div>
          <label htmlFor="low-threshold" style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>
            Low Threshold (0-255)
          </label>
          <input
            id="low-threshold"
            type="number"
            value={lowThreshold}
            onChange={(e) => setLowThreshold(e.target.value)}
            placeholder="0"
            min="0"
            max="255"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label htmlFor="med-threshold" style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>
            Medium Threshold (0-255)
          </label>
          <input
            id="med-threshold"
            type="number"
            value={medThreshold}
            onChange={(e) => setMedThreshold(e.target.value)}
            placeholder="0"
            min="0"
            max="255"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label htmlFor="high-threshold" style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>
            High Threshold (0-255)
          </label>
          <input
            id="high-threshold"
            type="number"
            value={highThreshold}
            onChange={(e) => setHighThreshold(e.target.value)}
            placeholder="0"
            min="0"
            max="255"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="home-domain" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          Home Domain (optional)
        </label>
        <input
          id="home-domain"
          type="text"
          value={homeDomain}
          onChange={(e) => setHomeDomain(e.target.value)}
          placeholder="example.com"
          style={{ width: '100%' }}
        />
      </div>

      <button type="submit" style={{ width: '100%', marginTop: 8 }}>
        Add SetOptions Operation
      </button>
    </form>
  );
}
