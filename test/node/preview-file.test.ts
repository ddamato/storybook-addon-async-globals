// Tests for preview-file.ts: finding the preview file and telling the two preview styles apart.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPreviewFile, isCsfFactoriesPreview, normalizePath } from '../../src/node/preview-file';
import { CSF_FACTORIES_PREVIEW, makeConfigDir, PLAIN_PREVIEW } from '../utils';

describe('findPreviewFile', () => {
  it('finds preview with any supported extension', () => {
    const dir = makeConfigDir({ 'main.ts': '', 'preview.tsx': PLAIN_PREVIEW });

    expect(findPreviewFile(dir)).toBe(path.join(dir, 'preview.tsx'));
  });

  it('returns undefined when there is no preview file', () => {
    expect(findPreviewFile(makeConfigDir({ 'main.ts': '' }))).toBeUndefined();
  });
});

describe('normalizePath', () => {
  it('drops queries and uses forward slashes', () => {
    const file = path.resolve('some', 'preview.ts');

    expect(normalizePath(`${file}?import`)).toBe(normalizePath(file));
    expect(normalizePath(file)).not.toContain('\\');
  });

  it.runIf(process.platform === 'win32')('ignores case on Windows', () => {
    expect(normalizePath('C:\\Project\\Preview.ts')).toBe(normalizePath('c:/project/preview.ts'));
  });
});

describe('isCsfFactoriesPreview', () => {
  // Storybook isn't installed in this repo, so these exercise the text fallback used for Storybook 7 and 8.
  it('detects definePreview', async () => {
    const dir = makeConfigDir({ 'preview.ts': CSF_FACTORIES_PREVIEW });

    expect(await isCsfFactoriesPreview(path.join(dir, 'preview.ts'))).toBe(true);
  });

  it('treats a plain object preview as not CSF factories', async () => {
    const dir = makeConfigDir({ 'preview.ts': PLAIN_PREVIEW });

    expect(await isCsfFactoriesPreview(path.join(dir, 'preview.ts'))).toBe(false);
  });
});
