export const PATIENT_HISTORY_VISIT_SEQUENCE_COLORS = [
  '#fecaca',
  '#fed7aa',
  '#fef08a',
  '#bbf7d0',
  '#bfdbfe',
  '#c7d2fe',
  '#e9d5ff',
];

function parseVisitCount(value) {
  const normalized = String(value ?? '').trim();
  if (normalized === '*') return 1;
  if (!/^\d+$/.test(normalized)) return null;
  const count = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

function getVisitSequenceEdge(currentLog, nextLog) {
  const currentCount = parseVisitCount(currentLog?.visit_count);
  const nextCount = parseVisitCount(nextLog?.visit_count);
  if (currentCount === null || nextCount === null) return null;
  if (currentCount - nextCount === 1) return 'step';

  const currentDate = String(currentLog?.date || '').trim();
  const nextDate = String(nextLog?.date || '').trim();
  if (
    currentCount === nextCount
    && currentDate
    && currentDate === nextDate
  ) {
    return 'same-date-duplicate';
  }
  return null;
}

export function getPatientHistoryVisitSequenceColors(logs = []) {
  const source = Array.isArray(logs) ? logs : [];
  const rowColors = Array(source.length).fill(null);
  let runStart = 0;
  let runHasStep = false;
  let sequenceIndex = 0;

  const finishRun = (endExclusive) => {
    if (runHasStep) {
      const color = PATIENT_HISTORY_VISIT_SEQUENCE_COLORS[
        sequenceIndex % PATIENT_HISTORY_VISIT_SEQUENCE_COLORS.length
      ];
      rowColors.fill(color, runStart, endExclusive);
      sequenceIndex += 1;
    }
  };

  for (let index = 0; index < source.length - 1; index += 1) {
    const edge = getVisitSequenceEdge(source[index], source[index + 1]);
    if (edge) {
      if (edge === 'step') runHasStep = true;
      continue;
    }

    finishRun(index + 1);
    runStart = index + 1;
    runHasStep = false;
  }

  finishRun(source.length);
  return rowColors;
}
