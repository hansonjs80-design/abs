const INLINE_NOTE_KEYWORD_PATTERN = /(?:도수|충격파|예약|진료\s*후|진료후)/u;
const VISIT_NOTE_ONLY_PATTERN = /^(\((-|\d+|\*)\)|\*)+$/u;

function matchVisitTokenWithTrailingNote(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const parenthesizedMatch = text.match(/^(.*?)(\((-|\d+|\*)\))(.+)$/u);
  if (parenthesizedMatch) {
    const noteText = String(parenthesizedMatch[4] || '').trim();
    if (noteText && !VISIT_NOTE_ONLY_PATTERN.test(noteText)) {
      return {
        baseText: String(parenthesizedMatch[1] || '').trimEnd(),
        visitSuffix: parenthesizedMatch[2],
        noteText,
      };
    }
  }

  const starMatch = text.match(/^(.*?)(\*)(.+)$/u);
  if (!starMatch || String(starMatch[1] || '').endsWith('(')) return null;
  const noteText = String(starMatch[3] || '').trim();
  if (!noteText) return null;
  if (VISIT_NOTE_ONLY_PATTERN.test(noteText)) return null;
  return {
    baseText: String(starMatch[1] || '').trimEnd(),
    visitSuffix: starMatch[2],
    noteText,
  };
}

export function splitSchedulerInlineNote(content) {
  const text = String(content || '').trim();
  if (!text) {
    return { baseText: '', visitSuffix: '', noteText: '', hasInlineNote: false, noteAfterVisit: false };
  }

  const visitTrailingNote = matchVisitTokenWithTrailingNote(text);
  if (visitTrailingNote) {
    return { ...visitTrailingNote, hasInlineNote: true, noteAfterVisit: true };
  }

  const slashIndex = text.indexOf('/');
  const prefix = slashIndex >= 0 ? text.slice(0, slashIndex + 1) : '';
  const namePart = slashIndex >= 0 ? text.slice(slashIndex + 1).trim() : text;
  const noteMatch = namePart.match(/^(.+?)\s+(.+)$/u);
  if (!noteMatch) {
    return { baseText: text, visitSuffix: '', noteText: '', hasInlineNote: false, noteAfterVisit: false };
  }

  const patientName = String(noteMatch[1] || '').trim();
  const noteText = String(noteMatch[2] || '').trim();
  if (!patientName || !INLINE_NOTE_KEYWORD_PATTERN.test(noteText)) {
    return { baseText: text, visitSuffix: '', noteText: '', hasInlineNote: false, noteAfterVisit: false };
  }

  return {
    baseText: `${prefix}${patientName}`,
    visitSuffix: '',
    noteText,
    hasInlineNote: true,
    noteAfterVisit: false,
  };
}

export function appendSchedulerInlineNote(content, noteText) {
  const base = String(content || '').trim();
  const note = String(noteText || '').trim();
  if (!base || !note) return base;
  return `${base} ${note}`;
}

