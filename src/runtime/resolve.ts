// The core of the addon. Finds every function inside globalTypes, initialGlobals and globals, calls them all at once,
// and puts each result where its function was. Also handles failures, the 10-second deadline and the cache.

export const GLOBAL_KEYS = ['globalTypes', 'initialGlobals', 'globals'] as const;
export type GlobalKey = (typeof GLOBAL_KEYS)[number];

/** One deadline shared by every function, in milliseconds. */
export const TIMEOUT = 10_000;

/** Stores resolved values between page loads. session-cache.ts provides the sessionStorage implementation. */
export interface ResolutionCache {
  get(path: string): { value: unknown } | undefined;
  set(path: string, value: unknown): void;
}

/** The consumer's preview module, as the generated wrapper imports it. */
export interface PreviewModule {
  default?: unknown;
  globalTypes?: unknown;
  initialGlobals?: unknown;
  globals?: unknown;
  [name: string]: unknown;
}

/** What the generated wrapper re-exports in place of the consumer's own exports. */
export interface ResolvedPreviewModule {
  default: unknown;
  globalTypes: unknown;
  initialGlobals: unknown;
  globals: unknown;
}

type Loader = () => unknown;
type Container = Record<PropertyKey, unknown>;
type Outcome = { ok: true; value: unknown } | { ok: false };

interface Task {
  /** Dot path from the section key, such as `globalTypes.theme.toolbar.items`. Used as the cache key. */
  path: string;
  fn: Loader;
  apply(value: unknown): void;
  /** Removes the whole global the function belongs to, so Storybook can still load without it. */
  drop(): void;
}

const LOG_PREFIX = '[async-globals]';
const TIMED_OUT = Symbol('timed out');

const isRecord = (value: unknown): value is Container => value !== null && typeof value === 'object';

// Only plain objects and arrays are walked; class instances, dates and the like are values in their own right.
const isWalkable = (value: unknown): value is Container => {
  if (Array.isArray(value)) return true;
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

// CSF factories: definePreview() returns { _tag: 'Preview', input, composed }.
const isCsfFactoriesPreview = (value: unknown): value is { input: unknown; composed: unknown } =>
  isRecord(value) && value._tag === 'Preview';

function collectValue(value: unknown, path: string, set: (v: unknown) => void, drop: () => void, tasks: Task[]) {
  if (typeof value === 'function') {
    tasks.push({ path, fn: value as Loader, apply: set, drop });
  } else if (isWalkable(value)) {
    for (const key of Object.keys(value)) {
      collectValue(value[key], `${path}.${key}`, (v) => (value[key] = v), drop, tasks);
    }
  }
}

function collectSection(container: Container, key: GlobalKey, tasks: Task[]) {
  const section = container[key];
  if (typeof section === 'function') {
    collectValue(
      section,
      key,
      (v) => (container[key] = v),
      () => delete container[key],
      tasks,
    );
  } else if (isWalkable(section)) {
    // Each entry is one global (`globalTypes.theme`); a failure anywhere inside it drops that entry.
    for (const name of Object.keys(section)) {
      collectValue(
        section[name],
        `${key}.${name}`,
        (v) => (section[name] = v),
        () => delete section[name],
        tasks,
      );
    }
  }
}

function collectAnnotations(annotations: unknown, tasks: Task[]) {
  if (!isRecord(annotations)) return;
  for (const key of GLOBAL_KEYS) collectSection(annotations, key, tasks);
}

const describeError = (error: unknown) => (error === TIMED_OUT ? 'it did not settle before the timeout' : error);

/**
 * Calls every function found in the preview module's globals, waits for them, and writes the results back into the
 * consumer's objects. Returns the values the generated wrapper should re-export.
 */
export async function resolvePreviewModule(
  mod: PreviewModule,
  cache?: ResolutionCache,
): Promise<ResolvedPreviewModule> {
  const tasks: Task[] = [];
  const preview = mod.default;

  if (isCsfFactoriesPreview(preview)) {
    // definePreview() has already merged its input: resolve the consumer's input and Storybook's merged copy.
    collectAnnotations(preview.input, tasks);
    collectAnnotations(preview.composed, tasks);
  } else {
    collectAnnotations(preview, tasks);
  }

  // Named exports: the bindings can't be reassigned from here, so their resolved values are returned instead.
  const named: Container = {};
  for (const key of GLOBAL_KEYS) named[key] = mod[key];
  for (const key of GLOBAL_KEYS) collectSection(named, key, tasks);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => (timer = setTimeout(() => resolve(TIMED_OUT), TIMEOUT)));

  // The same function can appear more than once (CSF factories input and composed, default and named exports).
  const inFlight = new Map<Loader, Promise<Outcome>>();

  const settle = async ({ path, fn }: Task): Promise<Outcome> => {
    const cached = cache?.get(path);
    if (cached) return { ok: true, value: cached.value };
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => fn()),
        deadline.then((reason) => Promise.reject(reason)),
      ]);
      cache?.set(path, value);
      return { ok: true, value };
    } catch (error) {
      console.error(
        `${LOG_PREFIX} ${path} failed, so its global was removed. Add a try/catch to this function that returns a fallback value.`,
        describeError(error),
      );
      return { ok: false };
    }
  };

  try {
    await Promise.all(
      tasks.map(async (task) => {
        let outcome = inFlight.get(task.fn);
        if (!outcome) {
          outcome = settle(task);
          inFlight.set(task.fn, outcome);
        }
        const result = await outcome;
        if (result.ok) task.apply(result.value);
        else task.drop();
      }),
    );
  } finally {
    clearTimeout(timer);
  }

  return {
    default: preview,
    globalTypes: named.globalTypes,
    initialGlobals: named.initialGlobals,
    globals: named.globals,
  };
}
