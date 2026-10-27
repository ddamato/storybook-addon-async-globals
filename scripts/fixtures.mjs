// Runs a step in every fixture Storybook at once. Usage: node scripts/fixtures.mjs <install|build|test>
// Each fixture is its own pnpm project (different Storybook versions can't share a node_modules), and installs the
// addon from the repo root as a packed copy, so run `pnpm build` first and `install` again after rebuilding.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const STEPS = {
  install: () => ['install'],
  build: () => ['run', 'build-storybook'],
  test: (fixture) => (fixture.scripts.test ? ['run', 'test'] : null),
};

const step = process.argv[2];
if (!STEPS[step]) {
  console.error(`Usage: node scripts/fixtures.mjs <${Object.keys(STEPS).join('|')}>`);
  process.exit(1);
}

const root = path.resolve('fixtures');
const fixtures = fs
  .readdirSync(root)
  .filter((name) => fs.existsSync(path.join(root, name, 'package.json')))
  .map((name) => ({
    ...JSON.parse(fs.readFileSync(path.join(root, name, 'package.json'))),
    name,
    dir: path.join(root, name),
  }));

const run = (fixture) =>
  new Promise((resolve) => {
    const args = STEPS[step](fixture);
    if (!args) return resolve({ fixture, code: 0, skipped: true });
    const child = spawn('pnpm', args, { cwd: fixture.dir, shell: process.platform === 'win32' });
    const prefix = `[${fixture.name}] `;
    const pipe = (stream, out) =>
      stream.on('data', (chunk) =>
        out.write(
          chunk
            .toString()
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => prefix + line + '\n')
            .join(''),
        ),
      );
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on('close', (code) => resolve({ fixture, code }));
  });

// Vitest browser mode can fail its first run on a cold Vite cache while dependencies are still being discovered
// ("Vitest failed to find the runner"); the second run is reliable.
const runWithRetry = async (fixture) => {
  const result = await run(fixture);
  if (step !== 'test' || result.code === 0 || result.skipped) return result;
  console.log(`[${fixture.name}] retrying once (Vitest's first run on a cold cache can fail)`);
  return run(fixture);
};

const results = await Promise.all(fixtures.map(runWithRetry));
for (const { fixture, code, skipped } of results) {
  console.log(`${fixture.name}: ${skipped ? 'skipped' : code === 0 ? 'ok' : `failed (${code})`}`);
}
process.exit(results.some((result) => result.code !== 0) ? 1 : 0);
