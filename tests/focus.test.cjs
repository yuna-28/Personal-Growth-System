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
test('sleep record decides on-time when bed was not pressed',()=>{const t=C.snapshot({...plan,bed:'01:00'},'2026-09-28').bedAt;assert.equal(C.sleepResult('00:30',t,'2026-09-28').kind,'onTime');const r=C.sleepResult('03:10',t,'2026-09-28');assert.equal(r.kind,'late');assert.equal(r.delta,130);assert.equal(C.sleepResult('',t,'2026-09-28'),null);});
test('pasted goal list: groups, month-end, next-year, new-year dates',()=>{
  const txt='我現在有一些創作目標：\n1.A生日(希望在11月底做完)\n2.B知識會(希望12月底做完)\n3.C影片(希望明年五月完成，這個工程量浩大！！！要花非常多時間)\n---\n生活影片剪輯\n1.要送給D的禮物(11/14要做好)\n2.送給E整年的禮物(可能明年過年前要做好)';
  const r=C.parseGoalLines(txt,'2026-11-06');
  assert.deepEqual(r.map(x=>[x.group,x.title,x.due]),[['創作目標','A生日','2026-11-30'],['創作目標','B知識會','2026-12-31'],['創作目標','C影片','2027-05-31'],['生活影片剪輯','要送給D的禮物','2026-11-14'],['生活影片剪輯','送給E整年的禮物','2027-02-05']]);
  assert.equal(r[0].note,'');assert.equal(r[3].note,'');assert.equal(r[4].note,'');
  assert.match(r[2].note,/工程量浩大/);
});
test('goal lines without bullets or dates still work',()=>{
  const r=C.parseGoalLines('F 12/3\nG\nH 1月底','2026-12-20');
  assert.deepEqual(r.map(x=>[x.title,x.due]),[['F','2026-12-03'],['G',''],['H','2027-01-31']]);
  assert.equal(C.parseDateText('年前','2027-02-06').due,'2028-01-25');
  assert.equal(C.parseDateText('13/45','2026-11-06'),null);
});
const planSrc={format:'grandol-plan',version:1,title:'T',
  projects:[{key:'a',match:['甲'],title:'甲專案',group:'創作',start:'2026-11-09',due:'2026-12-21',note:'n',
    stages:[{key:'s1',title:'開工',due:'2026-11-13'},{key:'s2',title:'交付',due:'2026-12-21',hard:true}],
    checkpoints:[{key:'c1',title:'實測',due:'2026-12-07',check:'看速度',bar:'本體完成',fallback:'縮範圍'}],
    phases:[{label:'前製',from:'2026-11-09',to:'2026-11-30'},{label:'製作',from:'2026-12-01',to:'2026-12-21'}]},
   {key:'b',title:'乙專案',due:'2027-02-05',stages:[{key:'t1',title:'製作',due:'2027-01-24'}]}],
  events:[{key:'e1',title:'出遊',from:'2026-11-15',to:'2026-11-16'},{key:'e2',title:'活動',from:'2027-06-01',tentative:true}],
  periods:[{key:'p1',label:'交付週',from:'2026-11-09',to:'2026-11-13'},{key:'p2',label:'出國',from:'2027-04-01',to:'2027-04-07',mode:'pause'}],
  items:[{key:'i1',label:'睡眠',floor:'起床 ≤ 09:00',target:'入睡 ≤ 02:00',weekly:2,floorRule:{type:'wake',max:'09:00',grace:{bedAfter:'04:00',max:'10:30'}},targetRule:{type:'bed',max:'02:00'}}],
  todos:[{key:'q1',text:'問交期',due:'2026-11-30'},{key:'q2',text:'已處理',done:true}]};
