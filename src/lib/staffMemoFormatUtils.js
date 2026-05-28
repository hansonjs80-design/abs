export function normalizeStaffDeptNameSpacing(value) {
  return String(value ?? '').replace(
    /([^\s,/]+)\s*\/\s*([^/\s,]+(?:\s*,\s*[^/\s,]+)*)/g,
    (match, dept, names) => {
      if (!dept || /^\d+$/.test(dept) || /[:\d]/.test(dept)) return match;
      const compactNames = String(names || '')
        .split(/\s*,\s*/)
        .map((name) => name.trim())
        .filter(Boolean)
        .join(',');
      return compactNames ? `${dept}/${compactNames}` : match;
    }
  );
}
