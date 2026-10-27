# storybook-addon-async-globals

Load Storybook globals from anywhere: an API, a design-token service, a CMS. Write `globalTypes` and `initialGlobals` as you always do, but with an `async` function wherever a value has to be fetched. The addon resolves those functions before your preview starts, so the toolbar and your decorators only ever see plain values. You don't import anything from the addon.

```ts
// .storybook/preview.ts
const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        icon: 'paintbrush',
        items: async () => {
          const themes = await fetch('https://tokens.example.com/themes.json').then((r) => r.json());
          return themes.map((t) => ({ value: t.id, title: t.name }));
        },
      },
    },
  },
};
```

- Works with Storybook 7, 8, 9 and 10 on the Vite builder, including CSF factories (`definePreview`) on 9 and 10.
- Values are loaded once per Storybook launch and cached for the browser session.
- Static builds fetch in the visitor's browser, so source changes show up without a redeploy.

## Install

```sh
npm install --save-dev storybook-addon-async-globals
# or: pnpm add -D storybook-addon-async-globals / yarn add -D storybook-addon-async-globals
```

Register it in `.storybook/main.ts`. That's the only setup.

```ts
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  addons: ['storybook-addon-async-globals'],
};

export default config;
```

Requirements: Storybook 7.0 or later with a Vite-based framework (`@storybook/react-vite`, `@storybook/vue3-vite`, and so on), and Vite 4 or later. The test suite runs on `@storybook/react-vite`. The Webpack builder isn't supported.

## Writing async globals

Any value inside `globalTypes` or `initialGlobals` can be a function. The addon calls it with no arguments, waits for the result, and puts the result where the function was.

```ts
// .storybook/preview.ts
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        dynamicTitle: true,
        items: async () => {
          try {
            const themes = await fetch('https://tokens.example.com/themes.json').then((r) => r.json());
            return themes.map((t) => ({ value: t.id, title: t.name }));
          } catch {
            return [{ value: 'light', title: 'Light' }];
          }
        },
      },
    },
    locale: {
      description: 'Locale',
      toolbar: { icon: 'globe', items: ['en', 'fr'] }, // static values work as before
    },
  },
  initialGlobals: {
    theme: async () => {
      try {
        const { id } = await fetch('https://tokens.example.com/default.json').then((r) => r.json());
        return id;
      } catch {
        return 'light';
      }
    },
    locale: 'en',
  },
};

export default preview;
```

The rules:

- **Where:** anywhere inside `globalTypes` and `initialGlobals` (`globals` on Storybook 7). The function can be a whole global type, `toolbar`, `items`, a single item, or an initial value. Other keys, such as `decorators`, `loaders` and `parameters`, are never touched.
- **What:** sync functions, `async` functions and functions that return a promise all work. They take no arguments.
- **When:** all functions run in parallel before Storybook starts. Their results aren't searched for more functions.
- **Formats:** a default export, named exports (`export const initialGlobals = { … }`) and CSF factories (`export default definePreview({ … })`) are all supported.

Your `preview.ts` file isn't modified. When Storybook loads it, the addon's Vite plugin serves a small wrapper module that imports your file and resolves the functions.

## Caching

Results are stored in `sessionStorage` for the current Storybook launch:

| Situation                                            | Fetches again? |
| ---------------------------------------------------- | -------------- |
| Refreshing the page                                  | No             |
| Opening Storybook in a new tab or window             | Yes            |
| Restarting `storybook dev`, or deploying a new build | Yes            |
| Visiting a deployed Storybook again in a new session | Yes            |

- Data is never built into the bundle. A deployed Storybook fetches in the visitor's browser, so changes at the source show up on their next visit.
- Only plain JSON data is cached: objects, arrays, strings, finite numbers, booleans and `null`. A function that returns anything else (a `Date`, `undefined`, a class instance) runs again on every page load, and you'll see a console warning.
- If `sessionStorage` is unavailable, nothing is cached and the functions run on every page load.

## Errors, fallbacks and timeouts

Give every function a `try`/`catch` that returns a fallback value, as in the examples above. Storybook then always gets a usable value, even when the source is down.

- **Timeout:** all functions share one 10-second deadline. The addon can't cancel your function, so at the deadline it stops waiting and treats the function as failed. To get your own fallback on a slow request instead, give `fetch` its own deadline so it lands in your `catch`:

  ```ts
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  ```

- **If a function throws (or misses the deadline):** the addon removes the whole global that contains it, so Storybook still loads without that toolbar item, and it logs `[async-globals] <path> failed, so its global was removed…`. Failures aren't cached, so the next refresh tries again.
- **Fallbacks are cached:** a value returned from your `catch` is cached like any other until the session ends. Open a new tab to retry sooner.

While functions run, the canvas shows Storybook's normal loading state.

## Recipe: themes from an external source

Load the theme list, show it in the toolbar, and give a decorator each theme's data. The data travels on the toolbar items themselves:

```tsx
// .storybook/preview.tsx
import type { Preview } from '@storybook/react-vite';
import { applyTheme } from './applyTheme';

type ThemeItem = { value: string; title: string; tokens: Record<string, string> };

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        icon: 'paintbrush',
        dynamicTitle: true,
        // On Storybook 10 with TypeScript, see the TypeScript section below.
        items: async () => {
          try {
            const themes = await fetch('https://tokens.example.com/themes.json').then((r) => r.json());
            // Extra fields such as `tokens` ride along; the toolbar only uses `value` and `title`.
            return themes.map((t) => ({ value: t.id, title: t.name, tokens: t.tokens }));
          } catch {
            return [{ value: 'default', title: 'Default', tokens: DEFAULT_TOKENS }];
          }
        },
      },
    },
  },
  decorators: [
    (Story, { globals, globalTypes }) => {
      const themes: ThemeItem[] = globalTypes.theme.toolbar.items;
      const theme = themes.find((item) => item.value === globals.theme) ?? themes[0];
      applyTheme(theme.tokens);
      return <Story />;
    },
  ],
};

export default preview;
```

