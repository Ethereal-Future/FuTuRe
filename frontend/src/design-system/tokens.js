/**
 * Design Tokens — single source of truth for the Stellar Remittance UI.
 * CSS custom properties are defined in index.css; these JS tokens mirror them
 * for use in JS/TS contexts (Storybook, tests, dynamic styles).
 *
 * Version: 1.0.0
 */

export const color = {
  // Brand
  primary: 'var(--primary)',
  primaryHover: 'var(--primary-hover)',
  // Semantic
  danger: 'var(--danger)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  info: 'var(--info)',
  // Neutral
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  card: 'var(--card)',
  text: 'var(--text)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  link: 'var(--link)',
};

export const space = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px',
};

export const radius = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  full: '9999px',
};

export const font = {
  size: {
    xs: '0.75rem',
    sm: '0.875rem',
    md: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
  },
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
};

export const shadow = {
  sm: '0 1px 3px rgba(0,0,0,0.08)',
  md: '0 4px 12px rgba(0,0,0,0.10)',
  lg: 'var(--shadow)',
};

export const transition = {
  fast: '0.15s ease',
  base: '0.25s ease',
};

/** Component version — bump when making breaking changes */
export const COMPONENT_VERSION = '1.0.0';