export function parseSchedulerPatientIdentity(content) {
  const cellContent = String(content || '');
  let patientChart = '';
  let patientName = '';
  const stripPatientSuffix = (value) => {
    const inlineNote = splitSchedulerInlineNote(value);
    const valueWithoutInlineNote = inlineNote.hasInlineNote
      ? `${inlineNote.baseText}${inlineNote.visitSuffix || ''}`
      : String(value || '').trim();
    const withoutVisit = valueWithoutInlineNote.replace(/(\((-|\d+|\*)\)|\*)+$/g, '').trim();
    const noteSuffix = getNonVisitParentheticalSuffix(withoutVisit);
    const base = noteSuffix ? withoutVisit.slice(0, -noteSuffix.length).trim() : withoutVisit;
    return base.replace(/([가-힣]{2,})([a-zA-Z\d]+)$/, '$1').trim();
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
  const suffix = getExplicitVisitSuffix(raw);
  if (suffix === '(-)') return '-';
  if (suffix === '(*)' || suffix === '*') return '*';
  const match = suffix.match(/\((\d+)\)/);
  return match?.[1] || '';
}

export function getExplicitVisitSuffix(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  const visitTrailingNote = matchVisitTokenWithTrailingNote(raw);
  if (visitTrailingNote) return visitTrailingNote.visitSuffix;
  if (/\(\*\)$/.test(raw)) return '(*)';
  if (/\*$/.test(raw)) return '*';
  const match = raw.match(/\((-|\d+)\)$/);
  return match?.[0] || '';
}

export function normalizeSchedulerVisitSuffix(content) {
  let raw = String(content || '').trim();
  if (!raw) return raw;

  // x숫자 패턴(예: x2, x3)을 대문자 X숫자(X2, X3)로 강제 정규화
  raw = raw.replace(/(?:\b|([가-힣a-zA-Z\d()[\]]))x(\d+)/gi, (match, p1, p2) => (p1 || '') + 'X' + p2);

  const inlineNote = splitSchedulerInlineNote(raw);
  if (inlineNote.hasInlineNote && inlineNote.visitSuffix) {
    const base = inlineNote.baseText
      .replace(/(\((-|\d+|\*)\)|\*)+$/g, '')
      .trim();
    return appendSchedulerInlineNote(`${base}${inlineNote.visitSuffix === '(*)' ? '*' : inlineNote.visitSuffix}`, inlineNote.noteText);
  }

  const suffix = getExplicitVisitSuffix(raw);
  if (!suffix) return raw;

  const base = raw
    .replace(/(\((-|\d+|\*)\)|\*)+$/g, '')
    .trim();

  return suffix ? `${base}${suffix === '(*)' ? '*' : suffix}` : base;
}

export function markSchedulerContentAsNewPatient(content) {
  const raw = normalizeSchedulerVisitSuffix(content);
  if (!raw) return raw;
  const inlineNote = splitSchedulerInlineNote(raw);
  if (inlineNote.hasInlineNote) {
    const base = inlineNote.baseText.replace(/(\((-|\d+|\*)\)|\*)+$/g, '').trim();
    return appendSchedulerInlineNote(base ? `${base}*` : raw, inlineNote.noteText);
  }
  const base = raw.replace(/(\((-|\d+|\*)\)|\*)+$/g, '').trim();
  return base ? `${base}*` : raw;
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

export function isStaleNumericVisitRestoreAfterNewPatientAutoFormat(previousContent, nextContent, pendingContent) {
  const previous = normalizeSchedulerVisitSuffix(previousContent);
  const next = normalizeSchedulerVisitSuffix(nextContent);
  const pending = normalizeSchedulerVisitSuffix(pendingContent);
  if (!previous || !next || !pending) return false;
  if (pending !== previous) return false;
  if (!isOnlySchedulerVisitSuffixChange(previous, next)) return false;

  const previousSuffix = getExplicitVisitSuffix(previous);
  const nextSuffix = getExplicitVisitSuffix(next);
  return previousSuffix === '*' && /^\(\d+\)$/.test(nextSuffix);
}

export function getNonVisitParentheticalSuffix(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';
  if (splitSchedulerInlineNote(raw).noteAfterVisit) return '';
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
  const inlineNote = splitSchedulerInlineNote(raw);
  if (inlineNote.hasInlineNote) {
    const base = inlineNote.baseText.replace(/(\((-|\d+|\*)\)|\*)+$/g, '').trim();
    const normalizedVisit = normalizeVisitInputValue(visitInput);
    let nextBase = base;
    if (normalizedVisit === '-') nextBase = `${base}(-)`;
    else if (normalizedVisit === '*') nextBase = `${base}*`;
    else if (normalizedVisit) nextBase = `${base}(${normalizedVisit})`;
    return appendSchedulerInlineNote(nextBase, inlineNote.noteText);
  }
  const base = raw.replace(/(\((-|\d+|\*)\)|\*)+$/g, '').trim();
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
  const inlineNote = splitSchedulerInlineNote(mainText);
  if (inlineNote.hasInlineNote && inlineNote.visitSuffix) {
    return {
      mainText,
      baseText: inlineNote.baseText,
      visitSuffix: inlineNote.visitSuffix,
      noteSuffix: inlineNote.noteText,
      noteAfterVisit: true,
      hasDisplayText,
    };
  }
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
