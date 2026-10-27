import { Show } from './Show';

export default { title: 'Demo', component: Show };

export const Basic = {
  render: (_args: unknown, context: { globals: { theme?: string } }) => <Show theme={context.globals.theme} />,
};
