# Contributing

Requires Node 22.13 or later (ESLint's minimum on Node 22) and pnpm (the version is pinned in `package.json`).

## How it works

The preset adds a Vite plugin. When Storybook's builder imports `.storybook/preview.*` from one of its virtual modules, the plugin serves a generated wrapper instead. The wrapper imports the real preview file, calls every function inside `globalTypes`, `initialGlobals` and `globals` (via the runtime in `src/runtime/`), writes the results back in place, and re-exports the module. Imports of the preview file from real files (stories, test setup) are left alone.

- **Plain-object previews:** the wrapper awaits resolution at the top level, and the preset sets esbuild's `supported: { 'top-level-await': true }` so builds don't fail on Vite 4–6's default target.
- **CSF factories (`definePreview`):** top-level `await` there breaks Rollup's chunk ordering, so the wrapper instead exposes a `composed` getter that returns a promise, which Storybook awaits.
- **Vitest:** the plugin prepends `dist/vitest.setup.js` to `setupFiles`, which imports the wrapper and waits for it.

This relies on Storybook behavior that isn't documented API, unchanged across 7–10:

- its Vite builder imports the preview file from virtual modules;
- it awaits `getProjectAnnotations()` and, with CSF factories, `preview.default.composed`;
- its Vitest addon applies `viteFinal`.

If a new Storybook release breaks the addon, check these first. The Webpack builder loads the preview with `require()`, which can't wait for top-level `await`, so it isn't supported.

## Layout

| Path                                         | What it is                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [src/preset.ts](src/preset.ts)               | Storybook preset: registers the Vite plugin                                                    |
| [src/node/](src/node/)                       | Vite plugin, generated wrapper, preview-file detection                                         |
| [src/runtime/](src/runtime/)                 | Browser runtime the wrapper imports: resolution and the sessionStorage cache                   |
| [src/vitest.setup.ts](src/vitest.setup.ts)   | Setup file the plugin adds first under Vitest                                                  |
| [test/](test/)                               | Unit tests (Vitest, in Node), mirroring the layout of `src/`                                   |
| [fixtures/](fixtures/)                       | Storybook projects used by the integration tests: 7, 9 (CSF factories), 10, 10 (CSF factories) |
| [e2e/](e2e/)                                 | Playwright tests run against every fixture, as a static build and on the dev server            |
| [scripts/fixtures.mjs](scripts/fixtures.mjs) | Runs install, build or test in every fixture at once (used by the `fixtures:*` commands)       |

### Compared with Storybook's addon template

The project follows [`storybookjs/addon-kit`](https://github.com/storybookjs/addon-kit) where it can: `src/preset.ts` exported as `./preset`, tsup, ESLint, Prettier, pnpm, the `storybook` metadata block and `storybook-addons` keyword in `package.json`, and the same names for the scripts both have (`build`, `build:watch`, `lint`, `format`). It differs where the addon needs something else:

| Addon kit                                                                          | Here                                                              | Why                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`, `src/manager.tsx`, `src/preview.ts`                                | Only `src/preset.ts`, plus `src/runtime/` exported as `./runtime` | Consumers import nothing and there's no UI: the toolbar is Storybook's own. The runtime is only for the generated wrapper, so it isn't the main (`.`) export. |
| Preset built as ESM for Node 20.19 (Storybook 10)                                  | Preset built as ESM and CJS for Node 18                           | Storybook 7 and 8 load presets with `require()`.                                                                                                              |
| Entries listed in `package.json` `bundler` (manager, preview, node)                | Entries listed in [tsup.config.ts](tsup.config.ts)                | The browser entries are neither manager nor preview code.                                                                                                     |
| A `.storybook/` at the root for developing the addon                               | [fixtures/](fixtures/), one Storybook per version                 | The addon hooks into how each Storybook version loads the preview, so it's developed and tested against several versions at once.                             |
| No tests                                                                           | Unit tests in `test/`, Playwright in `e2e/`                       | Same reason.                                                                                                                                                  |
| [auto](https://github.com/intuit/auto) releases from CI with an `NPM_TOKEN` secret | `npm version` and `npm publish` from the maintainer's machine     | No release workflow or stored npm token to maintain. See [Releases](#releases).                                                                               |

## Commands

| Command                     | What it does                                                                   |
| --------------------------- | ------------------------------------------------------------------------------ |
| `pnpm install`              | Install dependencies                                                           |
| `pnpm build`                | Build `dist/` with tsup (preset as ESM + CJS; runtime and Vitest setup as ESM) |
| `pnpm build:watch`          | Rebuild `dist/` on every change                                                |
| `pnpm test`                 | Run unit tests with Vitest (`pnpm test:watch` to rerun on change)              |
| `pnpm lint` / `pnpm format` | ESLint / Prettier                                                              |
| `pnpm typecheck`            | TypeScript, no emit                                                            |
| `pnpm check`                | Lint, format check, type-check, build and unit tests, in order                 |
| `pnpm fixtures:install`     | Install the fixture Storybooks, each with its own copy of the built addon      |
| `pnpm fixtures:build`       | Build every fixture Storybook                                                  |
| `pnpm e2e`                  | Playwright tests against every fixture, built and in dev (Chrome)              |
| `pnpm fixtures:test`        | Vitest in the fixtures that support it                                         |
| `pnpm test:integration`     | The four `fixtures:*` / `e2e` steps above, in order (run `pnpm build` first)   |

## Integration tests

There's no CI; run them locally (about a minute). `prepublishOnly` also runs them before every publish.

```sh
pnpm build && pnpm test:integration
```

- Each fixture is its own pnpm project (own `pnpm-workspace.yaml` and lockfile). Different Storybook versions can't share a `node_modules`, because Storybook packages resolve each other by name from wherever they're installed.
- Fixtures install the addon from the repo root as a packed copy (`file:../..`). After changing the addon, run `pnpm build && pnpm fixtures:install` before testing again.
- Narrow a local Playwright run with `E2E_FIXTURES=sb7,sb10` and `E2E_MODES=static` (or `dev`).
- Playwright uses the installed Chrome (`channel: 'chrome'`), so no browser download is needed.

## Releases

Releases are published from a maintainer's machine. Start from an up-to-date `main` with a clean working tree.

1. **Bump the version.** This updates `package.json`, regenerates `CHANGELOG.md` with [auto-changelog](https://github.com/cookpete/auto-changelog) (the `version` script), commits both, and tags the commit (`v0.1.0` and so on):

   ```sh
   npm version minor   # or patch / major
   ```

   The changelog lists the commit subjects (and merged pull requests) since the previous tag, so write subjects that read well as release notes. Don't edit `CHANGELOG.md` by hand; it's rewritten on every release.

2. **Publish.** `prepublishOnly` first runs `pnpm check` (lint, format, type-check, build, unit tests) and then the integration tests, so a failure stops the publish and `dist/` is always freshly built. It takes about a minute and needs Chrome installed:

   ```sh
   npm login           # once per machine
   npm publish         # asks for your 2FA code if your account has it on
   ```

3. **Push the commit and tag:** `git push --follow-tags`.