test('plan import: adopts an existing goal, never duplicates, keeps progress',()=>{
  const f0={projects:[{id:'old',kind:'project',title:'甲',status:'active',dueDate:'2026-11-30',milestones:[],next:null}]};
  const r1=C.applyPlan(f0,planSrc,{now:1000,today:'2026-11-06'});
  assert.equal(r1.report.added,1);assert.equal(r1.report.updated,1);assert.deepEqual(r1.report.matched,['甲 → 甲專案']);
  const g=r1.focus.projects.find(x=>x.id==='old');
  assert.equal(g.dueDate,'2026-12-21');assert.deepEqual(g.dueHistory,[{from:'2026-11-30',to:'2026-12-21',on:'2026-11-06'}]);
  assert.equal(g.milestones.length,2);assert.equal(g.checkpoints[0].bar,'本體完成');assert.equal(g.phases.length,2);
  // 使用者做了一些事，再匯入同一份
  g.milestones[0].done=true;g.checkpoints[0].result={ok:true,on:'2026-12-07'};
  r1.focus.plan.todos.find(t=>t.planKey==='q1').done=true;
  const r2=C.applyPlan(r1.focus,planSrc,{now:2000,today:'2026-11-07'});
  assert.equal(r2.report.added,0);assert.equal(r2.focus.projects.length,2);
  const g2=r2.focus.projects.find(x=>x.id==='old');
  assert.equal(g2.milestones.length,2);assert.equal(g2.milestones[0].done,true);assert.equal(g2.checkpoints[0].result.ok,true);
  assert.equal(r2.focus.plan.todos.length,2);assert.equal(r2.focus.plan.todos.find(t=>t.planKey==='q1').done,true);
  assert.equal(r2.focus.plan.events.length,2);assert.equal(r2.focus.plan.periods.length,2);assert.equal(g2.dueHistory.length,1);
  assert.ok(r2.size>0);
});
test('plan survives clean and merges across devices without resurrecting deletions',()=>{
  const a=C.applyPlan({},planSrc,{now:1000,today:'2026-11-06'}).focus;
  assert.equal(C.clean(a).plan.items.length,1);assert.equal(C.clean(a).plan.events.length,2);
  const b=JSON.parse(JSON.stringify(a));
  b.plan.events[0].deleted=true;b.plan.events[0].updatedAt=5000;b.plan.updatedAt=5000;
  a.plan.todos[0].done=true;a.plan.todos[0].updatedAt=6000;a.plan.updatedAt=6000;
  const m=C.merge(a,b);
  assert.equal(m.plan.events.find(x=>x.planKey==='e1').deleted,true);
  assert.equal(m.plan.todos.find(x=>x.planKey==='q1').done,true);
  assert.equal(m.projects.length,2);
  assert.equal(C.applyPlan({},{format:'x'},{}).error,'這不是格蘭朵的計畫檔');
});
test('daily floor and target rules: wake grace, bed, exercise, habit, periods',()=>{
  const it=C.applyPlan({},planSrc,{now:1}).focus.plan.items[0];
  assert.deepEqual(C.itemDay(it,{wake:'08:30',bed:'01:30'}),{floor:true,target:true});
  assert.deepEqual(C.itemDay(it,{wake:'09:40',bed:'03:00'}),{floor:false,target:false});
  assert.deepEqual(C.itemDay(it,{wake:'10:00',bed:'05:30'}),{floor:true,target:false});   // 前晚 04:00 後才睡，起床放寬到 10:30
  assert.deepEqual(C.itemDay(it,{wake:'10:40',bed:'05:30'}),{floor:false,target:false});
  assert.equal(C.itemDay(it,{wake:'',bed:''}).floor,false);                                // 沒紀錄不算做到
  // 地板改成「起床 ≤ 10:30 且睡滿 6.5 小時」：睡 5 小時不算，睡 10 小時補眠也不被當成失敗
  const sl={floorRule:{type:'wake',max:'10:30',minHours:6.5},targetRule:{type:'bed',max:'02:00'}};
  assert.equal(C.itemDay(sl,{wake:'09:30',bed:'04:30'}).floor,false);   // 5 小時
  assert.equal(C.itemDay(sl,{wake:'10:00',bed:'02:00'}).floor,true);    // 8 小時
  assert.equal(C.itemDay(sl,{wake:'10:00',bed:'03:30'}).floor,true);    // 6.5 小時剛好
  assert.equal(C.itemDay(sl,{wake:'09:30',bed:'03:10'}).floor,false);   // 6 小時 20 分
  assert.equal(C.itemDay(sl,{wake:'11:00',bed:'02:00'}).floor,false);   // 睡夠但起太晚
  assert.equal(C.itemDay(sl,{wake:'08:30',bed:'23:30'}).floor,true);    // 跨午夜前就睡
  assert.equal(C.itemDay(sl,{wake:'09:00',bed:''}).floor,true);         // 沒入睡紀錄就只看起床
  const ex={floorRule:{type:'exercise',minutes:10,orShoulder:true},targetRule:{type:'exercise',minutes:30}};
  assert.deepEqual(C.itemDay(ex,{minutes:0,shoulder:true}),{floor:true,target:false});
  assert.deepEqual(C.itemDay(ex,{minutes:35}),{floor:true,target:true});
  assert.deepEqual(C.itemDay({floorRule:{type:'habit'},targetRule:null},{habit:true},'target'),{floor:true,target:true});
  const plan=C.applyPlan({},planSrc,{now:1}).focus.plan;
  assert.equal(C.periodOf(plan,'2026-11-10').label,'交付週');assert.equal(C.periodOf(plan,'2026-11-14'),null);assert.equal(C.periodOf(plan,'2027-04-03').mode,'pause');
});
// ── 實測速度重算：用中性假資料（作品A，總量 3600 單位）──
test('speed recalculation: pace, remaining days, estimated date, vs current due date',()=>{
  const sp={unit:'秒',total:3600,doneAmt:1200,sinceDay:'2026-11-09'};
  const c=C.speedCalc(sp,{today:'2026-12-07',due:'2026-12-21'});
  assert.equal(c.days,28);assert.equal(c.autoDays,28);assert.equal(c.remain,2400);
  assert.equal(c.needDays,56);                       // 2400 ÷ (1200/28) = 56
  assert.equal(c.eta,'2027-02-01');assert.equal(c.diff,42);   // 比 12/21 晚 42 天
  assert.equal(c.unit,'秒');assert.equal(c.finished,false);
  const t=C.speedText(c);
  assert.match(t.pace,/這段做了 1200 秒、用了 28 天 → 每秒 0\.023 天（平均每天 42\.9 秒）/);
  assert.match(t.plan,/剩下 2400 秒要 56 天，預計 2027\/2\/1；比現在的截止日 12\/21 晚 42 天/);
  // 比截止日早／剛好
  assert.match(C.speedText(C.speedCalc(sp,{today:'2026-12-07',due:'2027-02-20'})).plan,/早 19 天/);
  assert.match(C.speedText(C.speedCalc(sp,{today:'2026-12-07',due:'2027-02-01'})).plan,/剛好/);
  assert.match(C.speedText(C.speedCalc(sp,{today:'2026-12-07'})).plan,/目前沒有設截止日/);
});
test('speed text: tiny per-unit days never show as 0',()=>{
  const t=C.speedText(C.speedCalc({unit:'字',total:900000000,doneAmt:300000000,days:30},{today:'2026-12-07'}));
  assert.doesNotMatch(t.pace,/每字 0 天/);assert.match(t.pace,/→ 平均每天 10000000 字$/);
  assert.equal(C.fmtNum(0.0233),'0.023');assert.equal(C.fmtNum(42.857),'42.9');assert.equal(C.fmtNum(3600),'3600');assert.equal(C.fmtNum(NaN),'');
  assert.equal(C.mdText('2027-01-03','2026-11-08'),'2027/1/3');assert.equal(C.mdText('2026-12-21','2026-11-08'),'12/21');
});
test('speed: nothing entered is not a failure; start day falls back to project start; manual days win',()=>{
  assert.equal(C.speedCalc(undefined,{today:'2026-12-07'}),null);
  assert.equal(C.speedCalc({},{today:'2026-12-07'}),null);
  assert.equal(C.speedHas({}),false);assert.equal(C.speedHas({unit:'秒'}),true);
  assert.equal(C.speedCalc({total:100,doneAmt:0,sinceDay:'2026-12-01'},{today:'2026-12-07'}),null);   // 還沒做就不推算
  assert.equal(C.speedCalc({total:100,doneAmt:10},{today:'2026-12-07'}),null);                        // 不知道從哪天開始
  assert.deepEqual(C.speedMissing({total:100},{today:'2026-12-07'}),['已做的量','開始日或天數']);
  assert.deepEqual(C.speedMissing({total:100,doneAmt:10},{today:'2026-12-07',startOn:'2026-12-01'}),[]);
  assert.equal(C.speedCalc({total:100,doneAmt:10},{today:'2026-12-07',startOn:'2026-12-01'}).days,6);   // 沿用專案開始日
  assert.equal(C.speedCalc({total:100,doneAmt:10,sinceDay:'2026-12-05'},{today:'2026-12-07',startOn:'2026-12-01'}).days,2);
  assert.equal(C.speedCalc({total:100,doneAmt:10,days:20,sinceDay:'2026-12-05'},{today:'2026-12-07'}).days,20);   // 手動天數優先
  assert.equal(C.speedCalc({total:100,doneAmt:10,sinceDay:'2026-12-07'},{today:'2026-12-07'}),null);   // 同一天，算不出速度
  assert.equal(C.speedCalc({total:100,doneAmt:10,sinceDay:'2026-12-09'},{today:'2026-12-07'}),null);   // 開始日在未來
  assert.equal(C.speedCalc({total:100,doneAmt:10,sinceDay:'2026-12-01'},{today:'2026-12-07'}).unit,'單位');
});
test('speed: finished work, rounding up whole days, and numbers stay anchored to the day they were entered',()=>{
  const done=C.speedCalc({total:100,doneAmt:120,sinceDay:'2026-12-01'},{today:'2026-12-07',due:'2026-12-20'});
  assert.equal(done.finished,true);assert.equal(done.needDays,0);assert.match(C.speedText(done).plan,/已經做完了/);
  assert.equal(C.speedCalc({total:100,doneAmt:30,days:3},{today:'2026-12-07'}).needDays,7);   // 70 ÷ 10 = 7，不會因浮點變 8
  assert.equal(C.speedCalc({total:10,doneAmt:3,days:3},{today:'2026-12-07'}).needDays,7);     // 7 ÷ 1 = 7
  assert.equal(C.speedCalc({total:10,doneAmt:3,days:2},{today:'2026-12-07'}).needDays,5);     // 7 ÷ 1.5 = 4.67 → 5
  // 填數字那天是 12/7，一個月後再打開，推算還是以 12/7 為準
  const sp={total:3600,doneAmt:1200,sinceDay:'2026-11-09',asOf:'2026-12-07'};
  assert.equal(C.speedCalc(sp,{today:'2027-01-20'}).days,28);assert.equal(C.speedCalc(sp,{today:'2027-01-20'}).eta,'2027-02-01');
  assert.equal(C.speedCalc({...sp,total:'3,600',doneAmt:'1200'},{today:'2027-01-20'}).needDays,56);   // 字串、千分位也吃得下
});
test('speed edits: validate, clear, remember the day the done amount was entered',()=>{
  let r=C.speedSet(null,'doneAmt','1,200',{today:'2026-12-07'});
  assert.deepEqual(r.speed,{doneAmt:1200,asOf:'2026-12-07'});
  r=C.speedSet(r.speed,'total','3600',{today:'2026-12-09'});assert.equal(r.speed.asOf,'2026-12-07');assert.equal(r.speed.total,3600);   // 只有「已做」會動基準日
  r=C.speedSet(r.speed,'unit','  秒 ');assert.equal(r.speed.unit,'秒');
  r=C.speedSet(r.speed,'sinceDay','2026-11-09');assert.equal(r.speed.sinceDay,'2026-11-09');
  assert.ok(C.speedSet(r.speed,'sinceDay','11/9').error);assert.ok(C.speedSet(r.speed,'total','很多').error);
  assert.ok(C.speedSet(r.speed,'total','-5').error);assert.ok(C.speedSet(r.speed,'total','0').error);assert.ok(C.speedSet(r.speed,'days','0').error);
  assert.equal(C.speedSet(r.speed,'doneAmt','0',{today:'2026-12-08'}).speed.doneAmt,0);
  const cleared=C.speedSet(r.speed,'doneAmt','',{today:'2026-12-08'});assert.equal(cleared.speed.asOf,undefined);assert.equal(cleared.speed.doneAmt,undefined);
  let all={unit:'秒'};all=C.speedSet(all,'unit','').speed;assert.equal(all,null);   // 全部清空＝這個專案沒有實測資料
  assert.ok(C.speedSet({}, 'nope','1').error);
});
test('speed survives clean/merge and a plan re-import',()=>{
  const f={projects:[{id:'a',title:'作品A',updatedAt:1,speed:{unit:'秒',total:3600,doneAmt:1200,sinceDay:'2026-11-09'}}]};
  assert.equal(C.clean(f).projects[0].speed.total,3600);
  const m=C.merge(f,{projects:[{id:'a',title:'作品A',updatedAt:2,speed:{unit:'秒',total:4000}}]});assert.equal(m.projects[0].speed.total,4000);
  const r=C.applyPlan(f,{format:'grandol-plan',version:1,projects:[{key:'a',match:['作品A'],title:'作品A',due:'2026-12-21'}]},{now:5,today:'2026-11-09'});
  assert.equal(r.focus.projects[0].speed.doneAmt,1200);
});
test('future night remains pending',()=>assert.equal(C.result(null,plan,'2026-09-28',new Date('2026-09-28T22:00:00+08:00')).label,'尚未到時間'));
test('snapshot survives plan change',()=>{const w={inBedAt:'2026-09-29T01:00:00+08:00',targetSnapshot:C.snapshot(plan,'2026-09-28')};assert.equal(C.result(w,{...plan,bed:'00:00'},'2026-09-28',new Date()).kind,'onTime');});
test('effective history and pause',()=>{const f={revisions:[plan,{...plan,id:'r2',effectiveFrom:'2026-10-01',status:'paused'}]};assert.equal(C.planFor(f,'2026-09-27'),null);assert.equal(C.planFor(f,'2026-09-28').id,'r1');assert.equal(C.snapshot(C.planFor(f,'2026-10-01'),'2026-10-01'),null);});
test('two devices preserve independent projects/revisions',()=>{const f=C.merge({projects:[{id:'a',title:'A',updatedAt:1}],revisions:[plan]},{projects:[{id:'b',title:'B',updatedAt:2}],revisions:[{...plan,id:'r2'}]});assert.equal(f.projects.length,2);assert.equal(f.revisions.length,2);});
test('archived status is preserved by version merge',()=>assert.equal(C.merge({projects:[{id:'a',title:'A',status:'active',updatedAt:1}]},{projects:[{id:'a',title:'A',status:'archived',updatedAt:2}]}).projects[0].status,'archived'));
test('independent phone and bed edits merge',()=>{const w=C.mergeWind({phoneAwayAt:'2026-09-28T17:30:00Z',updatedAt:1},{inBedAt:'2026-09-28T18:00:00Z',updatedAt:2});assert.ok(w.phoneAwayAt);assert.ok(w.inBedAt);});
test('explicit clear cannot resurrect from old device',()=>{const w=C.mergeWind({phoneAwayAt:'2026-09-28T17:30:00Z',updatedAt:1},{fieldUpdatedAt:{phoneAwayAt:2},updatedAt:2});assert.equal(w.phoneAwayAt,undefined);});
test('experiments and insights survive clean and merge across devices',()=>{const a={experiments:[{id:'e1',text:'A',updatedAt:1}],insights:[{id:'i1',text:'細心',updatedAt:1}]};const b={experiments:[{id:'e1',text:'A',status:'archived',updatedAt:2},{id:'e2',text:'B',updatedAt:1}],insights:'bad'};const f=C.merge(a,b);assert.equal(f.experiments.length,2);assert.equal(f.experiments.find(x=>x.id==='e1').status,'archived');assert.equal(f.insights.length,1);assert.deepEqual(C.clean({experiments:[{text:'no id'}]}).experiments,[]);});
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
test('module loads outside HTML comments at end',()=>assert.match(html,/<script src="focus\.js(\?v=\d+)?"><\/script>\s*<\/body>/));
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
test('weight: averages, not single days; compares only after two weeks',()=>{
  const off=[-0.4,0.4,-0.2,0.2,0,-0.3,0.3];   // 一天一天會跳，但一週平均不動
  const L=[];for(let i=0;i<28;i++){const d=new Date('2026-11-19T12:00:00');d.setDate(d.getDate()+i);const day=C.dateKey(d);L.push({day,kg:i<7?63.0+off[i]:(i>=21?62.3+off[i%7]:62.8)});}
  const r=C.weightTrend(L,'2026-12-16',1);
  assert.equal(r.start,63);assert.equal(r.recent,62.3);assert.equal(r.delta,-0.7);assert.equal(r.expect,-0.7);assert.equal(r.ready,true);assert.equal(r.n,28);
  const early=C.weightTrend(L.slice(0,9),'2026-11-27',1);assert.equal(early.ready,false);assert.equal(early.delta,null);assert.equal(early.expect,null);
});
test('weight: bad values ignored, no data is null, perMonth 0 means no expectation',()=>{
  assert.equal(C.weightTrend([],'2026-12-01',1),null);
  assert.equal(C.weightTrend([{day:'2026-11-19',kg:0},{day:'2026-11-20',kg:'abc'},{day:'2026-11-21',kg:400},{day:'bad',kg:60}],'2026-12-01',1),null);
  const L=[];for(let i=0;i<20;i++){const d=new Date('2026-11-19T12:00:00');d.setDate(d.getDate()+i);L.push({day:C.dateKey(d),kg:'62.5'});}
  const r=C.weightTrend(L,'2026-12-08',0);assert.equal(r.start,62.5);assert.equal(r.expect,null);assert.equal(r.delta,0);
  const gap=C.weightTrend([{day:'2026-11-19',kg:63},{day:'2026-11-20',kg:63}],'2026-12-20',1);assert.equal(gap.recent,null);assert.equal(gap.delta,null);
});
console.log(`${n} tests passed`);
