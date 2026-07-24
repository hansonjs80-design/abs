import {
  canonicalizeShockwaveScheduleItemDate,
  isShockwaveCalendarCellVisible,
} from './shockwaveScheduleDateMapping.js';
import {
  rememberDeletedScheduleDraft,
  removeDeletedScheduleDraft,
  wasScheduleDraftDeletedAfter,
} from './schedulerUtils.js';

function getCellKey(item) {
  return `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
}

export function isShockwaveScheduleItemVisibleInView(item, viewYear, viewMonth) {
  if (!item) return false;
  if (
    item.year != null &&
    item.month != null &&
    (
      Number(item.year) !== Number(viewYear) ||
      Number(item.month) !== Number(viewMonth)
    )
  ) {
    return false;
  }

  const key = item.key || getCellKey(item);
  if (!key || key.includes('undefined')) return false;
  const [weekIndex, dayIndex] = String(key).split('-').map(Number);
  if (![weekIndex, dayIndex].every(Number.isFinite)) return false;
  return isShockwaveCalendarCellVisible(viewYear, viewMonth, weekIndex, dayIndex);
}

export function getShockwaveScheduleDraftIdentities(item, fallbackYear, fallbackMonth) {
  if (!item) return [];

  const visibleItem = {
    ...item,
    year: item.year ?? fallbackYear,
    month: item.month ?? fallbackMonth,
  };
  const visibleIdentity = {
    year: Number(visibleItem.year),
    month: Number(visibleItem.month),
    key: getCellKey(visibleItem),
  };
  const canonicalItem = canonicalizeShockwaveScheduleItemDate(visibleItem);
  const canonicalIdentity = {
    year: Number(canonicalItem.year),
    month: Number(canonicalItem.month),
    key: getCellKey(canonicalItem),
  };

  const identities = [visibleIdentity];
  if (
    canonicalIdentity.year !== visibleIdentity.year ||
    canonicalIdentity.month !== visibleIdentity.month ||
    canonicalIdentity.key !== visibleIdentity.key
  ) {
    identities.push(canonicalIdentity);
  }
  return identities;
}

export function rememberDeletedShockwaveScheduleItem(item, fallbackYear, fallbackMonth) {
  getShockwaveScheduleDraftIdentities(item, fallbackYear, fallbackMonth)
    .forEach(({ year, month, key }) => rememberDeletedScheduleDraft(year, month, key));
}

export function removeDeletedShockwaveScheduleItem(item, fallbackYear, fallbackMonth) {
  getShockwaveScheduleDraftIdentities(item, fallbackYear, fallbackMonth)
    .forEach(({ year, month, key }) => removeDeletedScheduleDraft(year, month, key));
}

export function wasShockwaveScheduleItemDeletedAfter(
  item,
  fallbackYear,
  fallbackMonth,
  timestamp
) {
  return getShockwaveScheduleDraftIdentities(item, fallbackYear, fallbackMonth)
    .some(({ year, month, key }) => wasScheduleDraftDeletedAfter(year, month, key, timestamp));
}
