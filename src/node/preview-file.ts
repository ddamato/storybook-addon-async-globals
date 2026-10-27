// Finds the consumer's .storybook/preview file and works out which style it's written in (a plain object, or CSF
// factories with `definePreview`), since the wrapper is different for each.
import fs from 'node:fs';
import path from 'node:path';

// Same extensions Storybook accepts for .storybook/preview.
const PREVIEW_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];

// Storybook 9+ exposes the check its own builder uses; older versions have no CSF factories at all.
const CSF_TOOLS = 'storybook/internal/csf-tools';

export function findPreviewFile(configDir: string): string | undefined {
  for (const extension of PREVIEW_EXTENSIONS) {
    const candidate = path.resolve(configDir, `preview${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Comparable form of a file path or Vite module id (no query, forward slashes, case-insensitive on Windows). */
export function normalizePath(file: string): string {
  const resolved = path.resolve(file.split('?')[0] ?? file).replace(/\\/g, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

interface CsfTools {
  readConfig?: (file: string) => Promise<unknown>;
  isCsfFactoryPreview?: (config: unknown) => boolean;
}

/** Whether the preview file uses CSF factories (`export default definePreview(...)`). */
export async function isCsfFactoriesPreview(file: string): Promise<boolean> {
  try {
    const { readConfig, isCsfFactoryPreview } = (await import(/* @vite-ignore */ CSF_TOOLS)) as CsfTools;
    if (readConfig && isCsfFactoryPreview) return isCsfFactoryPreview(await readConfig(file));
  } catch {
    // Storybook 7 and 8, or csf-tools couldn't parse the file: fall back to a text check.
  }
  return /\bdefinePreview\s*\(/.test(await fs.promises.readFile(file, 'utf8'));
}
