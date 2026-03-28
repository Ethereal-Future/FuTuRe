import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatNumber, formatCurrency, formatDate, formatRelativeTime, getLocaleCurrency } from '../src/i18n/formatters';

// Mock i18n so formatters don't need the full init
vi.mock('../src/i18n/index.js', () => ({ default: { language: 'en' } }));

describe('formatNumber', () => {
  it('formats with locale grouping', () => {
    expect(formatNumber(1234567, {}, 'en')).toBe('1,234,567');
    expect(formatNumber(1234567, {}, 'fr')).toBe('1\u202f234\u202f567');
  });
});

describe('formatCurrency', () => {
  it('formats USD', () => {
    expect(formatCurrency(1234.5, 'USD', 'en')).toContain('1,234.50');
  });

  it('formats EUR in French locale', () => {
    const result = formatCurrency(1234.5, 'EUR', 'fr');
    expect(result).toContain('1');
    expect(result).toContain('234');
  });
});

describe('formatDate', () => {
  it('returns a non-empty string', () => {
    const result = formatDate(new Date('2026-01-15'), { dateStyle: 'medium' }, 'en');
    expect(result).toMatch(/Jan/i);
  });
});

describe('formatRelativeTime', () => {
  it('returns "now" or seconds for very recent time', () => {
    const result = formatRelativeTime(Date.now() - 5000, 'en');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns minutes for ~2 min ago', () => {
    const result = formatRelativeTime(Date.now() - 2 * 60 * 1000, 'en');
    expect(result).toMatch(/minute/i);
  });
});

describe('getLocaleCurrency', () => {
  it('returns USD for en', () => expect(getLocaleCurrency('en')).toBe('USD'));
  it('returns ILS for he', () => expect(getLocaleCurrency('he')).toBe('ILS'));
  it('returns SAR for ar', () => expect(getLocaleCurrency('ar')).toBe('SAR'));
  it('returns BRL for pt-BR', () => expect(getLocaleCurrency('pt-BR')).toBe('BRL'));
  it('falls back to USD for unknown', () => expect(getLocaleCurrency('xx')).toBe('USD'));
});
