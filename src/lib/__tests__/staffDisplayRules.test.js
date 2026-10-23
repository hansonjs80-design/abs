import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STAFF_DISPLAY_RULES, getSavedStaffDisplayRules, withSavedStaffDisplayRules,
  getEffectiveStaffDisplayRules, setMonthlyStaffDisplayRules, formatMemoWithRule,
  matchDisplayRule, validateStaffDisplayRules,
} from '../staffDisplayRules.js';

const custom = {id:'custom',keyword:'야간',position:'contains',today_format:'template',today_template:'{부서}/{이름} 야간 근무',enabled:true,priority:110};

test('custom keyword conditions match attached keywords and plain memos without a department pair', () => {
  assert.equal(formatMemoWithRule('방과야간/여', [{...custom,today_template:'방과/여 야간 근무'}]), '방과/여 야간 근무');
  assert.equal(formatMemoWithRule('야간 직원 교육', [{...custom,today_template:'교육 참석 안내'}]), '교육 참석 안내');
  assert.equal(formatMemoWithRule('간호/홍길동 야간', [custom]), '간호/홍길동 야간 근무');
  assert.equal(formatMemoWithRule('주간 직원 교육', [custom]), null);
});

test('exact matching respects full content, while contains matching ignores spacing and case', () => {
  assert.equal(matchDisplayRule(' PT 교육 ', [{...custom,keyword:'pt교육',position:'exact'}])?.rule.id, 'custom');
  assert.equal(matchDisplayRule('PT 교육 참석', [{...custom,keyword:'pt교육',position:'exact'}]), null);
  assert.equal(matchDisplayRule('간호/PT 교육 참석', [{...custom,keyword:'pt교육'}])?.rule.id, 'custom');
});

test('template fields and literal braces render safely and missing department fields stay empty', () => {
  assert.equal(formatMemoWithRule('간호/홍길동 야간', [{...custom,today_template:'{이름} · {부서} · {키워드} · {메모} · {기타}'}]), '홍길동 · 간호 · 야간 · 간호/홍길동 야간 · {기타}');
  assert.equal(formatMemoWithRule('야간', [{...custom,today_template:'{이름}{메모}'}]), '야간');
});

test('legacy rules preserve suffix formatting and custom rules override lower-priority defaults', () => {
  assert.equal(formatMemoWithRule('야간 간호/홍길동', DEFAULT_STAFF_DISPLAY_RULES), '간호/홍길동 야간 근무');
  assert.equal(formatMemoWithRule('간호/홍길동 연차', DEFAULT_STAFF_DISPLAY_RULES), '간호/홍길동 연차');
  const rules = [...DEFAULT_STAFF_DISPLAY_RULES,{...custom,today_template:'야간 안내'}];
  assert.equal(formatMemoWithRule('야간 간호/홍길동', rules), '야간 안내');
  assert.equal(formatMemoWithRule('야간 간호/홍길동', [...DEFAULT_STAFF_DISPLAY_RULES,{...custom,enabled:false}]), '간호/홍길동 야간 근무');
});

test('JSON persistence survives a cold reload and preserves existing settings and months', () => {
  const settings = {staff_display_rules:{'2026-09':[{...custom,today_template:'이전 달'}]}};
  const rules = setMonthlyStaffDisplayRules(settings,2026,10,[custom]);
  const original = {global_departments:['간호'],device_settings:{virtual:{width:150}}};
  const payload = {monthly_settlement_settings:withSavedStaffDisplayRules(original,rules)};
  const reloaded = JSON.parse(JSON.stringify(payload));
  assert.equal(formatMemoWithRule('간호/홍길동 야간',getEffectiveStaffDisplayRules(reloaded,2026,10).rules),'간호/홍길동 야간 근무');
  assert.equal(formatMemoWithRule('간호/홍길동 야간',getEffectiveStaffDisplayRules(reloaded,2026,11).rules),'간호/홍길동 야간 근무');
  assert.equal(formatMemoWithRule('간호/홍길동 야간',getEffectiveStaffDisplayRules(reloaded,2026,9).rules),'이전 달');
  assert.deepEqual(reloaded.monthly_settlement_settings.global_departments,['간호']);
  assert.deepEqual(reloaded.monthly_settlement_settings.device_settings,original.device_settings);
  assert.deepEqual(withSavedStaffDisplayRules(reloaded.monthly_settlement_settings,undefined),reloaded.monthly_settlement_settings);
  assert.equal(original.__staff_display_rules,undefined);
});

test('legacy global rules remain available for earlier months after adding a monthly override', () => {
  const settings = {staff_display_rules:[{...custom,today_template:'기존 문구'}]};
  const saved = {staff_display_rules:setMonthlyStaffDisplayRules(settings,2026,10,[custom])};
  assert.equal(formatMemoWithRule('야간',getEffectiveStaffDisplayRules(saved,2026,9).rules),'기존 문구');
  assert.deepEqual(getSavedStaffDisplayRules({monthly_settlement_settings:{__staff_display_rules:[]}}),[]);
});

test('validation identifies missing input and duplicate enabled conditions before a save', () => {
  assert.match(validateStaffDisplayRules([{...custom,keyword:''}]),/키워드/);
  assert.match(validateStaffDisplayRules([{...custom,today_template:' '}]),/표시 문구/);
  assert.match(validateStaffDisplayRules([custom,{...custom,id:'other',keyword:'야 간'}]),/조건/);
  assert.equal(validateStaffDisplayRules([custom,{...custom,enabled:false}]),'');
  assert.equal(validateStaffDisplayRules(DEFAULT_STAFF_DISPLAY_RULES),'');
});
