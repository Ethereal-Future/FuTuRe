import '../src/index.css';

/** @type { import('@storybook/react').Preview } */
const preview = {
  parameters: {
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark',  value: '#020617' },
      ],
    },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  decorators: [
    (Story, context) => {
      const isDark = context.globals.backgrounds?.value === '#020617';
      document.documentElement.classList.toggle('theme-dark', isDark);
      return <Story />;
    },
  ],
};

export default preview;
