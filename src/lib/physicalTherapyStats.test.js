import test from 'node:test';
import assert from 'node:assert/strict';
import { getPTStatsWeeks, fetchPTStatsYear } from './physicalTherapyStats.js';

const day = (weeks, n) => weeks.flat().find(d => d?.day === n);
test('PT integration, scope, overrides, missing days and zero follow the calendar display without mutating memos', () => {
  const memos = { '2026-10-19-5': { content: '55명' }, '2026-10-20-5': { content: '0명' }, '2026-10-21-5': { content: '14:30 회의' } };
  const original = structuredClone(memos);
  const pt = { settings: { scope: 'from', startDate: '2026-10-19' }, counts: { '2026-10-18': 99, '2026-10-19': 65, '2026-10-22': 0, '2026-10-23': 45 } };
  let weeks = getPTStatsWeeks(2026, 10, memos, null, pt);
  assert.equal(day(weeks, 18).value, null);
  assert.equal(day(weeks, 19).value, 65);
  assert.equal(day(weeks, 20).value, 0);
  assert.equal(day(weeks, 21).value, null);
  assert.equal(day(weeks, 22).value, null);
  assert.equal(day(weeks, 23).value, 45);
  pt.overrides = { '2026-10-19': { active: true, sourceCount: 65, memoKey: '2026-10-19-5', content: '55명' } };
  weeks = getPTStatsWeeks(2026, 10, memos, null, pt);
  assert.equal(day(weeks, 19).value, 55);
  pt.counts['2026-10-19'] = 66;
  assert.equal(day(getPTStatsWeeks(2026, 10, memos, null, pt), 19).value, 66);
  pt.settings.enabled = false;
  assert.equal(day(getPTStatsWeeks(2026, 10, memos, null, pt), 19).value, 55);
  assert.deepEqual(memos, original);
});

test('statistics use the configured last row, never numbers inside staff notes or hidden rows', () => {
  const weeks = getPTStatsWeeks(2026, 10, {
    '2026-10-5-5': {content:'999'}, '2026-10-5-7': {content:'1,234명'},
    '2026-10-6-4': {content:'간호/직원(2)'}, '2026-10-6-8': {content:'100'},
  }, {week_slot_counts:{1:8}});
  assert.equal(day(weeks,5).value,1234);
  assert.equal(day(weeks,6).value,null);
});

test('year loader reads past 1000 staff rows and uses previous-month slot settings without writing', async () => {
  const rows=Array.from({length:1001},(_,i)=>({year:2026,month:10,day:19,slot_index:i,content:String(i)}));
  const ranges=[];
  const client={from(table){let range;const query={
    select(){return query},eq(){return query},gte(){return query},lte(){return query},order(){return query},limit(){return query},abortSignal(){return query},
    range(a,b){range=[a,b];ranges.push(range);return query},
    then(resolve,reject){return Promise.resolve({error:null,data:table==='staff_schedules'?rows.slice(range[0],range[1]+1):[{year:2025,month:12,week_slot_counts:{0:8}},{year:2026,month:10,week_slot_counts:{3:7}}]}).then(resolve,reject)}
  };return query}};
  const result=await fetchPTStatsYear(client,2026);
  assert.deepEqual(ranges,[[0,999],[1000,1999]]);
  assert.equal(Object.keys(result.memos).length,1001);
  assert.equal(result.memos['2026-10-19-1000'].content,'1000');
  assert.deepEqual(result.settings[1].week_slot_counts,{0:8});
  assert.deepEqual(result.settings[11].week_slot_counts,{3:7});
  assert.equal(result.settings[12],null);
});
