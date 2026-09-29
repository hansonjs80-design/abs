import { readStorageValueWithCookieBackup, writeStorageValueWithCookieBackup } from './browserStorageBackup.js';

export const C_ARM_RECENT_MONTHS_KEY = 'abs.c-arm.recent-months';
export const DEFAULT_C_ARM_RECENT_MONTHS = 12;
export const MAX_C_ARM_RECENT_MONTHS = 120;

export function parseCArmRecentMonths(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const months = Number(text);
  return Number.isInteger(months) && months >= 1 && months <= MAX_C_ARM_RECENT_MONTHS ? months : null;
}

export function readCArmRecentMonths(storage, browserDocument) {
  return parseCArmRecentMonths(readStorageValueWithCookieBackup(C_ARM_RECENT_MONTHS_KEY, storage, browserDocument))
    ?? DEFAULT_C_ARM_RECENT_MONTHS;
}

export function saveCArmRecentMonths(value, storage, browserDocument) {
  const months = parseCArmRecentMonths(value);
  if (months !== null) writeStorageValueWithCookieBackup(C_ARM_RECENT_MONTHS_KEY, months, storage, browserDocument);
  return months;
}

export function cArmRecentMonthRange(year, month, count) {
  return Array.from({ length: count }, (_, index) => {
    const serial = year * 12 + month - 1 - index;
    return { year: Math.floor(serial / 12), month: (serial % 12 + 12) % 12 + 1 };
  });
}
