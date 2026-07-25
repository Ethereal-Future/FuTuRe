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

// Design System Components
import { Button } from '../src/design-system/Button';
import { Card } from '../src/design-system/Card';
import { Input } from '../src/design-system/Input';
import { Modal } from '../src/design-system/Modal';
import { Badge } from '../src/design-system/Badge';

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

// ═══════════════════════════════════════════════════════════════════════════
// Design System Components
// ═══════════════════════════════════════════════════════════════════════════

// ─── Button ──────────────────────────────────────────────────────────────────

describe('Button snapshots', () => {
  // Primary variant
  it('renders primary button', () => {
    const { container } = render(<Button variant="primary">Click me</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders primary button disabled', () => {
    const { container } = render(
      <Button variant="primary" disabled>
        Disabled
      </Button>
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders primary button loading', () => {
    const { container } = render(
      <Button variant="primary" loading>
        Loading...
      </Button>
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  // Secondary variant
  it('renders secondary button', () => {
    const { container } = render(<Button variant="secondary">Secondary</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });

  // Danger variant
  it('renders danger button', () => {
    const { container } = render(<Button variant="danger">Delete</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });

  // Ghost variant
  it('renders ghost button', () => {
    const { container } = render(<Button variant="ghost">Cancel</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });

  // Sizes
  it('renders small button', () => {
    const { container } = render(<Button size="sm">Small</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders medium button (default)', () => {
    const { container } = render(<Button size="md">Medium</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders large button', () => {
    const { container } = render(<Button size="lg">Large</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });

  // Full width
  it('renders full width button', () => {
    const { container } = render(<Button fullWidth>Full Width</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Card ───────────────────────────────────────────────────────────────────

describe('Card snapshots', () => {
  it('renders basic card', () => {
    const { container } = render(<Card>Card content</Card>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders card with header', () => {
    const { container } = render(<Card header="Card Title">Card content</Card>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders card with footer', () => {
    const { container } = render(<Card footer="Card Footer">Card content</Card>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders card with header and footer', () => {
    const { container } = render(
      <Card header="Title" footer="Footer">
        Card content
      </Card>
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  // Padding variants
  it('renders card with small padding', () => {
    const { container } = render(<Card padding="sm">Small padding</Card>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders card with medium padding (default)', () => {
    const { container } = render(<Card padding="md">Medium padding</Card>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders card with large padding', () => {
    const { container } = render(<Card padding="lg">Large padding</Card>);
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Input ──────────────────────────────────────────────────────────────────

describe('Input snapshots', () => {
  it('renders basic input', () => {
    const { container } = render(<Input placeholder="Enter text" />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders input with label', () => {
    const { container } = render(<Input label="Email" type="email" />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders input with hint text', () => {
    const { container } = render(<Input label="Password" type="password" hint="At least 8 characters" />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders input with error', () => {
    const { container } = render(<Input label="Email" error="Invalid email format" />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders input error state (aria-invalid)', () => {
    const { getByRole } = render(<Input label="Email" error="Required" />);
    expect(getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders full width input', () => {
    const { container } = render(<Input label="Name" fullWidth />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders input with custom id', () => {
    const { container } = render(<Input label="Username" id="custom-id" />);
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ─── Modal ──────────────────────────────────────────────────────────────────

describe('Modal snapshots', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal open={false} onClose={vi.fn()} title="Dialog">
        Modal content
      </Modal>
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders modal when open', () => {
    // Portal snapshots may need special handling
    const { getByRole } = render(
      <Modal open={true} onClose={vi.fn()} title="Dialog">
        Modal content
      </Modal>
    );
    const dialog = getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toMatchSnapshot();
  });

  it('renders modal with small size', () => {
    const { getByRole } = render(
      <Modal open={true} onClose={vi.fn()} title="Small Dialog" size="sm">
        Content
      </Modal>
    );
    expect(getByRole('dialog')).toMatchSnapshot();
  });

  it('renders modal with medium size (default)', () => {
    const { getByRole } = render(
      <Modal open={true} onClose={vi.fn()} title="Medium Dialog" size="md">
        Content
      </Modal>
    );
    expect(getByRole('dialog')).toMatchSnapshot();
  });

  it('renders modal with large size', () => {
    const { getByRole } = render(
      <Modal open={true} onClose={vi.fn()} title="Large Dialog" size="lg">
        Content
      </Modal>
    );
    expect(getByRole('dialog')).toMatchSnapshot();
  });

  it('modal title has correct id', () => {
    const { getByText, getByRole } = render(
      <Modal open={true} onClose={vi.fn()} title="Dialog Title">
        Content
      </Modal>
    );
    const title = getByText('Dialog Title');
    const dialog = getByRole('dialog');
    expect(title).toHaveAttribute('id', 'modal-title');
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
  });
});

// ─── Badge ──────────────────────────────────────────────────────────────────

describe('Badge snapshots', () => {
  it('renders default badge', () => {
    const { container } = render(<Badge>Default</Badge>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders success badge', () => {
    const { container } = render(<Badge variant="success">Success</Badge>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders danger badge', () => {
    const { container } = render(<Badge variant="danger">Error</Badge>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders warning badge', () => {
    const { container } = render(<Badge variant="warning">Warning</Badge>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders info badge', () => {
    const { container } = render(<Badge variant="info">Info</Badge>);
    expect(container.firstChild).toMatchSnapshot();
  });
});
