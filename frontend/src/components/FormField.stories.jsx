import { FormField } from './FormField';

export default {
  title: 'Components/FormField',
  component: FormField,
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    error: { control: 'text' },
    touched: { control: 'boolean' },
    required: { control: 'boolean' },
  },
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #ddd',
  borderRadius: 4,
  fontSize: 14,
};

export const Default = {
  args: { label: 'Recipient Address' },
  render: (args) => (
    <FormField {...args}>
      <input style={inputStyle} placeholder="G..." />
    </FormField>
  ),
};

export const Required = {
  args: { label: 'Amount', required: true },
  render: (args) => (
    <FormField {...args}>
      <input style={inputStyle} type="number" placeholder="0.00" />
    </FormField>
  ),
};

export const WithValidationError = {
  args: { label: 'Recipient Address', error: 'Invalid Stellar address', touched: true },
  render: (args) => (
    <FormField {...args}>
      <input style={inputStyle} defaultValue="notanaddress" />
    </FormField>
  ),
};

export const NoError = {
  args: { label: 'Recipient Address', error: 'Invalid Stellar address', touched: false },
  render: (args) => (
    <FormField {...args}>
      <input style={inputStyle} placeholder="G..." />
    </FormField>
  ),
};
