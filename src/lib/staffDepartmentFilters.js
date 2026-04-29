export const DEFAULT_STAFF_DEPARTMENTS = ['PT', '간호'];
export const STAFF_DEPARTMENT_STORAGE_KEY = 'staff-schedule-departments';

const DEPARTMENT_ALIASES = {
  pt: 'PT',
  physical: 'PT',
  물리치료: 'PT',
  간호: '간호',
  충격파: '충격파',
  shock: '충격파',
  sw: '충격파',
};

function normalizeDepartmentName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return DEPARTMENT_ALIASES[raw.toLowerCase()] || DEPARTMENT_ALIASES[raw] || raw;
}

export function detectStaffMemoDepartments(content) {
  const text = String(content || '').trim();
  if (!text) return [];

  const departments = new Set();
  const slashPattern = /(?:^|[\s,])([A-Za-z가-힣]+)\s*\//g;
  let match;
  while ((match = slashPattern.exec(text)) !== null) {
    const dept = normalizeDepartmentName(match[1]);
    if (dept) departments.add(dept);
  }

  if (/(^|[\s,])(?:shock|sw)(?=[\s,/]|$)/i.test(text)) departments.add('충격파');
  if (/(^|[\s,])충격파(?=[\s,/]|$)/.test(text)) departments.add('충격파');
  if (/(^|[\s,])PT(?=[\s,/]|$)/i.test(text)) departments.add('PT');
  if (/(^|[\s,])간호(?=[\s,/]|$)/.test(text)) departments.add('간호');

  return Array.from(departments);
}

export function getStaffDepartmentsFromMemos(staffMemos = {}) {
  const departments = new Set(DEFAULT_STAFF_DEPARTMENTS);
  Object.values(staffMemos || {}).forEach((memo) => {
    detectStaffMemoDepartments(memo?.content).forEach((dept) => departments.add(dept));
  });
  return Array.from(departments);
}

export function normalizeStaffDepartmentList(value) {
  const list = Array.isArray(value) ? value : DEFAULT_STAFF_DEPARTMENTS;
  const seen = new Set();
  return list
    .map((item) => normalizeDepartmentName(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

export function readStoredStaffDepartments() {
  if (typeof localStorage === 'undefined') return DEFAULT_STAFF_DEPARTMENTS;
  try {
    const parsed = JSON.parse(localStorage.getItem(STAFF_DEPARTMENT_STORAGE_KEY) || 'null');
    const normalized = normalizeStaffDepartmentList(parsed);
    return normalized.length > 0 ? normalized : DEFAULT_STAFF_DEPARTMENTS;
  } catch {
    return DEFAULT_STAFF_DEPARTMENTS;
  }
}

export function saveStoredStaffDepartments(departments) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(
    STAFF_DEPARTMENT_STORAGE_KEY,
    JSON.stringify(normalizeStaffDepartmentList(departments))
  );
}

export function shouldHideStaffMemoByDepartment(content, hiddenDepartments = []) {
  if (!hiddenDepartments || hiddenDepartments.length === 0) return false;
  const hiddenSet = new Set(hiddenDepartments);
  return detectStaffMemoDepartments(content).some((dept) => hiddenSet.has(dept));
}
