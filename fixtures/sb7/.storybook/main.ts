const config = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['storybook-addon-async-globals', '@storybook/addon-toolbars'],
  framework: { name: '@storybook/react-vite', options: {} },
  staticDirs: ['../public'],
  core: { disableTelemetry: true },
};

export default config;
