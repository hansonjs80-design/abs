import { formatInsuranceUsage, INSURANCE_USAGE_COLORS, INSURANCE_USAGE_LABELS } from '../../lib/insuranceUsageUtils';

export default function InsuranceUsageBadge({ usage, status = '조회 중', showLabel = false }) {
  if (!usage) return <span style={{ color: '#64748b', fontSize: '0.8em' }}>{status}</span>;
  const period = usage.periodStart ? `${usage.periodStart} ~ ${usage.periodEnd} 전일` : '집계 시작 전';
  return <span title={`병원 내 관리용 · ${period}${usage.selfPay ? ' · (본인) 처방은 횟수 증가 제외' : ''}`}
    style={{ color: INSURANCE_USAGE_COLORS[usage.category], fontWeight: 800, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
    {showLabel ? `${INSURANCE_USAGE_LABELS[usage.category]} ` : ''}{formatInsuranceUsage(usage, showLabel)}
  </span>;
}
