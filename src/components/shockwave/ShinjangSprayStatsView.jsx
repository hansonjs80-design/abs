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
  cryoPrescriptions = [],
  cryoPrices = {},
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
      monthlyTherapists={[]}
      treatmentLabel="신장분사"
      showRecentSummaries={false}
      showOnlyTherapistPrescriptions
      viewModeStorageKey={SHINJANG_VIEW_MODE_STORAGE_KEY}
    />
  );
}
