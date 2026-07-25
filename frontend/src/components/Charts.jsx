import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import { useRef, useCallback } from 'react';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const COLORS = ['#0066cc', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

/** Download the chart canvas as a PNG */
function useExport(title = 'chart') {
  const ref = useRef(null);
  const exportPng = useCallback(() => {
    const svg = ref.current?.querySelector('svg');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [title]);
  return { ref, exportPng };
}

function ChartCard({ title, children, onExport }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
        {onExport && (
          <button type="button" onClick={onExport} style={exportBtnStyle} title="Export as SVG">
            ↓ Export
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── 1. Transaction Volume Chart (Bar) ───────────────────────────────────────

/**
 * TransactionVolumeChart
 * data: [{ date: string, sent: number, received: number }]
 */
export function TransactionVolumeChart({ data = [] }) {
  const { ref, exportPng } = useExport('transaction-volume');
  return (
    <ChartCard title="Transaction Volume" onExport={exportPng}>
      <div ref={ref}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => `${v} XLM`} />
            <Legend />
            <Bar dataKey="sent" fill={COLORS[0]} name="Sent" radius={[3, 3, 0, 0]} />
            <Bar dataKey="received" fill={COLORS[1]} name="Received" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ─── 2. Balance History Graph (Area) ─────────────────────────────────────────

/**
 * BalanceHistoryChart
 * data: [{ date: string, balance: number }]
 */
export function BalanceHistoryChart({ data = [] }) {
  const { ref, exportPng } = useExport('balance-history');
  return (
    <ChartCard title="Balance History" onExport={exportPng}>
      <div ref={ref}>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[0]} stopOpacity={0.2} />
                <stop offset="95%" stopColor={COLORS[0]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => `${v} XLM`} />
            <Area type="monotone" dataKey="balance" stroke={COLORS[0]} fill="url(#balGrad)" strokeWidth={2} dot={false} name="Balance" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ─── 3. Portfolio Pie Chart ───────────────────────────────────────────────────

/**
 * PortfolioPieChart
 * data: [{ asset: string, balance: number }]
 */
export function PortfolioPieChart({ data = [] }) {
  const { ref, exportPng } = useExport('portfolio');
  const total = data.reduce((s, d) => s + d.balance, 0);

  const renderLabel = ({ name, percent }) =>
    percent > 0.04 ? `${name} ${(percent * 100).toFixed(1)}%` : '';

  return (
    <ChartCard title="Portfolio Breakdown" onExport={exportPng}>
      <div ref={ref}>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              dataKey="balance"
              nameKey="asset"
              cx="50%"
              cy="50%"
              outerRadius={90}
              label={renderLabel}
              labelLine={false}
            >
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => [`${v} XLM`, `${((v / total) * 100).toFixed(2)}%`]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ─── 4. Transaction Flow Diagram (Line) ──────────────────────────────────────

/**
 * TransactionFlowChart
 * data: [{ time: string, inflow: number, outflow: number }]
 */
export function TransactionFlowChart({ data = [] }) {
  const { ref, exportPng } = useExport('transaction-flow');
  return (
    <ChartCard title="Transaction Flow" onExport={exportPng}>
      <div ref={ref}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => `${v} XLM`} />
            <Legend />
            <Line type="monotone" dataKey="inflow" stroke={COLORS[1]} strokeWidth={2} dot={false} name="Inflow" />
            <Line type="monotone" dataKey="outflow" stroke={COLORS[3]} strokeWidth={2} dot={false} name="Outflow" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ─── 5. Performance Metrics Dashboard ────────────────────────────────────────

/**
 * PerformanceDashboard
 * metrics: { totalSent, totalReceived, txCount, avgTxSize, successRate }
 */
export function PerformanceDashboard({ metrics = {} }) {
  const {
    totalSent = 0, totalReceived = 0,
    txCount = 0, avgTxSize = 0, successRate = 100,
  } = metrics;

  const stats = [
    { label: 'Total Sent', value: `${totalSent.toLocaleString()} XLM`, color: COLORS[3] },
    { label: 'Total Received', value: `${totalReceived.toLocaleString()} XLM`, color: COLORS[1] },
    { label: 'Transactions', value: txCount.toLocaleString(), color: COLORS[0] },
    { label: 'Avg Tx Size', value: `${avgTxSize.toFixed(2)} XLM`, color: COLORS[2] },
    { label: 'Success Rate', value: `${successRate.toFixed(1)}%`, color: successRate >= 99 ? COLORS[1] : COLORS[3] },
  ];

  return (
    <ChartCard title="Performance Metrics">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        {stats.map(s => (
          <div key={s.label} style={{ ...metricTileStyle, borderTop: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cardStyle = {
  background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
  padding: 16, marginBottom: 16,
};
const exportBtnStyle = {
  background: 'none', color: '#0066cc', border: '1px solid #0066cc',
  borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
  width: 'auto', minHeight: 'unset', minWidth: 'unset',
};
const metricTileStyle = {
  background: '#f9fafb', borderRadius: 6, padding: '10px 12px',
};
