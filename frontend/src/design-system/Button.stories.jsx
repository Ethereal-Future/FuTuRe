import { Button } from './Button';

export default {
  title: 'Design System/Button',
  component: Button,
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'danger', 'ghost'] },
    size:    { control: 'select', options: ['sm', 'md', 'lg'] },
    loading: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};

export const Primary    = { args: { children: 'Send Payment', variant: 'primary' } };
export const Secondary  = { args: { children: 'Cancel', variant: 'secondary' } };
export const Danger     = { args: { children: 'Delete Account', variant: 'danger' } };
export const Ghost      = { args: { children: 'Learn more', variant: 'ghost' } };
export const Loading    = { args: { children: 'Sending…', loading: true } };
export const Small      = { args: { children: 'Copy', size: 'sm' } };
export const Large      = { args: { children: 'Create Account', size: 'lg' } };
export const FullWidth  = { args: { children: 'Confirm Transfer', fullWidth: true } };
