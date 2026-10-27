// Writes the source code of the wrapper: the module the plugin serves in place of the consumer's preview file. The
// wrapper imports the real file, resolves its functions, and passes everything on.

export const RUNTIME_SPECIFIER = 'storybook-addon-async-globals/runtime';

export interface WrapperOptions {
  /** Absolute path of the consumer's preview file. */
  previewFile: string;
  /** `export default definePreview(...)`; see isCsfFactoriesPreview. */
  csfFactories: boolean;
  /** Identifies this Storybook launch; cached values from other launches are ignored. */
  launchId: string;
}

export function generateWrapper({ previewFile, csfFactories, launchId }: WrapperOptions) {
  const original = JSON.stringify(previewFile.replace(/\\/g, '/'));
  const resolve = `resolvePreviewModule(original, createSessionCache(${JSON.stringify(launchId)}))`;
  const head = [
    `import * as original from ${original};`,
    `import { resolvePreviewModule, createSessionCache } from ${JSON.stringify(RUNTIME_SPECIFIER)};`,
    `export * from ${original};`,
  ];

  if (csfFactories) {
    // Storybook awaits getProjectAnnotations(), which returns preview.default.composed. A promise there avoids
    // top-level await, which would make Rollup split the preview into a chunk that runs before Storybook's runtime
    // globals exist.
    return [
      ...head,
      `const pending = ${resolve};`,
      `const preview = original.default;`,
      `export default Object.create(preview, { composed: { get: () => pending.then(() => preview.composed) } });`,
      '',
    ].join('\n');
  }

  return [
    ...head,
    `const resolved = await ${resolve};`,
    `export default resolved.default;`,
    `export const globalTypes = resolved.globalTypes;`,
    `export const initialGlobals = resolved.initialGlobals;`,
    `export const globals = resolved.globals;`,
    '',
  ].join('\n');
}
