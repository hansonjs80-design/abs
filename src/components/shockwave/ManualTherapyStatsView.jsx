import React, { useMemo } from 'react';
import { generateShockwaveCalendar } from '../../lib/calendarUtils';
import { normalizeNameForMatch } from '../../lib/memoParser';

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toVisitNumber(value) {
  if (value === '-') return '-';
  const parsed = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : '';
}

function formatMonthDay(dateText) {
  const parts = String(dateText || '').split('-');
  if (parts.length !== 3) return '';
  return `${parts[1]}/${parts[2]}`;
}

function parseManualTherapyEntry(rawContent, therapists) {
  const source = String(rawContent || '').trim();
  if (!source || !/(40|60)/.test(source)) return null;

  let chartNumber = '';
  let rest = source;

  if (source.includes('/')) {
    const [left, ...right] = source.split('/');
    if (/\d/.test(left)) {
      chartNumber = left.trim();
      rest = right.join('/').trim();
    }
  }

  let suffixToken = '';
  let visitCount = '';
  const suffixMatch = rest.match(/(\((-|\d+)\)|\*)\s*$/);
  if (suffixMatch) {
    suffixToken = suffixMatch[1];
    visitCount = suffixToken === '*'
      ? '1'
      : suffixMatch[2] === '-'
        ? '-'
        : suffixMatch[2];
    rest = rest.slice(0, rest.length - suffixToken.length).trim();
  }

  const sortedTherapists = [...(therapists || [])]
    .filter((item) => item?.name)
    .sort((a, b) => String(b.name).length - String(a.name).length);

  for (const therapist of sortedTherapists) {
    const match = rest.match(
      new RegExp(`^(.*?)(?:\\s+)?(${escapeRegExp(therapist.name)})\\s*(40|60)$`)
    );
    if (!match) continue;

    const patientName = String(match[1] || '').trim();
    if (!patientName) continue;

    return {
      patientName,
      therapistName: therapist.name,
      duration: match[3],
      chartNumber,
      visitCount,
    };
  }

  const fallback = rest.match(/^(.*?)(40|60)$/);
  if (!fallback) return null;

  const patientName = String(fallback[1] || '').trim();
  if (!patientName) return null;

  return {
    patientName,
    therapistName: '',
    duration: fallback[2],
    chartNumber,
    visitCount,
  };
}

function pickEnrichedHistory(entry, logs) {
  const normalizedName = normalizeNameForMatch(entry.patientName);
  const matched = (logs || [])
    .filter((log) => {
      const sameChart = entry.chartNumber && String(log?.chart_number || '').trim() === entry.chartNumber;
      const sameName = normalizedName && normalizeNameForMatch(log?.patient_name) === normalizedName;
      return sameChart || sameName;
    })
    .sort((a, b) => {
      const dateCompare = String(b?.date || '').localeCompare(String(a?.date || ''));
      if (dateCompare !== 0) return dateCompare;
      return (parseInt(String(b?.visit_count || '0'), 10) || 0) - (parseInt(String(a?.visit_count || '0'), 10) || 0);
    });

  return matched[0] || null;
}

