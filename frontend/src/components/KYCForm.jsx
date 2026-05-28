import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { FormField } from './FormField';
import { Spinner } from './Spinner';
import { StatusMessage } from './StatusMessage';

const KYC_STATUS = {
  PENDING: { label: 'Pending Review', color: '#f59e0b' },
  APPROVED: { label: 'Approved', color: '#22c55e' },
  REJECTED: { label: 'Rejected', color: '#ef4444' },
  UNDER_REVIEW: { label: 'Under Review', color: '#3b82f6' },
};

function StatusBadge({ status }) {
  const badge = KYC_STATUS[status] || { label: status, color: '#6b7280' };
  return (
    <span style={{ background: badge.color, color: '#fff', borderRadius: 4, padding: '4px 12px', fontSize: '0.875rem', fontWeight: 600 }}>
      {badge.label}
    </span>
  );
}

export function KYCForm() {
  const [step, setStep] = useState('form'); // 'form' or 'status'
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [kycStatus, setKycStatus] = useState(null);

  const [form, setForm] = useState({
    fullName: '',
    dateOfBirth: '',
    nationality: '',
    documentType: 'PASSPORT',
    documentNumber: '',
    address: '',
    phoneNumber: '',
    email: '',
  });

  const [touched, setTouched] = useState({});

  const fetchKycStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const { data } = await axios.get('/api/compliance/kyc/status');
      setKycStatus(data.status);
      setStep('status');
    } catch (e) {
      // No KYC record exists yet
      if (e.response?.status === 404) {
        setKycStatus(null);
        setStep('form');
      } else {
        setError(e.response?.data?.error || 'Failed to load KYC status');
      }
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKycStatus();
  }, [fetchKycStatus]);

  const validateField = (name, value) => {
    switch (name) {
      case 'fullName':
        return value.trim().length < 2 ? 'Name must be at least 2 characters' : null;
      case 'dateOfBirth':
        const dob = new Date(value);
        if (isNaN(dob)) return 'Invalid date';
        const age = new Date().getFullYear() - dob.getFullYear();
        if (age < 18) return 'Must be at least 18 years old';
        return null;
      case 'nationality':
        return value.length < 2 ? 'Please select a valid nationality' : null;
      case 'documentNumber':
        return value.trim().length < 5 ? 'Document number must be at least 5 characters' : null;
      case 'address':
        return value.trim().length < 5 ? 'Address must be at least 5 characters' : null;
      case 'email':
        return value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'Invalid email' : null;
      case 'phoneNumber':
        return value && !/^\+?[\d\s-()]{10,}$/.test(value) ? 'Invalid phone number' : null;
      default:
        return null;
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Validate required fields
    const requiredFields = ['fullName', 'dateOfBirth', 'nationality', 'documentNumber', 'address'];
    const newTouched = { ...touched };
    let hasErrors = false;

    requiredFields.forEach((field) => {
      newTouched[field] = true;
      if (validateField(field, form[field])) {
        hasErrors = true;
      }
    });

    setTouched(newTouched);
    if (hasErrors) return;

    setLoading(true);
    try {
      const response = await axios.post('/api/compliance/kyc', {
        fullName: form.fullName,
        dateOfBirth: form.dateOfBirth,
        nationality: form.nationality,
        documentType: form.documentType,
        documentNumber: form.documentNumber,
        address: form.address,
        phoneNumber: form.phoneNumber || undefined,
        email: form.email || undefined,
      });

      setSuccess('KYC information submitted successfully! Your application is under review.');
      setKycStatus(response.data.status || 'PENDING');
      setTimeout(() => {
        setStep('status');
        setSuccess(null);
      }, 2000);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to submit KYC information');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="section" aria-labelledby="kyc-heading">
      <h2 id="kyc-heading" style={{ marginBottom: 16 }}>Know Your Customer (KYC)</h2>

      {error && <StatusMessage type="error" message={error} />}
      {success && <StatusMessage type="success" message={success} />}

      {statusLoading ? (
        <Spinner />
      ) : step === 'status' && kycStatus ? (
        <div style={{ padding: 16, background: '#f3f4f6', borderRadius: 8, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>KYC Status</h3>
            <StatusBadge status={kycStatus} />
          </div>
          <p style={{ margin: '8px 0', fontSize: '0.875rem', color: '#666' }}>
            {kycStatus === 'APPROVED' &&
              'Your identity has been verified. You can now access all features without transaction limits.'}
            {kycStatus === 'PENDING' &&
              'Your KYC application is being reviewed. This typically takes 1-2 business days.'}
            {kycStatus === 'UNDER_REVIEW' &&
              'Your application is currently under review by our compliance team.'}
            {kycStatus === 'REJECTED' &&
              'Unfortunately, your application was rejected. Please contact support for more information.'}
          </p>
          {kycStatus !== 'APPROVED' && (
            <button
              type="button"
              onClick={() => setStep('form')}
              style={{ marginTop: 12, padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}
            >
              Update Information
            </button>
          )}
        </div>
      ) : null}

      {step === 'form' && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FormField
            label="Full Name"
            required
            error={validateField('fullName', form.fullName)}
            touched={touched.fullName}
          >
            <input
              type="text"
              name="fullName"
              placeholder="John Doe"
              value={form.fullName}
              onChange={handleChange}
              onBlur={handleBlur}
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </FormField>

          <FormField
            label="Date of Birth"
            required
            error={validateField('dateOfBirth', form.dateOfBirth)}
            touched={touched.dateOfBirth}
          >
            <input
              type="date"
              name="dateOfBirth"
              value={form.dateOfBirth}
              onChange={handleChange}
              onBlur={handleBlur}
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </FormField>

          <FormField
            label="Nationality"
            required
            error={validateField('nationality', form.nationality)}
            touched={touched.nationality}
          >
            <select
              name="nationality"
              value={form.nationality}
              onChange={handleChange}
              onBlur={handleBlur}
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
            >
              <option value="">Select a country...</option>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="GB">United Kingdom</option>
              <option value="AU">Australia</option>
              <option value="DE">Germany</option>
              <option value="FR">France</option>
              <option value="JP">Japan</option>
              <option value="SG">Singapore</option>
              <option value="OTHER">Other</option>
            </select>
          </FormField>

          <FormField label="Document Type" required>
            <select
              name="documentType"
              value={form.documentType}
              onChange={handleChange}
              onBlur={handleBlur}
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
            >
              <option value="PASSPORT">Passport</option>
              <option value="DRIVER_LICENSE">Driver's License</option>
              <option value="NATIONAL_ID">National ID</option>
              <option value="OTHER">Other</option>
            </select>
          </FormField>

          <FormField
            label="Document Number"
            required
            error={validateField('documentNumber', form.documentNumber)}
            touched={touched.documentNumber}
          >
            <input
              type="text"
              name="documentNumber"
              placeholder="e.g., ABC123456"
              value={form.documentNumber}
              onChange={handleChange}
              onBlur={handleBlur}
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </FormField>

          <FormField
            label="Address"
            required
            error={validateField('address', form.address)}
            touched={touched.address}
          >
            <textarea
              name="address"
              placeholder="Street, City, State, ZIP"
              value={form.address}
              onChange={handleChange}
              onBlur={handleBlur}
              rows="3"
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box', fontFamily: 'inherited' }}
            />
          </FormField>

          <FormField
            label="Email"
            error={validateField('email', form.email)}
            touched={touched.email}
          >
            <input
              type="email"
              name="email"
              placeholder="optional@example.com"
              value={form.email}
              onChange={handleChange}
              onBlur={handleBlur}
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </FormField>

          <FormField
            label="Phone Number"
            error={validateField('phoneNumber', form.phoneNumber)}
            touched={touched.phoneNumber}
          >
            <input
              type="tel"
              name="phoneNumber"
              placeholder="optional +1234567890"
              value={form.phoneNumber}
              onChange={handleChange}
              onBlur={handleBlur}
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </FormField>

          <div style={{ fontSize: '0.875rem', color: '#666', padding: 12, background: '#f0fdf4', borderRadius: 4 }}>
            <p style={{ margin: 0 }}>ℹ️ Unverified users are blocked from transactions over 1000 XLM.</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: 10,
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? <Spinner /> : 'Submit KYC Information'}
          </button>
        </form>
      )}
    </section>
  );
}
