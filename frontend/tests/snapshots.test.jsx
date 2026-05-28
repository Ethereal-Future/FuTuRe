/**
 * Snapshot tests for UI components.
 *
 * Updating snapshots:
 *   npx vitest run --update-snapshots
 *   or: npx vitest run -u
 *
 * Review changed snapshots in git diff before committing.
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Spinner } from '../src/components/Spinner';
import { FormField } from '../src/components/FormField';
import { AmountInput } from '../src/components/AmountInput';
import { NetworkBadge } from '../src/components/NetworkBadge';
import { StatusMessage } from '../src/components/StatusMessage';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { FeeDisplay } from '../src/components/FeeDisplay';
import { CopyButton } from '../src/components/CopyButton';

// Freeze framer-motion to avoid animation noise in snapshots
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  const Static = ({ children, className, style, role, 'aria-live': al, layout, ...rest }) =>
    <div className={className} style={style} role={role} aria-live={al}>{children}</div>;
  return {
    ...actual,
    motion: new Proxy({}, { get: () => Static }),
    AnimatePresence: ({ children }) => <>{children}</>,
  };
});

// ─── Spinner ────────────────────────────────────────────────────────────────

describe('Spinner snapshots', () => {
  it('renders without label', () => {
    const { container } = render(<Spinner />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders with label', () => {
    const { container } = render(<Spinner label="Loading…" />);
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── FormField ──────────────────────────────────────────────────────────────

describe('FormField snapshots', () => {
  it('renders with label and child input', () => {
    const { container } = render(
      <FormField label="Email" required>
        <input type="email" />
      </FormField>
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders validation error when touched', () => {
    const { container } = render(
      <FormField label="Email" error="Invalid email" touched required>
        <input type="email" />
      </FormField>
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders without label', () => {
    const { container } = render(
      <FormField>
        <input type="text" />
      </FormField>
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── AmountInput ────────────────────────────────────────────────────────────

describe('AmountInput snapshots', () => {
  it('renders default state', () => {
    const { container } = render(
      <AmountInput value="" onChange={vi.fn()} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders with value and available balance', () => {
    const { container } = render(
      <AmountInput value="100" onChange={vi.fn()} availableBalance={500} currency="XLM" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders with USDC currency', () => {
    const { container } = render(
      <AmountInput value="50" onChange={vi.fn()} currency="USDC" onCurrencyChange={vi.fn()} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── NetworkBadge ───────────────────────────────────────────────────────────

describe('NetworkBadge snapshots', () => {
  it('renders null when no status', () => {
    const { container } = render(<NetworkBadge status={null} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders online testnet badge', () => {
    const { container } = render(
      <NetworkBadge status={{ network: 'testnet', online: true, horizonUrl: 'https://horizon-testnet.stellar.org' }} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders offline mainnet badge', () => {
    const { container } = render(
      <NetworkBadge status={{ network: 'mainnet', online: false, horizonUrl: 'https://horizon.stellar.org' }} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── StatusMessage ──────────────────────────────────────────────────────────

describe('StatusMessage snapshots', () => {
  const msg = { id: 1, type: 'success', message: 'Payment sent', icon: '✅', timestamp: '2026-01-01T00:00:00.000Z' };

  it('renders empty state', () => {
    const { container } = render(<StatusMessage messages={[]} onRemove={vi.fn()} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders a success message', () => {
    const { container } = render(<StatusMessage messages={[msg]} onRemove={vi.fn()} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders an error message', () => {
    const errMsg = { ...msg, id: 2, type: 'error', message: 'Transaction failed', icon: '⚠️' };
    const { container } = render(<StatusMessage messages={[errMsg]} onRemove={vi.fn()} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders message with retry button', () => {
    const { container } = render(
      <StatusMessage messages={[{ ...msg, retry: vi.fn() }]} onRemove={vi.fn()} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── ErrorBoundary ──────────────────────────────────────────────────────────

describe('ErrorBoundary snapshots', () => {
  it('renders children when no error', () => {
    const { container } = render(
      <ErrorBoundary>
        <p>Child content</p>
      </ErrorBoundary>
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders error UI when error is thrown', () => {
    // Suppress console.error for expected error boundary output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Throw = () => { throw new Error('Test error'); };
    const { container } = render(
      <ErrorBoundary>
        <Throw />
      </ErrorBoundary>
    );
    expect(container.firstChild).toMatchSnapshot();
    spy.mockRestore();
  });
});

// ─── CopyButton ─────────────────────────────────────────────────────────────

describe('CopyButton snapshots', () => {
  it('renders default state', () => {
    const { container } = render(<CopyButton text="GABCDEF123" />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders with custom label', () => {
    const { container } = render(<CopyButton text="GABCDEF123" label="Copy address" />);
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── FeeDisplay ─────────────────────────────────────────────────────────────

describe('FeeDisplay snapshots', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<FeeDisplay amount="100" visible={false} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders nothing when visible but fee not yet loaded', () => {
    // No axios mock — fee stays null, component returns null
    const { container } = render(<FeeDisplay amount="100" visible={true} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
