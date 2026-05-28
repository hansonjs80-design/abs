import { toProperCase } from '../../lib/shockwaveSyncUtils';

export const THERAPIST_COLORS = [
  '#ffedd5',
  '#e9ddff',
  '#d8f3ea',
  '#ffe7c7',
  '#ffdced',
];

export const THERAPIST_TOTAL_COLORS = [
  '#fed7aa',
  '#d8b4fe',
  '#b7ead8',
  '#ffd39a',
  '#ffb9d8',
];

export const SUMMARY_COL_WIDTH = 78;

export const FIXED_FIELDS = [
  { id: 'idx', label: '#', field: 'idx', w: 37 },
  { id: 'date', label: '날짜', field: 'date', w: 67 },
  { id: 'name', label: '이름', field: 'patient_name', w: 81, bold: true },
  { id: 'chart', label: '차트번호', field: 'chart_number', w: 71 },
  { id: 'visit', label: '회차', field: 'visit_count', w: 43 },
  { id: 'body', label: '부위', field: 'body_part', w: 114 },
];

function normalizePrescriptionKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function prescriptionsMatch(a, b) {
  return normalizePrescriptionKey(a) === normalizePrescriptionKey(b);
}

export function toDateKey(date) {
  if (!(date instanceof Date)) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isEditableShortcutTarget(target) {
  const tagName = target?.tagName;
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    target?.isContentEditable
  );
}

export function findNearestDateRowIndex(rows, targetDateKey) {
  const datedRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row?._isFirst && row?.date);

  const exactIndex = datedRows.find(({ row }) => row.date === targetDateKey)?.index;
  if (Number.isInteger(exactIndex)) return exactIndex;

  const pastRows = datedRows.filter(({ row }) => row.date < targetDateKey);
  if (pastRows.length > 0) {
    return pastRows.reduce((latest, item) => (
      item.row.date > latest.row.date ? item : latest
    )).index;
  }

  if (datedRows.length === 0) return -1;
  return datedRows.reduce((earliest, item) => (
    item.row.date < earliest.row.date ? item : earliest
  )).index;
}

export function toTitleCaseBodyPart(value) {
  return toProperCase(String(value || '').trim());
}
