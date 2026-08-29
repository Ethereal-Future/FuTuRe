/**
 * Tests for TransactionBuilder.jsx (issue #1143)
 *
 * Covers:
 *  - adding / removing / reordering multiple operations
 *  - fee calculation reflecting the operation count
 *  - the assembled operation list matching what the user configured
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TransactionBuilder } from '../src/components/TransactionBuilder';

// ── API client stub ──────────────────────────────────────────────────────────
vi.mock('../src/api/client.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '../src/api/client.js';

// ── Operation form stubs ─────────────────────────────────────────────────────
// The individual operation-form components are tested separately; stub them
// so TransactionBuilder tests focus only on the orchestration layer.
vi.mock('../src/components/operations/PaymentOperationForm', () => ({
  PaymentOperationForm: ({ onAdd }) => (
    <button
      data-testid="add-payment"
      type="button"
      onClick={() => onAdd({ destination: 'GBOB', amount: '10', asset: 'XLM' })}
    >
      Add Payment
    </button>
  ),
}));

vi.mock('../src/components/operations/ChangeTrustOperationForm', () => ({
  ChangeTrustOperationForm: ({ onAdd }) => (
    <button
      data-testid="add-trust"
      type="button"
      onClick={() => onAdd({ assetCode: 'USDC', assetIssuer: 'GISSUER', limit: '1000' })}
    >
      Add Trust
    </button>
  ),
}));

vi.mock('../src/components/operations/ManageDataOperationForm', () => ({
  ManageDataOperationForm: ({ onAdd }) => (
    <button
      data-testid="add-data"
      type="button"
      onClick={() => onAdd({ key: 'memo', value: 'hello' })}
    >
      Add Data
    </button>
  ),
}));

vi.mock('../src/components/operations/SetOptionsOperationForm', () => ({
  SetOptionsOperationForm: ({ onAdd }) => (
    <button
      data-testid="add-options"
      type="button"
      onClick={() => onAdd({ homeDomain: 'example.com' })}
    >
      Add Options
    </button>
  ),
}));

vi.mock('../src/components/operations/ManageOfferOperationForm', () => ({
  ManageOfferOperationForm: ({ onAdd }) => (
    <button
      data-testid="add-offer"
      type="button"
      onClick={() => onAdd({ selling: 'XLM', buying: 'USDC', amount: '5', price: '1' })}
    >
      Add Offer
    </button>
  ),
}));

const PUBLIC_KEY = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN';
const BASE_FEE_STATS = { base_fee: '100' };

// ── Helpers ──────────────────────────────────────────────────────────────────
function renderBuilder(props = {}) {
  return render(
    <TransactionBuilder
      publicKey={PUBLIC_KEY}
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      {...props}
    />
  );
}

function addPaymentOp() {
  fireEvent.click(screen.getByTestId('add-payment'));
}

describe('TransactionBuilder (issue #1143)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: BASE_FEE_STATS });
    // suppress the atomicity warning for most tests
    localStorage.setItem('seenAtomicityWarning', 'true');
  });

  // ── Rendering ──────────────────────────────────────────────────────────────
  it('renders the dialog with the correct accessible title', () => {
    renderBuilder();
    expect(
      screen.getByRole('dialog', { name: /Advanced Transaction Builder/i })
    ).toBeInTheDocument();
  });

  it('shows "No operations added yet" when empty', () => {
    renderBuilder();
    expect(screen.getByText(/No operations added yet/i)).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderBuilder({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /Close builder/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Adding operations ─────────────────────────────────────────────────────
  it('adds a payment operation and shows it in the list', () => {
    renderBuilder();
    addPaymentOp();
    expect(screen.getByText(/1\. Payment/i)).toBeInTheDocument();
    expect(screen.getByText('Operations (1/100)')).toBeInTheDocument();
  });

  it('adds multiple operations and increments the counter', () => {
    renderBuilder();
    addPaymentOp();
    addPaymentOp();
    addPaymentOp();
    expect(screen.getByText('Operations (3/100)')).toBeInTheDocument();
  });

  it('adds a changeTrust operation when the type is switched', () => {
    renderBuilder();
    fireEvent.change(screen.getByRole('combobox', { name: /Add Operation/i }), {
      target: { value: 'changeTrust' },
    });
    fireEvent.click(screen.getByTestId('add-trust'));
    expect(screen.getByText(/1\. ChangeTrust/i)).toBeInTheDocument();
  });

  // ── Removing operations ───────────────────────────────────────────────────
  it('removes an operation when Remove is clicked', () => {
    renderBuilder();
    addPaymentOp();
    addPaymentOp();
    expect(screen.getByText('Operations (2/100)')).toBeInTheDocument();

    const removeButtons = screen.getAllByRole('button', { name: /Remove operation/i });
    fireEvent.click(removeButtons[0]);

    expect(screen.getByText('Operations (1/100)')).toBeInTheDocument();
  });

  it('shows "No operations added yet" after removing the last operation', () => {
    renderBuilder();
    addPaymentOp();
    fireEvent.click(screen.getByRole('button', { name: /Remove operation/i }));
    expect(screen.getByText(/No operations added yet/i)).toBeInTheDocument();
  });

  // ── Reordering operations ─────────────────────────────────────────────────
  it('reorders operations using the move-up button', () => {
    renderBuilder();
    // Add a payment then a changeTrust so they have different display text
    addPaymentOp();
    fireEvent.change(screen.getByRole('combobox', { name: /Add Operation/i }), {
      target: { value: 'changeTrust' },
    });
    fireEvent.click(screen.getByTestId('add-trust'));

    // Before reorder: Payment is #1, ChangeTrust is #2
    const listItems = () => screen.getAllByRole('listitem');
    expect(listItems()[0]).toHaveTextContent(/1\./);

    // Click "Move up" on the second item (ChangeTrust → position 1)
    fireEvent.click(screen.getByRole('button', { name: /Move up/i }));

    // After reorder: ChangeTrust is now #1, Payment is #2
    expect(listItems()[0]).toHaveTextContent(/ChangeTrust/i);
    expect(listItems()[1]).toHaveTextContent(/Payment/i);
  });

  it('reorders operations using the move-down button', () => {
    renderBuilder();
    addPaymentOp();
    fireEvent.change(screen.getByRole('combobox', { name: /Add Operation/i }), {
      target: { value: 'changeTrust' },
    });
    fireEvent.click(screen.getByTestId('add-trust'));

    // Payment is #1. Click "Move down" on Payment.
    fireEvent.click(screen.getByRole('button', { name: /Move down/i }));

    const listItems = screen.getAllByRole('listitem');
    expect(listItems()[0]).toHaveTextContent(/ChangeTrust/i);
    expect(listItems()[1]).toHaveTextContent(/Payment/i);
  });

  // ── Fee calculation ───────────────────────────────────────────────────────
  it('shows total fee of 0.0000100 XLM for 1 operation (base_fee=100 stroops)', async () => {
    renderBuilder();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/stellar/fee-stats'));
    addPaymentOp();
    // 1 op × 100 stroops = 100 stroops = 0.0000100 XLM
    expect(screen.getByText(/Total fee:.*0\.0000100/i)).toBeInTheDocument();
  });

  it('fee scales linearly with operation count', async () => {
    renderBuilder();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/stellar/fee-stats'));
    addPaymentOp();
    addPaymentOp();
    addPaymentOp();
    // 3 ops × 100 stroops = 300 stroops = 0.0000300 XLM
    expect(screen.getByText(/Total fee:.*0\.0000300/i)).toBeInTheDocument();
  });

  // ── Operation list matches user configuration ─────────────────────────────
  it('assembled operation list preserves types in insertion order', () => {
    renderBuilder();
    addPaymentOp();
    fireEvent.change(screen.getByRole('combobox', { name: /Add Operation/i }), {
      target: { value: 'changeTrust' },
    });
    fireEvent.click(screen.getByTestId('add-trust'));

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/Payment/i);
    expect(items[1]).toHaveTextContent(/ChangeTrust/i);
  });

  // ── Confirmation dialog ───────────────────────────────────────────────────
  it('opens confirmation dialog on Review & Submit', () => {
    renderBuilder();
    addPaymentOp();
    fireEvent.click(screen.getByRole('button', { name: /Review & Submit/i }));
    expect(screen.getByRole('heading', { name: /Confirm Transaction/i })).toBeInTheDocument();
  });

  it('lists all operations in the confirmation dialog', () => {
    renderBuilder();
    addPaymentOp();
    addPaymentOp();
    fireEvent.click(screen.getByRole('button', { name: /Review & Submit/i }));
    // Two "payment" entries in the confirmation pane
    const opEntries = screen.getAllByText(/payment/i);
    expect(opEntries.length).toBeGreaterThanOrEqual(2);
  });

  it('cancels confirmation without submitting', () => {
    renderBuilder();
    addPaymentOp();
    fireEvent.click(screen.getByRole('button', { name: /Review & Submit/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByRole('heading', { name: /Confirm Transaction/i })).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  // ── MAX_OPERATIONS guard ──────────────────────────────────────────────────
  it('enforces the 100-operation limit', () => {
    renderBuilder();
    for (let i = 0; i < 100; i++) addPaymentOp();
    // 101st add should trigger the error message
    addPaymentOp();
    expect(
      screen.getByText(/Maximum 100 operations per transaction reached/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Operations (100/100)')).toBeInTheDocument();
  });
});
