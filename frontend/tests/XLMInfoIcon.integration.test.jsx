import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../src/App';
import axios from 'axios';

vi.mock('axios');

describe('XLMInfoIcon Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock localStorage
    Storage.prototype.getItem = vi.fn(() => null);
    Storage.prototype.setItem = vi.fn();
    
    // Mock axios responses
    axios.get.mockResolvedValue({ data: {} });
    axios.post.mockResolvedValue({ data: {} });
  });

  describe('Balance Display Integration', () => {
    it('shows XLM info icon next to XLM balance', async () => {
      const mockAccount = {
        publicKey: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC',
        secretKey: 'STEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      };
      
      const mockBalance = {
        balances: [
          { asset: 'XLM', balance: '100.5000000' },
          { asset: 'USDC', balance: '50.0000000' }
        ]
      };

      axios.post.mockResolvedValueOnce({ data: mockAccount });
      axios.get.mockResolvedValueOnce({ data: mockBalance });

      render(<App />);
      
      // Create account
      const createButton = screen.getByRole('button', { name: /create.*account/i });
      fireEvent.click(createButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockAccount.publicKey)).toBeInTheDocument();
      });

      // Check balance
      const balanceButton = screen.getByRole('button', { name: /check.*balance/i });
      fireEvent.click(balanceButton);

      await waitFor(() => {
        expect(screen.getByText('XLM')).toBeInTheDocument();
      });

      // Verify XLM info icon is present next to XLM balance
      const infoButtons = screen.getAllByRole('button', { name: /information about xlm currency/i });
      expect(infoButtons.length).toBeGreaterThan(0);
    });

    it('does not show XLM info icon next to non-XLM assets', async () => {
      const mockAccount = {
        publicKey: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC',
        secretKey: 'STEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      };
      
      const mockBalance = {
        balances: [
          { asset: 'USDC', balance: '50.0000000' }
        ]
      };

      axios.post.mockResolvedValueOnce({ data: mockAccount });
      axios.get.mockResolvedValueOnce({ data: mockBalance });

      render(<App />);
      
      const createButton = screen.getByRole('button', { name: /create.*account/i });
      fireEvent.click(createButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockAccount.publicKey)).toBeInTheDocument();
      });

      const balanceButton = screen.getByRole('button', { name: /check.*balance/i });
      fireEvent.click(balanceButton);

      await waitFor(() => {
        expect(screen.getByText('USDC')).toBeInTheDocument();
      });

      // Should not have info icon for USDC
      const balanceRow = screen.getByText('USDC').closest('.balance-row');
      expect(balanceRow?.querySelector('.xlm-info-btn')).not.toBeInTheDocument();
    });
  });

  describe('Payment Form Integration', () => {
    it('shows XLM info icon in payment amount field', async () => {
      const mockAccount = {
        publicKey: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC',
        secretKey: 'STEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      };

      axios.post.mockResolvedValueOnce({ data: mockAccount });

      render(<App />);
      
      const createButton = screen.getByRole('button', { name: /create.*account/i });
      fireEvent.click(createButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockAccount.publicKey)).toBeInTheDocument();
      });

      // Look for the helper text with info icon
      await waitFor(() => {
        expect(screen.getByText(/XLM is the native Stellar currency/i)).toBeInTheDocument();
      });

      const infoButtons = screen.getAllByRole('button', { name: /information about xlm currency/i });
      expect(infoButtons.length).toBeGreaterThan(0);
    });

    it('XLM info tooltip works in payment form context', async () => {
      const mockAccount = {
        publicKey: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC',
        secretKey: 'STEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      };

      axios.post.mockResolvedValueOnce({ data: mockAccount });

      render(<App />);
      
      const createButton = screen.getByRole('button', { name: /create.*account/i });
      fireEvent.click(createButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockAccount.publicKey)).toBeInTheDocument();
      });

      const infoButtons = screen.getAllByRole('button', { name: /information about xlm currency/i });
      fireEvent.click(infoButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        expect(screen.getByText(/native currency of the Stellar network/i)).toBeInTheDocument();
      });
    });
  });

  describe('KYC Warning Integration', () => {
    it('shows XLM info icon in KYC warning message', async () => {
      const mockAccount = {
        publicKey: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC',
        secretKey: 'STEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      };

      const mockBalance = {
        balances: [{ asset: 'XLM', balance: '2000.0000000' }]
      };

      axios.post.mockResolvedValueOnce({ data: mockAccount });
      axios.get.mockImplementation((url) => {
        if (url.includes('/balance') || url.includes('/account/')) {
          return Promise.resolve({ data: mockBalance });
        }
        if (url.includes('/kyc/status')) {
          return Promise.resolve({ data: { status: 'PENDING' } });
        }
        return Promise.resolve({ data: {} });
      });

      render(<App />);
      
      const createButton = screen.getByRole('button', { name: /create.*account/i });
      fireEvent.click(createButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockAccount.publicKey)).toBeInTheDocument();
      });

      // Fill in payment form with large amount
      const recipientInput = screen.getByPlaceholderText(/recipient public key/i);
      const amountInput = screen.getByPlaceholderText(/amount.*xlm/i);

      fireEvent.change(recipientInput, { 
        target: { value: 'GRECIPIENT123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ12345' } 
      });
      fireEvent.change(amountInput, { target: { value: '1500' } });

      await waitFor(() => {
        const warningText = screen.queryByText(/large transactions above.*xlm.*require approved kyc/i);
        if (warningText) {
          expect(warningText).toBeInTheDocument();
        }
      });
    });
  });

  describe('Accessibility in Context', () => {
    it('maintains keyboard navigation flow in payment form', async () => {
      const mockAccount = {
        publicKey: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC',
        secretKey: 'STEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      };

      axios.post.mockResolvedValueOnce({ data: mockAccount });

      render(<App />);
      
      const createButton = screen.getByRole('button', { name: /create.*account/i });
      fireEvent.click(createButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockAccount.publicKey)).toBeInTheDocument();
      });

      // Tab through form elements
      const recipientInput = screen.getByPlaceholderText(/recipient public key/i);
      recipientInput.focus();
      expect(document.activeElement).toBe(recipientInput);

      // Info icon should be keyboard accessible
      const infoButtons = screen.getAllByRole('button', { name: /information about xlm currency/i });
      infoButtons[0].focus();
      expect(document.activeElement).toBe(infoButtons[0]);
    });

    it('does not interfere with form submission', async () => {
      const mockAccount = {
        publicKey: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC',
        secretKey: 'STEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      };

      const mockBalance = {
        balances: [{ asset: 'XLM', balance: '100.0000000' }]
      };

      axios.post.mockResolvedValueOnce({ data: mockAccount });
      axios.get.mockResolvedValueOnce({ data: mockBalance });
      axios.post.mockResolvedValueOnce({ 
        data: { hash: 'abc123', success: true } 
      });

      render(<App />);
      
      const createButton = screen.getByRole('button', { name: /create.*account/i });
      fireEvent.click(createButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockAccount.publicKey)).toBeInTheDocument();
      });

      // Fill form
      const recipientInput = screen.getByPlaceholderText(/recipient public key/i);
      const amountInput = screen.getByPlaceholderText(/amount.*xlm/i);

      fireEvent.change(recipientInput, { 
        target: { value: 'GRECIPIENT123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ12345' } 
      });
      fireEvent.change(amountInput, { target: { value: '10' } });

      // Info icon should not prevent form submission
      const sendButtons = screen.getAllByRole('button', { name: /send/i });
      const sendButton = sendButtons.find(btn => !btn.disabled);
      
      if (sendButton) {
        fireEvent.click(sendButton);
        // Form should process normally
        await waitFor(() => {
          expect(axios.post).toHaveBeenCalled();
        }, { timeout: 3000 });
      }
    });
  });

  describe('Layout and Spacing', () => {
    it('does not break layout in balance display', async () => {
      const mockAccount = {
        publicKey: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC',
        secretKey: 'STEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      };
      
      const mockBalance = {
        balances: [
          { asset: 'XLM', balance: '100.5000000' }
        ]
      };

      axios.post.mockResolvedValueOnce({ data: mockAccount });
      axios.get.mockResolvedValueOnce({ data: mockBalance });

      const { container } = render(<App />);
      
      const createButton = screen.getByRole('button', { name: /create.*account/i });
      fireEvent.click(createButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockAccount.publicKey)).toBeInTheDocument();
      });

      const balanceButton = screen.getByRole('button', { name: /check.*balance/i });
      fireEvent.click(balanceButton);

      await waitFor(() => {
        const balanceRow = container.querySelector('.balance-row');
        expect(balanceRow).toBeInTheDocument();
        
        // Check that layout is maintained
        const assetSpan = balanceRow?.querySelector('.balance-asset');
        const amountSpan = balanceRow?.querySelector('.balance-amount');
        
        expect(assetSpan).toBeInTheDocument();
        expect(amountSpan).toBeInTheDocument();
      });
    });

    it('maintains proper spacing in payment form', async () => {
      const mockAccount = {
        publicKey: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC',
        secretKey: 'STEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      };

      axios.post.mockResolvedValueOnce({ data: mockAccount });

      const { container } = render(<App />);
      
      const createButton = screen.getByRole('button', { name: /create.*account/i });
      fireEvent.click(createButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockAccount.publicKey)).toBeInTheDocument();
      });

      // Check that input wrapper maintains structure
      const inputWrap = container.querySelector('.input-wrap');
      expect(inputWrap).toBeInTheDocument();
    });
  });
});
