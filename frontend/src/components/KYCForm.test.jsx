/**
 * #1140 — KYCForm.jsx collects and submits PII with no automated test
 * coverage. These tests cover required-field validation (matching
 * backend/src/compliance/kycCollector.js's kycSchema), the submission
 * payload shape, and server-error handling.
 *
 * While writing these tests, two drifts were found between this form and
 * kycSchema and fixed directly in KYCForm.jsx:
 *   - documentType options sent 'DRIVER_LICENSE' / 'OTHER', neither of which
 *     is in the backend's enum (['PASSPORT','NATIONAL_ID','DRIVERS_LICENSE',
 *     'RESIDENCE_PERMIT']), so those two choices would always fail server-side.
 *   - phoneNumber validation accepted spaces/dashes/parens and made '+'
 *     optional, but the backend requires strict E.164 (`/^\+[1-9]\d{1,14}$/`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { KYCForm } from './KYCForm.jsx';

vi.mock('../api/client.js', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import apiClient from '../api/client.js';

function mockNoExistingKyc() {
  apiClient.get.mockRejectedValue({ response: { status: 404 } });
}

async function renderForm() {
  mockNoExistingKyc();
  render(<KYCForm />);
  await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument());
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Jane Doe' } });
  fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '1990-01-01' } });
  fireEvent.change(screen.getByLabelText(/nationality/i), { target: { value: 'US' } });
  fireEvent.change(screen.getByLabelText(/document number/i), { target: { value: 'ABC123456' } });
  fireEvent.change(screen.getByLabelText(/^address/i), { target: { value: '123 Main St, Springfield' } });
}

describe('KYCForm', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
  });

  it('loads the form when no KYC record exists yet (404)', async () => {
    await renderForm();
    expect(screen.getByRole('button', { name: /submit kyc information/i })).toBeInTheDocument();
  });

  it('offers only document types accepted by the backend kycSchema enum', async () => {
    await renderForm();
    const options = screen.getAllByRole('option', { name: /passport|driver|national id|residence permit/i });
    const values = options.map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining(['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE', 'RESIDENCE_PERMIT']),
    );
    // Neither of the old, backend-rejected values should be present.
    expect(values).not.toContain('DRIVER_LICENSE');
    expect(values).not.toContain('OTHER');
  });

  it('blocks submission and surfaces errors when required fields are empty', async () => {
    await renderForm();

    fireEvent.click(screen.getByRole('button', { name: /submit kyc information/i }));

    expect(await screen.findByText(/name must be at least 2 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/please select a valid nationality/i)).toBeInTheDocument();
    expect(screen.getByText(/document number must be at least 5 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/address must be at least 5 characters/i)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('rejects a date of birth under 18 years old', async () => {
    await renderForm();
    const recentYear = new Date().getFullYear() - 5;
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: `${recentYear}-01-01` },
    });
    fireEvent.blur(screen.getByLabelText(/date of birth/i));
    expect(await screen.findByText(/must be at least 18 years old/i)).toBeInTheDocument();
  });

  it('rejects a phone number that is not strict E.164 (matching backend regex)', async () => {
    await renderForm();
    const phoneInput = screen.getByLabelText(/phone number/i);
    fireEvent.change(phoneInput, { target: { value: '(202) 555-1234' } });
    fireEvent.blur(phoneInput);
    expect(await screen.findByText(/invalid phone number/i)).toBeInTheDocument();
  });

  it('accepts a strict E.164 phone number', async () => {
    await renderForm();
    const phoneInput = screen.getByLabelText(/phone number/i);
    fireEvent.change(phoneInput, { target: { value: '+12025551234' } });
    fireEvent.blur(phoneInput);
    expect(screen.queryByText(/invalid phone number/i)).not.toBeInTheDocument();
  });

  it('submits a payload matching the backend kycSchema shape on success', async () => {
    await renderForm();
    fillValidForm();
    apiClient.post.mockResolvedValue({ data: { status: 'PENDING' } });

    fireEvent.click(screen.getByRole('button', { name: /submit kyc information/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(apiClient.post).toHaveBeenCalledWith('/api/compliance/kyc', {
      fullName: 'Jane Doe',
      dateOfBirth: '1990-01-01',
      nationality: 'US',
      documentType: 'PASSPORT',
      documentNumber: 'ABC123456',
      address: '123 Main St, Springfield',
      phoneNumber: undefined,
      email: undefined,
    });
    expect(await screen.findByText(/submitted successfully/i)).toBeInTheDocument();
  });

  it('surfaces a server error instead of silently failing', async () => {
    await renderForm();
    fillValidForm();
    apiClient.post.mockRejectedValue({ response: { data: { error: 'Document number already in use' } } });

    fireEvent.click(screen.getByRole('button', { name: /submit kyc information/i }));

    expect(await screen.findByText('Document number already in use')).toBeInTheDocument();
  });
});
