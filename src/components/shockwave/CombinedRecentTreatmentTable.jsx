import { Printer } from 'lucide-react';
import { printSettlementTable } from '../../lib/printSettlementTable';

const formatValue = (value, metric) => `${Number(value || 0).toLocaleString('ko-KR')}${metric === 'amount' ? '원' : metric === 'newPatientCount' ? '명' : '건'}`;

export default function CombinedRecentTreatmentTable({ treatment, label, periodLabel, summaries, currentMonthKey, viewMode, onViewModeChange }) {
  const title = `${periodLabel} ${label} 결산/신환 현황`;
  return (
    <section className="combined-stats-recent combined-recent-treatment-card" data-print-title={title}>
      <div className="combined-stats-recent-heading">
        <h2>{title}</h2>
        <div className="combined-recent-filter-tabs" role="tablist" aria-label={`${label} 결산 현황 보기 방식`}>
          <button type="button" role="tab" aria-selected={viewMode === 'total-only'} className={`combined-recent-tab-btn ${viewMode === 'total-only' ? 'is-active' : ''}`} onClick={() => onViewModeChange('total-only')}>전체만 보기</button>
          <button type="button" role="tab" aria-selected={viewMode === 'detail'} className={`combined-recent-tab-btn ${viewMode === 'detail' ? 'is-active' : ''}`} onClick={() => onViewModeChange('detail')}>상세 보기</button>
        </div>
        <button type="button" className="combined-table-print-button" onClick={(event) => printSettlementTable(event.currentTarget.closest('section'), title)} aria-label={`${title} 인쇄`}><Printer size={16} />인쇄</button>
      </div>
      <div className="combined-stats-recent-table-wrap">
        <table>
          <thead><tr><th>월</th><th>건수</th><th>결산 금액</th><th>신환</th></tr></thead>
          <tbody>{summaries.map((summary) => {
            const values = summary.recentTreatments?.[treatment] || {};
            return (
              <tr key={summary.monthKey} className={summary.monthKey === currentMonthKey ? 'is-current' : undefined}>
                <th>{summary.label}</th>
                {['count', 'amount', 'newPatientCount'].map((metric) => (
                  <td key={metric} className="combined-recent-breakdown-cell">
                    {viewMode === 'total-only' ? <strong>{formatValue(values[metric], metric)}</strong> : (
                      <div className="combined-recent-breakdown">
                        <div className="combined-recent-breakdown-item combined-recent-breakdown-item--total"><span>전체</span><strong>{formatValue(values[metric], metric)}</strong></div>
                        {(values.details || []).map((detail) => <div key={detail.label} className="combined-recent-breakdown-item"><span>{detail.label}</span><strong>{formatValue(detail[metric], metric)}</strong></div>)}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}