export default function ManualTherapyStatsView({
  currentYear,
  currentMonth,
  memos,
  therapists,
  logs = [],
  prescriptions = ['40분', '60분'],
  incentivePercentage = 0,
}) {
  const entries = useMemo(() => {
    const weeks = generateShockwaveCalendar(currentYear, currentMonth);

    return Object.entries(memos || {})
      .map(([key, memo]) => {
        const [w, d, r, c] = key.split('-').map(Number);
        const dayInfo = weeks[w]?.[d];
        if (!dayInfo?.isCurrentMonth) return null;

        const parsed = parseManualTherapyEntry(memo?.content, therapists);
        if (!parsed) return null;

        const date = `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
        const enriched = pickEnrichedHistory(parsed, logs);
        const latestVisit = toVisitNumber(parsed.visitCount);
        const fallbackVisit = toVisitNumber(enriched?.visit_count);
        const visitLabel = latestVisit !== ''
          ? `${latestVisit}회`
          : fallbackVisit !== '' && fallbackVisit !== '-'
            ? `${fallbackVisit}회`
            : fallbackVisit === '-'
              ? '(-)'
              : '';

        return {
          key,
          weekIndex: w,
          dayIndex: d,
          rowIndex: r,
          colIndex: c,
          date,
          dateLabel: formatMonthDay(date),
          patientName: parsed.patientName,
          therapistName: parsed.therapistName || therapists?.[c]?.name || '',
          duration: parsed.duration,
          durationLabel: `${parsed.duration}분`,
          chartNumber: parsed.chartNumber || String(enriched?.chart_number || '').trim(),
          visitLabel,
          bodyPart: String(enriched?.body_part || '').trim() || '-',
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.therapistName !== b.therapistName) return a.therapistName.localeCompare(b.therapistName, 'ko');
        if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
        return a.colIndex - b.colIndex;
      });
  }, [currentYear, currentMonth, memos, therapists, logs]);

  const summaryByTherapist = useMemo(() => {
    return therapists
      .filter((therapist) => therapist?.name)
      .map((therapist) => {
        const therapistEntries = entries.filter((entry) => entry.therapistName === therapist.name);
        const count40 = therapistEntries.filter((entry) => entry.duration === '40').length;
        const count60 = therapistEntries.filter((entry) => entry.duration === '60').length;

        return {
          therapist,
          count40,
          count60,
          totalCount: therapistEntries.length,
        };
      })
      .filter((item) => item.totalCount > 0);
  }, [entries, therapists]);

  const totalCount = entries.length;
  const duration40Label = useMemo(
    () => prescriptions.find((item) => String(item).includes('40')) || '40분',
    [prescriptions]
  );
  const duration60Label = useMemo(
    () => prescriptions.find((item) => String(item).includes('60')) || '60분',
    [prescriptions]
  );

  return (
    <div className="sw-settlement-stack">
      <div className="sw-settlement-card">
        <div className="sw-settlement-header">
          <h2>{currentMonth}월 도수치료 통계</h2>
          <div className="sw-settlement-meta">
            <span>총 {totalCount}건</span>
            <span>인센티브 {Number(incentivePercentage) || 0}%</span>
          </div>
        </div>

        <div className="sw-settlement-table-wrap">
          <table className="sw-manual-summary-table">
            <thead>
              <tr>
                {summaryByTherapist.map((item) => (
                  <th key={item.therapist.id || item.therapist.name} colSpan={3} className="therapist-col">
                    {item.therapist.name} ( {item.totalCount}건 )
                  </th>
                ))}
              </tr>
              <tr>
                {summaryByTherapist.flatMap((item) => ([
                  <th key={`${item.therapist.id || item.therapist.name}-40`}>{duration40Label}</th>,
                  <th key={`${item.therapist.id || item.therapist.name}-60`}>{duration60Label}</th>,
                  <th key={`${item.therapist.id || item.therapist.name}-total`}>총건수</th>,
                ]))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {summaryByTherapist.flatMap((item) => ([
                  <td key={`${item.therapist.id || item.therapist.name}-40-count`} className="duration-40">{item.count40}</td>,
                  <td key={`${item.therapist.id || item.therapist.name}-60-count`} className="duration-60">{item.count60}</td>,
                  <td key={`${item.therapist.id || item.therapist.name}-total-count`} className="total-count">{item.totalCount}</td>,
                ]))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="sw-settlement-card">
        <div className="sw-settlement-header">
          <h2>{currentMonth}월 도수치료 현황</h2>
        </div>

        <div className="sw-settlement-table-wrap">
          <table className="sw-manual-detail-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>이름</th>
                <th>번호</th>
                <th>회차</th>
                <th>부위</th>
                <th>담당</th>
                <th>시간</th>
              </tr>
            </thead>
            <tbody>
              {entries.length > 0 ? entries.map((entry) => (
                <tr key={entry.key}>
                  <td>{entry.dateLabel}</td>
                  <td className="patient-name">{entry.patientName}</td>
                  <td>{entry.chartNumber || ''}</td>
                  <td>{entry.visitLabel}</td>
                  <td>{entry.bodyPart}</td>
                  <td>{entry.therapistName}</td>
                  <td className={entry.duration === '40' ? 'duration-40' : 'duration-60'}>{entry.durationLabel}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="manual-empty">이번 달 스케줄러에 도수치료(40/60) 표기가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
