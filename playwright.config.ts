import { defineConfig } from '@playwright/test';
import { FIXTURES, MODES, selected } from './e2e/fixtures';

// Static builds come from `pnpm fixtures:build`; dev servers are started here. Every server starts at once and each
// project runs in its own worker, so the whole matrix takes about as long as the slowest Storybook.
const fixtures = FIXTURES.filter((fixture) => selected([fixture.name], process.env.E2E_FIXTURES).length);
const modes = selected(MODES, process.env.E2E_MODES);
const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: fixtures.length * modes.length,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  use: { channel: 'chrome', trace: 'retain-on-failure' },
  projects: fixtures.flatMap((fixture) =>
    modes.map((mode) => ({
      name: `${fixture.name}-${mode}`,
      use: { baseURL: `http://localhost:${mode === 'static' ? fixture.staticPort : fixture.devPort}` },
      metadata: { fixture: fixture.name, mode },
    })),
  ),
  webServer: fixtures.flatMap((fixture) =>
    modes.map((mode) =>
      mode === 'static'
        ? {
            command: `node e2e/serve.mjs fixtures/${fixture.name}/storybook-static ${fixture.staticPort}`,
            url: `http://localhost:${fixture.staticPort}/iframe.html`,
            reuseExistingServer,
          }
        : {
            command: `pnpm --dir fixtures/${fixture.name} exec storybook dev --ci --no-open --quiet -p ${fixture.devPort}`,
            url: `http://localhost:${fixture.devPort}/iframe.html`,
            timeout: 240_000,
            reuseExistingServer,
          },
    ),
  ),
});
