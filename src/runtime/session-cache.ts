// Remembers resolved values in sessionStorage, so refreshing the page doesn't run the functions again. Values belong to
// one Storybook launch: restarting Storybook or deploying a new build fetches fresh data.
import type { ResolutionCache } from './resolve';

export const CACHE_PREFIX = 'async-globals:';

const LOG_PREFIX = '[async-globals]';

/** Values that survive a JSON round trip unchanged: the only ones the cache stores. */
export function isJsonSafe(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.values(value).every(isJsonSafe);
}

/**
 * Caches resolved values for the current browser session under `async-globals:<launchId>:<path>`. A new Storybook
 * launch (dev server restart or new build) has a new launch id, so it starts empty. Returns no cache when
 * sessionStorage is unavailable (or blocked, where reading it throws); the functions then run on every page load.
 */
export function createSessionCache(launchId: string, storage = getSessionStorage()): ResolutionCache | undefined {
  if (!storage) return undefined;
  const prefix = `${CACHE_PREFIX}${launchId}:`;
  pruneOtherLaunches(storage, prefix);
  let warnedFull = false;

  return {
    get(path) {
      const key = prefix + path;
      try {
        const raw = storage.getItem(key);
        return raw === null ? undefined : { value: JSON.parse(raw) as unknown };
      } catch {
        storage.removeItem(key);
        return undefined;
      }
    },
    set(path, value) {
      if (!isJsonSafe(value)) {
        console.warn(
          `${LOG_PREFIX} ${path} returned a value that can't be stored as JSON, so it will run again on every page load.`,
        );
        return;
      }
      try {
        storage.setItem(prefix + path, JSON.stringify(value));
      } catch {
        if (!warnedFull)
          console.warn(`${LOG_PREFIX} Couldn't write to sessionStorage (it may be full); values will be loaded again.`);
        warnedFull = true;
      }
    },
  };
}

function getSessionStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

// Entries from earlier launches can never be read again (the launch id changed), so remove them.
function pruneOtherLaunches(storage: Storage, current: string) {
  try {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(CACHE_PREFIX) && !key.startsWith(current)) storage.removeItem(key);
    }
  } catch {
    // Best effort.
  }
}
