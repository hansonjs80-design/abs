export const DEFAULT_STATS_CACHE_TTL_MS = 3 * 60 * 1000;

/**
 * Creates a TTL-backed in-memory cache that clears on configured window events.
 */
export function createStatsMemoryCache({
  ttlMs = DEFAULT_STATS_CACHE_TTL_MS,
  invalidateEvents = [],
} = {}) {
  const store = new Map();

  if (typeof window !== 'undefined' && Array.isArray(invalidateEvents)) {
    const events = new Set(invalidateEvents.filter(Boolean));
    if (events.has('clinic-stats-updated')) {
      events.add('clinic-stats-cache-invalidate');
    }
    events.forEach((eventName) => {
      window.addEventListener(eventName, () => {
        store.clear();
      });
    });
  }

  return {
    getEntry(key, now = Date.now()) {
      const entry = store.get(key);
      if (!entry) return null;
      if (now - entry.updatedAt > ttlMs) {
        store.delete(key);
        return null;
      }
      return entry;
    },
    get(key, now = Date.now()) {
      const entry = this.getEntry(key, now);
      return entry ? entry.value : null;
    },
    set(key, value, now = Date.now()) {
      store.set(key, { value, updatedAt: now });
      return value;
    },
    delete(key) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}

/**
 * Extracts entries from an ISO-date-keyed map within [startDate, endDate].
 */
export function sliceDateRecordByRange(record, startDate, endDate) {
  const result = {};
  if (!record || typeof record !== 'object') return result;

  Object.entries(record).forEach(([dateKey, value]) => {
    if (dateKey >= startDate && dateKey <= endDate) {
      result[dateKey] = value;
    }
  });

  return result;
}

/**
 * Finds the freshest cached range entry that matches or covers [startDate, endDate].
 */
export function findFreshCoveringRangeEntry(
  cacheMap,
  startDate,
  endDate,
  ttlMs,
  now = Date.now()
) {
  if (!(cacheMap instanceof Map)) return null;

  const exactKey = `${startDate}/${endDate}`;
  const exact = cacheMap.get(exactKey);
  if (exact) {
    if (now - exact.updatedAt <= ttlMs) {
      return { exact: true, entry: exact };
    }
    cacheMap.delete(exactKey);
  }

  let bestCovering = null;
  for (const [key, entry] of cacheMap.entries()) {
    if (!entry || now - entry.updatedAt > ttlMs) {
      cacheMap.delete(key);
      continue;
    }
    if (entry.startDate <= startDate && entry.endDate >= endDate) {
      if (!bestCovering || entry.updatedAt > bestCovering.updatedAt) {
        bestCovering = entry;
      }
    }
  }

  return bestCovering ? { exact: false, entry: bestCovering } : null;
}
