export const C_ARM_TABLE = 'c_arm_monthly_stats';
export const DEFAULT_C_ARM_RATE = 2000;
export const MAX_C_ARM_COUNT = 100000;
export const MAX_C_ARM_RATE = 100000000;

export const DEFAULT_C_ARM_COLUMNS = Object.freeze([
  { id: 'first', label: '초진', rate: DEFAULT_C_ARM_RATE },
  { id: 'returning', label: '재진', rate: DEFAULT_C_ARM_RATE },
]);

export function daysInCArmMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function cArmColumns(document) {
  const source = Array.isArray(document?.columns) && document.columns.length > 0
    ? document.columns
    : Array.isArray(document?.radiographers?.[0]?.columns) && document.radiographers[0].columns.length > 0
      ? document.radiographers[0].columns
      : DEFAULT_C_ARM_COLUMNS;
  const fallbackRate = Number.isInteger(document?.incentive_rate) ? document.incentive_rate : DEFAULT_C_ARM_RATE;
  return source.map((col, index) => ({
    id: String(col.id || `col_${index + 1}`).trim(),
    label: String(col.label || (index === 0 ? '초진' : index === 1 ? '재진' : `항목 ${index + 1}`)).trim(),
    rate: Number.isInteger(col.rate) && col.rate >= 0 ? col.rate : fallbackRate,
  }));
}

export function createCArmMonth(template) {
  const columns = cArmColumns(template);
  const fallbackRate = template?.incentive_rate ?? DEFAULT_C_ARM_RATE;
  return {
    incentive_rate: fallbackRate,
    columns,
    radiographers: (template?.radiographers ?? []).map((person) => ({
      id: person.id,
      name: person.name,
      columns,
      days: {},
    })),
  };
}

export function cArmPersonTotals(person, columns = null) {
  const cols = Array.isArray(columns) && columns.length > 0 ? columns : null;
  const totals = { total: 0 };
  if (cols) {
    for (const col of cols) {
      totals[col.id] = 0;
    }
  }
  totals.first = 0;
  totals.returning = 0;

  for (const day of Object.values(person?.days || {})) {
    for (const [key, val] of Object.entries(day || {})) {
      const count = Number(val) || 0;
      totals[key] = (totals[key] || 0) + count;
      totals.total += count;
    }
  }
  return totals;
}

export function cArmMonthTotal(document) {
  const cols = cArmColumns(document);
  return (document?.radiographers || []).reduce((sum, person) => sum + cArmPersonTotals(person, cols).total, 0);
}

export function cArmIncentive(person, documentOrRate, columns = null) {
  if (typeof documentOrRate === 'number') {
    return cArmPersonTotals(person).total * documentOrRate;
  }
  const doc = documentOrRate || {};
  const cols = columns || cArmColumns(doc);
  const totals = cArmPersonTotals(person, cols);
  return cols.reduce((sum, col) => {
    const rate = Number(col.rate ?? doc.incentive_rate ?? DEFAULT_C_ARM_RATE);
    const count = totals[col.id] || 0;
    return sum + (count * rate);
  }, 0);
}

export function validateCArmMonth(document, year, month) {
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('올바른 연월을 선택해주세요.');
  }
  if (!Number.isInteger(document.incentive_rate) || document.incentive_rate < 0 || document.incentive_rate > MAX_C_ARM_RATE) {
    throw new Error('건당 인센티브는 0~100,000,000원의 정수로 입력해주세요.');
  }
  const columns = cArmColumns(document);
  if (!columns.length || columns.length > 10) {
    throw new Error('항목 열은 1개에서 10개까지 설정할 수 있습니다.');
  }
  const colIds = new Set();
  const colLabels = new Set();
  for (const col of columns) {
    if (!col.id || colIds.has(col.id)) throw new Error('열 ID에 중복이 있습니다.');
    if (!col.label || col.label.length > 30) throw new Error('열 제목은 1~30자로 입력해주세요.');
    if (colLabels.has(col.label)) throw new Error(`열 제목 "${col.label}"이(가) 중복되었습니다.`);
    if (!Number.isInteger(col.rate) || col.rate < 0 || col.rate > MAX_C_ARM_RATE) {
      throw new Error(`"${col.label}" 열의 인센티브 단가는 0~100,000,000원의 정수로 입력해주세요.`);
    }
    colIds.add(col.id);
    colLabels.add(col.label);
  }
  if (!Array.isArray(document.radiographers) || document.radiographers.length > 30) {
    throw new Error('방사선사는 최대 30명까지 등록할 수 있습니다.');
  }
  const ids = new Set();
  const names = new Set();
  for (const person of document.radiographers) {
    const name = String(person.name || '').trim();
    if (!person.id || ids.has(person.id) || !name || name.length > 40 || names.has(name)) {
      throw new Error('방사선사 이름은 중복 없이 1~40자로 입력해주세요.');
    }
    ids.add(person.id);
    names.add(name);
    for (const [day, values] of Object.entries(person.days || {})) {
      if (!/^\d+$/.test(day) || Number(day) < 1 || Number(day) > daysInCArmMonth(year, month)) {
        throw new Error('해당 월에 없는 날짜의 기록이 있습니다.');
      }
      for (const [key, val] of Object.entries(values || {})) {
        if (val !== null && val !== undefined) {
          if (!Number.isInteger(val) || val < 0 || val > MAX_C_ARM_COUNT) {
            throw new Error('건수는 0~100,000 사이의 정수로 입력해주세요.');
          }
        }
      }
    }
  }
  return document;
}

export async function loadCArmYear(client, year) {
  const { data, error } = await client.from(C_ARM_TABLE).select('*').eq('year', year).order('month');
  if (error) throw error;
  return data || [];
}

export async function loadCArmTemplate(client, year) {
  const { data, error } = await client.from(C_ARM_TABLE).select('*')
    .lt('year', year).order('year', { ascending: false }).order('month', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export async function saveCArmMonth(client, { year, month, document, revision }) {
  validateCArmMonth(document, year, month);
  const columns = cArmColumns(document);
  const fallbackRate = document.incentive_rate ?? DEFAULT_C_ARM_RATE;
  const isCustom = columns.length !== 2 ||
    columns[0]?.id !== 'first' || columns[0]?.label !== '초진' || columns[0]?.rate !== fallbackRate ||
    columns[1]?.id !== 'returning' || columns[1]?.label !== '재진' || columns[1]?.rate !== fallbackRate ||
    (Array.isArray(document.columns) && document.columns.length > 0) ||
    document.radiographers?.some((p) => Array.isArray(p.columns));

  const radiographers = (document.radiographers || []).map((person) => {
    if (isCustom) {
      return { ...person, columns };
    }
    const copy = { ...person };
    delete copy.columns;
    return copy;
  });
  const payload = {
    year,
    month,
    incentive_rate: fallbackRate,
    radiographers,
    revision: revision === null ? 1 : revision + 1,
  };
  const query = revision === null
    ? client.from(C_ARM_TABLE).insert(payload)
    : client.from(C_ARM_TABLE).update(payload).eq('year', year).eq('month', month).eq('revision', revision);
  const { data, error } = await query.select();
  if (error?.code === '23505' || (!error && data?.length !== 1)) {
    throw new Error('다른 기기에서 이 달의 기록을 변경했습니다. 입력값을 확인한 뒤 서버 기록을 다시 불러와주세요.');
  }
  if (error) throw error;
  return data[0];
}
