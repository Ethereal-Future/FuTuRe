import { Breadcrumb } from './Breadcrumb';

export default {
  title: 'Components/Breadcrumb',
  component: Breadcrumb,
  tags: ['autodocs'],
};

export const SingleItem = {
  args: {
    items: [{ label: 'Dashboard' }],
  },
};

export const TwoLevels = {
  args: {
    items: [
      { label: 'Home', path: '/' },
      { label: 'Send Payment' },
    ],
  },
};

export const DeepTrail = {
  args: {
    items: [
      { label: 'Home', path: '/' },
      { label: 'Account', path: '/account' },
      { label: 'Settings', path: '/account/settings' },
      { label: 'Notifications' },
    ],
  },
};

export const Empty = {
  args: { items: [] },
};
