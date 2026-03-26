import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { NetworkBadge } from '../src/components/NetworkBadge';

const onlineTestnet = {
  network: 'testnet',
  online: true,
  horizonUrl: 'https://horizon-testnet.stellar.org',
  horizonVersion: '2.28.0',
  currentProtocolVersion: 21,
};

const offlineMainnet = {
  network: 'mainnet',
  online: false,
  horizonUrl: 'https://horizon.stellar.org',
};

describe('NetworkBadge', () => {
  it('renders nothing when status is null', () => {
    const { container } = render(<NetworkBadge status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the network name', () => {
    render(<NetworkBadge status={onlineTestnet} />);
    expect(screen.getByText(/Testnet/i)).toBeInTheDocument();
  });

  it('shows Mainnet label for mainnet status', () => {
    render(<NetworkBadge status={offlineMainnet} />);
    expect(screen.getByText(/Mainnet/i)).toBeInTheDocument();
  });

  it('shows offline warning indicator when offline', () => {
    render(<NetworkBadge status={offlineMainnet} />);
    expect(screen.getByText(/⚠/)).toBeInTheDocument();
  });

  it('expands the detail panel on click', () => {
    render(<NetworkBadge status={onlineTestnet} />);
    fireEvent.click(screen.getByRole('button', { name: /Network status/i }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText(/horizon-testnet\.stellar\.org/i)).toBeInTheDocument();
  });

  it('collapses the panel on second click', () => {
    render(<NetworkBadge status={onlineTestnet} />);
    const btn = screen.getByRole('button', { name: /Network status/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('sets aria-expanded correctly', () => {
    render(<NetworkBadge status={onlineTestnet} />);
    const btn = screen.getByRole('button', { name: /Network status/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows testnet warning in expanded panel', () => {
    render(<NetworkBadge status={onlineTestnet} />);
    fireEvent.click(screen.getByRole('button', { name: /Network status/i }));
    expect(screen.getByText(/funds have no real value/i)).toBeInTheDocument();
  });

  it('shows online status in expanded panel', () => {
    render(<NetworkBadge status={onlineTestnet} />);
    fireEvent.click(screen.getByRole('button', { name: /Network status/i }));
    expect(screen.getByText(/✅ Online/i)).toBeInTheDocument();
  });

  it('shows offline status in expanded panel', () => {
    render(<NetworkBadge status={offlineMainnet} />);
    fireEvent.click(screen.getByRole('button', { name: /Network status/i }));
    expect(screen.getByText(/❌ Offline/i)).toBeInTheDocument();
  });
});
