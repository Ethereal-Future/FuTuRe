/**
 * #1140 — ComplianceDashboard.jsx presents AML alert data (risk scores,
 * severities, and per-user/per-transaction detail) to compliance/admin
 * staff and gates that view by role, with no prior test coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComplianceDashboard } from './ComplianceDashboard.jsx';

vi.mock('../api/client.js', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
}));

import apiClient from '../api/client.js';

const ALERT = {
  id: 'alert-1',
  severity: 'HIGH',
  riskScore: 87,
  riskLevel: 'high',
  ruleId: 'RULE_STRUCTURING',
  description: 'Multiple sub-threshold transfers within 24h',
  transaction: { hash: 'a'.repeat(64), amount: '950', assetCode: 'USDC' },
  user: { publicKey: 'G'.repeat(56) },
  createdAt: '2026-08-01T00:00:00Z',
};

function mockAlertsResponse(alerts = [ALERT], pagination = { page: 1, pages: 1 }) {
  apiClient.get.mockResolvedValue({ data: { alerts, pagination } });
}

describe('ComplianceDashboard', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.patch).mockReset();
  });

  it('denies access for a role outside COMPLIANCE/ADMIN', () => {
    render(<ComplianceDashboard onClose={() => {}} userRole="USER" />);
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    expect(screen.queryByText(/severity/i)).not.toBeInTheDocument();
  });

  it('renders AML alert data for an authorized COMPLIANCE role', async () => {
    mockAlertsResponse();
    render(<ComplianceDashboard onClose={() => {}} userRole="COMPLIANCE" />);

    expect(await screen.findByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.getByText('RULE_STRUCTURING')).toBeInTheDocument();
    expect(screen.getByText(/multiple sub-threshold transfers/i)).toBeInTheDocument();
    expect(screen.getByText('950 USDC')).toBeInTheDocument();
    // Sensitive identifiers are truncated for display, not shown in full.
    expect(screen.getByText(/^aaaaaaaa\.\.\.$/)).toBeInTheDocument();
    expect(screen.getByText(/^GGGGGGGG\.\.\.$/)).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith('/api/compliance/aml/alerts?page=1&limit=20');
  });

  it('also renders for an authorized ADMIN role', async () => {
    mockAlertsResponse();
    render(<ComplianceDashboard onClose={() => {}} userRole="ADMIN" />);
    expect(await screen.findByText('HIGH')).toBeInTheDocument();
  });

  it('shows an empty state when there are no alerts', async () => {
    mockAlertsResponse([]);
    render(<ComplianceDashboard onClose={() => {}} userRole="ADMIN" />);
    expect(await screen.findByText(/no aml alerts found/i)).toBeInTheDocument();
  });

  it('surfaces a load error instead of failing silently', async () => {
    apiClient.get.mockRejectedValue({ response: { data: { error: 'Failed to reach compliance service' } } });
    render(<ComplianceDashboard onClose={() => {}} userRole="ADMIN" />);
    expect(await screen.findByText('Failed to reach compliance service')).toBeInTheDocument();
  });

  it('marks an alert as reviewed with the entered notes and reloads the list', async () => {
    mockAlertsResponse();
    apiClient.patch.mockResolvedValue({ data: { ok: true } });
    render(<ComplianceDashboard onClose={() => {}} userRole="ADMIN" />);

    await screen.findByText('HIGH');
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.change(screen.getByPlaceholderText(/review notes/i), {
      target: { value: 'Confirmed false positive' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith('/api/compliance/aml/alerts/alert-1/review', {
        notes: 'Confirmed false positive',
      }),
    );
    // The list is refetched after a successful review so status doesn't go stale.
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('shows pagination controls only when there is more than one page', async () => {
    mockAlertsResponse([ALERT], { page: 1, pages: 3 });
    render(<ComplianceDashboard onClose={() => {}} userRole="ADMIN" />);
    expect(await screen.findByText(/page 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });
});
