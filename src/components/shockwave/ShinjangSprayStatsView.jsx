import React from 'react';
import ShockwaveSettlementView from './ShockwaveSettlementView';
import '../../styles/shockwave_settlement_vertical.css';
import '../../styles/shockwave_settlement_horizontal2.css';

const SHINJANG_VIEW_MODE_STORAGE_KEY = 'shinjang-spray:settlement:viewMode';

export default function ShinjangSprayStatsView({
  currentMonth,
  rows = [],
  therapists = [],
  prescriptions = [],
  prescriptionPrices = {},
  incentivePercentages = {},
  hiddenIncentivePercentages = [],
  cryoPrescriptions = [],
  cryoPrices = {},
  recentMonthlySummaries = [],
  recentPeriodInput = '최근 6개월',
  recentPeriodLabel = '최근 6개월',
  onRecentPeriodInputChange,
  recentSummariesLoading = false,
}) {
  return (
    <ShockwaveSettlementView
      logs={rows}
      therapists={therapists}
      currentMonth={currentMonth}
      prescriptions={prescriptions}
      prescriptionPrices={prescriptionPrices}
      cryoPrescriptions={cryoPrescriptions}
      cryoPrices={cryoPrices}
      incentivePercentages={incentivePercentages}
      hiddenIncentivePercentages={hiddenIncentivePercentages}
      monthlyTherapists={[]}
      treatmentLabel="신장분사"
      recentMonthlySummaries={recentMonthlySummaries}
      recentPeriodInput={recentPeriodInput}
      recentPeriodLabel={recentPeriodLabel}
      onRecentPeriodInputChange={onRecentPeriodInputChange}
      recentSummariesLoading={recentSummariesLoading}
      showOnlyTherapistPrescriptions
      viewModeStorageKey={SHINJANG_VIEW_MODE_STORAGE_KEY}
    />
  );
}
