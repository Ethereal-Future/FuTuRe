import { describe, it, expect } from 'vitest';
import { verifyDocument } from '../identityVerifier.js';

const futureDate = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  return d.toISOString().slice(0, 10);
};

const pastDate = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

const adultDob = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 30);
  return d.toISOString().slice(0, 10);
};

const minorDob = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 15);
  return d.toISOString().slice(0, 10);
};

const validImage = () => ({
  mimeType: 'image/jpeg',
  width: 1200,
  height: 800,
  size: 250000,
  metadata: { software: 'camera-firmware' },
});

const baseDocument = (overrides = {}) => ({
  type: 'passport',
  nationality: 'US',
  number: '123456789',
  expiryDate: futureDate(),
  dob: adultDob(),
  image: validImage(),
  ...overrides,
});

describe('verifyDocument', () => {
  it('accepts a valid, unexpired document for an adult applicant', async () => {
    const result = await verifyDocument(baseDocument());
    expect(result.valid).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('rejects documents whose expiryDate is in the past', async () => {
    const result = await verifyDocument(baseDocument({ expiryDate: pastDate() }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/expir/i);
  });

  it('rejects documents with a missing or invalid expiryDate', async () => {
    const missing = await verifyDocument(baseDocument({ expiryDate: undefined }));
    expect(missing.valid).toBe(false);
    expect(missing.errors.join(' ')).toMatch(/expir/i);

    const invalid = await verifyDocument(baseDocument({ expiryDate: 'not-a-date' }));
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join(' ')).toMatch(/expir/i);
  });

  it('rejects underage applicants (<18)', async () => {
    const result = await verifyDocument(baseDocument({ dob: minorDob() }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/age|18/i);
  });

  it('rejects documents with a missing or invalid dob', async () => {
    const missing = await verifyDocument(baseDocument({ dob: undefined }));
    expect(missing.valid).toBe(false);
    expect(missing.errors.join(' ')).toMatch(/age|18|birth/i);

    const invalid = await verifyDocument(baseDocument({ dob: 'not-a-date' }));
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join(' ')).toMatch(/age|18|birth/i);
  });

  it('rejects US passports that are not 9 digits', async () => {
    const result = await verifyDocument(baseDocument({ nationality: 'US', number: 'ABC123' }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/format|number/i);
  });

  it('rejects UK passports that are not 9 digits', async () => {
    const result = await verifyDocument(
      baseDocument({ nationality: 'UK', number: '12345' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/format|number/i);
  });

  it('rejects unsupported issuing nations', async () => {
    const result = await verifyDocument(baseDocument({ nationality: 'ZZ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/nationality|unsupported/i);
  });

  it('rejects images with an unsupported MIME type', async () => {
    const result = await verifyDocument(
      baseDocument({ image: { ...validImage(), mimeType: 'application/pdf' } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/mime|image/i);
  });

  it('rejects images below the minimum resolution', async () => {
    const result = await verifyDocument(
      baseDocument({ image: { ...validImage(), width: 100, height: 100 } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/resolution|image/i);
  });

  it('rejects images with tampered metadata', async () => {
    const result = await verifyDocument(
      baseDocument({ image: { ...validImage(), metadata: { software: 'photoshop' } } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/tamper|metadata|image/i);
  });

  it('rejects documents with a missing image payload', async () => {
    const result = await verifyDocument(baseDocument({ image: undefined }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/image/i);
  });
});
