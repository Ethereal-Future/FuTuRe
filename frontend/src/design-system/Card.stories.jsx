import { Card } from './Card';

export default {
  title: 'Design System/Card',
  component: Card,
  argTypes: {
    padding: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
};

export const Basic = { args: { children: 'Card content goes here.' } };

export const WithHeader = {
  args: { header: 'Account Balance', children: '1,234.56 XLM' },
};

export const WithHeaderAndFooter = {
  args: {
    header: 'Transaction',
    children: 'Sent 50 XLM to GXXX…',
    footer: '2 seconds ago',
  },
};
