import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveLoadedSchedulePrescription} from '../scheduleLoadedPrescriptionUtils.js';
const settings = {manual_therapy_prescriptions:['40분','60분'], prescriptions:['F2.5']};
test('month loading preserves every explicitly saved prescription despite old dose tags', () => {
  for (const prescription of ['신장분사 1','신장분사 2','F2.5','폐기된 처방','60분']) {
    for (const month of [8,9,10]) {
      const memo = {content:'1001/가상환자40(2)',prescription};
      assert.deepEqual(resolveLoadedSchedulePrescription(memo, settings, 2026, month), memo);
    }
  }
});
test('only missing prescriptions use the configured dose tag or legacy inference', () => {
  assert.equal(resolveLoadedSchedulePrescription({content:'1001/가상환자40(2)'},settings,2026,9).prescription,'40분');
  assert.equal(resolveLoadedSchedulePrescription({content:'1001/가상환자(2)'},settings,2026,9).prescription,'');
});

test('loading merge repair also preserves the saved prescription through payload generation', async () => {
  const {buildManualTherapyAutoMergePayload} = await import('../scheduleManualTherapyAutoMergeUtils.js');
  const memo={content:'1001/가상환자40(2)',prescription:'신장분사 1'};
  const resolved=resolveLoadedSchedulePrescription(memo,settings,2026,9);
  const result=buildManualTherapyAutoMergePayload({key:'0-0-0-0',memos:{'0-0-0-0':memo},currentYear:2026,currentMonth:9,rowCount:60,
    ...resolved,preservePrescription:true,durationMinutesMap:{'40분':40,'신장분사 1':20},doseTags:{'40분':'40'},slotMinutes:10});
  assert.equal(result.ok,true);
  assert.equal(result.resolvedPrescription,'신장분사 1');
  assert.equal(result.payload[0].prescription,'신장분사 1');
  assert.equal(result.payload[0].content,memo.content);
});
