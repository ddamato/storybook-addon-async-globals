// Tests for plugin.ts: which imports get swapped for the wrapper, what the wrapper contains, and the Vitest setup.
import path from 'node:path';
import type { Plugin, UserConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asyncGlobalsPlugin, VITEST_SETUP_FILE, WRAPPER_ID, WRAPPER_PUBLIC_ID } from '../../src/node/plugin';
import { CSF_FACTORIES_PREVIEW, makeConfigDir, PLAIN_PREVIEW } from '../utils';

type Hook = (this: unknown, ...args: unknown[]) => unknown;
const hook = (plugin: Plugin, name: keyof Plugin): Hook => {
  const value = plugin[name] as Hook | { handler: Hook };
  return typeof value === 'function' ? value : value.handler;
};

const VIRTUAL_ENTRY = '/virtual:/@storybook/builder-vite/project-annotations.js';

function setup(files: Record<string, string> = { 'preview.tsx': PLAIN_PREVIEW }) {
  const configDir = makeConfigDir(files);
  const previewFile = path.join(configDir, 'preview.tsx');
  const plugin = asyncGlobalsPlugin({ configDir, launchId: 'launch-1' });
  const resolve = vi.fn(async (source: string) => ({ id: source.startsWith('/.storybook/') ? previewFile : source }));
  const context = { resolve, addWatchFile: vi.fn() };
  const resolveId = (source: string, importer: string | undefined) =>
    hook(plugin, 'resolveId').call(context, source, importer, {});
  const load = (id: string) => hook(plugin, 'load').call(context, id) as Promise<string | null>;
  return { plugin, previewFile, context, resolveId, load };
}

describe('asyncGlobalsPlugin', () => {
  describe('resolveId', () => {
    it("redirects Storybook's import of the preview file to the wrapper", async () => {
      const { resolveId } = setup();

      expect(await resolveId('/.storybook/preview.tsx', VIRTUAL_ENTRY)).toBe(WRAPPER_ID);
      expect(await resolveId('/.storybook/preview.tsx', '\0virtual:storybook-entry')).toBe(WRAPPER_ID);
    });

    it('leaves imports from real files on the original module', async () => {
      const { resolveId, context } = setup();

      expect(await resolveId('../.storybook/preview', '/project/src/Button.stories.tsx')).toBeNull();
      expect(context.resolve).not.toHaveBeenCalled();
    });

    it("leaves the wrapper's own import of the original alone", async () => {
      const { resolveId, previewFile } = setup();

      expect(await resolveId(previewFile, WRAPPER_ID)).toBeNull();
    });

    it('ignores other modules without resolving them', async () => {
      const { resolveId, context } = setup();

      expect(await resolveId('/.storybook/manager.ts', VIRTUAL_ENTRY)).toBeNull();
      expect(context.resolve).not.toHaveBeenCalled();
    });

    it('ignores a different file named preview and ids with queries', async () => {
      const { resolveId, context } = setup();

      expect(await resolveId('/elsewhere/preview.tsx', VIRTUAL_ENTRY)).toBeNull();
      context.resolve.mockResolvedValueOnce({ id: `${'x'}?raw` });
      expect(await resolveId('/.storybook/preview.tsx?raw', VIRTUAL_ENTRY)).toBeNull();
    });

    it('resolves the public id used by the Vitest setup file', async () => {
      const { resolveId } = setup();

      expect(await resolveId(WRAPPER_PUBLIC_ID, '/project/node_modules/x/vitest.setup.js')).toBe(WRAPPER_ID);
    });

    it('does nothing when there is no preview file', async () => {
      const { resolveId } = setup({ 'main.ts': '' });

      expect(await resolveId('/.storybook/preview.tsx', VIRTUAL_ENTRY)).toBeNull();
      expect(await resolveId(WRAPPER_PUBLIC_ID, undefined)).toBeNull();
    });
  });

  describe('load', () => {
    it('generates the plain-object wrapper and watches the preview file', async () => {
      const { load, context, previewFile } = setup();

      const code = await load(WRAPPER_ID);

      expect(code).toContain('const resolved = await resolvePreviewModule(original, createSessionCache("launch-1"));');
      expect(context.addWatchFile).toHaveBeenCalledWith(previewFile);
    });

    it('generates the CSF factories wrapper for definePreview', async () => {
      const { load } = setup({ 'preview.tsx': CSF_FACTORIES_PREVIEW });

      expect(await load(WRAPPER_ID)).toContain('const pending = resolvePreviewModule(');
    });

    it('ignores other ids', async () => {
      const { load } = setup();

      expect(await load('/project/src/main.tsx')).toBeNull();
    });
  });

  describe('config under Vitest', () => {
    const vitest = process.env.VITEST;
    beforeEach(() => {
      process.env.VITEST = 'true';
    });
    afterEach(() => {
      process.env.VITEST = vitest;
    });

    it('puts the setup file first', () => {
      const { plugin } = setup();
      const config = { test: { setupFiles: ['./storybook-setup.ts'] } } as UserConfig;

      hook(plugin, 'config').call({}, config, { command: 'serve', mode: 'test' });

      expect((config as { test: { setupFiles: string[] } }).test.setupFiles).toEqual([
        VITEST_SETUP_FILE,
        './storybook-setup.ts',
      ]);
    });

    it('accepts a single setup file string or none', () => {
      const { plugin } = setup();
      const single = { test: { setupFiles: './one.ts' } } as UserConfig;
      const none = {} as UserConfig;

      hook(plugin, 'config').call({}, single, { command: 'serve', mode: 'test' });
      hook(plugin, 'config').call({}, none, { command: 'serve', mode: 'test' });

      expect((single as { test: { setupFiles: string[] } }).test.setupFiles).toEqual([VITEST_SETUP_FILE, './one.ts']);
      expect((none as { test: { setupFiles: string[] } }).test.setupFiles).toEqual([VITEST_SETUP_FILE]);
    });

    it('leaves the config alone outside Vitest', () => {
      delete process.env.VITEST;
      const { plugin } = setup();
      const config = {} as UserConfig;

      hook(plugin, 'config').call({}, config, { command: 'serve', mode: 'development' });

      expect(config).toEqual({});
    });
  });
});
