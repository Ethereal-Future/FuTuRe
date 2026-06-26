import { useEffect, useState } from 'react';
import apiClient from '../api/client.js';

export function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [error, setError] = useState(null);

  const loadStats = async () => {
    const { data } = await apiClient.get('/api/admin/stats');
    setStats(data);
  };

  const loadUsers = async () => {
    const { data } = await apiClient.get('/api/admin/users', {
      params: { search, page, limit: 10 },
    });
    setUsers(data.users || []);
    setPagination(data.pagination);
  };

  useEffect(() => {
    Promise.all([loadStats(), loadUsers()]).catch((err) => {
      setError(err?.normalized?.message || err.message || 'Failed to load admin dashboard');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const reviewKyc = async (userId, action) => {
    setError(null);
    try {
      await apiClient.put(`/api/admin/kyc/${userId}/${action}`);
      await Promise.all([loadStats(), loadUsers()]);
    } catch (err) {
      setError(err?.normalized?.message || err.message || `Failed to ${action} KYC`);
    }
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setPage(1);
    loadUsers().catch((err) => setError(err?.normalized?.message || err.message));
  };

  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: 24 }}>
      <h1>Admin Dashboard</h1>
      <p style={{ color: '#64748b' }}>Monitor platform activity, KYC reviews, AML alerts, and system load.</p>
      {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          ['Total Users', stats?.totalUsers],
          ['Transactions', stats?.totalTransactions],
          ['Active Streams', stats?.activeStreams],
          ['Pending KYC', stats?.pendingKYC],
          ['Open AML Alerts', stats?.openAMLAlerts],
        ].map(([label, value]) => (
          <article key={label} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
            <strong style={{ display: 'block', fontSize: 24 }}>{value ?? '—'}</strong>
            <span style={{ color: '#64748b' }}>{label}</span>
          </article>
        ))}
      </section>

      <section>
        <form onSubmit={submitSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search username or public key"
            aria-label="Search users"
          />
          <button type="submit">Search</button>
        </form>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['User', 'Role', 'KYC', 'Created', 'Actions'].map((heading) => (
                  <th key={heading} style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', padding: 8 }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td style={{ padding: 8 }}>
                    <div>{user.username || 'Unnamed'}</div>
                    <small>{user.publicKey}</small>
                  </td>
                  <td style={{ padding: 8 }}>{user.role}</td>
                  <td style={{ padding: 8 }}>{user.kycRecord?.status || 'NONE'}</td>
                  <td style={{ padding: 8 }}>{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: 8 }}>
                    <button type="button" onClick={() => reviewKyc(user.id, 'approve')}>Approve</button>{' '}
                    <button type="button" onClick={() => reviewKyc(user.id, 'reject')}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pagination && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
            <span>Page {pagination.page} of {pagination.pages || 1}</span>
            <button type="button" disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</button>
          </div>
        )}
      </section>
    </main>
  );
}
