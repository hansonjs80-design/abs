/**
 * Shockwave Scheduler Utility Functions
 * 
 * Pure utility functions extracted from ShockwaveView.jsx for maintainability.
 * These functions handle: pending drafts, month backups, patient identity parsing,
 * visit counts, reservation times, merge span metadata, body parts, and prescriptions.
 */
import { has4060Pattern } from './schedulerContentFormat.js';
import { toProperCase } from './bodyPartFormatUtils.js';
import {
  applyVisitCountToSchedulerContent,
  buildSchedulerCellDisplay,
  getExplicitVisitSuffix,
  getMemoListFromMergeSpan,
  getNonVisitParentheticalSuffix,
  getSchedulerVisitInputValue,
  normalizeSchedulerVisitSuffix,
  normalizeVisitInputValue,
  parseSchedulerPatientIdentity,
  stepVisitShortcutInputValue,
  stepVisitInputValue,
} from './schedulerCellTextUtils.js';

export {
  applyVisitCountToSchedulerContent,
  buildSchedulerCellDisplay,
  getExplicitVisitSuffix,
  getMemoListFromMergeSpan,
  getNonVisitParentheticalSuffix,
  getSchedulerVisitInputValue,
  normalizeSchedulerVisitSuffix,
  normalizeVisitInputValue,
  parseSchedulerPatientIdentity,
  stepVisitShortcutInputValue,
  stepVisitInputValue,
};

// ── Constants ──
export const HORIZONTAL_BORDER_COLOR = '#b7b7b7';
export const TIME_COL_WIDTH = 41;
export const SHOCKWAVE_DAY_COL_WIDTH_KEY = 'shockwave-day-col-width';
export const SHOCKWAVE_COL_RATIOS_KEY = 'shockwave-col-ratios';
export const SHOCKWAVE_ROW_HEIGHT_KEY = 'shockwave-row-height';
export const SHOCKWAVE_PENDING_DRAFTS_KEY = 'shockwave-pending-cell-drafts-v1';
export const SHOCKWAVE_DELETED_DRAFTS_KEY = 'shockwave-deleted-cell-drafts-v1';
export const SHOCKWAVE_MONTH_BACKUP_KEY = 'shockwave-month-backup-v1';
export const SHOCKWAVE_PENDING_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const TREATMENT_COMPLETE_BG = '#ffe599';
export const TREATMENT_CANCEL_BG = '#f4cccc';
export const SCHEDULER_HOLIDAY_BG = '#93c47d';
export const shockwaveScheduleScrollMemory = new Map();

// ── Pending Draft Storage ──

export function getShockwaveScheduleScrollKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getPendingDraftId(year, month, key) {
  return `${year}-${String(month).padStart(2, '0')}:${key}`;
}

