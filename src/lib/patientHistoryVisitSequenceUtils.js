export const PATIENT_HISTORY_VISIT_SEQUENCE_COLORS = [
  '#fecaca',
  '#fed7aa',
  '#fef08a',
  '#bbf7d0',
  '#bfdbfe',
  '#c7d2fe',
  '#e9d5ff',
];

export const PATIENT_HISTORY_TREATMENT_SEQUENCE_PALETTES = {
  shockwave: ['#bfdbfe', '#93c5fd', '#dbeafe', '#a5b4fc'],
  manual: ['#fed7aa', '#fdba74', '#fde68a', '#fecdd3'],
  shinjang: ['#bbf7d0', '#99f6e4', '#a7f3d0', '#ddd6fe'],
};

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

export function getPatientHistoryVisitSequenceColors(
  logs = [],
  palette = PATIENT_HISTORY_VISIT_SEQUENCE_COLORS
) {
  const source = Array.isArray(logs) ? logs : [];
  const colors = Array.isArray(palette) && palette.length > 0
    ? palette
    : PATIENT_HISTORY_VISIT_SEQUENCE_COLORS;
  const rowColors = Array(source.length).fill(null);
  let runStart = 0;
  let runHasStep = false;
  let sequenceIndex = 0;

  const finishRun = (endExclusive) => {
    if (runHasStep) {
      const color = colors[
        sequenceIndex % colors.length
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

export function getPatientHistoryGroupedVisitSequenceColors(
  logs = [],
  getTreatmentGroup = (log) => log?.history_group || 'shockwave'
) {
  const source = Array.isArray(logs) ? logs : [];
  const rowColors = Array(source.length).fill(null);
  const sequenceGroups = new Map();

  source.forEach((log, index) => {
    const treatmentGroup = String(getTreatmentGroup(log) || 'shockwave');
    const prescription = String(log?.prescription || '').trim().toLowerCase() || '__empty__';
    const key = `${treatmentGroup}__${prescription}`;
    if (!sequenceGroups.has(key)) {
      sequenceGroups.set(key, { treatmentGroup, rows: [] });
    }
    sequenceGroups.get(key).rows.push({ log, index });
  });

  const prescriptionOffsets = new Map();
  sequenceGroups.forEach(({ treatmentGroup, rows }) => {
    const orderedRows = [...rows].sort((left, right) => (
      String(right.log?.date || '').localeCompare(String(left.log?.date || ''))
      || left.index - right.index
    ));
    const basePalette = PATIENT_HISTORY_TREATMENT_SEQUENCE_PALETTES[treatmentGroup]
      || PATIENT_HISTORY_VISIT_SEQUENCE_COLORS;
    const offset = prescriptionOffsets.get(treatmentGroup) || 0;
    prescriptionOffsets.set(treatmentGroup, offset + 1);
    const palette = basePalette.map((_, index) => (
      basePalette[(index + offset) % basePalette.length]
    ));
    const colors = getPatientHistoryVisitSequenceColors(
      orderedRows.map(({ log }) => log),
      palette
    );
    orderedRows.forEach(({ index }, orderedIndex) => {
      rowColors[index] = colors[orderedIndex];
    });
  });

  return rowColors;
}
