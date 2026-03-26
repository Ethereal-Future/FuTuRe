import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useMessages } from '../src/hooks/useMessages';

describe('useMessages hook', () => {
  it('starts with empty messages and history', () => {
    const { result } = renderHook(() => useMessages());
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.history).toHaveLength(0);
  });

  it('adds a success message', () => {
    const { result } = renderHook(() => useMessages());
    act(() => { result.current.success('Done!'); });
    expect(result.current.messages[0].message).toBe('Done!');
    expect(result.current.messages[0].type).toBe('success');
  });

  it('adds an error message', () => {
    const { result } = renderHook(() => useMessages());
    act(() => { result.current.error('Oops'); });
    expect(result.current.messages[0].type).toBe('error');
  });

  it('adds an info message', () => {
    const { result } = renderHook(() => useMessages());
    act(() => { result.current.info('FYI'); });
    expect(result.current.messages[0].type).toBe('info');
  });

  it('adds a warning message', () => {
    const { result } = renderHook(() => useMessages());
    act(() => { result.current.warning('Careful'); });
    expect(result.current.messages[0].type).toBe('warning');
  });

  it('removes a message by id', () => {
    const { result } = renderHook(() => useMessages());
    let id;
    act(() => { id = result.current.success('Temp'); });
    act(() => { result.current.remove(id); });
    expect(result.current.messages).toHaveLength(0);
  });

  it('clears all messages', () => {
    const { result } = renderHook(() => useMessages());
    act(() => {
      result.current.success('A');
      result.current.error('B');
    });
    act(() => { result.current.clear(); });
    expect(result.current.messages).toHaveLength(0);
  });

  it('preserves history after clear', () => {
    const { result } = renderHook(() => useMessages());
    act(() => { result.current.success('Remembered'); });
    act(() => { result.current.clear(); });
    expect(result.current.history.length).toBeGreaterThan(0);
  });

  it('assigns correct icon to each type', () => {
    const { result } = renderHook(() => useMessages());
    act(() => {
      result.current.success('s');
      result.current.error('e');
      result.current.info('i');
      result.current.warning('w');
    });
    const types = Object.fromEntries(result.current.messages.map((m) => [m.type, m.icon]));
    expect(types.success).toBe('✅');
    expect(types.error).toBe('⚠️');
    expect(types.info).toBe('ℹ️');
    expect(types.warning).toBe('⚠');
  });

  it('caps history at 50 entries', () => {
    const { result } = renderHook(() => useMessages());
    act(() => {
      for (let i = 0; i < 60; i++) result.current.info(`msg ${i}`);
    });
    expect(result.current.history.length).toBeLessThanOrEqual(50);
  });
});
