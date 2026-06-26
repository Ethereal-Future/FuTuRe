import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMerge } from './AccountMerge.jsx';
import apiClient from '../api/client.js';

vi.mock('../api/client.js');

describe('Issue #562: Account Merge Safety Flow', () => {
  const sourceSecret = 'SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const destinationKey = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN';
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render step 1: warning by default', () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.getByText(/Step 1\/4/i)).toBeInTheDocument();
    expect(screen.getByText(/CRITICAL WARNING/i)).toBeInTheDocument();
    expect(screen.getByText(/This action is IRREVERSIBLE/i)).toBeInTheDocument();
  });

  it('should show all warning points', () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.getByText(/All funds will be transferred/i)).toBeInTheDocument();
    expect(screen.getByText(/permanently closed/i)).toBeInTheDocument();
    expect(screen.getByText(/lose access forever/i)).toBeInTheDocument();
    expect(screen.getByText(/CANNOT be undone/i)).toBeInTheDocument();
  });

  it('should display XLM amount if provided', () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
        xlmAmount="1000"
      />
    );

    expect(screen.getByText(/Total XLM to transfer: 1000/i)).toBeInTheDocument();
  });

  it('should move to step 2 on continue from step 1', async () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    const continueBtn = screen.getByRole('button', { name: /Continue/i });
    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(screen.getByText(/Step 2\/4/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/i)).toBeInTheDocument();
    });
  });

  it('should validate destination key on step 2', async () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Move to step 2
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    await waitFor(() => expect(screen.getByText(/Step 2\/4/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/i);
    
    // Invalid key
    await userEvent.type(input, 'invalid');
    expect(screen.getByText(/Invalid Stellar public key format/i)).toBeInTheDocument();

    // Valid key
    await userEvent.clear(input);
    await userEvent.type(input, destinationKey);
    expect(screen.getByText(/✓ Valid public key/i)).toBeInTheDocument();
  });

  it('should move to step 3 after entering valid destination', async () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Step 1 -> Step 2
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 2\/4/i)).toBeInTheDocument());

    // Enter destination
    const destInput = screen.getByPlaceholderText(/GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/i);
    await userEvent.type(destInput, destinationKey);

    // Step 2 -> Step 3
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 3\/4/i)).toBeInTheDocument());
  });

  it('should require MERGE text on step 3', async () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Navigate to step 3
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 2\/4/i)).toBeInTheDocument());

    const destInput = screen.getByPlaceholderText(/GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/i);
    await userEvent.type(destInput, destinationKey);

    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 3\/4/i)).toBeInTheDocument());

    const mergeInput = screen.getByPlaceholderText(/MERGE/i);
    
    // Type wrong text
    await userEvent.type(mergeInput, 'merge');
    expect(screen.getByText(/Must type exactly "MERGE"/i)).toBeInTheDocument();

    // Type correct text
    await userEvent.clear(mergeInput);
    await userEvent.type(mergeInput, 'MERGE');
    expect(screen.queryByText(/Must type exactly "MERGE"/i)).not.toBeInTheDocument();
  });

  it('should move to step 4 (password) after MERGE confirmation', async () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Navigate through steps
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 2\/4/i)).toBeInTheDocument());

    const destInput = screen.getByPlaceholderText(/GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/i);
    await userEvent.type(destInput, destinationKey);

    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 3\/4/i)).toBeInTheDocument());

    const mergeInput = screen.getByPlaceholderText(/MERGE/i);
    await userEvent.type(mergeInput, 'MERGE');

    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 4\/4/i)).toBeInTheDocument());
    expect(screen.getByText(/re-enter your password/i)).toBeInTheDocument();
  });

  it('should call API on final merge with password', async () => {
    apiClient.post.mockResolvedValue({ data: { success: true } });

    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Navigate to step 4
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 2\/4/i)).toBeInTheDocument());

    await userEvent.type(
      screen.getByPlaceholderText(/GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/i),
      destinationKey
    );

    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 3\/4/i)).toBeInTheDocument());

    await userEvent.type(screen.getByPlaceholderText(/MERGE/i), 'MERGE');

    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 4\/4/i)).toBeInTheDocument());

    // Enter password and submit
    await userEvent.type(screen.getByPlaceholderText(/Enter your password/i), 'mypassword');
    fireEvent.click(screen.getByRole('button', { name: /MERGE ACCOUNT/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/stellar/account/merge',
        expect.objectContaining({
          sourceSecret,
          destination: destinationKey,
          password: 'mypassword',
        })
      );
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('should allow going back between steps', async () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Step 1 -> 2
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 2\/4/i)).toBeInTheDocument());

    // Step 2 -> 1
    fireEvent.click(screen.getByRole('button', { name: /← Back/i }));
    await waitFor(() => expect(screen.getByText(/Step 1\/4/i)).toBeInTheDocument());
  });

  it('should call onClose when cancel is clicked', async () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should disable continue buttons when validation fails', async () => {
    render(
      <AccountMerge
        sourceSecret={sourceSecret}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Step 2\/4/i)).toBeInTheDocument());

    const continueBtn = screen.getByRole('button', { name: /Continue/i });
    expect(continueBtn).toBeDisabled();

    const destInput = screen.getByPlaceholderText(/GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/i);
    await userEvent.type(destInput, destinationKey);

    expect(continueBtn).not.toBeDisabled();
  });
});
