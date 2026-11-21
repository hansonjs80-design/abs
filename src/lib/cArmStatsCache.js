import { createStatsMemoryCache, DEFAULT_STATS_CACHE_TTL_MS } from './statsMemoryCache.js';

const cArmYearCache = createStatsMemoryCache({ ttlMs: DEFAULT_STATS_CACHE_TTL_MS });
const cArmTemplateCache = createStatsMemoryCache({ ttlMs: DEFAULT_STATS_CACHE_TTL_MS });

/**
 * Returns cached C-Arm monthly records for a year if fresh, or null.
 */
export function getCachedCArmYear(year) {
  return cArmYearCache.get(String(year));
}

/**
 * Stores C-Arm monthly records for a year in the shared session cache.
 */
export function setCachedCArmYear(year, records) {
  const safeRecords = Array.isArray(records) ? records : [];
  return cArmYearCache.set(String(year), safeRecords);
}

/**
 * Returns { template } when cached (even if template is null), or null on miss.
 */
export function getCachedCArmTemplateEntry(year) {
  return cArmTemplateCache.get(String(year));
}

/**
 * Stores the fallback prior-year C-Arm template for a year.
 */
export function setCachedCArmTemplate(year, template) {
  return cArmTemplateCache.set(String(year), { template: template || null });
}

/**
 * Updates cached year records after a month save and resets template caches.
 */
export function upsertCachedCArmRow(row) {
  if (!row || !Number.isInteger(Number(row.year)) || !Number.isInteger(Number(row.month))) {
    return;
  }
  const yearKey = String(row.year);
  const existing = cArmYearCache.get(yearKey);
  if (Array.isArray(existing)) {
    const nextRecords = [
      ...existing.filter((item) => Number(item?.month) !== Number(row.month)),
      row,
    ].sort((a, b) => Number(a.month) - Number(b.month));
    cArmYearCache.set(yearKey, nextRecords);
  }
  // Template lookup for subsequent years depends on the latest prior-year record.
  cArmTemplateCache.clear();
}

/**
 * Clears all cached C-Arm year and template entries.
 */
export function clearCArmCache() {
  cArmYearCache.clear();
  cArmTemplateCache.clear();
}
