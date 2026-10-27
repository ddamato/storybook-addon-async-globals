// Tests for session-cache.ts: storing, reading and clearing cached values, and what happens when sessionStorage can't
// be used.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePreviewModule } from '../../src/runtime/resolve';
import { CACHE_PREFIX, createSessionCache, isJsonSafe } from '../../src/runtime/session-cache';

/** Minimal Storage implementation, since the unit tests run in Node. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
  entries() {
    return Object.fromEntries(this.items);
  }
}

const consoleWarn = () => vi.mocked(console.warn);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isJsonSafe', () => {
  it.each([
    ['a string', 'ocean'],
    ['a number', 42],
    ['a boolean', false],
    ['null', null],
    ['nested plain data', { items: [{ value: 'ocean', tokens: { color: '#00f' } }], count: 1 }],
  ])('accepts %s', (_label, value) => {
    expect(isJsonSafe(value)).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a function', () => 'x'],
    ['a date', new Date(0)],
    ['a map', new Map()],
    ['a bigint', 1n],
    ['data containing undefined', { value: undefined }],
    ['data containing a function', [{ render: () => null }]],
  ])('rejects %s', (_label, value) => {
    expect(isJsonSafe(value)).toBe(false);
  });
});

describe('createSessionCache', () => {
  it('stores values under the launch id and path, and reads them back', () => {
    const storage = new MemoryStorage();
    const cache = createSessionCache('launch-1', storage)!;

    cache.set('globalTypes.theme.toolbar.items', [{ value: 'ocean' }]);

    expect(storage.entries()).toEqual({
      [`${CACHE_PREFIX}launch-1:globalTypes.theme.toolbar.items`]: '[{"value":"ocean"}]',
    });
    expect(cache.get('globalTypes.theme.toolbar.items')).toEqual({ value: [{ value: 'ocean' }] });
    expect(cache.get('initialGlobals.theme')).toBeUndefined();
  });

  it('keeps cached values across page loads in the same launch', () => {
    const storage = new MemoryStorage();
    createSessionCache('launch-1', storage)!.set('initialGlobals.theme', 'ocean');

    const reloaded = createSessionCache('launch-1', storage)!;

    expect(reloaded.get('initialGlobals.theme')).toEqual({ value: 'ocean' });
  });

  it('distinguishes a cached null from a miss', () => {
    const cache = createSessionCache('launch-1', new MemoryStorage())!;

    cache.set('initialGlobals.theme', null);

    expect(cache.get('initialGlobals.theme')).toEqual({ value: null });
  });

  it('removes entries from other launches and leaves unrelated keys alone', () => {
    const storage = new MemoryStorage();
    storage.setItem(`${CACHE_PREFIX}old:initialGlobals.theme`, '"forest"');
    storage.setItem(`${CACHE_PREFIX}launch-2:initialGlobals.theme`, '"ocean"');
    storage.setItem('someone-else', 'kept');

    const cache = createSessionCache('launch-2', storage)!;

    expect(storage.entries()).toEqual({
      [`${CACHE_PREFIX}launch-2:initialGlobals.theme`]: '"ocean"',
      'someone-else': 'kept',
    });
    expect(cache.get('initialGlobals.theme')).toEqual({ value: 'ocean' });
  });

  it("doesn't confuse a launch id that starts with another one", () => {
    const storage = new MemoryStorage();
    storage.setItem(`${CACHE_PREFIX}launch-10:initialGlobals.theme`, '"forest"');

    const cache = createSessionCache('launch-1', storage)!;

    expect(cache.get('initialGlobals.theme')).toBeUndefined();
    expect(storage.length).toBe(0);
  });

  it("skips values that can't be stored as JSON and warns", () => {
    const storage = new MemoryStorage();
    const cache = createSessionCache('launch-1', storage)!;

    cache.set('globalTypes.theme.toolbar.items', [{ since: new Date(0) }]);
    cache.set('initialGlobals.theme', undefined);

    expect(storage.length).toBe(0);
    expect(consoleWarn()).toHaveBeenCalledTimes(2);
    expect(consoleWarn().mock.calls[0]?.[0]).toContain('globalTypes.theme.toolbar.items');
  });

  it('treats an unreadable entry as a miss and removes it', () => {
    const storage = new MemoryStorage();
    storage.setItem(`${CACHE_PREFIX}launch-1:initialGlobals.theme`, '{not json');
    const cache = createSessionCache('launch-1', storage)!;

    expect(cache.get('initialGlobals.theme')).toBeUndefined();
    expect(storage.length).toBe(0);
  });

  it('keeps working when storage rejects writes, warning once', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
    const cache = createSessionCache('launch-1', storage)!;

    expect(() => cache.set('initialGlobals.theme', 'ocean')).not.toThrow();
    expect(() => cache.set('initialGlobals.locale', 'en')).not.toThrow();
    expect(cache.get('initialGlobals.theme')).toBeUndefined();
    expect(consoleWarn()).toHaveBeenCalledTimes(1);
  });

  it('returns no cache when there is no sessionStorage', () => {
    // Node has no sessionStorage.
    expect(createSessionCache('launch-1')).toBeUndefined();
  });

  it('returns no cache when sessionStorage is blocked', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access denied', 'SecurityError');
      },
    });
    try {
      expect(createSessionCache('launch-1')).toBeUndefined();
    } finally {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
  });

  it('lets a refresh skip the functions entirely', async () => {
    const storage = new MemoryStorage();
    const items = vi.fn(async () => [{ value: 'ocean', title: 'Ocean' }]);
    const load = () => ({ default: { globalTypes: { theme: { toolbar: { items } } } } });
    const resolve = (mod: ReturnType<typeof load>) =>
      resolvePreviewModule(mod, createSessionCache('launch-1', storage));

    const first = load();
    await resolve(first);
    const refreshed = load();
    await resolve(refreshed);

    expect(items).toHaveBeenCalledTimes(1);
    expect(refreshed.default.globalTypes.theme.toolbar.items).toEqual([{ value: 'ocean', title: 'Ocean' }]);
  });
});