export function readDeletedScheduleDrafts() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SHOCKWAVE_DELETED_DRAFTS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeDeletedScheduleDrafts(deletedDrafts) {
  if (typeof window === 'undefined') return;
  const entries = Object.entries(deletedDrafts || {}).filter(([, deleted]) => {
    const updatedAt = Number(deleted?.updatedAt) || 0;
    return Date.now() - updatedAt < SHOCKWAVE_PENDING_DRAFT_MAX_AGE_MS;
  });
  if (entries.length === 0) {
    window.localStorage.removeItem(SHOCKWAVE_DELETED_DRAFTS_KEY);
    return;
  }
  window.localStorage.setItem(SHOCKWAVE_DELETED_DRAFTS_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export function rememberDeletedScheduleDraft(year, month, key) {
  if (!key) return;
  const deletedDrafts = readDeletedScheduleDrafts();
  deletedDrafts[getPendingDraftId(year, month, key)] = {
    year,
    month,
    key,
    updatedAt: Date.now(),
  };
  writeDeletedScheduleDrafts(deletedDrafts);
}

export function readPendingScheduleDrafts() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SHOCKWAVE_PENDING_DRAFTS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writePendingScheduleDrafts(drafts) {
  if (typeof window === 'undefined') return;
  const entries = Object.entries(drafts || {}).filter(([, draft]) => {
    const updatedAt = Number(draft?.updatedAt) || 0;
    return Date.now() - updatedAt < SHOCKWAVE_PENDING_DRAFT_MAX_AGE_MS;
  });
  if (entries.length === 0) {
    window.localStorage.removeItem(SHOCKWAVE_PENDING_DRAFTS_KEY);
    return;
  }
  window.localStorage.setItem(SHOCKWAVE_PENDING_DRAFTS_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export function rememberPendingScheduleDraft(year, month, key, value, options = {}) {
  if (!key) return;
  const { source = 'failed-save' } = options || {};
  const drafts = readPendingScheduleDrafts();
  drafts[getPendingDraftId(year, month, key)] = {
    year,
    month,
    key,
    value: value ?? '',
    source,
    updatedAt: Date.now(),
  };
  writePendingScheduleDrafts(drafts);
  const deletedDrafts = readDeletedScheduleDrafts();
  delete deletedDrafts[getPendingDraftId(year, month, key)];
  writeDeletedScheduleDrafts(deletedDrafts);
}

export function removePendingScheduleDraft(year, month, key) {
  if (!key) return;
  const drafts = readPendingScheduleDrafts();
  delete drafts[getPendingDraftId(year, month, key)];
  writePendingScheduleDrafts(drafts);
}

export function removePendingScheduleDraftIfValue(year, month, key, value) {
  if (!key) return;
  const drafts = readPendingScheduleDrafts();
  const draftId = getPendingDraftId(year, month, key);
  const draft = drafts[draftId];
  if (!draft) return;
  if (String(draft.value ?? '') !== String(value ?? '')) return;
  delete drafts[draftId];
  writePendingScheduleDrafts(drafts);
}

// ── Month Backup Storage ──

export function readScheduleMonthBackups() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SHOCKWAVE_MONTH_BACKUP_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeScheduleMonthBackups(backups) {
  if (typeof window === 'undefined') return;
  const entries = Object.entries(backups || {}).filter(([, backup]) => {
    const updatedAt = Number(backup?.updatedAt) || 0;
    return Date.now() - updatedAt < SHOCKWAVE_PENDING_DRAFT_MAX_AGE_MS;
  });
  if (entries.length === 0) {
    window.localStorage.removeItem(SHOCKWAVE_MONTH_BACKUP_KEY);
    return;
  }
  window.localStorage.setItem(SHOCKWAVE_MONTH_BACKUP_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export function rememberScheduleMonthBackup(year, month, memos) {
  if (typeof window === 'undefined') return;
  const cells = {};
  Object.entries(memos || {}).forEach(([key, memo]) => {
    const content = String(memo?.content || '').trim();
    const hasBgColor = memo?.bg_color !== undefined && memo?.bg_color !== null && memo?.bg_color !== '';
    const hasPrescription = memo?.prescription !== undefined && memo?.prescription !== null && memo?.prescription !== '';
    const hasBodyPart = memo?.body_part !== undefined && memo?.body_part !== null && memo?.body_part !== '';
    const merge = memo?.merge_span;
    const hasMerge = Boolean(merge) && (
      (merge.rowSpan && merge.rowSpan !== 1) ||
      (merge.colSpan && merge.colSpan !== 1) ||
      merge.mergedInto ||
      merge.meta
    );
    if (!content && !hasBgColor && !hasPrescription && !hasBodyPart && !hasMerge) return;
    cells[key] = {
      content: memo.content || '',
      bg_color: memo.bg_color ?? null,
      prescription: memo.prescription ?? null,
      body_part: memo.body_part ?? null,
      merge_span: memo.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
      updated_at: memo.updated_at || new Date().toISOString(),
    };
  });

  const backups = readScheduleMonthBackups();
  const id = getShockwaveScheduleScrollKey(year, month);
  if (Object.keys(cells).length === 0) delete backups[id];
  else backups[id] = { year, month, cells, updatedAt: Date.now() };
  writeScheduleMonthBackups(backups);
}

// ── Manual Therapy Helpers ──

export function getManualDoseTag(prescription) {
  const match = String(prescription || '').match(/(\d{2,3})/);
  return match ? match[1] : '';
}

export function buildManualNamePart(patientName, prescription) {
  const cleanName = String(patientName || '').replace(/\*/g, '').trim();
  const doseTag = getManualDoseTag(prescription);
  if (!cleanName) return doseTag || '';
  if (!doseTag || has4060Pattern(cleanName)) return cleanName;
  return `${cleanName}${doseTag}`;
}

export function getSchedulerHistoryTypeLabel(option) {
  if (!option) return '';
  if (option.type === 'manual') {
    const doseTag = option.doseTag || getManualDoseTag(option.prescription);
    return doseTag ? `도수치료 ${doseTag}` : '도수치료';
  }
  return '충격파';
}

// ── Body Part Helpers ──

export function splitBodyParts(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeBodyPartKey(part) {
  return String(part || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatBodyPartInput(part) {
  return toProperCase(String(part || '').trim()).replace(/\s+/g, ' ').trim();
}

// ── Prescription Color Helpers ──

export function normalizePrescriptionColorKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/분$/u, '')
    .toLowerCase();
}

export function getPrescriptionColor(prescription, colorMap) {
  if (!prescription || !colorMap) return null;
  const direct = colorMap[prescription] || colorMap[normalizePrescriptionColorKey(prescription)];
  if (direct) return direct;
  const targetKey = normalizePrescriptionColorKey(prescription);
  const match = Object.entries(colorMap).find(([key]) => normalizePrescriptionColorKey(key) === targetKey);
  if (match?.[1]) return match[1];
  if (!targetKey) return null;
  const containedMatch = Object.entries(colorMap)
    .sort(([a], [b]) => normalizePrescriptionColorKey(b).length - normalizePrescriptionColorKey(a).length)
    .find(([key]) => {
      const normalizedKey = normalizePrescriptionColorKey(key);
      return normalizedKey && (targetKey.includes(normalizedKey) || normalizedKey.includes(targetKey));
    });
  return containedMatch?.[1] || null;
}

export function filterPrescriptionColorMap(colorMap, prescriptions) {
  const allowed = new Set(
    (Array.isArray(prescriptions) ? prescriptions : [])
      .map((item) => normalizePrescriptionColorKey(item))
      .filter(Boolean)
  );
  if (!colorMap || allowed.size === 0) return {};

  return Object.entries(colorMap).reduce((acc, [key, value]) => {
    if (!key || !value) return acc;
    if (allowed.has(normalizePrescriptionColorKey(key))) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

// ── Merge Span & Memo List Helpers ──

export function getBodyPartOptionsFromMergeSpan(mergeSpan) {
  const list = mergeSpan?.meta?.body_part_options;
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map((item) => formatBodyPartInput(item))
    .filter((item) => {
      if (!item) return false;
      const key = normalizeBodyPartKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildMergeSpanWithBodyPartOptions(mergeSpan, bodyPartOptions) {
  const base = mergeSpan || { rowSpan: 1, colSpan: 1, mergedInto: null };
  const seen = new Set();
  const nextList = Array.isArray(bodyPartOptions)
    ? bodyPartOptions
        .map((item) => formatBodyPartInput(item))
        .filter((item) => {
          if (!item) return false;
          const key = normalizeBodyPartKey(item);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
    : [];
  const nextMeta = { ...(base.meta || {}) };
  if (nextList.length > 0) nextMeta.body_part_options = nextList;
  else delete nextMeta.body_part_options;

  const nextMergeSpan = { ...base };
  if (Object.keys(nextMeta).length > 0) nextMergeSpan.meta = nextMeta;
  else delete nextMergeSpan.meta;
  return nextMergeSpan;
}

// ── Reservation Time Helpers ──

export function normalizeReservationTimeValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const colonMatch = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    const hh = Math.min(23, Math.max(0, parseInt(colonMatch[1], 10) || 0));
    const mm = Math.min(59, Math.max(0, parseInt(colonMatch[2], 10) || 0));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const compact = raw.replace(/[^\d]/g, '');
  if (compact.length === 3) {
    const hh = Math.min(23, Math.max(0, parseInt(compact.slice(0, 1), 10) || 0));
    const mm = Math.min(59, Math.max(0, parseInt(compact.slice(1), 10) || 0));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  if (compact.length >= 4) {
    const hh = Math.min(23, Math.max(0, parseInt(compact.slice(0, 2), 10) || 0));
    const mm = Math.min(59, Math.max(0, parseInt(compact.slice(2, 4), 10) || 0));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return '';
}

export function stepReservationTimeValue(value, deltaMinutes) {
  const normalized = normalizeReservationTimeValue(value);
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return normalized;
  const total = (parseInt(match[1], 10) * 60) + parseInt(match[2], 10) + deltaMinutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function timeValueToMinutes(value) {
  const normalized = normalizeReservationTimeValue(value);
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return (parseInt(match[1], 10) * 60) + parseInt(match[2], 10);
}

export function minutesToTimeValue(totalMinutes) {
  const bounded = Math.min(1439, Math.max(0, totalMinutes));
  const hh = String(Math.floor(bounded / 60)).padStart(2, '0');
  const mm = String(bounded % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function stepReservationTimeWithinCellBase(value, baseValue, deltaMinutes) {
  const baseMinutes = timeValueToMinutes(baseValue);
  if (baseMinutes === null) return stepReservationTimeValue(value, deltaMinutes);

  const currentMinutes = timeValueToMinutes(value) ?? baseMinutes;
  const minMinutes = Math.max(0, baseMinutes - 10);
  const maxMinutes = Math.min(1439, baseMinutes + 10);
  const nextMinutes = Math.min(maxMinutes, Math.max(minMinutes, currentMinutes + deltaMinutes));
  return minutesToTimeValue(nextMinutes);
}

export function getReservationTimeFromMergeSpan(mergeSpan) {
  return String(mergeSpan?.meta?.reservation_time || '').trim();
}

export function buildMergeSpanWithReservationTime(mergeSpan, reservationTime) {
  const base = mergeSpan || { rowSpan: 1, colSpan: 1, mergedInto: null };
  const nextMeta = { ...(base.meta || {}) };
  const nextTime = normalizeReservationTimeValue(reservationTime);
  if (nextTime) nextMeta.reservation_time = nextTime;
  else delete nextMeta.reservation_time;

  const nextMergeSpan = { ...base };
  if (Object.keys(nextMeta).length > 0) nextMergeSpan.meta = nextMeta;
  else delete nextMergeSpan.meta;
  return nextMergeSpan;
}

export function stripReservationTimeFromMergeSpan(mergeSpan) {
  return buildMergeSpanWithReservationTime(mergeSpan, '');
}

// ── Visit Copy Link Helpers ──

export function buildMergeSpanWithVisitCopyLink(mergeSpan, link) {
  const base = mergeSpan || { rowSpan: 1, colSpan: 1, mergedInto: null };
  const nextMeta = { ...(base.meta || {}) };
  const sourceKey = String(link?.sourceKey || '').trim();
  const originalContent = String(link?.originalContent || '');
  const incrementedContent = String(link?.incrementedContent || '');

  if (sourceKey && originalContent && incrementedContent) {
    nextMeta.visit_copy_source_key = sourceKey;
    nextMeta.visit_copy_original_content = originalContent;
    nextMeta.visit_copy_incremented_content = incrementedContent;
  } else {
    delete nextMeta.visit_copy_source_key;
    delete nextMeta.visit_copy_original_content;
    delete nextMeta.visit_copy_incremented_content;
  }

  const nextMergeSpan = { ...base };
  if (Object.keys(nextMeta).length > 0) nextMergeSpan.meta = nextMeta;
  else delete nextMergeSpan.meta;
  return nextMergeSpan;
}

export function clearVisitCopyLinkFromMergeSpan(mergeSpan) {
  return buildMergeSpanWithVisitCopyLink(mergeSpan, null);
}

// ── Keyboard Shortcut Helpers ──

export function isUndoShortcutEvent(event) {
  if (!event || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
  const key = String(event.key || '').toLowerCase();
  return event.code === 'KeyZ' || key === 'z';
}

// ── Merge Span Memo List ──

export function buildMergeSpanWithMemoList(mergeSpan, memoList) {
  const base = mergeSpan || { rowSpan: 1, colSpan: 1, mergedInto: null };
  const nextList = Array.isArray(memoList)
    ? memoList.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const nextMeta = { ...(base.meta || {}) };
  if (nextList.length > 0) nextMeta.memo_list = nextList;
  else delete nextMeta.memo_list;

  const nextMergeSpan = { ...base };
  if (Object.keys(nextMeta).length > 0) nextMergeSpan.meta = nextMeta;
  else delete nextMergeSpan.meta;
  return nextMergeSpan;
}

export function cloneMergeSpanWithMeta(mergeSpan, overrides = {}) {
  const base = mergeSpan || { rowSpan: 1, colSpan: 1, mergedInto: null };
  const next = { ...base, ...overrides };
  if (base.meta && typeof base.meta === 'object') {
    next.meta = { ...base.meta };
  }
  return next;
}

export function buildSchedulerMemoSortKey(memoKey, weeks) {
  const parts = String(memoKey || '').split('-').map(Number);
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return '';
  const [w, d, r, c] = parts;
  const dayInfo = weeks?.[w]?.[d];
  const dateKey = dayInfo
    ? `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`
    : '';
  if (!dateKey) return '';
  return `${dateKey}-${String(r).padStart(3, '0')}-${String(c).padStart(3, '0')}`;
}

// ── Body Part Map ──

export function addBodyPartToMap(map, part) {
  if (!part) return;
  const normalizedKey = normalizeBodyPartKey(part);
  if (!normalizedKey) return;
  const existing = map.get(normalizedKey);
  if (!existing) {
    map.set(normalizedKey, part);
  } else {
    const existingDotCount = (existing.match(/\./g) || []).length;
    const newDotCount = (part.match(/\./g) || []).length;
    const existingUpperCount = existing.length - existing.replace(/[A-Z]/g, '').length;
    const newUpperCount = part.length - part.replace(/[A-Z]/g, '').length;
    if (
      newDotCount > existingDotCount ||
      (newDotCount === existingDotCount && newUpperCount > existingUpperCount)
    ) {
      map.set(normalizedKey, part);
    }
  }
}
