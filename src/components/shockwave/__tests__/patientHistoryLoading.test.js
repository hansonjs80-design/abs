import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const hookURL = new URL('../usePatientHistoryActions.js', import.meta.url);
const source = await readFile(hookURL, 'utf8');
const imports = [...source.matchAll(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';/gm)];
const bindings = {};
for (const [, names, path] of imports) {
  if (path === 'react' || path.endsWith('/supabaseClient')) continue;
  const module = await import(new URL(path + '.js', hookURL));
  for (const name of names.replace(/[{}]/g, '').split(',').map(value => value.trim()).filter(Boolean)) bindings[name] = module[name];
}
const executable = source.replace(/^import\s+[\s\S]*?\s+from\s+'[^']+';\s*/gm, '')
  .replace('export default function usePatientHistoryActions', 'function usePatientHistoryActions')
  + '\nglobalThis.createActions = usePatientHistoryActions;';

function fixture(resolveQuery, overrides = {}) {
  const calls = [], notices = [], cleanup = [];
  let data = {loading:false,logs:[{patient_name:'이전 검색 결과'}]}, open = false;
  const client = {from(table) {
    const query = {table,filters:[]};
    for (const method of ['select','order','limit','eq','neq','ilike','in','gte']) query[method] = (...args) => {
      query.filters.push([method,...args]);return query;
    };
    query.then = (resolve,reject) => {calls.push(query);return Promise.resolve().then(() => resolveQuery(query)).then(resolve,reject);};
    return query;
  }};
  const context = vm.createContext({...bindings,Date,setTimeout,clearTimeout,
    useRef:value => ({current:value}),useCallback:fn => fn,useEffect:fn => cleanup.push(fn()),
    supabase:client,console:{error(){}},alert:message => notices.push(message),
  });
  vm.runInContext(executable,context);
  const actions = context.createActions({currentYear:2026,currentMonth:10,holidays:new Set(),settings:{},therapists:[],manualTherapists:[],
    monthlyTherapists:[],monthlyManualTherapists:[],selectedCell:null,memos:{},pendingCellBgColors:{},pendingDisplayValues:{},
    baseTimeSlotsLength:30,colCount:4,cellKey:(w,d,r,c)=>`${w}-${d}-${r}-${c}`,
    patientHistoryTargetCellRef:{current:null},addToast:message=>notices.push(message),
    setPatientHistoryModalOpen:value=>{open=value;},setPatientHistoryModalData:next=>{data=typeof next==='function'?next(data):next;},
    ...overrides,
  });
  return {actions,calls,notices,cleanup,get data(){return data;},get open(){return open;}};
}
const log = name => ({id:name,patient_name:name,chart_number:name==='가상환자'?'461':'462',date:'2026-10-01',visit_count:'1',prescription:'충격파'});

test('history dialog opens with loading feedback before a slow read completes',async()=>{
  let finish;const waiting=new Promise(resolve=>{finish=resolve;});
  const f=fixture(async()=>{await waiting;return {data:[]};},{selectedCell:{w:0,d:0,r:0,c:0},memos:{'0-0-0-0':{content:'461/가상환자(1)'}}});
  const opening=f.actions.handleOpenPatientHistoryModal();
  assert.equal(f.open,true);assert.equal(f.data.loading,true,JSON.stringify(f.data));assert.equal(f.data.logs.length,0);
  finish();await opening;assert.equal(f.data.loading,false);
});

test('linked log and candidate reads share one monthly verification and retain the newest schedule fields',async()=>{
  const row={id:10,year:2026,month:10,week_index:0,day_index:4,row_index:0,col_index:0,
    content:'461/가상환자(2)',prescription:'충격파',body_part:'허리',bg_color:'#ffe599',updated_at:'2026-10-01T09:00:00Z'};
  const f=fixture(query=>{
    if(query.table==='shockwave_patient_logs')return {data:[{...log('가상환자'),source:'scheduler',scheduler_cell_key:'2026:10:0:4:0:0'}]};
    if(query.table==='shockwave_schedules')return {data:[row]};
    if(query.table==='shockwave_monthly_therapists')return {data:[{slot_index:0,therapist_name:'가상치료사',start_day:1,end_day:31}]};
    return {data:[]};
  });
  await f.actions.fetchPatientHistory('가상환자','461');
  const linked=f.calls.filter(query=>query.table==='shockwave_schedules'&&query.filters.some(([method,key])=>method==='eq'&&key==='year'));
  assert.equal(linked.length,1);
  assert.equal(f.data.logs.length,1);assert.equal(f.data.logs[0].visit_count,'2');
  assert.equal(f.data.logs[0].schedule_completed,true);assert.equal(f.data.logs[0].therapist_name,'가상치료사');
});

test('different verification windows run in parallel without widening their coordinate filters',{timeout:3000},async()=>{
  const row={id:10,year:2026,month:10,week_index:0,day_index:3,row_index:1,col_index:1,content:'461/가상환자(2)',prescription:'충격파'};
  let release,started=0;const bothStarted=new Promise(resolve=>{release=resolve;});
  const f=fixture(async query=>{
    if(query.table==='shockwave_patient_logs')return {data:[{...log('가상환자'),source:'scheduler',scheduler_cell_key:'2026:10:0:3:0:0'}]};
    if(query.table==='shockwave_schedules') {
      const rows=query.filters.find(([method,key])=>method==='in'&&key==='row_index');
      if(!rows)return {data:[row]};
      assert.equal(rows[2].length,1,'keep the original narrow window');
      if(++started===2)release();await bothStarted;
      return {data:[{...row,row_index:rows[2][0],col_index:rows[2][0]}]};
    }
    return {data:[]};
  });
  await f.actions.fetchPatientHistory('가상환자','461');assert.equal(started,2);assert.equal(f.notices.length,0);
});

test('an older slow search cannot replace the newest patient or populate a cancelled cache',async()=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const f=fixture(async query=>{
    if(query.table!=='shockwave_patient_logs')return {data:[]};
    const old=query.filters.some(([,key,value])=>key==='patient_name'&&value.includes('가상환자'));
    if(old)await gate;
    return {data:[log(old?'가상환자':'다른환자')]};
  });
  const old=f.actions.fetchPatientHistory('가상환자','');
  await f.actions.fetchPatientHistory('다른환자','');
  finish();await old;
  assert.equal(f.data.searchName,'다른환자');assert.equal(f.data.logs[0].patient_name,'다른환자');
  const reads=f.calls.length;await f.actions.fetchPatientHistory('가상환자','');
  assert.ok(f.calls.length>reads,'discarded responses are not cached');
});

test('closing or unmounting history suppresses late results and errors',async()=>{
  for(const cancel of ['close','unmount']) {
    let finish;const gate=new Promise(resolve=>{finish=resolve;});
    const f=fixture(async()=>{await gate;return {data:null,error:Error('late error')};});
    const pending=f.actions.fetchPatientHistory('가상환자','');
    if(cancel==='close')f.actions.cancelPatientHistorySearch();else f.cleanup.forEach(fn=>fn?.());
    const snapshot=f.data;finish();await pending;
    assert.equal(f.data,snapshot);assert.equal(f.notices.length,0);
  }
});

test('failed initial queries never cache a partial result and can be retried',async()=>{
  let fail=true;const f=fixture(query=>{
    if(fail&&query.table==='manual_therapy_patient_logs')return {error:Error('temporary failure')};
    return {data:query.table==='shockwave_patient_logs'?[log('가상환자')]:[]};
  });
  await f.actions.fetchPatientHistory('가상환자','');assert.equal(f.notices.length,1);assert.equal(f.data.logs.length,0);
  fail=false;await f.actions.fetchPatientHistory('가상환자','');assert.equal(f.data.logs.length,1);
  const reads=f.calls.length;await f.actions.fetchPatientHistory('가상환자','');assert.equal(f.calls.length,reads,'successful fresh results reuse the existing short cache');
});

test('failed therapist loading is retried rather than retaining a rejected cache promise',async()=>{
  let fail=true,monthlyReads=0;
  const row={id:10,year:2026,month:10,week_index:0,day_index:3,row_index:0,col_index:0,content:'461/가상환자(2)',prescription:'충격파'};
  const f=fixture(query=>{
    if(query.table==='shockwave_schedules')return {data:[row]};
    if(query.table==='shockwave_monthly_therapists') {
      monthlyReads++;if(fail)throw Error('temporary network error');
      return {data:[{slot_index:0,therapist_name:'복구된 치료사',start_day:1,end_day:31}]};
    }
    return {data:[]};
  });
  await f.actions.fetchPatientHistory('가상환자','461');assert.equal(f.notices.length,1);
  fail=false;await f.actions.fetchPatientHistory('가상환자','461');
  assert.equal(monthlyReads,2);assert.equal(f.data.logs[0].therapist_name,'복구된 치료사');
});
