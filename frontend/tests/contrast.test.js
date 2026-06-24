/**
 * WCAG 2.1 AA contrast ratio tests for the dark theme colour tokens.
 * Thresholds: 4.5:1 for normal text, 3:1 for large text / UI components.
 */

import { describe, it, expect } from 'vitest';

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Dark theme raw colour values (mirrors .theme-dark in index.css)
const dark = {
  bg: '#020617',
  surface: '#111827',
  card: '#1f2937',
  text: '#e2e8f0',
  muted: '#94a3b8',
  primary: '#60a5fa',
  primaryHover: '#3b82f6',
  onPrimary: '#0f172a',
  danger: '#f87171',
  success: '#34d399',
  warning: '#fbbf24',
  info: '#38bdf8',
  link: '#93c5fd',
};

const AA_NORMAL = 4.5;

describe('Dark theme WCAG 2.1 AA contrast', () => {
  describe('Text on backgrounds', () => {
    it('text on bg meets 4.5:1', () => {
      expect(contrastRatio(dark.text, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('text on surface meets 4.5:1', () => {
      expect(contrastRatio(dark.text, dark.surface)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('text on card meets 4.5:1', () => {
      expect(contrastRatio(dark.text, dark.card)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('muted on bg meets 4.5:1', () => {
      expect(contrastRatio(dark.muted, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('muted on surface meets 4.5:1', () => {
      expect(contrastRatio(dark.muted, dark.surface)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('muted on card meets 4.5:1', () => {
      expect(contrastRatio(dark.muted, dark.card)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('link on bg meets 4.5:1', () => {
      expect(contrastRatio(dark.link, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('primary as foreground text on bg meets 4.5:1', () => {
      expect(contrastRatio(dark.primary, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });

  describe('on-primary foreground on primary backgrounds', () => {
    it('onPrimary on primary meets 4.5:1', () => {
      expect(contrastRatio(dark.onPrimary, dark.primary)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('onPrimary on primaryHover meets 4.5:1', () => {
      expect(contrastRatio(dark.onPrimary, dark.primaryHover)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });

  describe('Semantic colours as foreground text on bg', () => {
    it('danger on bg meets 4.5:1', () => {
      expect(contrastRatio(dark.danger, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('success on bg meets 4.5:1', () => {
      expect(contrastRatio(dark.success, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('warning on bg meets 4.5:1', () => {
      expect(contrastRatio(dark.warning, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('info on bg meets 4.5:1', () => {
      expect(contrastRatio(dark.info, dark.bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });
});