- Storybook passes `globalTypes` to decorators from 8.3 onward. On Storybook 7 and 8.0–8.2, read the resolved values from your own config object instead: `preview.globalTypes.theme.toolbar.items`. The addon writes results back into it.
- Item data is sent to the Storybook UI along with the toolbar. That's fine for theme tokens; keep very large payloads out of toolbar items.
- Nothing here is specific to themes. The same pattern works for locales, brands, feature flags or API environments.

## Recipe: globals that depend on each other

**One function needs data another one loads.** Share a promise in your `preview.ts`:

```ts
let themesRequest: Promise<Theme[]> | undefined;
const loadThemes = () => (themesRequest ??= fetch('https://tokens.example.com/themes.json').then((r) => r.json()));

// globalTypes.theme.toolbar.items: async () => (await loadThemes()).map(...)
// initialGlobals.theme:            async () => (await loadThemes())[0].id
```

Both share one request on the first load. After that, both values come from the cache.

**Options that change when another global changes** (pick a brand, and the theme list narrows) aren't supported: toolbar items are fixed once Storybook starts. Model the globals as independent choices instead, and combine them in a decorator:

```ts
// globalTypes: brand (Acme, Globex) and mode (light, dark), each loaded separately
const theme = themes.find((t) => t.brand === globals.brand && t.mode === globals.mode) ?? fallbackTheme;
```

If the choices really don't line up, use a single global with combined values such as `acme/dark`.

## TypeScript

- **Storybook 7, 8 and 9** accept functions in globals as is.
- **Storybook 10** types `toolbar.items` as an array, so a function there is a type error, even though it works. Either add a comment:

  ```ts
  // @ts-expect-error Resolved by storybook-addon-async-globals before Storybook reads it
  items: async () => { /* ... */ },
  ```

  or make the whole global type the function, which type-checks on Storybook 10:

  ```ts
  theme: async () => ({ description: 'Theme', toolbar: { icon: 'paintbrush', items: await loadThemeItems() } }),
  ```

  Storybook marks the loose typing that allows this second form as deprecated, so it may stop type-checking in Storybook 11.

- **CSF factories:** `definePreview`'s `initialGlobals` only accepts globals declared in your renderer's types. That's Storybook's own rule, and it applies to plain values too.

## Testing

- **Storybook's Vitest addon** (`@storybook/addon-vitest` on 9 and 10) works without changes. Under Vitest, the addon adds its own setup file first, so globals are resolved before Storybook's or your setup file runs. The test suite covers this on 9 and 10, including CSF factories. Storybook 8.6's `@storybook/experimental-addon-test` uses the same mechanism and worked in development, but isn't part of the test suite.
- **URLs:** for data served from `staticDirs`, use root-relative URLs such as `fetch('/themes.json')`. A relative URL (`./themes.json`) resolves against the Vitest page, not the site root.
- **Mocking:** your functions are ordinary code, so mock the network the way you already do in tests (for example with MSW).
- Test runners that don't use Vite, such as Jest, don't go through the addon, so the functions stay unresolved there.

## Storybook versions

| Storybook | Notes                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| 10.x      | Supported, including CSF factories. See [TypeScript](#typescript) for `toolbar.items`.            |
| 9.x       | Supported, including CSF factories.                                                               |
| 8.x       | Supported. Decorators receive `globalTypes` from 8.3.                                             |
| 7.x       | Supported. Initial values go in `globals`; decorators read `globalTypes` from your config object. |
| 6.x       | Not supported.                                                                                    |

The test suite runs on Storybook 7.6, 9.1 (CSF factories) and 10.6 (plain and CSF factories). Storybook 8 loads the preview the same way 7 does and isn't tested separately.

## FAQ

**Does it change my `preview.ts`?**
No. When Storybook imports your preview file, the addon's Vite plugin serves a generated wrapper that imports your file, resolves the functions, and passes everything else through unchanged. Your stories and test setup files keep importing your file directly; the addon updates its objects in place, so they also see the resolved values.

**Can I force a refetch?**
Open Storybook in a new tab, restart `storybook dev`, or clear the `async-globals:*` keys from `sessionStorage`.

**Can a function read other globals, or the current story?**
No. Functions run once, before Storybook starts, and take no arguments. To share data between functions, see [globals that depend on each other](#recipe-globals-that-depend-on-each-other).

**Why is my toolbar item missing?**
Its function threw an error or missed the deadline, so the addon removed that global. Look for `[async-globals] … failed` in the browser console, and add a `try`/`catch` that returns a fallback.

**Does it work with the Webpack builder?**
No. The addon relies on Vite to serve the wrapper module.

**What does the addon log?**

| Message                                                                 | Meaning                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `[async-globals] <path> failed, so its global was removed…`             | The function threw or missed the deadline                      |
| `[async-globals] <path> returned a value that can't be stored as JSON…` | That function runs on every page load instead of being cached  |
| `[async-globals] Couldn't write to sessionStorage…`                     | Storage is full; values are loaded again on the next page load |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
