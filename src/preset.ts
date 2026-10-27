// What Storybook loads when a consumer adds the addon to `addons` in main.ts. It adds the addon's Vite plugin to
// Storybook's Vite config.
import type { UserConfig } from 'vite';
import { asyncGlobalsPlugin, PLUGIN_NAME } from './node/plugin';

// One id per Storybook process: a refresh reuses cached values, a restart (or new build) starts fresh.
const LAUNCH_ID = Date.now().toString(36);

export async function viteFinal(config: UserConfig, options: { configDir: string }): Promise<UserConfig> {
  const plugins = (config.plugins ?? []).filter(
    (plugin) => !(plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name === PLUGIN_NAME),
  );

  return {
    ...config,
    plugins: [...plugins, asyncGlobalsPlugin({ configDir: options.configDir, launchId: LAUNCH_ID })],
    // The wrapper uses top-level await. Vite 4–6's default build target predates it, so tell esbuild to leave it as
    // is instead of failing; the consumer's target still applies to everything else.
    esbuild:
      config.esbuild === false
        ? false
        : { ...config.esbuild, supported: { ...config.esbuild?.supported, 'top-level-await': true } },
    optimizeDeps: {
      ...config.optimizeDeps,
      // Served as-is: the Vitest setup file uses top-level await, which the dependency optimizer's target may reject.
      exclude: [...(config.optimizeDeps?.exclude ?? []), PLUGIN_NAME],
    },
  };
}
