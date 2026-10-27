// The Vite plugin. When Storybook loads the consumer's preview file, the plugin hands it a generated wrapper instead,
// which loads the real file and resolves its functions first. Under Vitest it also adds the addon's setup file.
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { findPreviewFile, isCsfFactoriesPreview, normalizePath } from './preview-file';
import { generateWrapper } from './wrapper';

export const PLUGIN_NAME = 'storybook-addon-async-globals';
export const WRAPPER_ID = '\0async-globals:wrapper';
/** Lets the Vitest setup file (a real file) import the wrapper. */
export const WRAPPER_PUBLIC_ID = 'virtual:async-globals/wrapper';
// The built setup file sits next to the built preset (dist/). An absolute path avoids depending on how each Vitest
// version resolves package names in setupFiles.
export const VITEST_SETUP_FILE = fileURLToPath(new URL('./vitest.setup.js', import.meta.url));

export interface AsyncGlobalsPluginOptions {
  configDir: string;
  /** Identifies this Storybook launch for the session cache. */
  launchId: string;
}

// Storybook's builder imports the preview file from its own virtual modules. Real files (CSF factories stories,
// Vitest setup files) keep the consumer's original module, which the wrapper updates in place; redirecting them too
// makes Rollup split the preview into a chunk that runs before Storybook's runtime globals exist.
const isFromStorybook = (importer: string | undefined) =>
  !importer || importer.startsWith('\0') || importer.includes('virtual:');

const looksLikePreview = (source: string) => /(^|[\\/])preview(\.[cm]?[jt]sx?)?(\?|$)/.test(source);

export function asyncGlobalsPlugin({ configDir, launchId }: AsyncGlobalsPluginOptions): Plugin {
  const previewFile = findPreviewFile(configDir);
  const previewKey = previewFile && normalizePath(previewFile);

  return {
    name: PLUGIN_NAME,
    enforce: 'pre',

    // Under Vitest, run the addon's setup file first so everything is resolved (in place) before Storybook's or the
    // consumer's setup files call setProjectAnnotations.
    config: {
      order: 'post',
      handler(config) {
        if (!process.env.VITEST || !previewFile) return;
        const test = ((config as { test?: { setupFiles?: string | string[] } }).test ??= {});
        const existing = test.setupFiles ?? [];
        test.setupFiles = [VITEST_SETUP_FILE, ...(Array.isArray(existing) ? existing : [existing])];
      },
    },

    async resolveId(source, importer, options) {
      if (source === WRAPPER_PUBLIC_ID) return previewFile ? WRAPPER_ID : null;
      if (!previewKey || importer === WRAPPER_ID || !isFromStorybook(importer) || !looksLikePreview(source)) {
        return null;
      }
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external || resolved.id.includes('?')) return null;
      return normalizePath(resolved.id) === previewKey ? WRAPPER_ID : null;
    },

    async load(id) {
      if (id !== WRAPPER_ID || !previewFile) return null;
      // The wrapper's shape depends on the file's contents, so regenerate it when the file changes.
      this.addWatchFile(previewFile);
      return generateWrapper({ previewFile, csfFactories: await isCsfFactoriesPreview(previewFile), launchId });
    },
  };
}
