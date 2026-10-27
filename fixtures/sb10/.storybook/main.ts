const config = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['storybook-addon-async-globals', '@storybook/addon-vitest'],
  framework: { name: '@storybook/react-vite', options: {} },
  staticDirs: ['../public'],
  core: { disableTelemetry: true },
  // Storybook 10 doesn't pre-bundle react for a plain-object preview whose stories never import it directly
  // (unrelated to this addon), so the React renderer's own files would load raw CommonJS.
  viteFinal: (config: { optimizeDeps?: { include?: string[] } }) => ({
    ...config,
    optimizeDeps: { ...config.optimizeDeps, include: [...(config.optimizeDeps?.include ?? []), 'react', 'react-dom'] },
  }),
};

export default config;
