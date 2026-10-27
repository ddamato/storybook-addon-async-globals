import { defineConfig } from 'tsup';

export default defineConfig([
  // Node: the Storybook preset (and the Vite plugin it registers). Storybook 7 and 8 often load presets with
  // require(), Storybook 10 with import, so it ships as both CJS and ESM.
  {
    entry: { preset: 'src/preset.ts' },
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node18',
    external: ['vite', 'storybook'],
    // import.meta.url in the CJS build (the Vitest setup file is located relative to the preset).
    shims: true,
  },
  // Browser: imported by the generated wrapper (runtime) and added to Vitest's setupFiles (vitest.setup).
  // The consumer's Vite build bundles these again, so they ship as ESM only.
  {
    entry: { runtime: 'src/runtime/index.ts', 'vitest.setup': 'src/vitest.setup.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    external: ['virtual:async-globals/wrapper'],
  },
]);
