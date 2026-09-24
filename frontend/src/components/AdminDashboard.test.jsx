/**
 * #1141 — AdminDashboard.jsx is the UI surface for irreversible,
 * compliance-relevant admin actions (approving/rejecting a user's KYC
 * status) behind requireAdmin-gated backend routes, with no prior test
 * coverage. These tests cover stats/user-list rendering and, most
 * importantly, that approve/reject send the correct userId/action and that
 * an API error during either action is surfaced rather than swallowed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { AdminDashboard } from './AdminDashboard.jsx';

vi.mock('../api/client.js', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

import apiClient from '../api/client.js';

const STATS = {
  totalUsers: 42,
  totalTransactions: 1000,
  activeStreams: 3,
  pendingKYC: 5,
  openAMLAlerts: 2,
};

const USERS = [
  {
    id: 'user-1',
    username: 'alice',
    publicKey: 'G'.repeat(56),
    role: 'USER',
    kycRecord: { status: 'PENDING' },
    createdAt: '2026-08-01T00:00:00Z',
  },
];

function mockLoad({ users = USERS, pagination = { page: 1, pages: 1 } } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/admin/stats') return Promise.resolve({ data: STATS });
    if (url === '/api/admin/users') return Promise.resolve({ data: { users, pagination } });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function renderDashboard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AdminDashboard />
    </I18nextProvider>,
  );
}

describe('AdminDashboard', () => {
  beforeEach(async () => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
    await i18n.changeLanguage('en');
  });

  it('renders stats and the user list on load', async () => {
    mockLoad();
    renderDashboard();

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('PENDING')).toBeInTheDocument();
  });

  it('sends the correct userId and action when approving KYC, then refreshes data', async () => {
    mockLoad();
    apiClient.put.mockResolvedValue({ data: { ok: true } });
    renderDashboard();

    await screen.findByText('alice');
    const getCallsBeforeApprove = apiClient.get.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/api/admin/kyc/user-1/approve'),
    );
    // Stats + user list are refetched so the UI doesn't show stale KYC status.
    await waitFor(() =>
      expect(apiClient.get.mock.calls.length).toBeGreaterThan(getCallsBeforeApprove),
    );
  });

  it('sends the correct userId and action when rejecting KYC', async () => {
    mockLoad();
    apiClient.put.mockResolvedValue({ data: { ok: true } });
    renderDashboard();

    await screen.findByText('alice');
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/api/admin/kyc/user-1/reject'),
    );
  });

  it('surfaces a load error rather than failing silently', async () => {
    apiClient.get.mockRejectedValue(new Error('network down'));
    renderDashboard();

    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
  });

  it('surfaces an approve/reject API error to the admin instead of swallowing it', async () => {
    mockLoad();
    apiClient.put.mockRejectedValue({ normalized: { message: 'User already approved' } });
    renderDashboard();

    await screen.findByText('alice');
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('User already approved');
  });

  it('resets to page 1 and re-queries with the search term on search submit', async () => {
    mockLoad();
    renderDashboard();
    await screen.findByText('alice');

    fireEvent.change(screen.getByPlaceholderText(/search username or public key/i), {
      target: { value: 'alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith('/api/admin/users', {
        params: { search: 'alice', page: 1, limit: 10 },
      }),
    );
  });
});
