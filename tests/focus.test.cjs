'use strict';
process.env.TZ='Asia/Taipei';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../focus-core.js');
let n=0;function test(name,fn){fn();console.log('PASS '+name);n++;}
const plan={id:'r1',stageId:'A',phone:'01:30',bed:'02:00',wake:'09:30',status:'active',effectiveFrom:'2026-09-28',updatedAt:1};
test('after-midnight target belongs to previous night',()=>assert.equal(C.targetAt('2026-09-28','02:00').toISOString(),'2026-09-28T18:00:00.000Z'));
test('midnight and evening mapping',()=>{assert.equal(C.targetAt('2026-09-28','00:00').getDate(),29);assert.equal(C.targetAt('2026-09-28','23:30').getDate(),28);});
test('invalid dates/time are rejected',()=>{assert.equal(C.targetAt('2026-02-30','02:00'),null);assert.equal(C.targetAt('2026-09-28','25:00'),null);});
test('late ten minutes computed correctly',()=>assert.equal(C.result({inBedAt:'2026-09-29T02:10:00+08:00'},plan,'2026-09-28',new Date()).delta,10));
test('23:50 before midnight is on time',()=>assert.equal(C.result({inBedAt:'2026-09-28T23:50:00+08:00'},{...plan,bed:'00:00'},'2026-09-28',new Date()).kind,'onTime'));
test('missing is not failure',()=>assert.equal(C.result(null,plan,'2026-09-28',new Date('2026-09-29T04:00:00+08:00')).kind,'missing'));
test('future night remains pending',()=>assert.equal(C.result(null,plan,'2026-09-28',new Date('2026-09-28T22:00:00+08:00')).label,'尚未到時間'));
test('snapshot survives plan change',()=>{const w={inBedAt:'2026-09-29T01:00:00+08:00',targetSnapshot:C.snapshot(plan,'2026-09-28')};assert.equal(C.result(w,{...plan,bed:'00:00'},'2026-09-28',new Date()).kind,'onTime');});
test('effective history and pause',()=>{const f={revisions:[plan,{...plan,id:'r2',effectiveFrom:'2026-10-01',status:'paused'}]};assert.equal(C.planFor(f,'2026-09-27'),null);assert.equal(C.planFor(f,'2026-09-28').id,'r1');assert.equal(C.snapshot(C.planFor(f,'2026-10-01'),'2026-10-01'),null);});
test('two devices preserve independent projects/revisions',()=>{const f=C.merge({projects:[{id:'a',title:'A',updatedAt:1}],revisions:[plan]},{projects:[{id:'b',title:'B',updatedAt:2}],revisions:[{...plan,id:'r2'}]});assert.equal(f.projects.length,2);assert.equal(f.revisions.length,2);});
test('archived status is preserved by version merge',()=>assert.equal(C.merge({projects:[{id:'a',title:'A',status:'active',updatedAt:1}]},{projects:[{id:'a',title:'A',status:'archived',updatedAt:2}]}).projects[0].status,'archived'));
test('independent phone and bed edits merge',()=>{const w=C.mergeWind({phoneAwayAt:'2026-09-28T17:30:00Z',updatedAt:1},{inBedAt:'2026-09-28T18:00:00Z',updatedAt:2});assert.ok(w.phoneAwayAt);assert.ok(w.inBedAt);});
test('explicit clear cannot resurrect from old device',()=>{const w=C.mergeWind({phoneAwayAt:'2026-09-28T17:30:00Z',updatedAt:1},{fieldUpdatedAt:{phoneAwayAt:2},updatedAt:2});assert.equal(w.phoneAwayAt,undefined);});
test('old or malformed optional collections normalize',()=>{assert.deepEqual(C.clean(null).projects,[]);assert.deepEqual(C.clean({projects:[{id:'a',title:'A',milestones:'bad'}]}).projects[0].milestones,[]);});
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const getFn=name=>{const start=html.indexOf('function '+name+'(');const end=html.indexOf('\nfunction ',start+1);return html.slice(start,end).replace(/\n\/\/[^]*$/,'');};
// Extract the actual helpers as a contiguous production block.
const tdlCode=html.slice(html.indexOf('function buildTdlSnapshot('),html.indexOf('function getOrCreateEntry('));
const box={S:{todayTDL:[],tdlDone:{}}};vm.createContext(box);vm.runInContext(tdlCode,box);
test('linked IDs and carry survive snapshots and normalization',()=>{const row={id:'step1',goalId:'goal1',theme:'動畫',task:'草稿',c:3};const snap=box.buildTdlSnapshot([row],{t0:true})[0];assert.equal(snap.id,'step1');assert.equal(snap.goalId,'goal1');assert.equal(snap.c,3);assert.equal(snap.done,true);assert.equal(box.tdlNorm(snap).id,'step1');});
test('renaming linked task preserves checked state',()=>{box.S.todayTDL=[{id:'step1',theme:'A',task:'old'}];box.S.tdlDone={t0:true};box.setTodayTDL([{id:'step1',theme:'B',task:'new'}]);assert.equal(box.S.tdlDone.t0,true);});
test('legacy task completion survives reorder',()=>{box.S.todayTDL=[{theme:'A',task:'1'},{theme:'A',task:'2'}];box.S.tdlDone={t1:true};box.setTodayTDL([{theme:'A',task:'2'},{theme:'A',task:'1'}]);assert.equal(box.S.tdlDone.t0,true);assert.equal(box.S.tdlDone.t1,undefined);});
const backend=fs.readFileSync(require('node:path').join(__dirname,'../gas_v2_1.txt'),'utf8');const gas={};vm.createContext(gas);vm.runInContext(backend,gas);
let table=[['updatedAt','focus'],[10,'{"projects":[{"id":"a"}]}']];gas.getSheet=()=>({getDataRange:()=>({getValues:()=>table}),getRange:()=>({setValues:rows=>{table[1]=rows[0]}})});
test('GAS upgraded client round-trips new focus column',()=>{assert.equal(gas.saveState_({updatedAt:20,baseUpdatedAt:10,focus:'{"version":1}'}),true);assert.equal(table[1][1],'{"version":1}');});
test('GAS old client cannot erase focus by omission',()=>{gas.saveState_({updatedAt:30,baseUpdatedAt:20});assert.equal(table[1][1],'{"version":1}');});
test('GAS optimistic conflict prevents overwrite',()=>{assert.equal(gas.saveState_({updatedAt:40,baseUpdatedAt:10,focus:'bad'}),'conflict');assert.equal(table[1][1],'{"version":1}');});
test('module loads outside HTML comments at end',()=>assert.match(html,/<script src="focus.js"><\/script>\s*<\/body>/));
test('public template has no personal project/date',()=>{const t=fs.readFileSync(require('node:path').join(__dirname,'../template/index.html'),'utf8');assert.match(t,/data-project="" data-due=""/);});
test('GAS preserves sleep events when old client omits them',()=>{
 table=[['date','health'],['2026-09-28',JSON.stringify({sleep:{windDown:{phoneAwayAt:'2026-09-28T17:30:00Z',updatedAt:1}}})]];
 gas.saveEntry_({date:'2026-09-28',health:JSON.stringify({sleep:{sleepTime:'02:00'}})});
 assert.equal(JSON.parse(table[1][1]).sleep.windDown.phoneAwayAt,'2026-09-28T17:30:00Z');
 assert.equal(JSON.parse(table[1][1]).sleep.sleepTime,'02:00');
});
test('GAS combines independent bed event with existing phone event',()=>{
 gas.saveEntry_({date:'2026-09-28',health:JSON.stringify({sleep:{windDown:{inBedAt:'2026-09-28T18:00:00Z',updatedAt:2}}})});
 const w=JSON.parse(table[1][1]).sleep.windDown;assert.ok(w.phoneAwayAt);assert.ok(w.inBedAt);
});
console.log(`${n} tests passed`);
