import { Badge } from './Badge';

export default {
  title: 'Design System/Badge',
  component: Badge,
  argTypes: {
    variant: { control: 'select', options: ['default', 'success', 'danger', 'warning', 'info'] },
  },
};

export const Default = { args: { children: 'Testnet', variant: 'default' } };
export const Success = { args: { children: 'Confirmed', variant: 'success' } };
export const Danger  = { args: { children: 'Failed', variant: 'danger' } };
export const Warning = { args: { children: 'Pending', variant: 'warning' } };
export const Info    = { args: { children: 'Processing', variant: 'info' } };

export const AllVariants = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {['default', 'success', 'danger', 'warning', 'info'].map((v) => (
        <Badge key={v} variant={v}>{v}</Badge>
      ))}
    </div>
  ),
};
