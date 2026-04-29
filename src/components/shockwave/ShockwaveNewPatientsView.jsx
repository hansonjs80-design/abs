import React, { useMemo } from 'react';
import { buildDisplayTherapists } from '../../lib/therapistDisplayUtils';

function normalizePatientName(value) {
  return String(value || '').replace(/\*/g, '').trim();
}

function toVisitNumber(value) {
  const parsed = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

function formatMonthDay(dateText) {
  const parts = String(dateText || '').split('-');
  if (parts.length !== 3) return '';
  return `${parts[1]}/${parts[2]}`;
}

export default function ShockwaveNewPatientsView({
  logs,
  therapists,
  currentMonth,
  title,
  monthlyTherapists,
}) {
  const safeTherapists = useMemo(() => (Array.isArray(therapists) ? therapists.filter(Boolean) : []), [therapists]);
  const displayTherapists = useMemo(
    () => buildDisplayTherapists(safeTherapists, monthlyTherapists),
    [safeTherapists, monthlyTherapists]
  );

  const summary = useMemo(() => {
    const byTherapist = displayTherapists.map((therapist) => {
      const therapistLogs = (logs || []).filter(
        (log) => log?.therapist_name === therapist.name && normalizePatientName(log?.patient_name)
      );

      const grouped = new Map();

      therapistLogs.forEach((log) => {
        const cleanName = normalizePatientName(log?.patient_name);
        if (!cleanName) return;

        const current = grouped.get(cleanName) || {
          hasNewMark: false,
          firstDate: String(log?.date || ''),
          latestDate: String(log?.date || ''),
          latestVisitCount: toVisitNumber(log?.visit_count),
          bodyPart: String(log?.body_part || '').trim(),
          patientName: cleanName,
        };

        const nextDate = String(log?.date || '');
        const nextVisitCount = toVisitNumber(log?.visit_count);
        const isNewMarked = String(log?.patient_name || '').includes('*');

        current.hasNewMark = current.hasNewMark || isNewMarked;
        if (nextDate && (!current.firstDate || nextDate < current.firstDate)) current.firstDate = nextDate;
        if (
          nextDate > current.latestDate ||
          (nextDate === current.latestDate && nextVisitCount >= current.latestVisitCount)
        ) {
          current.latestDate = nextDate;
          current.latestVisitCount = nextVisitCount;
          if (String(log?.body_part || '').trim()) current.bodyPart = String(log.body_part).trim();
        } else if (!current.bodyPart && String(log?.body_part || '').trim()) {
          current.bodyPart = String(log.body_part).trim();
        }

        grouped.set(cleanName, current);
      });

      const patients = Array.from(grouped.values())
        .filter((item) => item.hasNewMark)
        .sort((a, b) => {
          if (a.firstDate !== b.firstDate) return a.firstDate.localeCompare(b.firstDate);
          return a.patientName.localeCompare(b.patientName, 'ko');
        })
        .map((item) => ({
          date: formatMonthDay(item.firstDate),
          patientName: item.patientName,
          bodyPart: item.bodyPart || '-',
          visitLabel: `${item.latestVisitCount}회`,
        }));

      return {
        therapist: { ...therapist, id: therapist.key || therapist.id || therapist.name, name: therapist.displayName || therapist.name },
        patients,
        totalCount: patients.length,
      };
    });

    const maxRows = byTherapist.reduce((max, item) => Math.max(max, item.patients.length), 0);
    const totalCount = byTherapist.reduce((sum, item) => sum + item.totalCount, 0);

    return {
      byTherapist,
      maxRows,
      totalCount,
    };
  }, [logs, displayTherapists]);

  if (!displayTherapists.length) {
    return (
      <div className="sw-stats-empty">
        활성화된 치료사가 없어 신규환자 목록을 계산할 수 없습니다.
        <div className="empty-subtext">설정 탭에서 치료사를 먼저 저장해 주세요.</div>
      </div>
    );
  }

  return (
    <div className="sw-settlement-stack">
      <div className="sw-settlement-card">
        <div className="sw-settlement-header">
          <h2>{title || `${currentMonth}월 충격파 신규환자`}</h2>
          <div className="sw-settlement-meta">
            <span>총 {summary.totalCount}명</span>
          </div>
        </div>

        <div className="sw-settlement-table-wrap sw-compact-table-wrap">
          <table className="sw-new-patient-table sw-compact-new-patient-table">
            <thead>
              <tr>
                {summary.byTherapist.map((item, therapistIndex) => (
                  <th
                    key={item?.therapist?.id || item?.therapist?.name || therapistIndex}
                    colSpan={4}
                    className={`therapist-col therapist-tone-${therapistIndex % 5} therapist-group-end`}
                  >
                    {item?.therapist?.name || ''} ({item.totalCount}명)
                  </th>
                ))}
              </tr>
              <tr>
                {summary.byTherapist.flatMap((item, therapistIndex) => ([
                  <th key={`${item?.therapist?.id || item?.therapist?.name || therapistIndex}-date`} className={`sub-col therapist-tone-${therapistIndex % 5}-sub ${therapistIndex > 0 ? 'therapist-group-start' : ''}`}>날짜</th>,
                  <th key={`${item?.therapist?.id || item?.therapist?.name || therapistIndex}-name`} className={`sub-col therapist-tone-${therapistIndex % 5}-sub`}>이름</th>,
                  <th key={`${item?.therapist?.id || item?.therapist?.name || therapistIndex}-body`} className={`sub-col therapist-tone-${therapistIndex % 5}-sub`}>부위</th>,
                  <th key={`${item?.therapist?.id || item?.therapist?.name || therapistIndex}-visit`} className={`sub-col therapist-tone-${therapistIndex % 5}-sub therapist-group-end`}>회차</th>,
                ]))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: summary.maxRows || 1 }, (_, rowIndex) => (
                <tr key={`new-patient-row-${rowIndex}`}>
                  {summary.byTherapist.flatMap((item, therapistIndex) => {
                    const patient = item.patients[rowIndex];
                    const toneClass = `therapist-tone-${therapistIndex % 5}-cell`;
                    const tKey = item?.therapist?.id || item?.therapist?.name || therapistIndex;
                    return [
                      <td key={`${tKey}-${rowIndex}-date`} className={`${toneClass} ${therapistIndex > 0 ? 'therapist-group-start' : ''}`}>
                        {patient?.date || ''}
                      </td>,
                      <td key={`${tKey}-${rowIndex}-name`} className={`patient-name ${toneClass}`}>
                        {patient?.patientName || ''}
                      </td>,
                      <td key={`${tKey}-${rowIndex}-body`} className={toneClass}>
                        {patient?.bodyPart || ''}
                      </td>,
                      <td key={`${tKey}-${rowIndex}-visit`} className={`visit-count ${toneClass} therapist-group-end`}>
                        {patient?.visitLabel || ''}
                      </td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
