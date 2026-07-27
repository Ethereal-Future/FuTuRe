import { Spinner } from './Spinner';

export default {
  title: 'Components/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
  },
};

export const Default = { args: {} };

export const WithLabel = { args: { label: 'Loading...' } };

export const CustomLabel = { args: { label: 'Sending payment' } };
