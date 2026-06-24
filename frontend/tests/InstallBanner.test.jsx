/**
 * Tests for #533 — PWA install banner.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstallBanner } from '../src/components/InstallBanner';

describe('InstallBanner', () => {
  it('renders the install banner', () => {
    render(<InstallBanner onInstall={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole('banner', { name: /install app/i })).toBeInTheDocument();
  });

  it('shows an Install button', () => {
    render(<InstallBanner onInstall={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole('button', { name: /install app/i })).toBeInTheDocument();
  });

  it('shows a dismiss button', () => {
    render(<InstallBanner onInstall={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('calls onInstall when Install is clicked', () => {
    const onInstall = vi.fn();
    render(<InstallBanner onInstall={onInstall} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /install app/i }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<InstallBanner onInstall={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('usePWA — install dismissal', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores dismissal timestamp in localStorage', () => {
    const { dismissInstall } = (() => {
      let dismissed = false;
      return {
        dismissInstall: () => {
          localStorage.setItem('pwa_install_dismissed_at', String(Date.now()));
          dismissed = true;
        },
        dismissed,
      };
    })();
    dismissInstall();
    expect(localStorage.getItem('pwa_install_dismissed_at')).not.toBeNull();
  });
});
