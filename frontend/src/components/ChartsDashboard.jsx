import { useMemo } from 'react';
import {
  TransactionVolumeChart,
  BalanceHistoryChart,
  PortfolioPieChart,
  TransactionFlowChart,
  PerformanceDashboard,
} from './Charts.jsx';

/**
 * ChartsDashboard — assembles all charts from raw transaction + balance data.
 *
 * Props:
 *   transactions: [{ hash, createdAt, successful, type, amount, asset }]
 *   balances:     [{ asset: string, balance: string }]
 *   publicKey:    string
 */
export function ChartsDashboard({ transactions = [], balances = [], publicKey }) {
  const volumeData = useMemo(() => {
    const byDay = {};
    transactions.forEach(tx => {
      const day = tx.createdAt?.slice(0, 10) ?? 'unknown';
      if (!byDay[day]) byDay[day] = { date: day, sent: 0, received: 0 };
      const amt = parseFloat(tx.amount ?? 0);
      if (tx.type === 'sent') byDay[day].sent += amt;
      else byDay[day].received += amt;
    });
    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [transactions]);

  const balanceHistory = useMemo(() => {
    let running = parseFloat(balances.find(b => b.asset === 'XLM')?.balance ?? 0);
    return [...transactions]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-30)
      .map(tx => {
        const amt = parseFloat(tx.amount ?? 0);
        running += tx.type === 'received' ? amt : -amt;
        return { date: tx.createdAt?.slice(0, 10), balance: parseFloat(running.toFixed(7)) };
      });
  }, [transactions, balances]);

  const portfolioData = useMemo(() =>
    balances.map(b => ({ asset: b.asset, balance: parseFloat(b.balance) }))
      .filter(b => b.balance > 0),
    [balances]
  );

  const flowData = useMemo(() => {
    const byDay = {};
    transactions.forEach(tx => {
      const day = tx.createdAt?.slice(0, 10) ?? 'unknown';
      if (!byDay[day]) byDay[day] = { time: day, inflow: 0, outflow: 0 };
      const amt = parseFloat(tx.amount ?? 0);
      if (tx.type === 'received') byDay[day].inflow += amt;
      else byDay[day].outflow += amt;
    });
    return Object.values(byDay).sort((a, b) => a.time.localeCompare(b.time)).slice(-14);
  }, [transactions]);

  const metrics = useMemo(() => {
    const sent = transactions.filter(t => t.type === 'sent');
    const received = transactions.filter(t => t.type === 'received');
    const successful = transactions.filter(t => t.successful !== false);
    const totalSent = sent.reduce((s, t) => s + parseFloat(t.amount ?? 0), 0);
    const totalReceived = received.reduce((s, t) => s + parseFloat(t.amount ?? 0), 0);
    return {
      totalSent: parseFloat(totalSent.toFixed(7)),
      totalReceived: parseFloat(totalReceived.toFixed(7)),
      txCount: transactions.length,
      avgTxSize: transactions.length ? parseFloat(((totalSent + totalReceived) / transactions.length).toFixed(7)) : 0,
      successRate: transactions.length ? (successful.length / transactions.length) * 100 : 100,
    };
  }, [transactions]);

  if (!transactions.length && !balances.length) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 14 }}>
        No data yet. Create an account and make transactions to see charts.
      </div>
    );
  }

  return (
    <div>
      <PerformanceDashboard metrics={metrics} />
      {volumeData.length > 0 && <TransactionVolumeChart data={volumeData} />}
      {balanceHistory.length > 0 && <BalanceHistoryChart data={balanceHistory} />}
      {flowData.length > 0 && <TransactionFlowChart data={flowData} />}
      {portfolioData.length > 0 && <PortfolioPieChart data={portfolioData} />}
    </div>
  );
}
