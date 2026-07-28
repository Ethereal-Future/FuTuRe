import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddressBook } from '../src/components/AddressBook';

describe('AddressBook - Accessibility & Validation Fixes', () => {
  describe('Issue #933: Stellar address validation', () => {
    it('should validate Stellar address format when adding a contact', () => {
      const onSelect = vi.fn();
      render(<AddressBook onSelect={onSelect} contacts={[]} />);

      // Open address book
      const toggleButton = screen.getByRole('button', { name: /address book/i });
      fireEvent.click(toggleButton);

      // Fill in name
      const nameInput = screen.getByPlaceholderText('Name');
      fireEvent.change(nameInput, { target: { value: 'Test User' } });

      // Fill in invalid address
      const addressInput = screen.getByPlaceholderText('Stellar Address');
      fireEvent.change(addressInput, { target: { value: 'INVALID_ADDRESS' } });
      fireEvent.blur(addressInput);

      // Error message should appear
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid stellar address format/i);

      // Add button should be disabled
      const addButton = screen.getByRole('button', { name: /add contact/i });
      expect(addButton).toBeDisabled();
    });

    it('should accept valid Stellar address', () => {
      const onSelect = vi.fn();
      render(<AddressBook onSelect={onSelect} contacts={[]} />);

      // Open address book
      const toggleButton = screen.getByRole('button', { name: /address book/i });
      fireEvent.click(toggleButton);

      // Fill in name
      const nameInput = screen.getByPlaceholderText('Name');
      fireEvent.change(nameInput, { target: { value: 'Valid User' } });

      // Fill in valid address (56 chars starting with G)
      const validAddress = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      const addressInput = screen.getByPlaceholderText('Stellar Address');
      fireEvent.change(addressInput, { target: { value: validAddress } });

      // Add button should be enabled
      const addButton = screen.getByRole('button', { name: /add contact/i });
      expect(addButton).not.toBeDisabled();

      // Should be able to add contact
      fireEvent.click(addButton);

      // Contact should appear in list
      expect(screen.getByText('Valid User')).toBeInTheDocument();
      expect(screen.getByText(validAddress)).toBeInTheDocument();
    });

    it('should show validation feedback with proper ARIA attributes', () => {
      const onSelect = vi.fn();
      render(<AddressBook onSelect={onSelect} contacts={[]} />);

      // Open address book
      fireEvent.click(screen.getByRole('button', { name: /address book/i }));

      const addressInput = screen.getByPlaceholderText('Stellar Address');

      // Type invalid address
      fireEvent.change(addressInput, { target: { value: 'INVALID' } });
      fireEvent.blur(addressInput);

      // Check ARIA attributes
      expect(addressInput).toHaveAttribute('aria-invalid', 'true');
      expect(addressInput).toHaveAttribute('aria-describedby', 'address-error');

      // Error message should have proper ID and role
      const errorMessage = screen.getByRole('alert');
      expect(errorMessage).toHaveAttribute('id', 'address-error');
    });
  });

  describe('Issue #932: Contact removal confirmation', () => {
    const mockContact = {
      id: 1,
      name: 'Test Contact',
      address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
    };

    it('should require confirmation before deleting a contact', () => {
      const onSelect = vi.fn();
      render(<AddressBook onSelect={onSelect} contacts={[mockContact]} />);

      // Open address book
      fireEvent.click(screen.getByRole('button', { name: /address book/i }));

      // First click on remove button should show confirm/cancel
      const removeButton = screen.getByRole('button', { name: /remove test contact/i });
      fireEvent.click(removeButton);

      // Confirm and Cancel buttons should appear
      expect(screen.getByRole('button', { name: /confirm removal/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel removal/i })).toBeInTheDocument();

      // Contact should still be in list
      expect(screen.getByText('Test Contact')).toBeInTheDocument();
    });

    it('should delete contact only after confirmation', () => {
      const onSelect = vi.fn();
      render(<AddressBook onSelect={onSelect} contacts={[mockContact]} />);

      // Open address book
      fireEvent.click(screen.getByRole('button', { name: /address book/i }));

      // Click remove
      const removeButton = screen.getByRole('button', { name: /remove test contact/i });
      fireEvent.click(removeButton);

      // Click confirm
      const confirmButton = screen.getByRole('button', { name: /confirm removal/i });
      fireEvent.click(confirmButton);

      // Contact should be removed
      expect(screen.queryByText('Test Contact')).not.toBeInTheDocument();
    });

    it('should cancel removal when cancel button is clicked', () => {
      const onSelect = vi.fn();
      render(<AddressBook onSelect={onSelect} contacts={[mockContact]} />);

      // Open address book
      fireEvent.click(screen.getByRole('button', { name: /address book/i }));

      // Click remove
      const removeButton = screen.getByRole('button', { name: /remove test contact/i });
      fireEvent.click(removeButton);

      // Click cancel
      const cancelButton = screen.getByRole('button', { name: /cancel removal/i });
      fireEvent.click(cancelButton);

      // Contact should still be in list
      expect(screen.getByText('Test Contact')).toBeInTheDocument();

      // Remove button should be back (not confirm/cancel)
      expect(screen.getByRole('button', { name: /remove test contact/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /confirm removal/i })).not.toBeInTheDocument();
    });
  });
});
