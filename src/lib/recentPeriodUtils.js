export function parseRecentPeriodMonths(value, fallback = 6) {
  const text = String(value || '').trim();
  if (!text) return fallback;

  const yearMatch = text.match(/(\d+)\s*년/);
  const monthMatch = text.match(/(\d+)\s*(개월|달|월)/);
  const plainNumberMatch = text.match(/^\D*(\d+)\D*$/);

  const years = yearMatch ? Number.parseInt(yearMatch[1], 10) : 0;
  const months = monthMatch ? Number.parseInt(monthMatch[1], 10) : 0;
  const plainMonths = !yearMatch && !monthMatch && plainNumberMatch
    ? Number.parseInt(plainNumberMatch[1], 10)
    : 0;

  const total = years * 12 + months + plainMonths;
  if (!Number.isFinite(total) || total < 1) return fallback;
  return Math.min(total, 60);
}

export function formatRecentPeriodLabel(months) {
  const safeMonths = Math.max(1, Math.min(60, Number.parseInt(String(months), 10) || 6));
  if (safeMonths % 12 === 0) {
    const years = safeMonths / 12;
    return `최근 ${years}년`;
  }
  return `최근 ${safeMonths}개월`;
}
