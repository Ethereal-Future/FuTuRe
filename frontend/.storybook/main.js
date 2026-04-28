/** @type { import('@storybook/react-vite').StorybookConfig } */
const config = {
  stories: ['../src/design-system/**/*.stories.@(js|jsx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
};

export default config;
