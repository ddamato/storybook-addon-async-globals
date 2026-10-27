import { expect } from 'storybook/test';
import { Show } from './Show';

export default { title: 'Demo', component: Show };

export const Basic = {
  render: (_args: unknown, context: { globals: { theme?: string } }) => <Show theme={context.globals.theme} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const themed = canvasElement.querySelector('#themed');
    await expect(themed?.getAttribute('data-theme')).toBe('forest');
    await expect(themed?.getAttribute('data-themes')).toBe('2');
    await expect(themed?.getAttribute('data-locales')).toBe('English (fallback)');
  },
};
