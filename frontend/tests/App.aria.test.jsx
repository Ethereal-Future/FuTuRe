import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../src/App';

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

// Mock hooks
vi.mock('../src/hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(() => 'connected'),
}));

vi.mock('../src/hooks/useNetworkStatus', () => ({
  useNetworkStatus: vi.fn(() => ({ status: 'online' })),
}));

vi.mock('../src/hooks/usePWA', () => ({
  usePWA: vi.fn(() => ({
    canInstall: false,
    install: vi.fn(),
    updateAvailable: false,
    applyUpdate: vi.fn(),
  })),
}));

vi.mock('../src/hooks/useOfflineQueue', () => ({
  useOfflineQueue: vi.fn(() => ({
    queue: vi.fn(),
    pendingCount: 0,
  })),
}));

vi.mock('../src/contexts/ThemeContext', () => ({
  useTheme: vi.fn(() => ({
    theme: 'light',
    isDark: false,
    toggleTheme: vi.fn(),
  })),
}));

describe('App - Issue #931: ARIA attributes for recipient and amount fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set aria-invalid on recipient field when invalid', async () => {
    render(<App />);

    // Create an account first to access send payment section
    const createButton = screen.getByRole('button', { name: /create account/i });
    
    // Mock successful account creation
    const axios = await import('axios');
    axios.default.post.mockResolvedValueOnce({
      data: {
        publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        secretKey: 'SXXX...',
      },
    });

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByLabelText(/recipient public key/i)).toBeInTheDocument();
    });

    const recipientInput = screen.getByLabelText(/recipient public key/i);

    // Type an invalid address
    fireEvent.change(recipientInput, { target: { value: 'INVALID_ADDRESS' } });

    // Check ARIA attributes
    expect(recipientInput).toHaveAttribute('aria-invalid', 'true');
    expect(recipientInput).toHaveAttribute('aria-describedby', 'recipient-error');
  });

  it('should link error message to recipient field via aria-describedby', async () => {
    render(<App />);

    // Create account
    const createButton = screen.getByRole('button', { name: /create account/i });
    const axios = await import('axios');
    axios.default.post.mockResolvedValueOnce({
      data: {
        publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        secretKey: 'SXXX...',
      },
    });

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByLabelText(/recipient public key/i)).toBeInTheDocument();
    });

    const recipientInput = screen.getByLabelText(/recipient public key/i);

    // Type an invalid address
    fireEvent.change(recipientInput, { target: { value: 'BAD' } });

    // Error message should have role="alert" and id="recipient-error"
    const errorElement = screen.getByRole('alert');
    expect(errorElement).toHaveAttribute('id', 'recipient-error');
    expect(errorElement).toHaveTextContent(/invalid stellar address format/i);

    // Input should reference this error
    expect(recipientInput).toHaveAttribute('aria-describedby', 'recipient-error');
  });

  it('should set aria-invalid on amount field when invalid', async () => {
    render(<App />);

    // Create account
    const createButton = screen.getByRole('button', { name: /create account/i });
    const axios = await import('axios');
    axios.default.post.mockResolvedValueOnce({
      data: {
        publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        secretKey: 'SXXX...',
      },
    });

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByLabelText(/payment amount in xlm/i)).toBeInTheDocument();
    });

    const amountInput = screen.getByLabelText(/payment amount in xlm/i);

    // Type an invalid amount (negative)
    fireEvent.change(amountInput, { target: { value: '-10' } });

    // Check ARIA attributes
    expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    expect(amountInput).toHaveAttribute('aria-describedby', 'amount-error');
  });

  it('should announce amount errors with role="alert"', async () => {
    render(<App />);

    // Create account
    const createButton = screen.getByRole('button', { name: /create account/i });
    const axios = await import('axios');
    axios.default.post.mockResolvedValueOnce({
      data: {
        publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        secretKey: 'SXXX...',
      },
    });

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByLabelText(/payment amount in xlm/i)).toBeInTheDocument();
    });

    const amountInput = screen.getByLabelText(/payment amount in xlm/i);

    // Type an invalid amount
    fireEvent.change(amountInput, { target: { value: 'abc' } });

    // Error should be announced
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some(alert => alert.id === 'amount-error')).toBe(true);
    });
  });

  it('should not have aria-invalid when fields are valid', async () => {
    render(<App />);

    // Create account
    const createButton = screen.getByRole('button', { name: /create account/i });
    const axios = await import('axios');
    axios.default.post.mockResolvedValueOnce({
      data: {
        publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        secretKey: 'SXXX...',
      },
    });

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByLabelText(/recipient public key/i)).toBeInTheDocument();
    });

    const recipientInput = screen.getByLabelText(/recipient public key/i);
    const amountInput = screen.getByLabelText(/payment amount in xlm/i);

    // Type valid values
    fireEvent.change(recipientInput, { 
      target: { value: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' } 
    });
    fireEvent.change(amountInput, { target: { value: '10' } });

    // Neither should have aria-invalid="true"
    expect(recipientInput).toHaveAttribute('aria-invalid', 'false');
    expect(amountInput).toHaveAttribute('aria-invalid', 'false');

    // No aria-describedby when valid
    expect(recipientInput).not.toHaveAttribute('aria-describedby');
    expect(amountInput).not.toHaveAttribute('aria-describedby');
  });
});
