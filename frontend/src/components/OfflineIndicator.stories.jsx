import { OfflineIndicator } from './OfflineIndicator';

export default {
  title: 'Components/OfflineIndicator',
  component: OfflineIndicator,
  tags: ['autodocs'],
  parameters: {
    // Show offline banner inline rather than fixed-positioned for Storybook
    layout: 'centered',
  },
};

// The component renders nothing when online, so we render it directly
// by rendering the inner markup for Storybook preview purposes.
export const OfflineState = {
  render: () => (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: '#1f2937',
        color: '#f9fafb',
        padding: '8px 20px',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <span aria-hidden="true">⚡</span>
      You are offline — payments will be queued and sent when reconnected.
    </div>
  ),
};

// Live component — shows nothing when browser is online (expected)
export const LiveComponent = {
  render: () => <OfflineIndicator />,
  parameters: {
    docs: {
      description: {
        story: 'Renders nothing when the browser is online. Go offline to see the indicator.',
      },
    },
  },
};
