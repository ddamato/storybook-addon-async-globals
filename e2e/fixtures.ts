// The fixture Storybooks the end-to-end tests run against, and the ports they're served on.
export interface Fixture {
  name: string;
  staticPort: number;
  devPort: number;
}

export const FIXTURES: Fixture[] = [
  { name: 'sb7', staticPort: 6107, devPort: 6207 },
  { name: 'sb9-csf4', staticPort: 6119, devPort: 6219 },
  { name: 'sb10', staticPort: 6110, devPort: 6210 },
  { name: 'sb10-csf4', staticPort: 6120, devPort: 6220 },
];

export type Mode = 'static' | 'dev';
export const MODES: Mode[] = ['static', 'dev'];

/** `E2E_FIXTURES=sb7,sb10` and `E2E_MODES=static` narrow a local run; by default everything runs. */
export function selected<T extends string>(all: T[], env: string | undefined): T[] {
  const wanted = env?.split(',').map((value) => value.trim());
  return wanted?.length ? all.filter((value) => wanted.includes(value)) : all;
}
