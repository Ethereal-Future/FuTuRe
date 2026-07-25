import { Input } from './Input';

export default {
  title: 'Design System/Input',
  component: Input,
  argTypes: {
    fullWidth: { control: 'boolean' },
    disabled:  { control: 'boolean' },
  },
};

export const Default  = { args: { label: 'Recipient Address', placeholder: 'G…' } };
export const WithHint = { args: { label: 'Amount', hint: 'Minimum 1 XLM', placeholder: '0.00' } };
export const WithError = {
  args: { label: 'Amount', error: 'Amount exceeds balance', placeholder: '0.00' },
};
export const Disabled = { args: { label: 'Network', value: 'Testnet', disabled: true } };
