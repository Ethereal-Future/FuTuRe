import React from 'react';

/**
 * SkeletonText — Placeholder for lines of text.
 */
export function SkeletonText({
  lines = 3,
  width = '100%',
  height = '14px',
  className = '',
  ...props
}) {
  const getLineWidth = (index) => {
    if (Array.isArray(width)) {
      return width[index] || '100%';
    }
    // If it's a single value, we vary it slightly for the last line if lines > 1
    if (lines > 1 && index === lines - 1 && width === '100%') {
      return '65%';
    }
    return width;
  };

  return (
    <div
      className={`skeleton-text-container ${className}`}
      role="status"
      aria-busy="true"
      aria-label="Loading content"
      {...props}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className="skeleton-block skeleton-text-line"
          style={{
            display: 'block',
            width: getLineWidth(i),
            height,
          }}
        />
      ))}
    </div>
  );
}

/**
 * SkeletonCard — Placeholder matching the shape of a transaction item.
 */
export function SkeletonCard({ className = '', ...props }) {
  return (
    <div
      className={`tx-row tx-skeleton ${className}`}
      role="status"
      aria-busy="true"
      aria-label="Loading transaction"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        padding: '10px 0',
        cursor: 'default',
      }}
      {...props}
    >
      <span className="skeleton-block" style={{ width: 16, height: 16, borderRadius: 4 }} />
      <span className="skeleton-block" style={{ width: 80, height: 14, borderRadius: 4 }} />
      <span className="skeleton-block" style={{ width: 100, height: 14, borderRadius: 4 }} />
      <span className="skeleton-block" style={{ width: 120, height: 14, borderRadius: 4, marginLeft: 'auto' }} />
      <span className="skeleton-block" style={{ width: 16, height: 16, borderRadius: 4 }} />
    </div>
  );
}

/**
 * SkeletonBalance — Placeholder matching the shape of the account balances.
 */
export function SkeletonBalance({ rows = 2, className = '', ...props }) {
  return (
    <div
      className={`skeleton-balance ${className}`}
      role="status"
      aria-busy="true"
      aria-label="Loading account balances"
      style={{
        marginTop: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
      {...props}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="balance-row"
          style={{
            display: 'flex',
            justify-content: 'space-between',
            alignItems: 'center',
            padding: '4px 0',
            height: '29px',
          }}
        >
          <span className="skeleton-block" style={{ width: 60, height: 14, borderRadius: 4 }} />
          <span className="skeleton-block" style={{ width: 100, height: 14, borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}
