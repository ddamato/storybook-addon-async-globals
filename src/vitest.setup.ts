// Runs first when stories are tested with Vitest. Loading the wrapper here resolves the consumer's functions before
// Storybook's or the consumer's own setup files read the globals.
// @ts-expect-error The Vite plugin generates this module (see src/node/plugin.ts); it never exists on disk.
import * as wrapper from 'virtual:async-globals/wrapper';

// CSF factories: the wrapper's `composed` is a promise that settles once everything is resolved.
await (wrapper.default as { composed?: unknown } | undefined)?.composed;
