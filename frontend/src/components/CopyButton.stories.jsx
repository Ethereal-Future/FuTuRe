import { CopyButton } from './CopyButton';

export default {
  title: 'Components/CopyButton',
  component: CopyButton,
  tags: ['autodocs'],
  argTypes: {
    text: { control: 'text' },
    label: { control: 'text' },
  },
};

export const Default = {
  args: {
    text: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
    label: 'Copy address',
  },
};

export const TransactionHash = {
  args: {
    text: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
    label: 'Copy transaction hash',
  },
};

export const ShortValue = {
  args: {
    text: 'Copy me',
    label: 'Copy',
  },
};
