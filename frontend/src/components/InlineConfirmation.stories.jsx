import { InlineConfirmation } from './InlineConfirmation';

export default {
  title: 'Components/InlineConfirmation',
  component: InlineConfirmation,
  tags: ['autodocs'],
  argTypes: {
    isVisible: { control: 'boolean' },
    message: { control: 'text' },
    confirmText: { control: 'text' },
    cancelText: { control: 'text' },
    onConfirm: { action: 'confirmed' },
    onCancel: { action: 'cancelled' },
  },
};

export const Visible = {
  args: {
    isVisible: true,
    message: 'Clear all form fields?',
    confirmText: 'Clear',
    cancelText: 'Cancel',
  },
};

export const Hidden = {
  args: {
    isVisible: false,
    message: 'Clear all form fields?',
  },
};

export const CustomText = {
  args: {
    isVisible: true,
    message: 'Delete this entry permanently?',
    confirmText: 'Delete',
    cancelText: 'Keep',
  },
};
