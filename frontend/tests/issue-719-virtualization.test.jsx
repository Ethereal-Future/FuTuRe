import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransactionHistory } from '../src/components/TransactionHistory';

// Mock apiClient
vi.mock('../src/api/client.js', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Mock react-query
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useInfiniteQuery: vi.fn(),
}));

describe('#719 - Transaction List Virtualization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render plain list for <50 transactions without virtualization', () => {
    const smallTxs = Array.from({ length: 30 }, (_, i) => ({
      id: `tx-${i}`,
      hash: `hash-${i}`,
      type: 'payment',
      direction: 'sent',
      amount: '100',
      asset: 'XLM',
      date: new Date().toISOString(),
      successful: true,
    }));

    const { container } = render(
      <TransactionHistory publicKey="GTEST123" transactions={smallTxs} />
    );

    // Should render plain ul list instead of virtualized
    expect(container.querySelector('ul.tx-list')).toBeTruthy();
  });

  it('should use VirtualList for >=50 transactions', () => {
    const largeTxs = Array.from({ length: 100 }, (_, i) => ({
      id: `tx-${i}`,
      hash: `hash-${i}`,
      type: 'payment',
      direction: i % 2 === 0 ? 'sent' : 'received',
      amount: String(Math.random() * 1000),
      asset: 'XLM',
      date: new Date(Date.now() - i * 60000).toISOString(),
      successful: true,
    }));

    const { container } = render(
      <TransactionHistory publicKey="GTEST123" transactions={largeTxs} />
    );

    // Should use virtualized container (has overflowY: auto from VirtualList)
    const virtualContainer = container.querySelector('[style*="overflowY"]');
    expect(virtualContainer).toBeTruthy();
  });

  it('should render only visible rows in virtualized list', () => {
    const largeTxs = Array.from({ length: 200 }, (_, i) => ({
      id: `tx-${i}`,
      hash: `hash-${i}`,
      type: 'payment',
      direction: 'sent',
      amount: '100',
      asset: 'XLM',
      date: new Date().toISOString(),
      successful: true,
    }));

    const { container } = render(
      <TransactionHistory publicKey="GTEST123" transactions={largeTxs} />
    );

    // Calculate expected visible rows: container height ~480px, each row ~64px
    // So roughly 7-8 rows visible + overscan buffer (default 5)
    const renderedRows = container.querySelectorAll('[data-index]');
    expect(renderedRows.length).toBeLessThan(50);
    expect(renderedRows.length).toBeGreaterThan(0);
  });

  it('should maintain accessibility with keyboard navigation', () => {
    const largeTxs = Array.from({ length: 100 }, (_, i) => ({
      id: `tx-${i}`,
      hash: `hash-${i}`,
      type: 'payment',
      direction: 'sent',
      amount: '100',
      asset: 'XLM',
      date: new Date().toISOString(),
      successful: true,
    }));

    const { container } = render(
      <TransactionHistory publicKey="GTEST123" transactions={largeTxs} />
    );

    // Each row should have role=button for keyboard accessibility
    const buttons = container.querySelectorAll('[role="button"]');
    expect(buttons.length).toBeGreaterThan(0);
    
    // Buttons should be keyboard accessible
    buttons.forEach((btn) => {
      expect(btn.getAttribute('tabIndex')).toBe('0');
    });
  });

  it('should reduce DOM size significantly with virtualization', () => {
    const largeTxs = Array.from({ length: 1000 }, (_, i) => ({
      id: `tx-${i}`,
      hash: `hash-${i}`,
      type: 'payment',
      direction: 'sent',
      amount: '100',
      asset: 'XLM',
      date: new Date().toISOString(),
      successful: true,
    }));

    const { container } = render(
      <TransactionHistory publicKey="GTEST123" transactions={largeTxs} />
    );

    // With 1000 transactions but virtualization:
    // Should render ~15-20 rows max (7-8 visible + 5 overscan on each side)
    // instead of 1000 DOM nodes
    const renderedRows = container.querySelectorAll('[data-index]');
    expect(renderedRows.length).toBeLessThan(100);
    // Ensure at least some are rendered
    expect(renderedRows.length).toBeGreaterThan(5);
  });
});
