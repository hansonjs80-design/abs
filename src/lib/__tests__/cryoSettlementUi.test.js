import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const shockwaveStatsViewUrl = new URL(
  '../../components/shockwave/ShockwaveStatsView.jsx',
  import.meta.url
);
const shockwaveSettlementViewUrl = new URL(
  '../../components/shockwave/ShockwaveSettlementView.jsx',
  import.meta.url
);
const shockwaveHorizontal2ViewUrl = new URL(
  '../../components/shockwave/ShockwaveSettlementHorizontalCompactView.jsx',
  import.meta.url
);
const manualTherapyPageUrl = new URL('../../pages/ManualTherapyStatsPage.jsx', import.meta.url);
const manualTherapyViewUrl = new URL(
  '../../components/shockwave/ManualTherapyStatsView.jsx',
  import.meta.url
);

test('shockwave settlement keeps three standard views and adds three cryo-adjusted views', async () => {
  const [statsView, settlementView, horizontal2View] = await Promise.all([
    readFile(shockwaveStatsViewUrl, 'utf8'),
    readFile(shockwaveSettlementViewUrl, 'utf8'),
    readFile(shockwaveHorizontal2ViewUrl, 'utf8'),
  ]);

  assert.match(statsView, /cryoAdjustedAmount/);
  assert.match(statsView, /cryoPrescriptions=\{effectiveSettlementSettings\.cryo_prescriptions\}/);
  assert.match(statsView, /cryoPrices=\{effectiveSettlementSettings\.cryo_prices\}/);
  assert.match(settlementView, /renderViewModeSelector\('standard', '기본 충격파 결산 보기 방식'\)/);
  assert.match(settlementView, /renderViewModeSelector\('cryo', '크라이오 반영 충격파 결산 보기 방식'\)/);
  assert.match(settlementView, /크라이오 반영 통계/);
  assert.match(settlementView, /buildCryoAdjustedPrescriptionPrices/);
  assert.match(settlementView, /amount:\s*item\.cryoAdjustedAmount \?\? item\.amount/);
  assert.match(horizontal2View, /isCryoAdjusted \? '충격파 크라이오 반영 결산' : '충격파 결산'/);
});

test('manual therapy settlement toggles the same table to cryo-adjusted prices', async () => {
  const [page, view] = await Promise.all([
    readFile(manualTherapyPageUrl, 'utf8'),
    readFile(manualTherapyViewUrl, 'utf8'),
  ]);

  assert.match(page, /cryoPrescriptions=\{effectiveSettlementSettings\.cryo_prescriptions\}/);
  assert.match(page, /cryoPrices=\{effectiveSettlementSettings\.cryo_prices\}/);
  assert.match(view, /aria-pressed=\{isCryoAdjusted\}/);
  assert.match(view, />\s*크라이오 반영 통계\s*<\/button>/);
  assert.match(view, /buildCryoAdjustedPrescriptionPrices/);
  assert.match(view, /prescriptionPrices:\s*effectivePrescriptionPrices/);
  assert.match(view, /isCryoAdjusted \? '도수치료 크라이오 반영 결산' : '도수치료 결산'/);
});
