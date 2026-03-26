/**
 * App component — integration-style component tests
 * Covers rendering, user interactions, state changes, API calls, and error handling.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../src/App';
import {
  mockAccount,
  mockBalance,
  mockPaymentResult,
  mockRecipient,
  mockNetworkStatus,
} from './helpers/testUtils';

// ── Mock axios ────────────────────────────────────────────────────────────────
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// ── Mock hooks that open real network connections ─────────────────────────────
vi.mock('../src/hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(() => 'disconnected'),
}));

vi.mock('../src/hooks/useNetworkStatus', () => ({
  useNetworkStatus: vi.fn(() => ({ status: mockNetworkStatus, refresh: vi.fn() })),
}));

// ── Mock QRCode canvas (not available in jsdom) ───────────────────────────────
vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn(() => Promise.resolve()) },
}));

import axios from 'axios';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('App — initial render', () => {
  it('renders the platform title', () => {
    render(<App />);
    expect(screen.getByText(/Stellar Remittance Platform/i)).toBeInTheDocument();
  });

  it('renders the Create Account button', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /Create Account/i })).toBeInTheDocument();
  });

  it('does not show balance or payment sections before account creation', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: /Check Balance/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Recipient Public Key/i)).not.toBeInTheDocument();
  });

  it('shows the network badge', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /Network status/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('App — account creation', () => {
  it('calls POST /api/stellar/account/create on button click', async () => {
    axios.post.mockResolvedValueOnce({ data: mockAccount });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));

    await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/stellar/account/create'));
  });

  it('displays public and secret key after successful creation', async () => {
    axios.post.mockResolvedValueOnce({ data: mockAccount });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));

    await waitFor(() => {
      expect(screen.getByText(mockAccount.publicKey)).toBeInTheDocument();
      expect(screen.getByText(mockAccount.secretKey)).toBeInTheDocument();
    });
  });

  it('shows success status message after account creation', async () => {
    axios.post.mockResolvedValueOnce({ data: mockAccount });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));

    await waitFor(() =>
      expect(screen.getByText(/Account created/i)).toBeInTheDocument()
    );
  });

  it('reveals Check Balance and Send Payment sections after creation', async () => {
    axios.post.mockResolvedValueOnce({ data: mockAccount });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Check Balance/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Recipient Public Key/i)).toBeInTheDocument();
    });
  });

  it('shows error message when account creation fails', async () => {
    axios.post.mockRejectedValueOnce(new Error('Network error'));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );
  });

  it('disables Create Account button while loading', async () => {
    // Never resolves — keeps loading state active
    axios.post.mockReturnValueOnce(new Promise(() => {}));

    render(<App />);
    const btn = screen.getByRole('button', { name: /Create Account/i });
    fireEvent.click(btn);

    expect(btn).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('App — balance retrieval', () => {
  async function renderWithAccount() {
    axios.post.mockResolvedValueOnce({ data: mockAccount });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
    await waitFor(() => screen.getByRole('button', { name: /Check Balance/i }));
  }

  it('calls GET /api/stellar/account/:publicKey on Check Balance click', async () => {
    await renderWithAccount();
    axios.get.mockResolvedValueOnce({ data: mockBalance });

    fireEvent.click(screen.getByRole('button', { name: /Check Balance/i }));

    await waitFor(() =>
      expect(axios.get).toHaveBeenCalledWith(`/api/stellar/account/${mockAccount.publicKey}`)
    );
  });

  it('displays XLM balance after successful fetch', async () => {
    await renderWithAccount();
    axios.get.mockResolvedValueOnce({ data: mockBalance });

    fireEvent.click(screen.getByRole('button', { name: /Check Balance/i }));

    await waitFor(() =>
      expect(screen.getByText(/XLM: 9999\.0000000/i)).toBeInTheDocument()
    );
  });

  it('shows error alert when balance fetch fails', async () => {
    await renderWithAccount();
    axios.get.mockRejectedValueOnce({ message: 'Network error' });

    fireEvent.click(screen.getByRole('button', { name: /Check Balance/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('App — send payment form interactions', () => {
  async function renderWithAccountAndBalance() {
    axios.post.mockResolvedValueOnce({ data: mockAccount });
    axios.get.mockResolvedValue({ data: mockBalance });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
    await waitFor(() => screen.getByPlaceholderText(/Recipient Public Key/i));
  }

  it('shows validation error for invalid recipient address', async () => {
    await renderWithAccountAndBalance();

    fireEvent.change(screen.getByPlaceholderText(/Recipient Public Key/i), {
      target: { value: 'invalid-key' },
    });

    await waitFor(() =>
      expect(screen.getByText(/Invalid Stellar address format/i)).toBeInTheDocument()
    );
  });

  it('shows ✅ icon for a valid recipient address', async () => {
    await renderWithAccountAndBalance();

    fireEvent.change(screen.getByPlaceholderText(/Recipient Public Key/i), {
      target: { value: mockRecipient },
    });

    await waitFor(() => {
      const icons = screen.getAllByText('✅');
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  it('shows ❌ icon for an invalid recipient address', async () => {
    await renderWithAccountAndBalance();

    fireEvent.change(screen.getByPlaceholderText(/Recipient Public Key/i), {
      target: { value: 'bad' },
    });

    await waitFor(() => {
      const icons = screen.getAllByText('❌');
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  it('shows validation error for zero amount', async () => {
    await renderWithAccountAndBalance();

    fireEvent.change(screen.getByPlaceholderText(/Amount/i), {
      target: { value: '0' },
    });

    await waitFor(() =>
      expect(screen.getByText(/Amount must be a positive number/i)).toBeInTheDocument()
    );
  });

  it('keeps Send button disabled with invalid inputs', async () => {
    await renderWithAccountAndBalance();

    const sendBtn = screen.getByRole('button', { name: /^Send/i });
    expect(sendBtn).toBeDisabled();
  });

  it('enables Send button when both recipient and amount are valid', async () => {
    await renderWithAccountAndBalance();

    fireEvent.change(screen.getByPlaceholderText(/Recipient Public Key/i), {
      target: { value: mockRecipient },
    });
    fireEvent.change(screen.getByPlaceholderText(/Amount/i), {
      target: { value: '10' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Send/i })).not.toBeDisabled()
    );
  });

  it('calls POST /api/stellar/payment/send with correct payload', async () => {
    await renderWithAccountAndBalance();
    axios.post.mockResolvedValueOnce({ data: mockPaymentResult });

    fireEvent.change(screen.getByPlaceholderText(/Recipient Public Key/i), {
      target: { value: mockRecipient },
    });
    fireEvent.change(screen.getByPlaceholderText(/Amount/i), {
      target: { value: '10' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Send/i })).not.toBeDisabled()
    );

    fireEvent.click(screen.getByRole('button', { name: /^Send/i }));

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith('/api/stellar/payment/send', {
        sourceSecret: mockAccount.secretKey,
        destination: mockRecipient,
        amount: '10',
        assetCode: 'XLM',
      })
    );
  });

  it('shows success message with tx hash after payment', async () => {
    await renderWithAccountAndBalance();
    axios.post.mockResolvedValueOnce({ data: mockPaymentResult });

    fireEvent.change(screen.getByPlaceholderText(/Recipient Public Key/i), {
      target: { value: mockRecipient },
    });
    fireEvent.change(screen.getByPlaceholderText(/Amount/i), {
      target: { value: '10' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Send/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /^Send/i }));

    await waitFor(() =>
      expect(screen.getByText(/Payment sent/i)).toBeInTheDocument()
    );
  });

  it('shows error alert when payment fails', async () => {
    await renderWithAccountAndBalance();
    axios.post.mockRejectedValueOnce({ message: 'insufficient balance' });

    fireEvent.change(screen.getByPlaceholderText(/Recipient Public Key/i), {
      target: { value: mockRecipient },
    });
    fireEvent.change(screen.getByPlaceholderText(/Amount/i), {
      target: { value: '10' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Send/i })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /^Send/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('App — QR code modal', () => {
  it('opens QR modal when Show QR Code is clicked', async () => {
    axios.post.mockResolvedValueOnce({ data: mockAccount });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));

    await waitFor(() => screen.getByRole('button', { name: /Show QR Code/i }));
    fireEvent.click(screen.getByRole('button', { name: /Show QR Code/i }));

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /QR Code/i })).toBeInTheDocument()
    );
  });

  it('closes QR modal when close button is clicked', async () => {
    axios.post.mockResolvedValueOnce({ data: mockAccount });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));

    await waitFor(() => screen.getByRole('button', { name: /Show QR Code/i }));
    fireEvent.click(screen.getByRole('button', { name: /Show QR Code/i }));

    await waitFor(() => screen.getByRole('button', { name: /Close/i }));
    fireEvent.click(screen.getByRole('button', { name: /Close/i }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /QR Code/i })).not.toBeInTheDocument()
    );
  });
});
