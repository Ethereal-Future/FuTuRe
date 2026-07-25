import React from 'react';
import { SkeletonText, SkeletonCard, SkeletonBalance } from './Skeleton';

export default {
  title: 'Components/Skeleton',
};

export const Text = {
  render: () => (
    <div style={{ maxWidth: 400, padding: 16, background: 'var(--surface)', borderRadius: 8 }}>
      <h4 style={{ marginBottom: 12, color: 'var(--text)' }}>SkeletonText Variant</h4>
      <SkeletonText lines={3} />
    </div>
  ),
};

export const Card = {
  render: () => (
    <div style={{ maxWidth: 600, padding: 16, background: 'var(--surface)', borderRadius: 8 }}>
      <h4 style={{ marginBottom: 12, color: 'var(--text)' }}>SkeletonCard Variant</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  ),
};

export const Balance = {
  render: () => (
    <div style={{ maxWidth: 300, padding: 16, background: 'var(--surface)', borderRadius: 8 }}>
      <h4 style={{ marginBottom: 12, color: 'var(--text)' }}>SkeletonBalance Variant</h4>
      <SkeletonBalance rows={3} />
    </div>
  ),
};
