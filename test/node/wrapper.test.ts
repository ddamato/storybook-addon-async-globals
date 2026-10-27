// Tests for wrapper.ts: the generated wrapper code for each preview style.
import { parseAst } from 'vite';
import { describe, expect, it } from 'vitest';
import { generateWrapper, RUNTIME_SPECIFIER } from '../../src/node/wrapper';

const base = {
  previewFile: 'C:\\project\\.storybook\\preview.tsx',
  launchId: 'mabc123',
};

describe('generateWrapper', () => {
  it('re-exports the plain-object preview after top-level await', () => {
    const code = generateWrapper({ ...base, csfFactories: false });

    expect(() => parseAst(code)).not.toThrow();
    expect(code).toContain(`import * as original from "C:/project/.storybook/preview.tsx";`);
    expect(code).toContain(`export * from "C:/project/.storybook/preview.tsx";`);
    expect(code).toContain(`import { resolvePreviewModule, createSessionCache } from "${RUNTIME_SPECIFIER}";`);
    expect(code).toContain(`const resolved = await resolvePreviewModule(original, createSessionCache("mabc123"));`);
    for (const name of ['default', 'const globalTypes', 'const initialGlobals', 'const globals']) {
      expect(code).toContain(`export ${name}`);
    }
  });

  it('uses a promise instead of top-level await for CSF factories', () => {
    const code = generateWrapper({ ...base, csfFactories: true });

    expect(() => parseAst(code)).not.toThrow();
    expect(code).not.toMatch(/^\s*(const \w+ = )?await /m);
    expect(code).toContain(`const pending = resolvePreviewModule(original, createSessionCache("mabc123"));`);
    expect(code).toContain(
      `export default Object.create(preview, { composed: { get: () => pending.then(() => preview.composed) } });`,
    );
  });

  it('escapes the preview path and launch id as string literals', () => {
    const code = generateWrapper({
      ...base,
      previewFile: '/srv/it\'s "here"/preview.ts',
      launchId: 'a"b',
      csfFactories: false,
    });

    expect(() => parseAst(code)).not.toThrow();
    expect(code).toContain(`from "/srv/it's \\"here\\"/preview.ts";`);
    expect(code).toContain(`createSessionCache("a\\"b")`);
  });
});
