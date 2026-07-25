import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDebounce } from '../src/hooks/useDebounce';

describe('useDebounce hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('test', 300));
    expect(result.current).toBe('test');
  });

  it('debounces rapid value changes - only one update after delay', () => {
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: '', delay: 300 },
    });

    // Simulate 10 rapid updates
    for (let i = 0; i < 10; i++) {
      act(() => {
        rerender({ value: `char${i}`, delay: 300 });
      });
    }

    // Before delay, should still have old value
    expect(result.current).toBe('');

    // After delay, should have latest value only
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe('char9');
  });

  it('cancels previous debounce timeout on new value', () => {
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: 'first', delay: 300 },
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('first');

    // Change value midway through debounce
    act(() => {
      rerender({ value: 'second', delay: 300 });
    });
    expect(result.current).toBe('first'); // Still old value

    act(() => {
      vi.advanceTimersByTime(150); // Halfway through new debounce
    });
    expect(result.current).toBe('first'); // Still not updated

    act(() => {
      vi.advanceTimersByTime(150); // Complete second debounce
    });
    expect(result.current).toBe('second'); // Now updated
  });

  it('respects custom delay value', () => {
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: 'test', delay: 500 },
    });

    act(() => {
      rerender({ value: 'updated', delay: 500 });
    });

    // 300ms should not be enough for 500ms delay
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('test');

    // Full 500ms should trigger update
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('updated');
  });

  it('handles clearing value correctly', () => {
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: 'hello', delay: 300 },
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('hello');

    act(() => {
      rerender({ value: '', delay: 300 });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('');
  });

  it('works with numeric values', () => {
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: 0, delay: 300 },
    });

    act(() => {
      rerender({ value: 42, delay: 300 });
    });

    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(42);
  });

  it('works with object values', () => {
    const obj1 = { id: 1 };
    const obj2 = { id: 2 };

    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: obj1, delay: 300 },
    });

    act(() => {
      rerender({ value: obj2, delay: 300 });
    });

    expect(result.current).toBe(obj1);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(obj2);
  });
});
