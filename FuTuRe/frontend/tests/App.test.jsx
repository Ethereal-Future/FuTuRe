import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../src/App';

describe('App Component', () => {
  it('renders the platform title', () => {
    render(<App />);
    const linkElement = screen.getByText(/Stellar Remittance Platform/i);
    expect(linkElement).toBeInTheDocument();
  });

  it('renders the Create Account button', () => {
    render(<App />);
    const buttonElement = screen.getByRole('button', { name: /Create Account/i });
    expect(buttonElement).toBeInTheDocument();
  });
});
