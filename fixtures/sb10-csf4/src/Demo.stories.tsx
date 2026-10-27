import { expect } from 'storybook/test';
import preview from '../.storybook/preview';
import { Show } from './Show';

const meta = preview.meta({ title: 'Demo', component: Show });

export const Basic = meta.story({
  render: (_args, context) => <Show theme={context.globals.theme} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const themed = canvasElement.querySelector('#themed');
    await expect(themed?.getAttribute('data-theme')).toBe('forest');
    await expect(themed?.getAttribute('data-themes')).toBe('2');
    await expect(themed?.getAttribute('data-locales')).toBe('English (fallback)');
  },
});
