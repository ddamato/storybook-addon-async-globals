import type { Preview } from '@storybook/react';

type Theme = { id: string; name: string; tokens: { color: string } };
type ThemeItem = { value: string; title: string; tokens: Theme['tokens'] };

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        dynamicTitle: true,
        items: async () => {
          const themes: Theme[] = await fetch('/themes.json').then((r) => r.json());
          return themes.map((t) => ({ value: t.id, title: t.name, tokens: t.tokens }));
        },
      },
    },
    locale: {
      description: 'Locale',
      toolbar: {
        title: 'Locale',
        icon: 'globe',
        // locales.json doesn't exist, so the toolbar shows the fallback from the catch.
        items: async () => {
          try {
            const response = await fetch('/locales.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
          } catch {
            return [{ value: 'en', title: 'English (fallback)' }];
          }
        },
      },
    },
  },
  globals: {
    theme: async () => (await fetch('/default.json').then((r) => r.json())).id,
  },
  decorators: [
    (Story, context) => {
      // Storybook 7 and 8.0–8.2 don't pass globalTypes to decorators; the addon resolves the preview object in place.
      const globalTypes = context.globalTypes ?? preview.globalTypes!;
      const themes: ThemeItem[] = globalTypes.theme.toolbar.items;
      const locales: { title: string }[] = globalTypes.locale.toolbar.items;
      const theme = themes.find((item) => item.value === context.globals.theme) ?? themes[0]!;
      return (
        <div
          id="themed"
          data-version="1"
          data-theme={theme.value}
          data-color={theme.tokens.color}
          data-themes={themes.length}
          data-locales={locales.map((locale) => locale.title).join(',')}
          style={{ color: theme.tokens.color }}
        >
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
