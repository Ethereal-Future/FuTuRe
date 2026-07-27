import { NetworkBadge } from './NetworkBadge';

export default {
  title: 'Components/NetworkBadge',
  component: NetworkBadge,
  tags: ['autodocs'],
  argTypes: {
    status: { control: 'object' },
  },
};

export const TestnetOnline = {
  args: {
    status: {
      network: 'testnet',
      online: true,
      horizonUrl: 'https://horizon-testnet.stellar.org',
      horizonVersion: '2.28.0',
      currentProtocolVersion: 20,
    },
  },
};

export const TestnetOffline = {
  args: {
    status: {
      network: 'testnet',
      online: false,
      horizonUrl: 'https://horizon-testnet.stellar.org',
    },
  },
};

export const MainnetOnline = {
  args: {
    status: {
      network: 'mainnet',
      online: true,
      horizonUrl: 'https://horizon.stellar.org',
      horizonVersion: '2.28.0',
      currentProtocolVersion: 20,
    },
  },
};

export const NoStatus = {
  args: { status: null },
};
