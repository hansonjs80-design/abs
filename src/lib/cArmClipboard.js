import { cArmColumns, daysInCArmMonth, MAX_C_ARM_COUNT } from './cArmStats.js';

// Spreadsheet text is TSV, including quoted cells and a final row separator.
export function parseCArmClipboard(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (quoted || cell === '') quoted = !quoted;
      else cell += char;
    } else if (!quoted && (char === '\t' || char === '\n')) {
      row.push(cell);
      cell = '';
      if (char === '\n') { rows.push(row); row = []; }
    } else cell += char;
  }
  if (quoted) throw new Error('복사한 셀의 따옴표가 닫히지 않았습니다. 범위를 다시 복사해주세요.');
  if (cell !== '' || row.length || !source.endsWith('\n')) rows.push([...row, cell]);
  return rows;
}

function clipboardDate(value) {
  const text = value.trim();
  const korean = text.match(/^(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일(?:\s*\(?[일월화수목금토]\)?)?$/);
  const numeric = text.match(/^(?:(\d{4})[./-]?)?(\d{1,2})[./-](\d{1,2})(?:\s*\([일월화수목금토]\))?$/);
  const match = korean || numeric;
  return match ? { year: match[1] ? Number(match[1]) : null, month: Number(match[2]), day: Number(match[3]) } : null;
}

function clipboardCount(value, row, column) {
  const text = value.trim();
  if (!text) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(text)) {
    throw new Error(`${row}행 ${column}열: 건수에는 0 이상의 정수만 붙여넣을 수 있습니다.`);
  }
  const count = Number(text.replaceAll(',', ''));
  if (!Number.isSafeInteger(count) || count > MAX_C_ARM_COUNT) {
    throw new Error(`${row}행 ${column}열: 건수는 ${MAX_C_ARM_COUNT.toLocaleString('ko-KR')} 이하로 입력해주세요.`);
  }
  return count;
}

export function pasteCArmCounts(document, { text, year, month, personId, day, kind }) {
  let rows = parseCArmClipboard(text);
  const cols = cArmColumns(document);
  const colCount = Math.max(1, cols.length);
  const colIds = cols.map((c) => c.id);
  const headers = new Set(['날짜', '초진', '재진', '초진환자', '재진환자', ...cols.map((c) => c.label)]);
  if (rows[0]?.length && rows[0].every((value) => headers.has(value.trim()))) rows = rows.slice(1);
  if (!rows.length) throw new Error('붙여넣을 건수 데이터가 없습니다.');
  const personIndex = document.radiographers.findIndex((person) => person.id === personId);
  const kindIndex = colIds.indexOf(kind);
  if (personIndex < 0 || kindIndex < 0 || !Number.isInteger(day) || day < 1) {
    throw new Error('붙여넣을 건수 칸을 먼저 선택해주세요.');
  }
  if (day + rows.length - 1 > daysInCArmMonth(year, month)) {
    throw new Error('붙여넣을 행이 이 달의 마지막 날짜를 넘습니다. 복사 범위를 줄여주세요.');
  }
  const width = rows[0].length;
  if (rows.some((row) => row.length !== width)) throw new Error('각 행의 열 수가 다릅니다. 사각형 범위를 복사해주세요.');
  const includesDate = clipboardDate(rows[0][0]) !== null;
  if (includesDate) {
    rows = rows.map((row, offset) => {
      const date = clipboardDate(row[0]);
      if (!date || (date.year !== null && date.year !== year) || date.month !== month || date.day !== day + offset) {
        throw new Error(`${offset + 1}행의 날짜가 선택한 입력 날짜와 다릅니다. 시작 날짜와 월을 확인해주세요.`);
      }
      return row.slice(1);
    });
  }
  const startColumn = personIndex * colCount + kindIndex;
  const countColumns = rows[0].length;
  if (!countColumns) throw new Error('날짜 오른쪽의 건수도 함께 복사해주세요.');
  if (startColumn + countColumns > document.radiographers.length * colCount) {
    throw new Error('붙여넣을 열이 방사선사 표 범위를 넘습니다. 방사선사를 추가하거나 복사 범위를 줄여주세요.');
  }
  // Validate every cell before creating an updated document: never apply a partial paste.
  const counts = rows.map((row, r) => row.map((value, c) => clipboardCount(value, r + 1, c + 1)));
  const people = document.radiographers.map((person) => ({ ...person, days: { ...person.days } }));
  counts.forEach((row, offset) => row.forEach((value, column) => {
    const targetColumn = startColumn + column;
    const person = people[Math.floor(targetColumn / colCount)];
    const targetColId = cols[targetColumn % colCount]?.id;
    const targetDay = day + offset;
    person.days[targetDay] = { ...person.days[targetDay], [targetColId]: value };
  }));
  return { document: { ...document, radiographers: people }, rows: counts.length, columns: countColumns };
}
