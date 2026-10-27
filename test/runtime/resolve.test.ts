// Tests for resolve.ts: finding and calling functions, failures, timeouts and caching.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePreviewModule, TIMEOUT, type ResolutionCache } from '../../src/runtime/resolve';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const memoryCache = (initial: Record<string, unknown> = {}): ResolutionCache & { store: Map<string, unknown> } => {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: (path) => (store.has(path) ? { value: store.get(path) } : undefined),
    set: (path, value) => void store.set(path, value),
  };
};

// Failures are logged with console.error; keep the test output quiet and let tests inspect the calls.
const consoleError = () => vi.mocked(console.error);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('resolvePreviewModule', () => {
  it('resolves a nested async function in place, keeping the consumer objects', async () => {
    const toolbar = { title: 'Theme', items: async () => [{ value: 'ocean', title: 'Ocean' }] };
    const theme = { description: 'Theme', toolbar };
    const preview = { globalTypes: { theme } };

    const result = await resolvePreviewModule({ default: preview });

    expect(result.default).toBe(preview);
    expect(preview.globalTypes.theme).toBe(theme);
    expect(theme.toolbar).toBe(toolbar);
    expect(toolbar.items).toEqual([{ value: 'ocean', title: 'Ocean' }]);
  });

  it('treats sync, async and promise-returning functions the same', async () => {
    const preview = {
      initialGlobals: {
        sync: () => 'a',
        async: async () => 'b',
        promise: () => Promise.resolve('c'),
      },
    };

    await resolvePreviewModule({ default: preview });

    expect(preview.initialGlobals).toEqual({ sync: 'a', async: 'b', promise: 'c' });
  });

  it('resolves functions at any depth, including array entries and whole globals', async () => {
    const preview = {
      globalTypes: {
        theme: async () => ({ toolbar: { items: ['light'] } }),
        locale: { toolbar: { items: ['en', async () => ({ value: 'fr', title: 'French' })] } },
      },
    };

    await resolvePreviewModule({ default: preview });

    expect(preview.globalTypes.theme).toEqual({ toolbar: { items: ['light'] } });
    expect(preview.globalTypes.locale.toolbar.items).toEqual(['en', { value: 'fr', title: 'French' }]);
  });

  it('resolves a function that replaces a whole section', async () => {
    const preview = { initialGlobals: async () => ({ theme: 'ocean' }) };

    await resolvePreviewModule({ default: preview });

    expect(preview.initialGlobals).toEqual({ theme: 'ocean' });
  });

  it('does not walk into a resolved value', async () => {
    const inner = async () => 'never called';
    const preview: { globalTypes: Record<string, unknown> } = {
      globalTypes: { theme: async () => ({ toolbar: { items: inner } }) },
    };

    await resolvePreviewModule({ default: preview });

    expect(preview.globalTypes.theme).toEqual({ toolbar: { items: inner } });
  });

  it('walks globalTypes, initialGlobals and globals only', async () => {
    const decorator = () => null;
    const transform = () => 'source';
    const preview = {
      globals: { theme: async () => 'ocean' },
      decorators: [decorator],
      parameters: { docs: { source: { transform } } },
    };

    await resolvePreviewModule({ default: preview });

    expect(preview.globals).toEqual({ theme: 'ocean' });
    expect(preview.decorators[0]).toBe(decorator);
    expect(preview.parameters.docs.source.transform).toBe(transform);
  });

  it('leaves non-plain objects alone', async () => {
    class Theme {
      load = async () => 'not a global loader';
    }
    const instance = new Theme();
    const date = new Date(0);
    const preview = { globalTypes: { theme: { toolbar: { items: instance, since: date } } } };

    await resolvePreviewModule({ default: preview });

    expect(preview.globalTypes.theme.toolbar.items).toBe(instance);
    expect(typeof instance.load).toBe('function');
    expect(preview.globalTypes.theme.toolbar.since).toBe(date);
  });

  it('runs functions in parallel', async () => {
    const second = deferred<void>();
    const preview = {
      initialGlobals: {
        // Settles only once the second function has started, so sequential execution would never finish.
        first: async () => {
          await second.promise;
          return 'a';
        },
        second: async () => {
          second.resolve();
          return 'b';
        },
      },
    };

    await resolvePreviewModule({ default: preview });

    expect(preview.initialGlobals).toEqual({ first: 'a', second: 'b' });
  });

  describe('named exports', () => {
    it('updates exported objects in place and returns them', async () => {
      const globalTypes = { theme: { toolbar: { items: async () => ['ocean'] } } };

      const result = await resolvePreviewModule({ globalTypes });

      expect(result.globalTypes).toBe(globalTypes);
      expect(globalTypes.theme.toolbar.items).toEqual(['ocean']);
    });

    it('returns the resolved value of an exported function', async () => {
      const result = await resolvePreviewModule({ initialGlobals: async () => ({ theme: 'ocean' }) });

      expect(result.initialGlobals).toEqual({ theme: 'ocean' });
      expect(result.default).toBeUndefined();
      expect(result.globals).toBeUndefined();
    });

    it('calls a function shared by the default and named exports once', async () => {
      const items = vi.fn(async () => ['ocean']);
      const globalTypes = { theme: { toolbar: { items } } };

      await resolvePreviewModule({ default: { globalTypes }, globalTypes });

      expect(items).toHaveBeenCalledTimes(1);
      expect(globalTypes.theme.toolbar.items).toEqual(['ocean']);
    });
  });

  describe('CSF factories', () => {
    // Mirrors definePreview(): `composed` is a shallow merge, so each global object is shared with `input`.
    const definePreviewLike = (input: Record<string, Record<string, unknown>>) => ({
      _tag: 'Preview',
      input,
      composed: {
        globalTypes: { ...input.globalTypes },
        initialGlobals: { ...input.initialGlobals },
      },
    });

    it('resolves both input and composed, calling each function once', async () => {
      const items = vi.fn(async () => ['ocean']);
      const initialTheme = vi.fn(async () => 'ocean');
      const preview = definePreviewLike({
        globalTypes: { theme: { toolbar: { items } } },
        initialGlobals: { theme: initialTheme },
      });

      const result = await resolvePreviewModule({ default: preview });

      expect(result.default).toBe(preview);
      expect(items).toHaveBeenCalledTimes(1);
      expect(initialTheme).toHaveBeenCalledTimes(1);
      expect(preview.composed.globalTypes).toEqual({ theme: { toolbar: { items: ['ocean'] } } });
      expect(preview.composed.initialGlobals).toEqual({ theme: 'ocean' });
      expect(preview.input.initialGlobals).toEqual({ theme: 'ocean' });
    });

    it('drops a failed global from both input and composed', async () => {
      const preview = definePreviewLike({
        globalTypes: { theme: { toolbar: { items: async () => Promise.reject(new Error('offline')) } } },
        initialGlobals: {},
      });

      await resolvePreviewModule({ default: preview });

      expect(preview.input.globalTypes).toEqual({});
      expect(preview.composed.globalTypes).toEqual({});
    });
  });

  describe('failures', () => {
    it('drops the whole global and logs its path when a function rejects', async () => {
      const preview = {
        globalTypes: {
          theme: { toolbar: { items: async () => Promise.reject(new Error('offline')) } },
          locale: { toolbar: { items: ['en'] } },
        },
      };

      await resolvePreviewModule({ default: preview });

      expect(preview.globalTypes).toEqual({ locale: { toolbar: { items: ['en'] } } });
      expect(consoleError()).toHaveBeenCalledTimes(1);
      expect(consoleError().mock.calls[0]?.[0]).toContain('globalTypes.theme.toolbar.items');
    });

    it('handles a synchronous throw like a rejection', async () => {
      const preview = {
        initialGlobals: {
          theme: () => {
            throw new Error('boom');
          },
          locale: 'en',
        },
      };

      await resolvePreviewModule({ default: preview });

      expect(preview.initialGlobals).toEqual({ locale: 'en' });
    });

    it('removes a section whose own function fails', async () => {
      const preview: Record<string, unknown> = { initialGlobals: async () => Promise.reject(new Error('offline')) };

      await resolvePreviewModule({ default: preview });

      expect(preview).not.toHaveProperty('initialGlobals');
    });

    it('stops waiting at the shared deadline', async () => {
      vi.useFakeTimers();
      const preview = {
        globalTypes: {
          slow: { toolbar: { items: () => new Promise(() => {}) } },
          fast: { toolbar: { items: async () => ['ok'] } },
        },
      };

      const pending = resolvePreviewModule({ default: preview });
      await vi.advanceTimersByTimeAsync(TIMEOUT);
      await pending;

      expect(preview.globalTypes).toEqual({ fast: { toolbar: { items: ['ok'] } } });
      expect(consoleError().mock.calls[0]?.[0]).toContain('globalTypes.slow.toolbar.items');
      expect(consoleError().mock.calls[0]?.[1]).toBe('it did not settle before the timeout');
    });
  });

  describe('cache', () => {
    it('uses a cached value instead of calling the function', async () => {
      const items = vi.fn(async () => ['fresh']);
      const preview = { globalTypes: { theme: { toolbar: { items } } } };

      await resolvePreviewModule({ default: preview }, memoryCache({ 'globalTypes.theme.toolbar.items': ['cached'] }));

      expect(items).not.toHaveBeenCalled();
      expect(preview.globalTypes.theme.toolbar.items).toEqual(['cached']);
    });

    it('stores successful results by path and skips failures', async () => {
      const cache = memoryCache();
      const preview = {
        initialGlobals: {
          theme: async () => 'ocean',
          locale: async () => Promise.reject(new Error('offline')),
        },
      };

      await resolvePreviewModule({ default: preview }, cache);

      expect(Object.fromEntries(cache.store)).toEqual({ 'initialGlobals.theme': 'ocean' });
    });
  });
});
