export function parseSchedulerPatientIdentity(content) {
  const cellContent = String(content || '');
  let patientChart = '';
  let patientName = '';
  const stripPatientSuffix = (value) => {
    const withoutVisit = String(value || '').trim().replace(/(\((-|\d+)\)|\*)+$/g, '').trim();
    const noteSuffix = getNonVisitParentheticalSuffix(withoutVisit);
    return noteSuffix ? withoutVisit.slice(0, -noteSuffix.length).trim() : withoutVisit;
  };

  if (cellContent.includes('/')) {
    const parts = cellContent.split('/');
    const p0 = parts[0].trim();
    const p1 = stripPatientSuffix(parts[1] || '');
    if (/\d/.test(p0)) {
      patientChart = p0;
      patientName = p1;
    } else {
      patientName = p0;
      patientChart = p1;
    }
  } else {
    const cleaned = stripPatientSuffix(cellContent);
    if (/^\d+$/.test(cleaned)) {
      patientChart = cleaned;
    } else {
      patientName = cleaned;
    }
  }

  return { patientChart, patientName };
}

export function getSchedulerVisitInputValue(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  if (/\(-\)$/.test(raw)) return '-';
  if (/\*$/.test(raw)) return '*';
  const match = raw.match(/\((\d+)\)$/);
  return match?.[1] || '';
}

export function getExplicitVisitSuffix(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  if (/\*$/.test(raw)) return '*';
  const match = raw.match(/\((-|\d+)\)$/);
  return match?.[0] || '';
}

export function normalizeSchedulerVisitSuffix(content) {
  let raw = String(content || '').trim();
  if (!raw) return raw;

  // x숫자 패턴(예: x2, x3)을 대문자 X숫자(X2, X3)로 강제 정규화
  raw = raw.replace(/(?:\b|([가-힣a-zA-Z\d()\[\]]))x(\d+)/gi, (match, p1, p2) => (p1 || '') + 'X' + p2);

  const suffix = getExplicitVisitSuffix(raw);
  if (!suffix) return raw;

  const base = raw
    .replace(/(\((-|\d+)\)|\*)+$/g, '')
    .trim();

  return suffix ? `${base}${suffix}` : base;
}

export function isOnlySchedulerVisitSuffixChange(previousContent, nextContent) {
  const previousRaw = normalizeSchedulerVisitSuffix(previousContent);
  const nextRaw = normalizeSchedulerVisitSuffix(nextContent);
  if (!previousRaw || !nextRaw || previousRaw === nextRaw) return false;

  const previousSuffix = getExplicitVisitSuffix(previousRaw);
  const nextSuffix = getExplicitVisitSuffix(nextRaw);
  if (previousSuffix === nextSuffix) return false;

  const previousBase = previousSuffix ? previousRaw.slice(0, -previousSuffix.length).trim() : previousRaw;
  const nextBase = nextSuffix ? nextRaw.slice(0, -nextSuffix.length).trim() : nextRaw;
  return previousBase === nextBase;
}

export function getNonVisitParentheticalSuffix(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  const visitSuffix = getExplicitVisitSuffix(raw);
  const base = visitSuffix ? raw.slice(0, -visitSuffix.length).trim() : raw;
  if (!base) return '';
  const match = base.match(/(\(([^()]*)\))$/);
  if (!match) return '';
  const inner = String(match[2] || '').trim();
  if (!inner || /^-?\d+$/.test(inner)) return '';
  return match[1];
}

export function normalizeVisitInputValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw === '-') return '-';
  if (raw === '*') return '*';
  const numeric = raw.replace(/[^\d]/g, '');
  if (!numeric) return '';
  const parsed = parseInt(numeric, 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : '';
}

export function applyVisitCountToSchedulerContent(content, visitInput) {
  const raw = normalizeSchedulerVisitSuffix(content);
  if (!raw) return raw;
  const base = raw.replace(/(\((-|\d+)\)|\*)+$/g, '').trim();
  const normalizedVisit = normalizeVisitInputValue(visitInput);
  if (!normalizedVisit) return base;
  if (normalizedVisit === '-') return `${base}(-)`;
  if (normalizedVisit === '*') return `${base}*`;
  return `${base}(${normalizedVisit})`;
}

export function stepVisitInputValue(value, delta) {
  const normalized = normalizeVisitInputValue(value);

  let currentIndex = 0;
  if (normalized === '-') currentIndex = -1;
  else if (normalized === '') currentIndex = 0;
  else if (normalized === '*') currentIndex = 1;
  else currentIndex = parseInt(normalized, 10) || 0;

  const nextIndex = currentIndex + delta;

  if (nextIndex <= -1) return '-';
  if (nextIndex === 0) return '';
  if (nextIndex === 1) return '*';
  return String(nextIndex);
}

export function stepVisitShortcutInputValue(value, delta) {
  const normalized = normalizeVisitInputValue(value);

  let currentIndex = 0;
  if (normalized === '-') currentIndex = 0;
  else if (normalized === '*') currentIndex = 1;
  else if (normalized === '') currentIndex = 0;
  else currentIndex = (parseInt(normalized, 10) || 0) + 1;

  const nextIndex = currentIndex + delta;

  if (nextIndex <= 0) return '-';
  if (nextIndex === 1) return '*';
  return String(nextIndex - 1);
}

export function getMemoListFromMergeSpan(mergeSpan) {
  const list = mergeSpan?.meta?.memo_list;
  return Array.isArray(list) ? list.filter((item) => String(item || '').trim()) : [];
}

export function buildSchedulerCellDisplay(content, mergeSpan) {
  const mainText = String(content || '').trim();
  const memoList = getMemoListFromMergeSpan(mergeSpan);
  const hasDisplayText = Boolean(mainText || memoList.length);
  const visitSuffix = getExplicitVisitSuffix(mainText);
  const noteSuffix = getNonVisitParentheticalSuffix(mainText);
  const textWithoutVisitSuffix = visitSuffix ? mainText.slice(0, -visitSuffix.length).trimEnd() : mainText;
  const baseText = noteSuffix ? textWithoutVisitSuffix.slice(0, -noteSuffix.length) : textWithoutVisitSuffix;

  return {
    mainText,
    baseText,
    visitSuffix,
    noteSuffix,
    hasDisplayText,
  };
}
