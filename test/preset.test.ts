// Tests for preset.ts: how the addon changes Storybook's Vite config.
import type { Plugin, UserConfig } from 'vite';
import { beforeEach, describe, expect, it } from 'vitest';
import { PLUGIN_NAME, WRAPPER_ID } from '../src/node/plugin';
import { makeConfigDir, PLAIN_PREVIEW } from './utils';
import { viteFinal } from '../src/preset';

const ours = (config: UserConfig) =>
  (config.plugins ?? []).filter((plugin): plugin is Plugin => (plugin as Plugin | null)?.name === PLUGIN_NAME);

async function wrapperCode(plugin: Plugin) {
  const load = plugin.load as (this: unknown, id: string) => Promise<string>;
  return load.call({ addWatchFile() {} }, WRAPPER_ID);
}

describe('viteFinal', () => {
  let configDir: string;
  beforeEach(() => {
    configDir = makeConfigDir({ 'preview.ts': PLAIN_PREVIEW });
  });

  it('adds the plugin once', async () => {
    const first = await viteFinal({ plugins: [{ name: 'other' }] }, { configDir });
    const second = await viteFinal(first, { configDir });

    expect(ours(second)).toHaveLength(1);
    expect(second.plugins?.[0]).toEqual({ name: 'other' });
  });

  it('allows top-level await without changing the build target or other esbuild options', async () => {
    const config = await viteFinal(
      { build: { target: 'es2020' }, esbuild: { jsx: 'automatic', supported: { bigint: false } } },
      { configDir },
    );

    expect(config.build).toEqual({ target: 'es2020' });
    expect(config.esbuild).toEqual({ jsx: 'automatic', supported: { bigint: false, 'top-level-await': true } });
  });

  it('leaves esbuild alone when the consumer turned it off', async () => {
    const config = await viteFinal({ esbuild: false }, { configDir });

    expect(config.esbuild).toBe(false);
  });

  it('excludes the addon from dependency optimization', async () => {
    const config = await viteFinal({ optimizeDeps: { exclude: ['other'], include: ['react'] } }, { configDir });

    expect(config.optimizeDeps).toEqual({ exclude: ['other', PLUGIN_NAME], include: ['react'] });
  });

  it('uses one launch id for every viteFinal call in a Storybook process', async () => {
    const launchId = async () =>
      /createSessionCache\("([a-z0-9]+)"\)/.exec(await wrapperCode(ours(await viteFinal({}, { configDir }))[0]!))?.[1];

    const first = await launchId();

    expect(first).toBeTruthy();
    expect(await launchId()).toBe(first);
  });
});
