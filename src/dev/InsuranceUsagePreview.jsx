import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import InsuranceUsageBadge from '../components/shockwave/InsuranceUsageBadge';
import ReservationWarningDialog from '../components/shockwave/ReservationWarningDialog';
import ShockwaveHoverTooltip from '../components/shockwave/ShockwaveHoverTooltip';
import { buildInsuranceRecords, formatInsuranceUsage, getInsuranceUsage } from '../lib/insuranceUsageUtils';
import { buildScheduleReservationWarnings, notifyReservationWarnings } from '../lib/scheduleReservationWarningUtils';
import { getPatientHistoryInsuranceWidth } from '../components/shockwave/shockwaveViewUtils';
import '../styles/shockwave.css';

const settings = { prescriptions: ['F2.5'], manual_therapy_prescriptions: ['30분'] };
const elbow = '외측상과염(M771)';
const spine = '요추/척추부 근막통(M79180)';
const makeLog = (id, body_part, prescription = 'F2.5') => ({ id, date: '2026-09-01', sort_index: id,
  chart_number: '1001', patient_name: '가상환자', content: '1001/가상환자(1)',
  prescription, body_part, type: prescription === '30분' ? 'manual' : 'shockwave' });
const initial = [makeLog(1, elbow), makeLog(2, elbow), makeLog(3, '내측상과염(M770)'),
  makeLog(4, spine), makeLog(5, spine), makeLog(6, spine),
  makeLog(7, spine, '30분'), makeLog(8, spine, '30분'), makeLog(9, spine, '30분')];

function Preview() {
  const [rows, setRows] = useState(initial);
  const [part, setPart] = useState(elbow);
  const [alert, setAlert] = useState(null);
  const [hover, setHover] = useState(false);
  const [saved, setSaved] = useState('부위를 선택하고 붙여넣기를 눌러 보세요.');
  const records = buildInsuranceRecords({ historyLogs: rows, settings });
  const latest = rows.at(-1);
  const usages = ['shockwave', 'manual'].map((category) => getInsuranceUsage(records, latest, settings, category));
  const displayRows = [...rows].reverse().map((row) => ({ ...row, insuranceUsage: getInsuranceUsage(records, row, settings) }));
  const width = getPatientHistoryInsuranceWidth([{ logs: displayRows }]);
  const paste = () => {
    const target = makeLog(rows.length + 1, part);
    notifyReservationWarnings(() => buildScheduleReservationWarnings({ target, historyLogs: rows, settings, year: 2026, month: 9 }),
      (warnings) => setAlert({ warnings }));
    setRows([...rows, target]);
    setSaved(`붙여넣기 완료: ${target.body_part} · 총 ${rows.length + 1}개 기록`);
  };
  const text = `⏱ 09:00\n🦴 부위: ${latest.body_part}\n📝 메모: 미리보기용 가상 기록` + usages
    .map((usage) => `\n• 실비소진: ${usage.category === 'manual' ? '도수치료' : '충격파'} ${formatInsuranceUsage(usage, true)}\n• 갱신 일자: ${usage.periodEnd}`).join('');
  return <main style={{ fontFamily: 'system-ui', padding: 28, color: '#1e293b', background: '#f8fafc', minHeight: '100vh' }}>
    <h2>실비소진 · 예약 알림 미리보기</h2>
    <p>가상 데이터입니다. 같은 부위가 7회, 전체가 13회가 되면 알림이 뜹니다.</p>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '20px 0' }}>
      <select aria-label="예약 부위" value={part} onChange={(event) => setPart(event.target.value)}>
        {[elbow, '내측상과염(M770)', spine, '회전근개건병증(M751)'].map((value) => <option key={value}>{value}</option>)}
      </select>
      <button onClick={paste}>셀에 붙여넣기</button>
      <button onClick={() => { setRows(initial); setAlert(null); setSaved('초기화 완료'); }}>초기화</button>
      <button onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>셀 호버 확인</button>
    </div>
    <p role="status" style={{ color: '#15803d', fontWeight: 700 }}>{saved}</p>
    <div style={{ width: `min(${650 + width}px, 100%)`, overflowX: 'auto', background: 'white', borderRadius: 10, border: '1px solid #cbd5e1' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', textAlign: 'left' }}>
        <thead><tr>{['처방', '부위(세부 진단명)', '실비소진', '갱신 일자'].map((title) => <th key={title} style={{ padding: 12, background: '#e2e8f0' }}>{title}</th>)}</tr></thead>
        <tbody>{displayRows.map((row) => <tr key={row.id}>
          <td style={{ padding: 10 }}>{row.prescription}</td><td style={{ padding: 10 }}>{row.body_part}</td>
          <td style={{ padding: 10, width }}><InsuranceUsageBadge usage={row.insuranceUsage} /></td>
          <td style={{ padding: 10, whiteSpace: 'nowrap' }}>{row.insuranceUsage.periodEnd}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <ShockwaveHoverTooltip text={text} visible={hover} tooltipRef={(element) => {
      if (element) { element.style.opacity = '1'; element.style.top = '220px'; element.style.left = '40px'; }
    }} />
    {alert && <ReservationWarningDialog request={alert} onAnswer={() => setAlert(null)} />}
  </main>;
}

createRoot(document.getElementById('root')).render(<Preview />);
