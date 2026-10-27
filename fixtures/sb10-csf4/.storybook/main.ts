const config = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['storybook-addon-async-globals', '@storybook/addon-vitest'],
  framework: { name: '@storybook/react-vite', options: {} },
  staticDirs: ['../public'],
  core: { disableTelemetry: true },
};

export default config;
