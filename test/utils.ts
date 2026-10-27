// Shared helpers for the unit tests: temporary .storybook folders and sample preview files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Creates a temporary .storybook directory containing the given files; removed after each test. */
export function makeConfigDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'async-globals-'));
  created.push(dir);
  for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), contents);
  return dir;
}

export const PLAIN_PREVIEW = `export default { globalTypes: { theme: { toolbar: { items: async () => [] } } } };\n`;
export const CSF_FACTORIES_PREVIEW = `import { definePreview } from '@storybook/react-vite';\nexport default definePreview({});\n`;
