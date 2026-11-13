/* 🎯 目標優先的首頁（v123）
   ① 現在要做：依時間自動切換（白天＝動畫今天這一步；晚上＝睡前流程走到哪）
   ② 兩張目標卡：作品型＝階段清單（每段可有日期、硬期限紅旗）；身體型＝本週點點
   ③ 今晚時間軸：收工 → 肩背 → 洗澡 → 收手機 → 上床，點一下＝做完
   編輯一律用彈窗（點卡片上的 ✏️），不再是首頁下面一大片表單。
   每日紀錄仍存在既有的健康卡與 TDL：記一次，健康卡、便利貼、習慣都會一起更新。 */
(function(){
'use strict';
const C=FocusCore, hub=document.getElementById('focus-hub');   // hub 只放預設值（data-*），不再直接畫東西
if(!hub)return;
const M={now:document.getElementById('focus-now'),cards:document.getElementById('focus-cards'),today:document.getElementById('focus-today-exps'),
  moves:document.getElementById('focus-moves'),tags:document.getElementById('focus-tags'),rhythm:document.getElementById('focus-rhythm'),plan:document.getElementById('focus-plan'),
  undone:document.getElementById('focus-undone'),bring:document.getElementById('focus-bring-next'),
  tonight:document.getElementById('focus-tonight'),goals:document.getElementById('focus-goals')};
const mounts=Object.values(M).filter(Boolean);
const inMounts=el=>!!el&&mounts.some(m=>m.contains(el));
const $q=sel=>{for(const m of mounts){const x=m.querySelector(sel);if(x)return x;}return null;};
const $qa=sel=>mounts.flatMap(m=>[...m.querySelectorAll(sel)]);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>(crypto.randomUUID?crypto.randomUUID():'id'+Date.now()+Math.random().toString(16).slice(2));
const MOVES=[{t:'跑步',m:30},{t:'跳舞',m:30},{t:'走路',m:20},{t:'伸展',m:15}];
const BODY_METRICS=[
  {k:'move',l:'動一動',unit:'天',def:7},
  {k:'shoulder',l:'肩背',unit:'次',def:7},
  {k:'bed',l:'準時上床',unit:'晚',def:7}
];
let editing='',cloudSupported=null,justDone='',cloudReady=false;

function data(){S.focus=C.clean(S.focus);return S.focus;}
function ds(){return viewDate||curDay();}
function health(d){return d===curDay()?S.health:((S.entries||[]).find(e=>e.date===d)?.health||emptyHealth());}
function clock(t){if(!t)return '';const d=new Date(t);return isNaN(d)?'':String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function md(s){return s?(+s.slice(5,7))+'/'+(+s.slice(8,10)):'';}
function daysBetween(a,b){return Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/86400000);}
function writable(){if(VIEWER_MODE){softToast('監督模式是唯讀的 👀',2200);return false;}return true;}
function saveGoal(g){g.updatedAt=Date.now();sv(S);syncStateDebounced();render(true);}
function toMin(hhmm){const [h,m]=String(hhmm).split(':').map(Number);return h*60+(m||0);}
function hm(min){min=((min%1440)+1440)%1440;return String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0');}
// 「10/8」「10-8」「10月8日」「2026-10-08」→ YYYY-MM-DD；年份自動推（比今天早兩個月以上就算明年）
function parseMD(str){
  str=String(str||'').trim();if(!str)return '';
  let m=str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  let y,mo,d;
  if(m){y=+m[1];mo=+m[2];d=+m[3];}
  else{m=str.match(/^(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?$/);if(!m)return null;mo=+m[1];d=+m[2];
    const base=new Date(curDay()+'T12:00:00');y=base.getFullYear();
    const t=new Date(y,mo-1,d,12);if((base-t)/86400000>60)y++;}
  const out=C.dateKey(new Date(y,mo-1,d,12));
  return (C.validDate(out)&&+out.slice(5,7)===mo)?out:null;
}
// 階段名稱前面的「1.」「2、」這類編號去掉（編號本來就照順序）
function cleanTitle(t){return String(t||'').replace(/^\s*\d+\s*[.、)．:：]\s*/,'').trim();}
function seed(){
  const f=data();
  if(!f.projects.some(p=>p.id==='seed-anim'))f.projects.push({id:'seed-anim',kind:'project',title:hub.dataset.project||'完成作品',
    dueDate:hub.dataset.due||'',status:'active',milestones:[],next:{id:'seed-anim-next',text:'',small:''},createdAt:0,updatedAt:0});
  if(!f.projects.some(p=>p.id==='seed-body'))f.projects.push({id:'seed-body',kind:'body',title:'體態',
    dueDate:hub.dataset.bodyDue||'',event:hub.dataset.bodyEvent||'',status:'active',
    targets:{move:7,shoulder:7,bed:7},milestones:[],next:null,startOn:curDay(),createdAt:0,updatedAt:0});
  f.projects.forEach(p=>(p.milestones||[]).forEach(m=>{const c=cleanTitle(m.title);if(c&&c!==m.title)m.title=c;}));
  S.focus=f;
}
// 頁面上 data-night-extra="20:00 戴牙套" → 預設的固定項目（公開範本是空的）
function defaultExtras(){
  return String(hub.dataset.nightExtra||'').split(/[,，]/).map(t=>t.trim().match(/^(\d{1,2}:\d{2})\s+(.+)$/)).filter(Boolean)
    .map(mm=>({id:'x'+mm[1].replace(':',''),label:mm[2],at:mm[1].padStart(5,'0')})).filter(x=>C.validTime(x.at));
}
function seedExtras(){
  const p=C.planFor(data(),curDay());
  if(p&&p.extras===undefined){const ex=defaultExtras();if(ex.length){p.extras=ex;p.updatedAt=Date.now();sv(S);syncStateDebounced();}}
}
function goals(){return data().projects.filter(p=>p.status==='active');}
// 改截止日都留紀錄：回顧才看得出目標改過期，不會只剩「已過截止日」
function setDue(g,due){
  due=due||'';const old=g.dueDate||'';if(old===due)return;
  g.dueHistory=[...(g.dueHistory||[]),{from:old,to:due,on:curDay()}];g.dueDate=due;
}
// 身體目標的項目。舊資料只有 targets{move,shoulder,bed}，沒有 metrics 時照舊換算
// src：move＝有運動紀錄的天、shoulder＝肩背打勾、bed＝準時上床、manual＝在卡片上自己打勾
const SRC_LABEL={move:'自動：有記運動的那天',shoulder:'自動：睡前流程的肩背',bed:'自動：準時上床',manual:'在體態卡上自己打勾'};
function metricsOf(g){
  if(Array.isArray(g.metrics))return g.metrics.filter(m=>m&&m.k&&m.l);
  const t=g.targets||{};
  return BODY_METRICS.map(m=>({k:m.k,l:m.l,unit:m.unit,target:+t[m.k]||0,src:m.k}));
}
function activeMetrics(g){return metricsOf(g).filter(m=>(+m.target||0)>0);}
function wantsShoulder(){const bg=bodyGoal();return !!(bg&&activeMetrics(bg).some(m=>m.src==='shoulder'));}
// 某一天這個項目有沒有做到
function metricHit(m,day){
  const h=health(day)||{};
  if(m.src==='move')return exTypesOf(h.exercise).length>0;
  if(m.src==='shoulder')return !!(h.body&&h.body.shoulder);
  if(m.src==='bed')return nightInfo(day).kind==='onTime';
  return !!(h.body&&h.body['m_'+m.k]);
}
// 作品型目標可以同時有好幾個：最近的截止日排前面，沒日期的放最後
function projectGoals(){
  return goals().filter(g=>g.kind!=='body').map((g,i)=>({g,i}))
    .sort((a,b)=>((a.g.dueDate||'9999')<(b.g.dueDate||'9999')?-1:((a.g.dueDate||'9999')>(b.g.dueDate||'9999')?1:a.i-b.i))).map(x=>x.g);
}
// 今天卡片上展開的那一個：預設是最近要交的；點別的目標就換過去，只記到今天
function projectGoal(){
  const all=projectGoals();if(!all.length)return null;
  try{const [id,day]=(localStorage.getItem('grandol_focus_goal')||'').split('@');
    if(day===curDay()){const g=all.find(x=>x.id===id);if(g)return g;}}catch(e){}
  return all[0];
}
function focusGoalOn(id){try{localStorage.setItem('grandol_focus_goal',id+'@'+curDay());}catch(e){}}
const daysLeftTxt=(d,due)=>{if(!due)return '';const n=daysBetween(d,due);return n<0?`<b class="warn">已過 ${-n} 天</b>`:(n===0?'今天':`還有 ${n} 天`);};
function bodyGoal(){return goals().find(g=>g.kind==='body');}
function saveHealth(d,h){
  if(!writable())return;
  const old=S.exp;
  reconcileHealthExp(h,d);
  if(d===curDay()){S.health=h;localStorage.setItem('grandol_live_ts',String(Date.now()));writeDraftEntry(true);}
  const e=getOrCreateEntry(d);e.health=JSON.parse(JSON.stringify(h));e.savedAt=Date.now();e.exp=S.exp;
  markDirty('e:'+d);sv(S);syncEntryFor(d).catch(()=>{});syncStateDebounced();
  checkLevelUp(old,S.exp);renderFlowers();renderExpBar();
  if(d===ds())renderHealth();
  render(true);
}
function autoHabit(k){
  if(!ctxIsToday()||S.checked[k])return;
  if(typeof isArchived==='function'&&isArchived(k))return;
  document.querySelector(`#habits .neo-chip[data-k="${k}"]`)?.click();
}
function updateWind(d,fn){
  const h=health(d);h.sleep=h.sleep||{};
  const p=C.planFor(data(),d),w=h.sleep.windDown||{nightDate:d,targetSnapshot:C.snapshot(p,d)};
  if(!w.targetSnapshot){softToast('先設定今晚想幾點上床 🌙',2600);return;}
  const before={...w};fn(w);
  w.updatedAt=Date.now();w.fieldUpdatedAt=w.fieldUpdatedAt||{};
  for(const k of ['phoneAwayAt','inBedAt','obstacle'])if(before[k]!==w[k])w.fieldUpdatedAt[k]=w.updatedAt;
  h.sleep.windDown=w;saveHealth(d,h);
}
// ── 本週 ──────────────────────────────────────────
function mondayOfDs(d){const x=new Date(d+'T12:00:00');const wd=(x.getDay()+6)%7;x.setDate(x.getDate()-wd);return C.dateKey(x);}
function weekStats(d,g){
  const mon=mondayOfDs(d),out={};
  metricsOf(g).forEach(m=>{let n=0;for(let i=0;i<7;i++){const day=shiftDay(mon,i);if(day>d)break;if(metricHit(m,day))n++;}out[m.k]=n;});
  return out;
}
// ── 今晚的流程：從「收手機／上床」往回推 ────────────
// 收工＝收手機前 60 分；肩背 30 分＝收手機前 50～20 分；洗澡＝收手機前 20 分
// 預設的收尾步驟（還沒自己改過時用）
function baseSteps(p,wantSh){
  const ph=toMin(p.phone),out=[{k:'off',label:'收工',at:hm(ph-60)}];
  if(wantSh)out.push({k:'shoulder',label:'肩背 30 分',at:hm(ph-50)});
  out.push({k:'shower',label:'洗澡洗漱',at:hm(ph-20)});
  return out;
}
function routine(d){
  const p=C.planFor(data(),d);
  if(!p||p.status==='paused')return null;
  const ph=toMin(p.phone),bd=toMin(p.bed);
  const wantSh=wantsShoulder();
  const h=health(d),w=h.sleep?.windDown||{},n=h.night||{};
  // 收工／肩背／洗澡：自己改過（p.steps）就照自己的；沒改過才從收手機時間往前推
  const doneOf=k=>k==='shoulder'?(h.body&&h.body.shoulder):n[k];
  const steps=(Array.isArray(p.steps)?p.steps.filter(x=>x&&x.k&&x.label&&C.validTime(x.at)):baseSteps(p,wantSh))
    .map(x=>({k:x.k,label:x.label,hint:'',at:x.at,done:doneOf(x.k)}));
  steps.push({k:'phone',label:'收手機',hint:'放到床上拿不到的地方',at:p.phone,done:w.phoneAwayAt});
  steps.push({k:'bed',label:'上床',hint:'晚安 🌙',at:p.bed,done:w.inBedAt});
  // 自己加的固定時間項目（例如 20:00 戴牙套）
  (p.extras||[]).forEach(x=>{if(x&&x.label&&C.validTime(x.at))steps.push({k:'x_'+x.id,label:x.label,hint:'固定時間',at:x.at,done:n['x_'+x.id],extra:true});});
  const skip=n.skip||{},now=new Date();
  steps.forEach(s=>{s.abs=C.targetAt(d,s.at);s.skipped=!s.done&&!!skip[s.k];});
  steps.sort((a,b)=>a.abs-b.abs);
  // 現在這一步：第一個「還沒做、沒跳過」的步驟——但如果下一步的時間已經到了，
  // 就當它錯過了往前走，不會卡在沒做的那一步
  let next=null;
  for(let i=0;i<steps.length;i++){
    const st=steps[i];if(st.done||st.skipped)continue;
    const after=steps[i+1];
    const expired=st.extra&&now>=new Date(+st.abs+60*60000);
    if(d!==curDay()||(!expired&&(!after||now<after.abs))){next=st;break;}
    st.missed=true;
  }
  return {p,steps,next};
}
// ── ① 現在要做 ────────────────────────────────────
// 現在是不是晚上收尾時段（收工前 90 分鐘起，到上床後 3 小時）
function isEvening(day){
  const d=day||ds();if(d!==curDay())return false;
  const r=routine(d);if(!r)return false;
  // 收工被刪掉了 → 用第一個收尾步驟；都沒有就用收手機
  const core=r.steps.find(x=>x.k==='off')||r.steps.find(x=>!x.extra&&x.k!=='bed')||r.steps.find(x=>x.k==='phone'),bed=r.steps.find(x=>x.k==='bed'),now=new Date();
  return now>=new Date(core.abs-90*60000)&&now<new Date(+bed.abs+180*60000);
}
// 目標日期過了（或階段全做完）：問一次要怎麼收尾
function closeBanner(g){
  const d=ds();if(d!==curDay()||!g)return '';
  const left=g.dueDate?daysBetween(d,g.dueDate):null,ms=g.milestones||[],allDone=g.kind!=='body'&&ms.length>0&&ms.every(m=>m.done);
  if(!allDone&&!(left!==null&&left<0))return '';
  const id=esc(g.id);
  if(g.kind==='body')return `<div class="close-banner"><span>${esc(g.event||'日期')}的日子過了，這個目標接下來？</span>
    <button class="focus-btn" data-action="goal-nodate" data-g="${id}">繼續，不設日期</button>
    <button class="focus-btn" data-edit-goal="${id}">改日期</button>
    <button class="focus-btn" data-action="goal-close" data-kind="end" data-g="${id}">結束</button></div>`;
  return `<div class="close-banner"><span>${allDone?'階段都做完了，辛苦了':'截止日過了，這個目標現在是？'}</span>
    <button class="focus-btn primary" data-action="${allDone?'goal-finish':'goal-close'}" data-kind="done" data-g="${id}">${allDone?'🎉 完成了':'完成了'}</button>
    ${allDone?'':`<button class="focus-btn" data-action="goal-redate" data-g="${id}">改日期</button>
    <button class="focus-btn" data-action="goal-close" data-kind="letgo" data-g="${id}">放下</button>`}</div>`;
}
function openCloseGoal(g,kind){
  const label=CLOSE_LABEL[kind]||'結束';
  modal(`${esc(g.title)}：${label}`,`
    <div class="fm-lbl">一句話小結（選填）</div>
    <input class="fm-in" id="gc-note" maxlength="200" placeholder="${kind==='letgo'?'為什麼先放下？':'這次學到什麼？下次想怎麼做？'}"/>
    <div class="fm-hint">之後在「方向 → 新增目標・封存・備份」可以恢復。${kind==='letgo'?'日曆上這個目標的行程會拿掉。':'日曆上的行程會留著當紀錄。'}</div>
    <div class="fm-actions"><button class="focus-btn primary" id="gc-save" style="margin-left:auto;">${label}</button></div>`,
  (m,close)=>{
    const save=()=>{
      g.closure={kind,on:curDay(),note:m.querySelector('#gc-note').value.trim()};
      g.status=kind==='letgo'?'archived':'complete';
      g.updatedAt=Date.now();sv(S);syncStateDebounced();close();softToast(kind==='letgo'?'放下了，沒關係 🌿':'🎉 '+g.title+' 結案',2400);
    };
    m.querySelector('#gc-save').addEventListener('click',save);
    m.querySelector('#gc-note').addEventListener('keydown',e=>{if(e.key==='Enter'&&!isImeEnter(e)){e.preventDefault();save();}});
    m.querySelector('#gc-note').focus();
  });
}
// ④ 目標值比最近的實際多很多時，建議一個有機會做到的數字（做不到就不用理它）
function metricSuggest(g,m,d){
  const target=+m.target||0;if(target<=1||m.noSuggest)return null;
  const start=bodyStart(g),days=[];
  for(let i=1;i<=28;i++){const day=shiftDay(d,-i);if(day<start)break;if(!isRestDay(day))days.push(day);}
  if(days.length<14)return null;
  const perWeek=days.filter(day=>metricHit(m,day)).length/(days.length/7);
  const next=Math.max(1,Math.ceil(perWeek)+1);
  return target>=next+2?{perWeek:Math.round(perWeek*10)/10,next}:null;
}
function tonightOpen(){try{return localStorage.getItem('grandol_tonight')==='1';}catch(e){return false;}}
// 階段清單平常收起來，按「階段 ▾」展開編輯（會記住）
function heroOpen(){try{return localStorage.getItem('grandol_hero_ms')==='1';}catch(e){return false;}}
// 今天頁的目標卡：每一個欄位都可以直接點了改（名稱、日期、🚩、這一步、沒電版本），✏️ 打開完整編輯
function nowCard(){
  const d=ds();if(d!==curDay())return '';                 // 補記過去的日子不顯示
  const pg=projectGoal();
  if(!pg)return `<div class="gcard hero day"><div class="hero-top"><span>現在沒有進行中的作品目標</span></div>
    <div class="hero-main"><button class="focus-btn primary" data-action="more">＋ 新增目標</button></div></div>`;
  const ms=pg.milestones||[],done=ms.filter(m=>m.done).length,curI=ms.findIndex(m=>!m.done);
  let meta='';
  {const left=pg.dueDate?daysBetween(d,pg.dueDate):null;
   meta=`<span class="due-wrap">截止 <input class="hero-due" data-goal-due="${esc(pg.id)}" value="${pg.dueDate?md(pg.dueDate):''}" placeholder="設定日期" maxlength="10" title="打 10/31 這樣；清空＝沒有截止日"/></span>`
     +(left==null?'':` · ${left<0?'<b class="warn">已過 '+(-left)+' 天</b>':(left===0?'今天':'還有 '+left+' 天')}`);}
  const hard=ms.filter(m=>!m.done&&m.due&&m.hard).sort((x,y)=>x.due.localeCompare(y.due))[0];
  if(hard&&daysBetween(d,hard.due)<=5)meta+=`${meta?' · ':''}<b class="warn">🚩 ${esc(hard.title)} ${md(hard.due)}</b>`;
  const n=pg.next||{};
  const i=n.id?stickyCtx().items.findIndex(x=>x.id===n.id):-1;
  const isDone=i>=0&&!!stickyCtx().done['t'+i];
  const cur=curI>=0?ms[curI]:null;
  let main;
  // 這一步做完了，或寫的就是一個已經打勾的階段（例如「草稿」）→ 不再停在劃掉的那一步，直接問下一步
  const stale=!!n.text&&ms.some(m=>m.done&&m.title.trim()===n.text.trim());
  if(!n.text||justDone===pg.id||isDone||stale){
    const finished=n.text&&(isDone||stale||justDone===pg.id);
    const quick=cur&&cur.title.trim()!==(n.text||'').trim()?`<button class="focus-btn" data-action="set-next-stage" data-g="${esc(pg.id)}">就做「${esc(cur.title)}」</button>`:'';
    main=`${finished?`<div class="hero-done">✓ 完成了：${esc(n.text)}</div>`:''}
      <div class="hero-main"><input class="goal-in" data-next-in="${esc(pg.id)}" maxlength="200"
        placeholder="${cur?'下一步：「'+esc(cur.title)+'」要做哪一小步？':'下一步是什麼？'}"/>
      ${quick}<button class="focus-btn primary" data-action="set-next" data-g="${esc(pg.id)}">好</button></div>`;
  }else{
    main=`<div class="hero-main"><input class="hero-step${isDone?' is-done':''}" data-step-text="${esc(pg.id)}" value="${esc(n.text)}" maxlength="200" title="點一下就可以改"/>
      <button class="focus-btn${isDone?' done':' primary'}" data-action="step-done" data-g="${esc(pg.id)}">${isDone?'✓ 完成了':'完成'}</button></div>
      ${!isDone&&(n.small||heroOpen())?`<div class="hero-sub"><span>沒電時：</span><input class="hero-small" data-small-text="${esc(pg.id)}" value="${esc(n.small||'')}" placeholder="寫一個最小版本（選填）" maxlength="200"/></div>`:''}`;
  }
  const allMsDone=ds()===curDay()&&pg.kind!=='body'&&ms.length>0&&ms.every(m=>m.done);
  const segs=`<div class="hero-segs">${ms.map((m,k)=>`<span class="goal-seg${m.done?' done':(k===curI?' cur':'')}" title="${esc(m.title)}${m.due?' · '+md(m.due):''}"></span>`).join('')}
      <span data-cal-state="${esc(pg.id)}">${calStateHTML(pg)}</span><button class="hero-toggle" data-action="hero-ms" title="展開可以改階段、日期">${ms.length?`階段 ${done}/${ms.length}${cur?' · '+esc(cur.title):''}`:'拆階段'} ${heroOpen()?'▴':'▾'}</button></div>`;
  const list=heroOpen()?`<div class="ms-list">${msEditRows(pg)}</div>`:'';
  const othersAll=projectGoals().filter(x=>x.id!==pg.id),showAll=(()=>{try{return localStorage.getItem('grandol_others_all')==='1';}catch(e){return false;}})();
  const others=showAll?othersAll:othersAll.slice(0,5);
  const noteRow=heroOpen()?`<div class="hero-sub"><span>備註：</span><input class="hero-small" data-goal-note="${esc(pg.id)}" value="${esc(pg.note||'')}" placeholder="例如：這個很花時間、要先問對方（選填）" maxlength="200"/></div>`:'';
  const otherRows=others.length?`<div class="hero-others"><div class="ho-hd">還有 ${othersAll.length} 個進行中</div>${others.map(o=>{
      const ms=o.milestones||[],nx=o.next&&o.next.text?`<span class="ho-step">${esc(o.next.text)}</span>`:'';
      return `<button type="button" class="ho-row" data-action="focus-goal" data-g="${esc(o.id)}" title="換成這個目標">
        <span class="ho-t">${o.group?`<i class="ho-g">${esc(o.group)}</i>`:''}${esc(o.title)}</span>${nx}
        <span class="ho-d">${o.dueDate?md(o.dueDate)+' · ':''}${daysLeftTxt(d,o.dueDate)||'沒有日期'}</span></button>`;}).join('')}${othersAll.length>5?`<button type="button" class="ho-more" data-action="others-toggle">${showAll?'收起來':`看全部 ${othersAll.length} 個`}</button>`:''}</div>`:'';
  return `<div class="gcard hero day"><div class="hero-top"><span>${pg.group?`<i class="ho-g">${esc(pg.group)}</i>`:''}${esc(pg.title)} · 今天這一步</span>
      <span class="hero-meta">${meta}</span><button class="card-edit" data-edit-goal="${esc(pg.id)}" title="名稱、截止日、狀態">✏️ 編輯</button></div>
    ${closeBanner(pg)}${cpHeroList().map(cpBox).join('')}${allMsDone?'':main+segs+noteRow+list}${otherRows}</div>`;
}
// 階段清單：每一列都是可以直接改的欄位
function msEditRows(g){
  const d=ds(),ms=g.milestones||[],cur=ms.findIndex(m=>!m.done),gid=esc(g.id);
  return ms.map((m,i)=>{
    let cls=m.done?' done':(i===cur?' cur':''),left='';
    if(m.due&&!m.done){const l=daysBetween(d,m.due);if(l<0){cls+=' over';left=`晚了 ${-l} 天`;}else if(i===cur)left=l===0?'今天':`還有 ${l} 天`;}
    return `<div class="ms-row${cls}"><button class="ms-dot" data-ms="${i}" data-g="${gid}" title="${m.done?'點一下取消完成':'點一下標成完成'}">${m.done?'✅':(i===cur?'🟡':'⚪')}</button>
      <input class="ms-title" data-ms-title="${i}" data-g="${gid}" value="${esc(m.title)}" maxlength="60" title="點一下就可以改"/>
      ${left?`<span class="ms-left">${left}</span>`:''}
      <input class="ms-due" data-ms-due="${i}" data-g="${gid}" value="${m.due?md(m.due):''}" placeholder="日期" maxlength="10" title="打 10/8 這樣；清空＝沒有日期"/>
      <button class="ms-flag${m.hard?' on':''}" data-ms-flag="${i}" data-g="${gid}" title="${m.hard?'硬期限（點一下取消）':'設成硬期限（例如送印）'}">🚩</button>
      <button class="ms-del" data-ms-del="${i}" data-g="${gid}" title="刪除這段">✕</button></div>`;
  }).join('')+(ms.length||!g.dueDate?'':`<button type="button" class="focus-btn ms-tpl" data-action="stage-template" data-g="${gid}">套用常見四階段（準備素材→初稿→修改→完成輸出）</button>`)+`<div class="ms-row ms-add"><span class="ms-dot">＋</span><input class="ms-title" data-ms-add="${gid}" placeholder="新增階段，可以順便打日期：送印 10/8" maxlength="70"/></div>`;
}
// 改「今天這一步」的文字：沿用同一個 id，便利貼上的那一條跟著改，不會變成兩筆
function renameStep(g,text,small){
  const oldId=g.next&&g.next.id;
  if(!oldId){g.next={id:uid(),text,small:small||''};return;}
  g.next={...g.next,text};
  const upd=r=>r.id===oldId?{...r,theme:g.title,task:text}:r;
  setTodayTDL((S.todayTDL||[]).map(upd));S.tomorrowTDL=(S.tomorrowTDL||[]).map(upd);
  if(typeof tdlRows!=='undefined'&&tdlRows.some(r=>r.id===oldId)){tdlRows.forEach((r,k)=>{tdlRows[k]=upd(r);});if(typeof renderTDL==='function')renderTDL();}
  if((S.todayTDL||[]).some(r=>r.id===oldId)){writeDraftEntry(true);markDirty('e:'+curDay());syncEntryFor(curDay()).catch(()=>{});}
  renderStickyNote();
}
// 卡片上的欄位改完：先存，等不在打字了再重畫（不然從一格點到下一格時，焦點會被重畫吃掉）
function saveQuiet(g){g.updatedAt=Date.now();sv(S);syncStateDebounced();whenIdle('focus-render',()=>render(true));}
// 「送印 10/8」→ ['送印','2026-10-08']
function splitTitleDate(v){
  const mm=String(v).match(/^(.*?)[\s　]+(\d{1,2}\s*[\/\-.月]\s*\d{1,2}\s*日?)$/);
  return mm&&parseMD(mm[2])?[cleanTitle(mm[1]),parseMD(mm[2])]:[cleanTitle(v),''];
}
// ── ② 作品型目標卡：階段清單 ─────────────────────
function dueTxt(g){
  if(!g.dueDate)return '';
  const left=daysBetween(ds(),g.dueDate);
  return `${md(g.dueDate)}${g.event?' '+esc(g.event):''} · ${left>0?left+' 天':(left===0?'今天':'已過 '+(-left)+' 天')}`;
}
// ── 身體型目標卡：本週點點＋動一動 ──────────────
// ── 體重：每天一個數字，只看平均 ──────────────────────────
// 存在每天的 health.body.weight（公斤）。畫面主角是「近 7 天平均」，不是今天的數字；
// 沒量不算失敗、沒有連續天數、上升也不會變紅。
const weightOf=day=>{const b=(health(day)||{}).body;const w=b&&+b.weight;return w>0?w:0;};
function weightList(){
  const t=curDay(),out=[];
  (S.entries||[]).forEach(e=>{const w=e.health&&e.health.body&&+e.health.body.weight;if(w>0&&e.date!==t)out.push({day:e.date,kg:w});});
  const tw=weightOf(t);if(tw)out.push({day:t,kg:tw});   // 今天的還在草稿裡，不一定已進 entries
  return out;
}
const wSign=x=>(x>0?'＋':x<0?'−':'±')+Math.abs(x).toFixed(1);
function weightRow(g){
  const d=ds(),cur=weightOf(d),pm=g.weightPerMonth===undefined?1:(+g.weightPerMonth||0);
  const t=C.weightTrend(weightList(),curDay(),pm);
  let sum;
  if(!t)sum='每天起床後、吃東西前量一次，打進來就好。看的是平均，不看一天的起伏。';
  else if(t.recent==null)sum='最近 7 天沒有記錄，量了再打進來就會接上。';
  else if(!t.ready)sum=`已記 ${t.n} 天。滿兩週後開始跟起點比；現在先看平均就好。`;
  else{
    const ok=t.expect!=null&&t.delta<=t.expect+0.3;
    sum=`比起點 <b>${wSign(t.delta)}</b> kg（起點 ${t.start}，${md(t.first)} 起）`
      +(t.expect!=null?`・每月 −${pm} 的速度，現在約 ${wSign(t.expect)}　<span class="wt-st${ok?' ok':''}">${ok?'✓ 跟得上':'比預期慢一點，不急；一個月的平均才準'}</span>`:'');
  }
  return `<div class="wt-box"><div class="dots-row"><span class="dl">體重</span>
      <input class="wt-in" data-weight="${esc(g.id)}" inputmode="decimal" maxlength="5" placeholder="今天" value="${cur?cur.toFixed(1):''}" title="起床後、吃東西前量一次；清空＝刪掉這天的" aria-label="${esc(md(d))} 體重"/><span class="wt-u">kg</span>
      <span class="dn" title="最近 7 天的平均">${t&&t.recent!=null?`7 天平均 ${t.recent}`:''}</span></div>
    <div class="goal-sub muted wt-sum">${sum}</div></div>`;
}
function bodyCard(g){
  const d=ds(),st=weekStats(d,g);let suggested=!!closeBanner(g);
  const mon=mondayOfDs(d);let restN=0;for(let i=0;i<7;i++){const day=shiftDay(mon,i);if(day>d)break;if(isRestDay(day))restN++;}
  const effGoal=t=>t?Math.max(1,Math.round(t*(7-restN)/7)):0;   // 本週有不舒服的日子，目標跟著等比例少
  const rows=activeMetrics(g).map(m=>{
    const n=st[m.k],goal=effGoal(+m.target),today=metricHit(m,d);
    const tick=m.src==='manual'?`<button class="focus-btn mt-tick${today?' done':''}" data-metric="${esc(m.k)}" data-g="${esc(g.id)}">${today?'今天 ✓':'今天'}</button>`:'';
    const sg=suggested?null:metricSuggest(g,m,d);if(sg)suggested=true;   // 一次只提一項，不要整張卡都在催
    const hint=sg?`<div class="mt-suggest">最近平均每週 ${sg.perWeek} ${esc(m.unit)}，要先把目標改成 ${sg.next} 嗎？
      <button class="focus-btn" data-metric-set="${esc(m.k)}" data-n="${sg.next}" data-g="${esc(g.id)}">改成 ${sg.next}</button>
      <button class="goal-more" data-metric-keep="${esc(m.k)}" data-g="${esc(g.id)}">不用</button></div>`:'';
    return `<div class="dots-row${n>=goal?' hit':''}"><span class="dl">${esc(m.l)}</span><span class="dd">${Array.from({length:goal},(_,i)=>`<i class="${i<n?'on':''}"></i>`).join('')}</span><span class="dn">${n}/${goal}</span>${tick}</div>${hint}`;
  }).join('');
  const pgNow=projectGoal();
  return `<div class="gcard goal-card">${pgNow&&closeBanner(pgNow)?'':closeBanner(g)}<div class="goal-hd"><span class="goal-title">${esc(g.title)}</span><span class="goal-sub muted">本週${restN?` · 休息 ${restN} 天不算`:''}</span>
      <span class="goal-sub" style="margin-left:auto;">${dueTxt(g)}</span><button class="card-edit" data-edit-goal="${esc(g.id)}" title="編輯">✏️ 編輯</button></div>
    ${rows?`<div style="display:flex;flex-direction:column;gap:7px;margin-top:8px;" title="本週，週一重新開始">${rows}</div>`:'<div class="goal-sub muted">還沒設每週目標，點 ✏️ 設定</div>'}
    ${weightRow(g)}
  </div>`;
}
function expRows(){
  const d=ds(),list=exps().filter(e=>e.status!=='archived'&&e.place==='checkin');
  if(!list.length)return '';
  const mon=mondayOfDs(d),week=[...Array(7)].map((_,i)=>shiftDay(mon,i));
  return list.map(e=>{
    const on=!!(e.log||{})[d],wk=week.filter(x=>x<=d&&(e.log||{})[x]).length;
    const goal=e.freq==='weekly'?(e.n||1):(e.freq==='daily'?7:1);
    return `<div class="exp-row"><button class="er-box${on?' on':''}" data-exp-log="${esc(e.id)}">${on?'✓':''}</button>
      <span style="${on?'text-decoration:line-through;opacity:.55;':''}">${esc(e.text)}</span>
      <span class="er-tag">🧪 實驗${e.freq==='once'?'':' · 本週 '+wk+'/'+goal}</span></div>`;
  }).join('');
}
// 今天狀況：一鍵標記。rest＝這天身體不舒服，不算進每週目標
const DEF_TAGS=[{l:'經期',rest:true},{l:'不舒服',rest:true},{l:'趕工'},{l:'上課'}];
function tagsOf(g){return g&&Array.isArray(g.dayTags)?g.dayTags.filter(x=>x&&x.l):DEF_TAGS;}
// 日曆上有「月經／經期／生理期」的行程＝低能量日（不用另外記）；或今天狀況勾了「不計目標」的標籤
const PERIOD_RE=/月經|經期|生理期/;
function periodCal(day){
  try{const a=(typeof calEvents!=='undefined'&&calEvents[day])||[];const e=a.find(ev=>PERIOD_RE.test(ev.title||''));return e?String(e.title).match(PERIOD_RE)[0]:'';}catch(e){return '';}
}
function tagRest(day){
  const on=(health(day)||{}).dayTags||[];if(!on.length)return false;
  const rest=tagsOf(movesGoal()).filter(x=>x.rest).map(x=>x.l);
  return on.some(x=>rest.indexOf(x)>=0);
}
function isRestDay(day){return !!periodCal(day)||tagRest(day);}
function tagChips(){
  const on=(health(ds())||{}).dayTags||[],list=tagsOf(movesGoal());
  const extra=on.filter(x=>!list.some(t=>t.l===x)).map(l=>({l}));   // 標過但已從清單刪掉的也要看得到
  return `<div class="also-chips">${[...list,...extra].map(t=>`<button class="focus-btn${on.indexOf(t.l)>=0?' done':''}" data-day-tag="${esc(t.l)}" title="${t.rest?'這天不算進每週目標':''}">${esc(t.l)}${on.indexOf(t.l)>=0?' ✓':''}</button>`).join('')}</div>`;
}
function moveChips(){
  const e=health(ds()).exercise||{},types=exTypesOf(e);
  return `<div class="also-chips">${movesOf(movesGoal()).map(x=>{const on=types.indexOf(x.t)>=0;return `<button class="focus-btn${on?' done':''}" data-move="${esc(x.t)}" data-min="${x.m}">${esc(x.t)} ${x.m}${on?' ✓':''}</button>`;}).join('')}
    <button class="focus-btn${e.restDay?' rest':''}" data-action="rest">${e.restDay?'休息 ✓':'休息'}</button></div>`;
}
// ── 收工面板：今天沒做完的（不順延＝如實記成沒完成）＋把動畫下一步排到明天 ──
function undoneList(){
  const c=stickyCtx();if(!c.todayMode)return '';
  const rows=c.items.map((x,i)=>({x,i})).filter(o=>!c.done['t'+o.i]);
  if(!rows.length){
    const left=projectGoals().filter(g=>{const n=g.next,j=n&&n.id?c.items.findIndex(x=>x.id===n.id):-1;return n&&n.text&&!(j>=0&&c.done['t'+j]);});
    return left.length?`<div class="goal-sub" style="margin-bottom:10px;">清單做完了，還差作品的這一步：${left.map(g=>esc(g.title+'：'+g.next.text)).join('、')}</div>`
      :`<div class="goal-sub ok" style="margin-bottom:10px;">今天的清單都做完了 🎉</div>`;
  }
  return `<div class="goal-sub" style="font-weight:700;margin-bottom:4px;">今天還沒做完的 <span class="goal-sub muted" style="font-weight:500;">（不順延就照實記成沒完成）</span></div>
    ${rows.map(o=>`<div class="undone-row"><span>${o.x.theme?esc(o.x.theme)+'：':''}${esc(o.x.task)}${(+o.x.c||0)?' <span class="goal-sub muted">⏩'+o.x.c+'</span>':''}</span>
      <button class="focus-btn" data-postpone="${o.i}">⏩ 排到明天</button></div>`).join('')}
    <div style="height:10px;"></div>`;
}
function bringNext(){
  const c=stickyCtx();
  return projectGoals().map(pg=>{
    if(!pg.next||!pg.next.text)return '';
    const id=pg.next.id;
    if((typeof tdlRows!=='undefined'&&tdlRows.some(r=>r.id===id))||(S.tomorrowTDL||[]).some(r=>r.id===id))return '';
    const i=c.items.findIndex(x=>x.id===id);
    if(i>=0)return '';                            // 還在今天的清單（或已做完）→ 用上面「沒做完的」處理
    return `<button class="focus-btn" data-action="bring-next" data-g="${esc(pg.id)}" style="margin:8px 8px 0 0;">＋ 把「${esc(pg.next.text)}」排到明天</button>`;
  }).join('');
}
// 今天／明天 分頁：晚上收尾時段預設打開「明天」；自己點過就照自己的
function listTab(){
  let manual='';try{const m=JSON.parse(localStorage.getItem('grandol_lt')||'{}');if(m.d===curDay())manual=m.t;}catch(e){}
  return manual||(isEvening()?'tomorrow':'today');
}
function applyListTab(){
  const t=listTab();
  document.querySelectorAll('#list-tabs [data-lt]').forEach(b=>b.classList.toggle('on',b.dataset.lt===t));
  document.querySelectorAll('.list-card .lt-pane').forEach(p=>p.classList.toggle('on',p.dataset.lt===t));
  const tc=document.getElementById('tmr-count');
  if(tc&&typeof tdlRows!=='undefined'){const n=tdlRows.filter(r=>r.theme||r.task).length;tc.textContent=n?String(n):'';}
  const sub=document.getElementById('pg-sub-today');
  if(sub){const d=new Date(ds()+'T12:00:00'),h=new Date().getHours();
    sub.textContent=`${d.getMonth()+1}月${d.getDate()}日 週${'日一二三四五六'[d.getDay()]}`+(ds()===curDay()?' · '+(h<5?'深夜了':h<11?'早安':h<18?'午安':'晚安'):' · 補記中');}
}
document.querySelectorAll('#list-tabs [data-lt]').forEach(b=>b.addEventListener('click',()=>{
  try{localStorage.setItem('grandol_lt',JSON.stringify({d:curDay(),t:b.dataset.lt}));}catch(e){}
  applyListTab();
}));
document.getElementById('pg-cal-btn')?.addEventListener('click',()=>{if(typeof toggleCalPopup==='function')toggleCalPopup();});
function updateCount(){
  const el=document.getElementById('today-count');if(!el)return;
  const c=stickyCtx();if(!c.todayMode){el.textContent='';return;}
  const d=ds(),ex=exps().filter(e=>e.status!=='archived'&&e.place==='checkin');
  const total=c.items.length+ex.length,done=Object.keys(c.done).filter(k=>c.done[k]).length+ex.filter(e=>(e.log||{})[d]).length;
  el.textContent=total?`${done}/${total}`:'';
}
// 方向頁：這陣子的目標（一行一個，點 ✏️ 調整）
// ── ③ 今晚時間軸 ─────────────────────────────────
function tonightCard(){
  const d=ds(),r=routine(d);
  if(!r)return `<div class="gcard tonight"><span>${fi('1f319',19)}</span><span class="tonight-lbl">今晚</span>
    <span class="tonight-note">想幾點上床？</span>
    <div class="tonight-acts"><button class="focus-btn primary" data-action="quick-plan" data-stage="C">01:00 上床</button>
    <button class="focus-btn" data-action="quick-plan" data-stage="A">02:00 上床</button>
    <button class="focus-btn" data-action="edit-plan">自己設定</button></div></div>`;
  const w=health(d).sleep?.windDown||{},res=C.result(w,r.p,d,new Date());
  // 現在這一步快到了（收尾步驟前 90 分、固定項目前 15 分，到上床後 3 小時）→ 直接給「做完了／跳過」
  const now=new Date(),bedAbs=r.steps.find(x=>x.k==='bed').abs;
  const live=d===curDay()&&!!r.next&&now>=new Date(r.next.abs-(r.next.extra?15:90)*60000)&&now<new Date(+bedAbs+180*60000);
  const open=d!==curDay()||live||!!editing||tonightOpen();
  const bgm=bodyGoal(),feeds=bgm?{shoulder:activeMetrics(bgm).some(m=>m.src==='shoulder'),bed:activeMetrics(bgm).some(m=>m.src==='bed')}:{};
  if(!open){
    const doneN=r.steps.filter(x=>x.done).length;
    return `<button class="gcard tonight-card tonight-mini" data-action="tonight-toggle" title="展開看今晚每一步">
      <span class="tn-title">今晚 ${esc(r.p.bed)} 上床</span>
      <span class="tn-next">${r.next?`下一步 ${esc(r.next.at)} ${esc(r.next.label)}`:'今晚都做完了'}</span>
      <span class="tn-count">${doneN}/${r.steps.length} ▾</span></button>`;
  }
  const cells=r.steps.map(s=>{
    const isNext=r.next&&r.next.k===s.k;
    if(editing===s.k&&(s.k==='phone'||s.k==='bed'))
      return `<div class="tl-step next"><div class="t">幾點${esc(s.label)}？</div><input class="focus-time" type="time" data-edit="${s.k}" value="${esc(clock(s.done))}" style="width:88px;margin:3px auto 0;display:block;"/>
        <button class="focus-btn" data-action="clear-time" data-k="${s.k}" style="margin-top:4px;padding:3px 9px;">清除</button></div>`;
    const doneAt=(s.k==='phone'||s.k==='bed')?clock(s.done):'';
    const off=!s.done&&(s.skipped||s.missed);
    const step=`<button class="tl-step${s.done?' done':(isNext?' next':(off?' missed':''))}" data-step="${s.k}" title="${off?'沒做 · 補做了就點一下':(s.done?'點一下取消':'點一下＝做完了')}">
      <div class="t">${s.done&&doneAt?'✓ '+doneAt:(off?'沒做 · ':'')+esc(s.at)}</div><div class="n">${s.done&&!doneAt?'✓ ':''}${esc(s.label)}</div>${feeds[s.k]?'<span class="tl-feed">算進體態</span>':''}</button>`;
    if(!isNext||!live)return step;
    return `<div class="tl-now">${step}<button class="focus-btn" data-skip="${s.k}">跳過</button><button class="focus-btn primary" data-step="${s.k}">做完了</button></div>`;
  }).join('');
  const done=r.steps.filter(x=>x.done).length;
  return `<div class="gcard tonight-card${live?' live':''}"><div class="tn-hd">
      <span class="tn-title">今晚 ${esc(r.p.bed)} 上床</span><span class="tn-count">${done}/${r.steps.length}</span>
      <button class="card-edit" data-action="edit-plan" title="改時間、改每一步">✏️ 編輯</button>
      ${live||d!==curDay()?'':'<button class="card-edit" data-action="tonight-toggle" title="收起來">▴</button>'}</div>
    <div class="tn-sub"><span class="${res.kind==='late'?'warn':''}">${res.kind==='missing'?(live?'現在這一步做完就按「做完了」':'點一下＝做完了'):esc(res.label)}</span></div>
    <div class="tl">${cells}</div></div>`;
}
// ══ 目標的日期 → Google 日曆 ═════════════════════════
// 作品型目標：每個有日期的階段＝一個全天行程；🚩 硬期限前一天早上 9 點提醒；目標截止日也放一個。
// 已經建好的行程 id 記在 g.cal（跟著目標一起同步到雲端），改名、改日期、刪掉都會跟著更新日曆。
const CLOSE_LABEL={done:'完成了',letgo:'放下了',end:'結束了'};
const CAL_STAGE_COLOR='9',CAL_HARD_COLOR='11';
const calSync={busy:{},again:{},timer:null,state:{},err:{},retryT:{},prog:{}};
const CAL_CP_COLOR='5',CAL_PLAN_COLOR='7',CAL_PERIOD_COLOR='8';
// 設成「只放截止日」就不放階段與檢查日（日曆太擠時用）
function calDetailOn(){const p=data().plan;return !p||p.calDetail!==false;}
function goalCalItems(g){
  const out={};
  if(g.kind==='body'||g.status==='archived')return out;   // 封存才從日曆拿掉；暫停、完成都留著
  const detail=calDetailOn();
  if(detail)(g.milestones||[]).forEach(m=>{
    if(!m.due||!m.id)return;
    out['m:'+m.id]={title:`${m.done?'✅':(m.hard?'🚩':'🎬')} ${g.title}：${m.title}`,date:m.due,color:m.hard?CAL_HARD_COLOR:CAL_STAGE_COLOR,reminderMin:m.hard&&!m.done?900:''};
  });
  if(detail)(g.checkpoints||[]).forEach(c=>{
    if(!c.due||!c.id||c.deleted)return;
    const icon=c.result?(c.result.ok?'✅':'⚠️'):'◆';
    out['c:'+c.id]={title:`${icon} 檢查日｜${g.title}：${c.title}${c.approx?'（日期暫定）':''}`,date:c.due,color:CAL_CP_COLOR,reminderMin:c.result?'':900};
  });
  // 截止日跟某個🚩硬期限階段同一天，就不重複放
  const dupHard=detail&&(g.milestones||[]).some(m=>m.hard&&m.due===g.dueDate);
  if(g.dueDate&&!dupHard)out.due={title:`🏁 ${g.title} 截止`,date:g.dueDate,color:CAL_HARD_COLOR,reminderMin:900};
  return out;
}
// 計畫本身的行程（出遊、年假、出國、活動日）和趕工週：多天的做成橫跨的全天行程
function planCalItems(pl){
  const out={};if(!pl)return out;
  (pl.events||[]).forEach(e=>{if(e.deleted||!e.from)return;
    out['e:'+e.id]={title:`📌 ${e.title}${e.tentative?'（暫定）':''}`,date:e.from,endDate:e.to&&e.to>e.from?e.to:'',color:e.color||CAL_PLAN_COLOR,reminderMin:''};});
  (pl.periods||[]).forEach(x=>{if(x.deleted||!x.from||!x.to)return;
    out['p:'+x.id]={title:x.mode==='pause'?`⏸ 習慣暫停：${x.label}`:`🛡 趕工週：${x.label}（只守最低版）`,date:x.from,endDate:x.to>x.from?x.to:'',color:CAL_PERIOD_COLOR,reminderMin:''};});
  return out;
}
const calOwner=id=>id==='__plan'?(data().plan||null):(data().projects.find(x=>x.id===id)||null);
const calItemsOf=o=>!o?{}:(o.id==='__plan'?planCalItems(o):goalCalItems(o));
const calSig=w=>[w.title,w.date,w.endDate||'',w.color,w.reminderMin].join('|');
function goalCalDirty(g){
  const want=calItemsOf(g),have=g.cal||{};
  return Object.keys(want).some(k=>!have[k]||have[k].sig!==calSig(want[k]))||Object.keys(have).some(k=>!want[k]);
}
const calOwners=()=>[...data().projects,...(data().plan?[data().plan]:[])];
function scheduleGoalCal(){
  // 只在這台裝置已經拿到雲端資料、日曆也連得上時才同步（避免還沒拿到別台的 cal 就重複建行程）
  if(!cloudReady||typeof calConnected==='undefined'||!calConnected||!GAS_URL||VIEWER_MODE)return;
  if(!calOwners().some(goalCalDirty))return;
  clearTimeout(calSync.timer);
  calSync.timer=setTimeout(()=>{if(isTyping()){scheduleGoalCal();return;}calOwners().filter(goalCalDirty).forEach(syncGoalCal);},2500);
}
async function syncGoalCal(g){
  if(calSync.busy[g.id]){calSync.again[g.id]=true;return;}
  calSync.busy[g.id]=true;calSync.state[g.id]='syncing';paintCalState(g);
  const have={...(g.cal||{})};let changed=false;
  try{
    const want=calItemsOf(g);
    const todo=Object.keys(want).filter(k=>!have[k]||have[k].sig!==calSig(want[k])).length+Object.keys(have).filter(k=>!want[k]).length;
    let n=0;const tick=()=>{n++;calSync.prog[g.id]=`${n}/${todo}`;paintCalState(g);};
    for(const [k,w] of Object.entries(want)){
      const sig=calSig(w),h=have[k];
      if(h&&h.sig===sig)continue;
      const payload={title:w.title,date:w.date,allDay:true,color:w.color,reminderMin:w.reminderMin,repeat:'none'};
      if(w.endDate)payload.endDate=w.endDate;
      // 不用 editCalEvent：Apps Script 的「編輯」會先刪舊的，舊的已經被手動刪掉時會整個失敗。
      // 改成自己先刪（已經不在就算了），再建一個新的
      if(h&&h.id){await delCalQuiet(h.id);delete have[k];changed=true;}
      const j=await gasJson(await gasPost('addCalEvent',payload));
      if(!j||!j.ok||!j.id)throw new Error((j&&j.error)||'日曆沒有回應');
      have[k]={id:j.id,sig};changed=true;tick();
      if(n%8===0)persistCal(g.id,have);   // 事情多的時候，每 8 筆先存一次，中途斷線也不會重建
    }
    for(const k of Object.keys(have)){
      if(want[k])continue;
      await delCalQuiet(have[k].id);
      delete have[k];changed=true;tick();
    }
    calSync.state[g.id]='ok';calSync.prog[g.id]='';
  }catch(e){
    calSync.state[g.id]='error';calSync.err[g.id]=calErrText(e);console.warn('goal calendar sync',e);
    clearTimeout(calSync.retryT[g.id]);calSync.retryT[g.id]=setTimeout(()=>{const cur=calOwner(g.id);if(cur&&goalCalDirty(cur))syncGoalCal(cur);},30000);
  }
  finally{
    if(changed){
      persistCal(g.id,have,g);
      if(typeof fetchCalMonth==='function'){calFetchedMonths={};const t=new Date();fetchCalMonth(t.getFullYear(),t.getMonth(),true).then(()=>{if(typeof renderTodayEvents==='function')renderTodayEvents();}).catch(()=>{});}
    }
    calSync.busy[g.id]=false;paintCalState(g);
    if(calSync.again[g.id]){calSync.again[g.id]=false;const cur=calOwner(g.id);if(cur)syncGoalCal(cur);}
  }
}
// data() 每次都會重建物件：一定要寫回「現在的」那一個，不然 id 會存到舊物件上弄丟
function persistCal(id,have,fallback){const cur=calOwner(id)||fallback;if(!cur)return;cur.cal={...have};cur.updatedAt=Date.now();sv(S);syncStateDebounced();}
// 刪日曆行程：行程本來就不在了（手動刪掉、或之前刪過）也當作成功
const CAL_GONE=/不存在|已遭刪除|not found|does not exist|deleted|找不到/i;
async function delCalQuiet(id){
  let j;
  try{j=await gasJson(await gasPost('delCalEvent',{id}));}
  catch(e){if(CAL_GONE.test(String(e&&e.message)))return;throw e;}
  if(j&&j.ok===false&&!CAL_GONE.test(String(j.error||'')))throw new Error(j.error||'刪除失敗');
}
function calErrText(e){
  const m=String(e&&e.message||e||'');
  if(/unauthorized/.test(m))return '需要通行碼：到「設定」輸入通行碼';
  if(/http 0|Failed to fetch|NetworkError|http undefined/i.test(m))return '連不上雲端（網路或 Apps Script 沒回應）';
  if(/bad-response/.test(m))return 'Apps Script 回傳的不是資料（可能要重新授權日曆）';
  if(/unknown action/.test(m))return 'Apps Script 版本太舊，沒有日曆功能';
  return m.slice(0,120)||'不明原因';
}
function calStateHTML(g,always){
  if(!Object.keys(calItemsOf(g)).length&&!Object.keys(g.cal||{}).length)return '';
  const st=calSync.state[g.id]||(goalCalDirty(g)?'pending':'ok');
  if(!always&&!heroOpen()&&st!=='error')return '';
  if(typeof calConnected==='undefined'||!calConnected)return '<span class="cal-sync off" title="連上 Google 日曆後，有日期的階段會自動放進日曆">📅 日曆未連線</span>';
  return {syncing:`<span class="cal-sync">📅 同步中${calSync.prog[g.id]?' '+calSync.prog[g.id]:'…'}</span>`,pending:'<span class="cal-sync">📅 等一下就同步</span>',
    error:`<button type="button" class="cal-sync err" data-action="cal-retry" data-g="${esc(g.id)}" title="${esc(calSync.err[g.id]||'')}（點一下重試）">📅 日曆同步失敗 · 重試</button>`,ok:'<span class="cal-sync ok" title="有日期的階段都在 Google 日曆上">📅 已在日曆上</span>'}[st];
}
function paintCalState(g){$qa(`[data-cal-state="${g.id}"]`).forEach(el=>{el.innerHTML=calStateHTML(g,el.dataset.always==='1');});}
// ══ 檢查日（止損點）══════════════════════════════
// 先寫好「到那天看什麼、達標門檻、沒達標就改做什麼」，到了那天照表決定，不用在很累的時候重新談判
const cpOpenSet=new Set();
function allCheckpoints(){
  return data().projects.filter(g=>g.kind!=='body'&&g.status!=='archived')
    .flatMap(g=>(g.checkpoints||[]).filter(c=>!c.deleted).map(c=>({g,c})));
}
const byDue=(a,b)=>(a.c.due||'9999').localeCompare(b.c.due||'9999');
function cpDueNow(){const d=curDay();return allCheckpoints().filter(x=>!x.c.result&&x.c.due&&x.c.due<=d).sort(byDue);}
// 今天卡片上要顯示的：到期還沒檢查的；沒達標的留 7 天（退路要看得到、要寫下決定）；達標的只留當天（按錯可以改回）
function cpHeroList(){
  const d=curDay();
  return allCheckpoints().filter(x=>{const c=x.c,r=c.result;if(!r)return c.due&&c.due<=d;const age=daysBetween(r.on,d);return r.ok?age<=0:age<=7;}).sort(byDue);
}
const cpAttr=x=>`data-g="${esc(x.g.id)}" data-c="${esc(x.c.id)}"`;
// 實測速度：「看什麼」提到實測／速度，或這個專案填過數字，檢查日上才會出現。計算在 FocusCore.speedCalc，這裡只呈現
// 沒填就只剩幾格空白的輸入框；不扣分、不加紅字；截止日要按按鈕才會改
const spWanted=(g,c)=>C.speedHas(g.speed)||/實測|速度/.test(c.check||'');
function speedOpts(g){return {today:curDay(),due:g.dueDate,startOn:g.startOn};}
function speedBox(x){
  const {g,c}=x,sp=g.speed||{},has=C.speedHas(sp);
  if(!spWanted(g,c)||(c.result&&!has))return '';   // 已經決定了、又沒填過數字，就不用再顯示空格子
  const d=curDay(),opt=speedOpts(g),calc=C.speedCalc(sp,opt),t=C.speedText(calc),dy=C.speedDays(sp,opt);
  const fld=(k,ph,w,tip)=>`<input class="cp-spi ${w}" data-cp-sp="${k}" data-g="${esc(g.id)}" value="${esc(sp[k]===undefined?'':(k==='sinceDay'?dateIn(sp[k]):sp[k]))}" placeholder="${esc(ph)}" maxlength="12"${k==='sinceDay'||k==='unit'?'':' inputmode="decimal"'} title="${esc(tip)}"/>`;
  const out=calc
    ?`<div class="cp-sp-res"><div>${esc(t.pace)}</div><div>${esc(t.plan)}</div>${calc.asOf!==d?`<small>以 ${md(calc.asOf)} 填的數字算；重填「已做」就會用今天重算</small>`:''}</div>`
    :`<div class="cp-sp-hint">${has?'再填：'+esc(C.speedMissing(sp,opt).join('、'))+' 就會算':'填兩個數字就會算（已做多少、總共多少）；不填也沒關係'}</div>`;
  // 按了才改日期；日期是現在才從資料算出來的，不是畫面上那一刻的舊數字
  const btn=calc&&!calc.finished&&calc.eta!==(g.dueDate||'')
    ?`<button type="button" class="focus-btn cp-sp-btn" data-action="cp-sp-due" data-g="${esc(g.id)}" title="不會自動改；按了才把截止日改掉，日曆也會跟著換">把截止日改成 ${esc(C.mdText(calc.eta,d))}</button>`:'';
  return `<div class="cp-sp"><div class="cp-sp-hd">實測速度<small>只在這天填就好</small></div>
    <div class="cp-sp-in"><label>已做 ${fld('doneAmt','數量','n','這段已經做了多少')}</label><label>／ 總共 ${fld('total','數量','n','全部是多少（例如影片總秒數）')}</label>${fld('unit','單位','u','單位，例如 秒、頁、張')}</div>
    <div class="cp-sp-in"><label>從 ${fld('sinceDay',g.startOn?dateIn(g.startOn):'開始日','d','從哪天開始算；空白＝用專案的開始日')} 起</label><label>已用 ${fld('days',Number.isFinite(dy.auto)?'自動 '+dy.auto:'天數','n','空白＝從開始日算到填數字的那天')} 天</label></div>
    ${out}${btn}</div>`;
}
// 匯出／回顧用的一行：沒填或算不出來就不寫（不是失敗）。數字是「填的那天」的，所以用 asOf 當基準
function speedLine(g){
  const calc=C.speedCalc(g.speed,speedOpts(g));if(!calc)return '';
  return `實測速度（${md(calc.asOf)} 填）：${C.speedText(calc).full}`;
}
function cpBox(x){
  const {g,c}=x,d=curDay(),left=c.due?daysBetween(d,c.due):null,res=c.result;
  const when=left==null?'':(left<0?`已過 ${-left} 天`:(left===0?'今天':`還有 ${left} 天`));
  const f=(k,lbl,ph)=>`<div class="cp-row"><i>${lbl}</i><input class="cp-in" data-cp-f="${k}" ${cpAttr(x)} value="${esc(c[k]||'')}" placeholder="${ph}" maxlength="400"/></div>`;
  const dueIn=`<input class="cp-due" data-cp-due="1" ${cpAttr(x)} value="${c.due?dateIn(c.due):''}" placeholder="日期" maxlength="12" title="打 12/7 這樣"/>`;
  if(res)return `<div class="cp-box ${res.ok?'ok':'no'}"><div class="cp-hd"><span>${res.ok?'✅ 達標':'⚠️ 沒達標'} · ${md(res.on)}</span><b>${esc(g.title)}：${esc(c.title)}</b>
      <button type="button" class="goal-more" data-action="cp-undo" ${cpAttr(x)}>改回還沒檢查</button></div>
    ${res.ok?'':`<div class="cp-fb"><i>就照這個走</i>${esc(c.fallback||'（當初沒寫退路，可以在下面補）')}</div>${f('fallback','退路','沒達標就…')}${f('decision','我決定','寫下你今天決定怎麼做')}`}${speedBox(x)}</div>`;
  return `<div class="cp-box open"><div class="cp-hd"><span>◆ 檢查日 · ${dueIn}${c.approx?' 暫定':''} · ${when}</span><b>${esc(g.title)}：${esc(c.title)}</b></div>
    ${f('check','看什麼','到那天要看什麼')}${f('bar','達標門檻','')}${f('fallback','沒達標就','退路')}${speedBox(x)}
    <div class="cp-act"><button type="button" class="focus-btn primary" data-action="cp-ok" ${cpAttr(x)}>達標了</button><button type="button" class="focus-btn" data-action="cp-no" ${cpAttr(x)}>沒達標</button></div></div>`;
}
const cpOf=el=>{const g=data().projects.find(x=>x.id===el.dataset.g);return {g,c:g&&(g.checkpoints||[]).find(x=>x.id===el.dataset.c)};};
// ══ 每天的最低標準：最低版一定要做到，理想版有餘力再做 ══════════════
const rhyItems=()=>live(planOf()&&planOf().items);
const habitOn=(day,key)=>!!key&&dayRec(day).checked.indexOf(key)>=0;
function rhyCtx(it,day){
  const h=health(day)||{},sl=h.sleep||{},ex=h.exercise||{};
  const hk=[it.floorRule,it.targetRule].map(r=>r&&r.type==='habit'?r.key:'').find(Boolean);
  return {wake:sl.wakeTime||'',bed:sl.sleepTime||'',minutes:+ex.duration||0,shoulder:!!(h.body&&h.body.shoulder),habit:habitOn(day,hk)};
}
const rhyManual=(it,day)=>((health(day)||{}).rhythm||{})[it.id];
const rhyDay=(it,day)=>C.itemDay(it,rhyCtx(it,day),rhyManual(it,day));
const dayPeriod=day=>{
  const p=planOf()?C.periodOf(planOf(),day):null;
  if(p&&p.mode==='pause')return p;
  if(isRestDay(day))return {mode:'rest',label:periodCal(day)||'不舒服'};   // 低能量日：只求睡飽，不計失敗
  return p;
};
const skipDay=per=>!!per&&(per.mode==='pause'||per.mode==='rest');
function rhyWeek(it,d){
  const mon=mondayOfDs(d);let floor=0,target=0;
  for(let i=0;i<7;i++){const day=shiftDay(mon,i);if(day>d)break;const per=dayPeriod(day);if(skipDay(per))continue;const r=rhyDay(it,day);if(r.floor)floor++;if(r.target)target++;}
  return {floor,target};
}
// 紅線：連續幾天沒守到最低（只算有記錄起床時間的日子）
function redlineHit(it,d){
  const rl=it.redline;if(!rl||!rl.days||!it.floorRule||it.floorRule.type!=='wake')return false;
  const lateBed=rl.lateBed&&C.validTime(rl.lateBed)?rl.lateBed:'';   // 有填：連續幾晚「入睡」晚於這個時間；沒填：連續幾天沒守到最低
  let n=0;
  for(let i=1;i<=14;i++){
    const day=shiftDay(d,-i),per=dayPeriod(day);if(skipDay(per))continue;
    const ctx=rhyCtx(it,day);
    if(lateBed){if(!C.validTime(ctx.bed))break;if(C.toMin(ctx.bed,true)<C.toMin(lateBed,true))break;}
    else{if(!C.validTime(ctx.wake))break;if(C.ruleMet(it.floorRule,ctx))break;}   // 沒記錄就不猜
    n++;if(n>=rl.days)break;
  }
  return n>=rl.days;
}
const rhyLaterOpen=new Set();
// 入睡時間的趨勢（跟前 7 晚比）與「這一晚通常最晚睡」：都從已記的睡眠算，不用另外輸入
function sleepBedList(){
  const out=[],t=curDay();
  (S.entries||[]).forEach(e=>{const s=e.health&&e.health.sleep;if(s&&s.sleepTime&&e.date!==t)out.push({day:e.date,bed:s.sleepTime});});
  const ts=(S.health||{}).sleep;if(ts&&ts.sleepTime)out.push({day:t,bed:ts.sleepTime});
  return out;
}
function sleepNotes(it,d,rest){
  if(!it.floorRule||it.floorRule.type!=='wake')return '';
  const list=sleepBedList(),tr=C.sleepTrend(list,curDay());let h='';
  if(tr.avg){
    const dif=tr.diff==null?'':(tr.diff>0?`，比前 7 晚早 ${tr.diff} 分`:(tr.diff<0?`，比前 7 晚晚 ${-tr.diff} 分`:'，跟前 7 晚一樣'));
    h+=`<span class="rhy-i">近 7 天平均 ${tr.avg} 入睡${dif}</span>`;
  }
  const w=!rest&&d===curDay()?C.worstNight(list,curDay()):null;
  if(w&&new Date(d+'T12:00:00').getDay()===w.dow)h+=`<span class="rhy-i nudge">週${'日一二三四五六'[w.dow]}晚上通常是你最晚睡的（過去平均 ${w.avg}），今晚先比平常早 30 分就好。</span>`;
  return h;
}
function rhythmCard(){
  const pl=planOf(),items=rhyItems();if(!pl||!items.length)return '';
  const d=ds(),per=dayPeriod(d),rest=!!per&&per.mode==='rest';
  if(per&&per.mode==='pause')return `<div class="gcard rhy-card pause"><div class="rhy-hd"><span class="goal-title">每天的最低標準</span><span class="rhy-mode pause">⏸ 習慣暫停 · ${esc(per.label)}</span></div><div class="goal-sub muted">這段時間不計失敗，好好休息。</div></div>`;
  const floorDay=!!per;
  const red=rest?'':items.filter(it=>redlineHit(it,d)).map(it=>`<div class="rhy-red">🚨 ${esc(it.redline.lateBed?`睡眠紅線：連續 ${it.redline.days} 晚 ${it.redline.lateBed} 後才睡，今天只做必要交付項，其他先暫停`:(it.redline.msg||it.label+'連續沒守到最低'))}</div>`).join('');
  const rowOf=it=>{
    const st=rhyDay(it,d),man=rhyManual(it,d),wk=rhyWeek(it,d);
    const pill=(lv,txt,on)=>{
      const auto=on&&man!==lv&&!(lv==='floor'&&man==='target');
      return `<button type="button" class="rhy-pill${on?' on':''}${auto?' auto':''}" data-action="rhy-tap" data-id="${esc(it.id)}" data-lv="${lv}" title="${auto?'從紀錄自動算到的':'點一下標記'}">${on?'✓ ':''}${txt}</button>`;};
    const showT=!floorDay&&it.target;
    const dots=it.weekly?` · 理想 ${'●'.repeat(Math.min(wk.target,Math.max(it.weekly,wk.target)))}${'○'.repeat(Math.max(0,it.weekly-wk.target))}`:'';
    return `<div class="rhy-row"><div class="rhy-l"><b>${esc(it.label)}</b><span>${esc(it.floor||'')}</span>${showT?`<span class="rhy-t">理想：${esc(it.target)}</span>`:''}${sleepNotes(it,d,rest)}</div>
      <div class="rhy-s">${pill('floor','最低',st.floor)}${showT?pill('target','理想',st.target):''}<small>本週 ${wk.floor} 天${showT||it.weekly?dots:''}</small></div></div>`;
  };
  const main=items.filter(it=>!it.later),later=items.filter(it=>it.later);
  const shown=main.length?main:later;   // 全部都先放著的話，不要讓卡片空掉
  const lo=main.length&&later.length,open=rhyLaterOpen.has('later');
  const laterBox=lo?`<div class="rhy-later"><button type="button" class="rhy-later-h" data-action="rhy-later"><b>其他 ${later.length} 項先放著</b><small>${later.map(i=>esc(i.label)).join('、')}</small><span>${open?'▴':'▾'}</span></button>${open?later.map(rowOf).join(''):''}</div>`:'';
  const chip=rest?`<span class="rhy-mode rest">🌙 低能量日 · ${esc(per.label)}</span>`:(per?`<span class="rhy-mode floor">🛡 趕工日 · ${esc(per.label)}</span>`:'<span class="rhy-mode">平常日</span>');
  const cap=rest?'<div class="goal-sub muted rhy-cap">今天能量低：只留最小的 1–2 件事，睡飽最重要，其他先放著，睡晚一點也沒關係，都不算失敗。</div>':'';
  return `<div class="gcard rhy-card"><div class="rhy-hd"><span class="goal-title">每天的最低標準</span>${chip}
      <button type="button" class="card-edit" data-action="rhy-edit" title="改文字、時間、每週次數">✏️ 編輯</button></div>${cap}${red}${shown.map(rowOf).join('')}${laterBox}</div>`;
}
function openRhythmEditor(){
  const pl=ensurePlan();
  const rowHTML=it=>{
    const fr=it.floorRule||{},tr=it.targetRule||{};
    const num=(lbl,k,v,w)=>`<label class="rhy-ed-n">${lbl}<input class="fm-in" data-k="${k}" value="${esc(v)}" maxlength="6" style="width:${w||70}px"/></label>`;
    return `<div class="rhy-ed" data-item="${esc(it.id)}">
      <div class="qg-1"><input class="fm-in" data-k="label" value="${esc(it.label)}" maxlength="12" placeholder="名稱"/><input class="fm-in" data-k="weekly" value="${it.weekly||''}" maxlength="2" placeholder="每週理想次數" title="理想版每週要做到幾次；不用就留空"/><button type="button" class="fm-del" data-del title="刪除">✕</button></div>
      <input class="fm-in" data-k="floor" value="${esc(it.floor||'')}" maxlength="80" placeholder="最低版：最少要做到什麼" style="margin-bottom:6px;"/>
      <label class="pl-chk" style="margin-bottom:6px;"><input type="checkbox" data-k="later"${it.later?' checked':''}/>先放著（收進「其他」，先專心做上面的）</label>
      <input class="fm-in" data-k="target" value="${esc(it.target||'')}" maxlength="80" placeholder="理想版：有餘力做到什麼（選填）" style="margin-bottom:6px;"/>
      <div class="rhy-ed-r">${fr.max?num('最低：最晚',"fmax",fr.max):''}${fr.minHours!==undefined?num('且至少睡（小時）','fhrs',fr.minHours,56):''}${fr.grace?num('前晚太晚睡可放寬到','gmax',fr.grace.max,70):''}${tr.max?num('理想：最晚','tmax',tr.max):''}${fr.minutes!==undefined&&fr.type==='exercise'?num('最低：分鐘','fmin',fr.minutes,56):''}${tr.minutes!==undefined&&tr.type==='exercise'?num('理想：分鐘','tmin',tr.minutes,56):''}${it.redline&&it.redline.lateBed?num('紅線：連續幾晚','rdays',it.redline.days||3,40)+num('入睡晚於','rbed',it.redline.lateBed,70):''}</div></div>`;
  };
  modal('每天的最低標準',`
    <div class="fm-hint">最低版是再忙再累也要守的；理想版有餘力再做。睡眠、運動會從紀錄自動算，其他的點一下標記。</div>
    <div id="rhy-list">${live(pl.items).map(rowHTML).join('')}</div>
    <button type="button" class="focus-btn" id="rhy-add">＋ 新增一項（自己打勾）</button>
    <div class="fm-actions"><button class="focus-btn primary" id="rhy-save" style="margin-left:auto;">儲存</button></div>`,
  (m,close)=>{
    const box=m.querySelector('#rhy-list');
    const bind=r=>r.querySelector('[data-del]').onclick=()=>{r.dataset.gone='1';r.style.display='none';};
    box.querySelectorAll('.rhy-ed').forEach(bind);
    m.querySelector('#rhy-add').onclick=()=>{box.insertAdjacentHTML('beforeend',rowHTML({id:'pl-'+uid(),label:'',floor:'',target:'',weekly:0,floorRule:{type:'manual'}}));bind(box.lastElementChild);box.lastElementChild.querySelector('input').focus();};
    m.querySelector('#rhy-save').onclick=()=>{
      const bad=[];const now=Date.now();
      box.querySelectorAll('.rhy-ed').forEach(r=>{
        const id=r.dataset.item,v=k=>(r.querySelector(`[data-k="${k}"]`)||{}).value,has=k=>!!r.querySelector(`[data-k="${k}"]`);
        let it=pl.items.find(x=>x.id===id);
        if(r.dataset.gone){if(it){it.deleted=true;it.updatedAt=now;}return;}
        if(!(v('label')||'').trim())return;
        if(!it){it={id,floorRule:{type:'manual'},targetRule:null};pl.items.push(it);}
        it.label=v('label').trim();it.floor=(v('floor')||'').trim();it.target=(v('target')||'').trim();it.weekly=Math.max(0,+v('weekly')||0);it.deleted=false;it.updatedAt=now;{const lc=r.querySelector('[data-k="later"]');if(lc)it.later=lc.checked;}
        const time=k=>{const t=(v(k)||'').trim().padStart(5,'0');if(!C.validTime(t)){bad.push(t||k);return null;}return t;};
        it.floorRule=it.floorRule?{...it.floorRule,...(it.floorRule.grace?{grace:{...it.floorRule.grace}}:{})}:it.floorRule;it.targetRule=it.targetRule?{...it.targetRule}:it.targetRule;
        if(has('fmax')){const t=time('fmax');if(t)it.floorRule.max=t;}
        if(has('gmax')){const t=time('gmax');if(t)it.floorRule.grace.max=t;}
        if(has('tmax')){const t=time('tmax');if(t)it.targetRule.max=t;}
        if(has('fhrs'))it.floorRule.minHours=Math.min(12,Math.max(0,parseFloat(v('fhrs'))||0));
        if(it.redline)it.redline={...it.redline};
        if(has('rdays'))it.redline.days=Math.min(14,Math.max(1,Math.round(+v('rdays'))||3));
        if(has('rbed')){const t=time('rbed');if(t)it.redline.lateBed=t;}
        if(has('fmin'))it.floorRule.minutes=Math.max(0,+v('fmin')||0);
        if(has('tmin'))it.targetRule.minutes=Math.max(0,+v('tmin')||0);
      });
      if(bad.length){softToast('時間格式不對，打成 09:00 這樣',2800);return;}
      savePlan();close();softToast('存好了 ✓',1600);
    };
  });
}
// ══ 計畫：時間軸、檢查日、待確認、行程與趕工週 ══════════════
const planOf=()=>data().plan||null;
const live=arr=>(arr||[]).filter(x=>!x.deleted);
const dateIn=v=>v?((v.slice(0,4)!==curDay().slice(0,4)?v.slice(0,4)+'/':'')+md(v)):'';
function savePlan(){const p=planOf();if(!p)return;p.updatedAt=Date.now();sv(S);syncStateDebounced();whenIdle('focus-render',()=>render(true));}
// 在輸入框裡按 Enter 新增時要馬上看到新的一列（游標還在輸入框，等「打完字」會一直等不到）
function savePlanNow(){const p=planOf();if(!p)return;p.updatedAt=Date.now();sv(S);syncStateDebounced();render(true);}
function ensurePlan(){const f=data();if(!f.plan){f.plan={id:'__plan',version:1,title:'',updatedAt:0,importedAt:0,calDetail:true,cal:{},periods:[],events:[],todos:[],items:[]};}return f.plan;}
function todoRows(){
  const pl=planOf(),list=live(pl&&pl.todos).slice().sort((a,b)=>(a.done?1:0)-(b.done?1:0)||(a.due||'9999').localeCompare(b.due||'9999'));
  const d=curDay();
  return list.map(t=>{const late=!t.done&&t.due&&t.due<d;
    return `<div class="td-row${t.done?' done':''}${late?' late':''}"><input type="checkbox" data-todo-done="${esc(t.id)}"${t.done?' checked':''}/>
      <input class="td-text" data-todo-text="${esc(t.id)}" value="${esc(t.text)}" maxlength="200"/>
      <input class="td-due" data-todo-due="${esc(t.id)}" value="${dateIn(t.due)}" placeholder="期限" maxlength="12" title="要在哪天之前確認；清空＝沒有期限"/>
      <button type="button" class="fm-del" data-action="todo-del" data-id="${esc(t.id)}" title="刪除">✕</button></div>`;}).join('')
    +`<div class="td-row add"><span class="td-plus">＋</span><input class="td-text" data-todo-add="1" placeholder="新增要確認的事，按 Enter" maxlength="200"/></div>`;
}
function planRows(){
  const pl=planOf();if(!pl)return {ev:'',pe:''};
  const ev=live(pl.events).slice().sort((a,b)=>(a.from||'').localeCompare(b.from||'')).map(e=>`<div class="pl-row">
      <input class="pl-t" data-plan-f="title" data-kind="events" data-id="${esc(e.id)}" value="${esc(e.title)}" maxlength="40"/>
      <input class="pl-d" data-plan-d="from" data-kind="events" data-id="${esc(e.id)}" value="${dateIn(e.from)}" placeholder="開始" maxlength="12"/>
      <input class="pl-d" data-plan-d="to" data-kind="events" data-id="${esc(e.id)}" value="${e.to&&e.to!==e.from?dateIn(e.to):''}" placeholder="結束（選填）" maxlength="12"/>
      <label class="pl-chk"><input type="checkbox" data-plan-c="tentative" data-kind="events" data-id="${esc(e.id)}"${e.tentative?' checked':''}/>暫定</label>
      <button type="button" class="fm-del" data-action="plan-del" data-kind="events" data-id="${esc(e.id)}" title="刪除">✕</button></div>`).join('');
  const pe=live(pl.periods).slice().sort((a,b)=>(a.from||'').localeCompare(b.from||'')).map(x=>`<div class="pl-row">
      <input class="pl-t" data-plan-f="label" data-kind="periods" data-id="${esc(x.id)}" value="${esc(x.label)}" maxlength="40"/>
      <input class="pl-d" data-plan-d="from" data-kind="periods" data-id="${esc(x.id)}" value="${dateIn(x.from)}" placeholder="開始" maxlength="12"/>
      <input class="pl-d" data-plan-d="to" data-kind="periods" data-id="${esc(x.id)}" value="${dateIn(x.to)}" placeholder="結束" maxlength="12"/>
      <label class="pl-chk"><input type="checkbox" data-plan-c="pause" data-kind="periods" data-id="${esc(x.id)}"${x.mode==='pause'?' checked':''}/>暫停</label>
      <button type="button" class="fm-del" data-action="plan-del" data-kind="periods" data-id="${esc(x.id)}" title="刪除">✕</button></div>`).join('');
  return {
    ev:`${ev||'<div class="goal-sub muted">還沒有。</div>'}<button type="button" class="focus-btn" data-action="plan-add" data-kind="events">＋ 新增行程</button>`,
    pe:`<div class="goal-sub muted" style="margin-bottom:6px;">這段時間每天只要做到「最低版」就算過關；勾「暫停」＝習慣暫停、不計失敗。</div>${pe||'<div class="goal-sub muted">還沒有。</div>'}<button type="button" class="focus-btn" data-action="plan-add" data-kind="periods">＋ 新增趕工週</button>`};
}
// 下面的細項預設收起來：只看一行摘要，要改才點開（展開狀態在重畫時保留）
const plOpenSet=new Set();
function plFold(key,title,sum,body){
  const o=plOpenSet.has(key);
  return `<div class="pl-fold${o?' open':''}"><button type="button" class="pl-fold-h" data-action="pl-fold" data-k="${key}"><b>${title}</b><small>${sum}</small><span>${o?'▴':'▾'}</span></button>${o?`<div class="pl-fold-b">${body}</div>`:''}</div>`;
}
function planFolds(pl){
  const d=curDay(),todos=live(pl.todos).filter(t=>!t.done),late=todos.filter(t=>t.due&&t.due<d).length;
  const evs=live(pl.events).filter(e=>e.from),next=evs.filter(e=>(e.to||e.from)>=d).sort((a,b)=>a.from.localeCompare(b.from))[0];
  const per=live(pl.periods),r=planRows();
  return plFold('todos','還沒確定的事',`${todos.length} 項${late?`・<b class="warn">${late} 項過期</b>`:''}`,`<div class="goal-sub muted" style="margin-bottom:6px;">有期限的，過期會變橘色。</div>${todoRows()}`)
    +plFold('events','行程（出遊、年假、活動日）',`${evs.length} 個${next?'・下一個 '+esc(next.title)+' '+md(next.from):''}`,r.ev)
    +plFold('periods','趕工週（只做最低版的時期）',`${per.length} 段`,r.pe);
}
// ── 方向頁（v151）：睡覺一列、目標一張（時間軸就是清單）、其餘全收進「更多」──
function dirSleep(){
  const pl=planOf(),p=C.planFor(data(),ds());
  const names=live(pl&&pl.items).filter(x=>!x.later).map(x=>x.label).filter(Boolean);
  return `<div class="gcard dir-sleep"><span class="dir-ic">🌙</span><div class="dir-main"><div class="dir-t">每天只要顧：${esc(names.join('、')||'睡覺')}</div>
    <div class="goal-sub">${p?`${p.status==='paused'?'（暫停中）':''}${esc(p.bed)} 上床 · ${esc(p.wake)} 起床`:'還沒設定想幾點上床'}</div></div>
    <button type="button" class="card-edit" data-action="edit-plan" title="改時間、改每一步">✏️ 編輯</button></div>`;
}
function dirGoals(){
  const d=curDay(),pg=projectGoal(),projs=projectGoals(),bodies=goals().filter(g=>g.kind==='body');
  const rows=projs.map(g=>{
    const ph=(g.phases||[]).filter(x=>x.from&&x.to),ms=(g.milestones||[]).filter(m=>m.due).map(m=>m.due).sort();
    const start=ph.length?ph.map(x=>x.from).sort()[0]:(g.startOn&&g.startOn<=(g.dueDate||'9999')?g.startOn:(ms[0]||g.dueDate||d));
    const end=[g.dueDate||'',...ph.map(x=>x.to),ms[ms.length-1]||''].sort().pop();
    return {g,start,end};
  });
  const lo=shiftDay(d,-2),hi=shiftDay([shiftDay(d,28),...rows.map(r=>r.end).filter(Boolean)].sort().pop(),4);
  const total=daysBetween(lo,hi)+1,pct=x=>Math.max(0,Math.min(100,daysBetween(lo,x)/total*100));
  const ticks=[];for(let x=lo.slice(0,8)+'01';x<=hi;){const dt=new Date(x+'T12:00:00');if(x>lo&&pct(x)>9)ticks.push(x);dt.setMonth(dt.getMonth()+1);x=C.dateKey(dt);}
  const grid=ticks.map(x=>`<i class="dir-grid" style="left:${pct(x)}%"></i>`).join('');
  const axis=`<span style="left:0">今天</span>`+ticks.map(x=>`<span style="left:${pct(x)}%">${+x.slice(5,7)===1?x.slice(2,4)+'/':''}${+x.slice(5,7)}月</span>`).join('');
  const rowHTML=rows.map(({g,start,end})=>{
    const left=g.dueDate?daysBetween(d,g.dueDate):null;
    let bar='';
    if(end){const l=pct(start),r=Math.max(l+1.4,pct(shiftDay(end,1)));bar=`<i class="dir-seg" style="left:${l}%;width:${Math.min(100,r)-l}%"></i>`;}
    const when=g.dueDate?`${md(g.dueDate)} · ${left>0?left+' 天':(left===0?'今天':`<b>已過 ${-left} 天</b>`)}`:'沒有日期';
    return `<button type="button" class="dir-g${pg&&pg.id===g.id?' now':''}" data-edit-goal="${esc(g.id)}" title="點一下編輯：${esc(g.title)}"><span class="dir-gn">${esc(g.title)}</span><span class="dir-bar">${grid}${bar}</span><span class="dir-gd">${when}</span></button>`;
  }).join('');
  const bodyHTML=bodies.map(g=>`<button type="button" class="dir-g body" data-edit-goal="${esc(g.id)}" title="點一下編輯"><span class="dir-gn">${esc(g.title)}</span><span class="dir-bs">${esc(activeMetrics(g).map(m=>m.l+' '+m.target+m.unit).join('・')||'還沒設每週目標')}</span><span class="dir-gd"></span></button>`).join('');
  return `<div class="gcard dir-goals"><div class="goal-hd"><span class="goal-title">${projs.length} 個目標，照要交的日期排</span><span class="goal-sub muted" style="margin-left:auto;">點一列就能改</span></div>
    ${projs.length?`<div class="dir-axis">${axis}</div>`:''}
    ${rowHTML||'<div class="goal-sub muted" style="margin:6px 0;">還沒有目標。</div>'}${bodyHTML}
    <button type="button" class="focus-btn primary dir-add" data-action="goal-add">＋ 新增目標</button></div>`;
}
function expInner(){
  const list=data().experiments.filter(e=>e.status!=='archived');
  return `<div class="pl-hd">進行中的實驗<small>回顧時決定，最多 3 個</small></div>
    ${list.length?list.map(e=>`<div class="dots-row" style="padding:6px 0;border-top:1px solid var(--ds-line);">
        <span style="flex:1;min-width:0;">${esc(e.text)}</span><span class="goal-sub muted">${expLabelFreq(e)} · ${PLACES[e.place]||''}</span>
        <button class="goal-more" data-exp-end="${esc(e.id)}" style="margin:0;">結束</button></div>`).join('')
      :'<div class="goal-sub muted">還沒有。</div>'}
    <div class="goal-chips" style="margin-top:8px;"><button class="focus-btn" data-loop-add="1">＋ 自己加一個實驗</button></div>`;
}
function dirMore(){
  const pl=planOf(),f=data(),size=JSON.stringify(f).length,warn=size>40000;
  const cps=allCheckpoints(),open=cps.filter(x=>!x.c.result).sort(byDue),done=cps.filter(x=>x.c.result).sort(byDue);
  const cpRow=(x,res)=>{const left=x.c.due?daysBetween(curDay(),x.c.due):null,k=x.g.id+'|'+x.c.id,isOpen=cpOpenSet.has(k);
    const w=res?(x.c.result.ok?'✅ 達標':'⚠️ 沒達標'):(left==null?'':(left<0?'<b class="warn">已過 '+(-left)+' 天</b>':(left===0?'今天':'還有 '+left+' 天')));
    return `<div class="cpl"><button type="button" class="cpl-row" data-action="cp-toggle" data-k="${esc(k)}"><span class="cpl-d">${x.c.due?md(x.c.due):'?'}</span>
      <span class="cpl-t"><b>${esc(x.g.title)}</b>${esc(x.c.title)}</span><span class="cpl-w">${w}</span><span>${isOpen?'▴':'▾'}</span></button>${isOpen?cpBox(x):''}</div>`;};
  const cpHTML=open.length||done.length?`<div class="pl-sec"><div class="pl-hd">檢查日<small>${open.length} 個還沒檢查${done.length?'・'+done.length+' 個已檢查':''}</small></div>${open.slice(0,5).map(x=>cpRow(x,false)).join('')||'<div class="goal-sub muted">都檢查過了。</div>'}${open.length>5?`<div class="goal-sub muted">還有 ${open.length-5} 個在後面</div>`:''}
    ${done.length?`<div class="pl-hd" style="margin-top:10px;"><small>已檢查</small></div>${done.slice().reverse().slice(0,6).map(x=>cpRow(x,true)).join('')}`:''}</div>`:'';
  const body=`${pl?`<div class="pl-cal"><span data-cal-state="__plan" data-always="1">${calStateHTML(pl,true)}</span>
      <label class="pl-chk"><input type="checkbox" data-plan-c="calDetail"${pl.calDetail!==false?' checked':''}/>階段和檢查日也放進日曆</label>
      ${warn?'<span class="goal-sub warn" title="雲端把目標資料存在一個儲存格，上限約 5 萬字">資料快滿了，別再塞太多文字</span>':''}</div>`:''}
    ${cpHTML}${pl?`<div class="pl-sec pl-folds">${planFolds(pl)}</div>`:''}
    <div class="pl-sec">${expInner()}</div>
    <div class="pl-sec"><div class="goal-chips"><button class="focus-btn" data-action="quick-goals">一次貼上多個目標</button><button class="focus-btn" data-action="more">身體目標・封存・備份</button><button class="focus-btn" data-action="plan-import" title="匯入計畫檔">⬇ 匯入計畫檔</button></div></div>`;
  return `<div class="gcard dir-more">${plFold('more','更多','要確認的事、檢查日、行程、實驗、備份',body)}</div>`;
}
function dirTop(){return dirSleep()+dirGoals();}
function openAddGoal(){
  modal('新增目標',`
    <input class="fm-in" id="ag-t" maxlength="60" placeholder="名字，例如：寫報告" style="width:100%;"/>
    <input class="fm-in" id="ag-d" maxlength="12" placeholder="哪天要交（可以不填），例如 12/20" style="width:100%;margin-top:8px;"/>
    <div class="fm-actions"><button type="button" class="focus-btn primary" id="ag-go" style="margin-left:auto;">新增</button></div>`,
  (m,close)=>{
    const t=m.querySelector('#ag-t'),dd=m.querySelector('#ag-d');
    const go=()=>{
      const title=t.value.trim();if(!title){softToast('先寫名字',2000);t.focus();return;}
      const raw=dd.value.trim();let due='';
      if(raw){due=parseMD(raw);if(due===null){dd.classList.add('bad');softToast('日期看不懂，打成 12/20 這樣就好',2600);dd.focus();return;}}
      data().projects.push({id:uid(),kind:'project',title,dueDate:due||'',event:'',status:'active',group:'',note:'',milestones:[],next:{id:uid(),text:'',small:''},startOn:curDay(),createdAt:Date.now(),updatedAt:Date.now()});
      sv(S);syncStateDebounced();close();softToast('加好了',2000);render(true);
    };
    m.querySelector('#ag-go').addEventListener('click',go);
    [t,dd].forEach(x=>x.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();go();}}));
    dd.addEventListener('input',()=>dd.classList.remove('bad'));
    t.focus();
  });
}
// ── 匯入計畫檔 ──
function openPlanImport(){
  modal('匯入計畫檔',`
    <div class="fm-hint">貼上計畫的 JSON，或選擇檔案。同一份重複匯入只會更新，不會多一份；你已經勾掉的階段、做過的檢查、勾掉的待確認都會保留。名字有對到的目標（例如「作品A」）會直接接上去，不會另外多一個。</div>
    <textarea class="fm-in" id="pi-text" rows="7" style="width:100%;resize:vertical;font-size:12px;" placeholder='{"format":"grandol-plan", ...}'></textarea>
    <div class="goal-chips" style="align-items:center;"><label class="fm-hint">或選檔案 <input id="pi-file" type="file" accept="application/json,.json,text/plain"/></label>
      <button type="button" class="focus-btn primary" id="pi-check" style="margin-left:auto;">看看會變成什麼</button></div>
    <div id="pi-preview"></div>`,
  (m,close)=>{
    const ta=m.querySelector('#pi-text'),box=m.querySelector('#pi-preview');
    m.querySelector('#pi-file').addEventListener('change',async ev=>{const f=ev.target.files[0];if(!f)return;if(f.size>2*1024*1024){softToast('檔案太大了',2400);return;}ta.value=await f.text();});
    m.querySelector('#pi-check').addEventListener('click',()=>{
      let src;try{src=JSON.parse(ta.value);}catch(e){box.innerHTML='<div class="fm-hint" style="color:#B0502A;">看不懂這段文字：不是完整的 JSON。</div>';return;}
      const r=C.applyPlan(data(),src,{now:Date.now(),today:curDay()});
      if(r.error){box.innerHTML=`<div class="fm-hint" style="color:#B0502A;">${esc(r.error)}</div>`;return;}
      const rp=r.report,tooBig=r.size>46000;
      box.innerHTML=`<div class="pi-sum"><b>${esc(src.title||'計畫')}</b>
        <div>新增 ${rp.added} 個目標，更新 ${rp.updated} 個${rp.matched.length?`（接上你原本的：${rp.matched.map(esc).join('、')}）`:''}</div>
        <div>階段 ${rp.stages}・檢查日 ${rp.checkpoints}・行程 ${rp.events}・趕工週 ${rp.periods}・每天的最低標準 ${rp.items}・待確認 ${rp.todos}</div>
        <div class="goal-sub muted">資料量會變成 ${(r.size/1000).toFixed(1)}K（雲端上限約 45K）</div>
        ${rp.warnings.map(w=>`<div class="fm-hint" style="color:#B0502A;">${esc(w)}</div>`).join('')}
        ${tooBig?'<div class="fm-hint" style="color:#B0502A;">太大了，雲端存不下。請先把備註縮短再匯入。</div>':''}</div>
        <div class="fm-actions"><label class="fm-hint"><input type="checkbox" id="pi-cal" checked/> 階段、檢查日、行程、趕工週也放進 Google 日曆</label>
          <button type="button" class="focus-btn primary" id="pi-go" style="margin-left:auto;"${tooBig?' disabled':''}>匯入</button></div>`;
      box.querySelector('#pi-go')?.addEventListener('click',()=>{
        S.focus=r.focus;const pl=S.focus.plan;pl.calDetail=box.querySelector('#pi-cal').checked;
        sv(S);syncStateDebounced();close();
        softToast(`匯入好了：${rp.added+rp.updated} 個目標${pl.calDetail?'，日曆會陸續放上去':''}`,3200);
        focusGoalOn(projectGoals()[0]&&projectGoals()[0].id);render(true);
      });
    });
  });
}
function render(force){
  if(!mounts.length)return;
  const a=document.activeElement;
  const typing=inMounts(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName||'');
  if(typing&&!force)return;
  const keep={};$qa('[data-next-in]').forEach(x=>{if(x.value)keep[x.dataset.nextIn]=x.value;});
  const gs=goals();
  if(M.now)M.now.innerHTML=nowCard();
  if(M.today)M.today.innerHTML=expRows();
  if(M.tonight)M.tonight.innerHTML=tonightCard();
  // 短期目標卡放在「今天」：每天打開就看得到；「方向」只放一行一個的清單，用來調整
  if(M.cards)M.cards.innerHTML=gs.filter(g=>g.kind==='body').map(bodyCard).join('');
  {const pg=projectGoal();
   let st=document.getElementById('hero-hide');if(!st){st=document.createElement('style');st.id='hero-hide';document.head.appendChild(st);}
   st.textContent=(pg&&pg.next&&pg.next.text&&ds()===curDay())?`.list-card .sticky-item.is-goal[data-goal="${CSS.escape(pg.id)}"]{display:none;}`:'';}
  if(M.moves)M.moves.innerHTML=moveChips();
  if(M.plan)M.plan.innerHTML=dirTop();
  if(M.rhythm)M.rhythm.innerHTML=rhythmCard();
  {const chip=document.getElementById('mode-chip'),per=dayPeriod(curDay());
   if(chip){chip.hidden=!per;if(per){chip.textContent=(per.mode==='pause'?'⏸ 習慣暫停 · ':per.mode==='rest'?'🌙 低能量日 · ':'🛡 趕工日 · ')+per.label;chip.className='mode-chip '+per.mode;}}}
  if(M.tags)M.tags.innerHTML=tagChips();
  if(M.undone)M.undone.innerHTML=undoneList();
  if(M.bring)M.bring.innerHTML=bringNext();
  updateCount();applyListTab();
  if(M.goals)M.goals.innerHTML=dirMore();
  $qa('[data-next-in]').forEach(x=>{if(keep[x.dataset.nextIn])x.value=keep[x.dataset.nextIn];});
  if(editing==='phone'||editing==='bed')$q('[data-edit]')?.focus();
  if(justDone)$q(`[data-next-in="${justDone}"]`)?.focus();
  if(VIEWER_MODE)$qa('button,input').forEach(el=>{el.disabled=true;});
  scheduleGoalCal();
}
// 「現在要做」跟著時間走：每分鐘更新一次（打字中不動）
setInterval(()=>{if(!document.hidden)render(false);applyNight();},60000);
// ── 夜晚模式：晚上收尾時段自動換成深色（收工前 90 分鐘起，到上床後 3 小時；沒設作息就 21:00～凌晨 4 點）
// 今晚可以手動關掉／打開，只記到這一晚，明天又回到自動
function nightAuto(){
  if(routine(curDay()))return isEvening(curDay());     // 作息暫停中也照時間：21:00 之後
  const h=new Date().getHours();return h>=21||h<4;
}
function nightPref(){try{const v=localStorage.getItem('grandol_night')||'';const [mode,day]=v.split('@');return day===curDay()?mode:'';}catch(e){return '';}}
function applyNight(){
  const auto=nightAuto(),pref=nightPref(),on=pref==='on'?true:(pref==='off'?false:auto);
  document.documentElement.toggleAttribute('data-night',on);
  const b=document.getElementById('night-toggle');
  if(b){b.hidden=!auto&&pref!=='on';b.textContent=on?'🌙 夜晚模式':'☀️ 白天模式';b.title=on?'今晚先用白天模式':'換回夜晚模式';}
}
document.getElementById('night-toggle')?.addEventListener('click',()=>{
  const on=document.documentElement.hasAttribute('data-night');
  try{localStorage.setItem('grandol_night',(on?'off':'on')+'@'+curDay());}catch(e){}
  applyNight();
});
applyNight();
// ══ 編輯彈窗 ═════════════════════════════════════
function modal(title,body,onMount){
  document.getElementById('goal-modal')?.remove();
  const m=document.createElement('div');m.className='pd-mask';m.id='goal-modal';
  m.innerHTML=`<div class="pd-box" style="width:min(460px,100%);"><div style="display:flex;align-items:center;margin-bottom:8px;">
    <div style="flex:1;font-weight:800;color:var(--tc);font-size:15px;">${title}</div>
    <button class="goal-edit" data-x="1" title="關閉">✕</button></div>${body}</div>`;
  document.body.appendChild(m);
  const close=()=>{m.remove();render(true);};
  m.addEventListener('click',e=>{if(e.target===m||e.target.closest('[data-x]'))close();});
  m.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  onMount(m,close);
}
function stageRowHTML(ms){
  return `<div class="fm-row" data-row>
    <input class="fm-in" data-f="title" value="${esc(ms.title||'')}" placeholder="階段名稱" maxlength="60"/>
    <input class="fm-in" data-f="due" value="${esc(ms.due?md(ms.due):'')}" placeholder="10/8" maxlength="10"/>
    <button type="button" class="fm-flag${ms.hard?' on':''}" data-flag title="硬期限（例如送印）">🚩</button>
    <button type="button" class="fm-del" data-del title="刪除這段">✕</button>
    <input type="hidden" data-f="id" value="${esc(ms.id||'')}"/></div>`;
}
function openProjectEditor(g){
  const ms=(g.milestones||[]).length?g.milestones:[{title:''},{title:''},{title:''}];
  modal(`編輯：${esc(g.title)}`,`
    <div class="fm-lbl">名稱／截止日</div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 96px;gap:6px;">
      <input class="fm-in" id="ge-title" value="${esc(g.title)}" maxlength="60"/>
      <input class="fm-in" id="ge-due" value="${esc(g.dueDate?md(g.dueDate):'')}" placeholder="10/10" maxlength="10"/></div>
    <div class="fm-lbl">分類／備註（選填）</div>
    <div style="display:grid;grid-template-columns:110px minmax(0,1fr);gap:6px;">
      <input class="fm-in" id="ge-group" value="${esc(g.group||'')}" placeholder="例如：生活影片" maxlength="12"/>
      <input class="fm-in" id="ge-note" value="${esc(g.note||'')}" placeholder="例如：這個很花時間" maxlength="200"/></div>
    <div class="fm-lbl">階段（日期可以不填 · 🚩＝硬期限，例如送印）</div>
    <div id="ge-rows">${ms.map(stageRowHTML).join('')}</div>
    <button type="button" class="focus-btn" id="ge-add" style="margin-top:2px;">＋ 新增一段</button>
    <button type="button" class="focus-btn" id="ge-spread" style="margin-top:2px;">沒填日期的平均分配</button>
    <div class="fm-hint">小技巧：在名稱後面直接打日期也可以，例如「送印 10/8」。</div>
    <div class="fm-lbl">今天這一步／沒電版本</div>
    <input class="fm-in" id="ge-next" value="${esc(g.next?.text||'')}" placeholder="今天要做的那一小步" maxlength="200" style="margin-bottom:6px;"/>
    <input class="fm-in" id="ge-small" value="${esc(g.next?.small||'')}" placeholder="沒電時：例如只修 3 張關鍵格" maxlength="200"/>
    <div class="fm-actions">
      <select class="fm-in" id="ge-status" style="width:auto;">${['active','paused','complete','archived'].map((x,i)=>`<option value="${x}"${g.status===x?' selected':''}>${['進行中','暫停','已完成','封存'][i]}</option>`).join('')}</select>
      <button class="focus-btn primary" id="ge-save" style="margin-left:auto;">儲存</button></div>`,
  (m,close)=>{
    const rowsBox=m.querySelector('#ge-rows');
    const bindRow=r=>{
      r.querySelector('[data-flag]').addEventListener('click',e=>e.currentTarget.classList.toggle('on'));
      r.querySelector('[data-del]').addEventListener('click',()=>r.remove());
      // 名稱後面打日期 → 自動搬到日期欄
      r.querySelector('[data-f="title"]').addEventListener('blur',e=>{
        const mm=e.target.value.match(/^(.*?)[\s　]+(\d{1,2}\s*[\/\-.月]\s*\d{1,2}\s*日?)$/);
        if(mm&&parseMD(mm[2])){e.target.value=mm[1];r.querySelector('[data-f="due"]').value=mm[2];}
      });
    };
    rowsBox.querySelectorAll('[data-row]').forEach(bindRow);
    m.querySelector('#ge-add').addEventListener('click',()=>{
      rowsBox.insertAdjacentHTML('beforeend',stageRowHTML({}));const r=rowsBox.lastElementChild;bindRow(r);r.querySelector('input').focus();
    });
    m.querySelector('#ge-spread').addEventListener('click',()=>{
      const due=parseMD(m.querySelector('#ge-due').value);
      if(!due){softToast('先填截止日，才能平均分配',2600);return;}
      const rows=[...rowsBox.querySelectorAll('[data-row]')].filter(r=>r.querySelector('[data-f="title"]').value.trim());
      // 每一段沒填日期的，照它前後有日期的段落之間平均分（沒有前一段就從今天開始）
      let prev=curDay(),i=0;
      while(i<rows.length){
        const dv=rows[i].querySelector('[data-f="due"]').value;
        if(dv&&parseMD(dv)){prev=parseMD(dv);i++;continue;}
        let j=i;while(j<rows.length&&!parseMD(rows[j].querySelector('[data-f="due"]').value))j++;
        const end=j<rows.length?parseMD(rows[j].querySelector('[data-f="due"]').value):due;
        const span=Math.max(0,daysBetween(prev,end)),n=j-i+(j<rows.length?1:0);
        for(let k=i;k<j;k++){const dd=shiftDay(prev,Math.round(span*(k-i+1)/(n||1)));rows[k].querySelector('[data-f="due"]').value=md(dd);}
        prev=j<rows.length?end:due;i=j;
      }
      softToast('排好了，可以再微調 ✓',2200);
    });
    m.querySelector('#ge-save').addEventListener('click',()=>{
      const title=m.querySelector('#ge-title').value.trim();
      if(!title){softToast('目標要有名字',2400);return;}
      const dueRaw=m.querySelector('#ge-due').value,due=dueRaw.trim()?parseMD(dueRaw):'';
      if(due===null){m.querySelector('#ge-due').classList.add('bad');softToast('截止日看不懂，打成 10/10 這樣就好',2800);return;}
      const old=g.milestones||[],list=[];let bad=false;
      m.querySelectorAll('[data-row]').forEach(r=>{
        const t=cleanTitle(r.querySelector('[data-f="title"]').value);if(!t)return;
        const dr=r.querySelector('[data-f="due"]'),dv=dr.value.trim()?parseMD(dr.value):'';
        if(dv===null){dr.classList.add('bad');bad=true;return;}
        const id=r.querySelector('[data-f="id"]').value;
        const o=old.find(x=>x.id&&x.id===id)||old.find(x=>x.title===t);
        list.push({...(o||{id:uid(),done:false}),title:t,due:dv||'',hard:r.querySelector('[data-flag]').classList.contains('on')});
      });
      if(bad){softToast('有日期看不懂（紅框），打成 10/8 這樣就好',2800);return;}
      g.title=title;setDue(g,due);g.milestones=list;g.status=m.querySelector('#ge-status').value;
      g.group=m.querySelector('#ge-group').value.trim();g.note=m.querySelector('#ge-note').value.trim();
      const text=m.querySelector('#ge-next').value.trim(),small=m.querySelector('#ge-small').value.trim();
      if(!g.next||g.next.text!==text){
        const oldId=g.next&&g.next.id,keepId=!!(oldId&&g.next.text&&text);
        g.next={id:keepId?oldId:uid(),text,small};
        if(keepId){   // 已經排進便利貼的那一步，改字時跟著改，不會變成兩筆
          const upd=r=>r.id===oldId?{...r,theme:g.title,task:text}:r;
          setTodayTDL((S.todayTDL||[]).map(upd));S.tomorrowTDL=(S.tomorrowTDL||[]).map(upd);
          if((S.todayTDL||[]).some(r=>r.id===oldId)){writeDraftEntry(true);markDirty('e:'+curDay());syncEntryFor(curDay()).catch(()=>{});}
          renderStickyNote();
        }
      }else g.next.small=small;
      g.updatedAt=Date.now();sv(S);syncStateDebounced();close();softToast('存好了 ✓',2000);
    });
  });
}
function metricRowHTML(m){
  const src=m.src||'manual';
  return `<div class="fm-row mt-row" data-mrow style="grid-template-columns:minmax(0,1fr) 54px auto 26px;">
    <input class="fm-in" data-f="l" value="${esc(m.l||'')}" placeholder="例如：喝水 2000" maxlength="16"/>
    <input class="fm-in" data-f="unit" value="${esc(m.unit||'次')}" maxlength="3" title="單位"/>
    <div class="fm-step" style="margin:0;"><button type="button" data-dec>−</button><span class="fs-n" data-f="target">${+m.target||0}</span><button type="button" data-inc>＋</button></div>
    <button type="button" class="fm-del" data-del title="刪除這一項">✕</button>
    <input type="hidden" data-f="k" value="${esc(m.k||'')}"/><input type="hidden" data-f="src" value="${esc(src)}"/>
    <div class="fm-hint" style="grid-column:1/-1;margin:-2px 0 4px;">${SRC_LABEL[src]||''}</div></div>`;
}
function moveRowHTML(x){
  return `<div class="fm-row" data-vrow style="grid-template-columns:minmax(0,1fr) 92px 26px;">
    <input class="fm-in" data-f="t" value="${esc(x.t||'')}" placeholder="例如：瑜伽" maxlength="10"/>
    <label class="fm-in" style="display:flex;align-items:center;gap:4px;"><input data-f="m" type="number" min="0" max="300" step="5" value="${+x.m||0}" style="width:44px;border:none;background:none;font:inherit;outline:none;"/>分</label>
    <button type="button" class="fm-del" data-del title="刪除">✕</button></div>`;
}
// 運動選項存在身體目標上；目標結束了選項還是要在
function movesGoal(){return bodyGoal()||data().projects.filter(p=>p.kind==='body').sort((a,b)=>(+a.updatedAt||0)-(+b.updatedAt||0)).at(-1)||null;}
function tagRowHTML(t){
  return `<div class="fm-row" data-trow style="grid-template-columns:minmax(0,1fr) 96px 26px;">
    <input class="fm-in" data-f="l" value="${esc(t.l||'')}" placeholder="例如：吉他課" maxlength="10"/>
    <label class="fm-hint" style="display:flex;align-items:center;gap:4px;margin:0;"><input type="checkbox" data-f="rest"${t.rest?' checked':''}/>不計目標</label>
    <button type="button" class="fm-del" data-del title="刪除">✕</button></div>`;
}
function movesOf(g){return g&&Array.isArray(g.moves)?g.moves.filter(x=>x&&x.t):MOVES;}
function bindRows(box,sel){
  box.querySelectorAll(sel).forEach(r=>{
    r.querySelector('[data-del]').onclick=()=>r.remove();
    const n=r.querySelector('[data-f="target"]');
    if(n){r.querySelector('[data-inc]').onclick=()=>{n.textContent=Math.min(7,(+n.textContent||0)+1);};
          r.querySelector('[data-dec]').onclick=()=>{n.textContent=Math.max(0,(+n.textContent||0)-1);};}
  });
}
function readMoves(m){
  return [...m.querySelectorAll('[data-vrow]')].map(r=>({t:r.querySelector('[data-f="t"]').value.trim(),m:Math.max(0,Math.min(300,+r.querySelector('[data-f="m"]').value||0))})).filter(x=>x.t);
}
function openBodyEditor(g){
  modal(`編輯：${esc(g.title)}`,`
    <div class="fm-lbl">名稱／日期／那一天是</div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 80px minmax(0,1fr);gap:6px;">
      <input class="fm-in" id="gb-title" value="${esc(g.title)}" maxlength="60"/>
      <input class="fm-in" id="gb-due" value="${esc(g.dueDate?md(g.dueDate):'')}" placeholder="10/31" maxlength="10"/>
      <input class="fm-in" id="gb-event" value="${esc(g.event||'')}" placeholder="例如：見朋友" maxlength="20"/></div>
    <div class="fm-lbl">每週要做到的項目（名字、單位、每週幾次都能改；0＝先不追）</div>
    <div id="gb-metrics">${metricsOf(g).map(metricRowHTML).join('')}</div>
    <button type="button" class="focus-btn" id="gb-add">＋ 新增一項（在體態卡上自己打勾）</button>
    <div class="fm-lbl">體重：每月想減幾公斤（0＝先不追；看的是平均，不是一天的數字）</div>
    <input class="fm-in" id="gb-wpm" value="${g.weightPerMonth===undefined?1:esc(String(g.weightPerMonth))}" maxlength="4" style="width:90px;"/>
    <div class="fm-lbl">「今天也做了」的運動選項（點一下就記，分鐘會加進運動紀錄）</div>
    <div id="gb-moves">${movesOf(g).map(moveRowHTML).join('')}</div>
    <button type="button" class="focus-btn" id="gb-add-move">＋ 新增運動</button>
    <div class="fm-actions">
      <select class="fm-in" id="gb-status" style="width:auto;">${['active','paused','complete','archived'].map((x,i)=>`<option value="${x}"${g.status===x?' selected':''}>${['進行中','暫停','已完成','封存'][i]}</option>`).join('')}</select>
      <button class="focus-btn primary" id="gb-save" style="margin-left:auto;">儲存</button></div>`,
  (m,close)=>{
    const mb=m.querySelector('#gb-metrics'),vb=m.querySelector('#gb-moves');
    bindRows(mb,'[data-mrow]');bindRows(vb,'[data-vrow]');
    m.querySelector('#gb-add').addEventListener('click',()=>{mb.insertAdjacentHTML('beforeend',metricRowHTML({k:'',l:'',unit:'次',target:3,src:'manual'}));bindRows(mb,'[data-mrow]');mb.lastElementChild.querySelector('input').focus();});
    m.querySelector('#gb-add-move').addEventListener('click',()=>{vb.insertAdjacentHTML('beforeend',moveRowHTML({t:'',m:20}));bindRows(vb,'[data-vrow]');vb.lastElementChild.querySelector('input').focus();});
    m.querySelector('#gb-save').addEventListener('click',()=>{
      const title=m.querySelector('#gb-title').value.trim();if(!title){softToast('目標要有名字',2400);return;}
      const raw=m.querySelector('#gb-due').value,due=raw.trim()?parseMD(raw):'';
      if(due===null){m.querySelector('#gb-due').classList.add('bad');softToast('日期看不懂，打成 10/31 這樣就好',2800);return;}
      const metrics=[...m.querySelectorAll('[data-mrow]')].map(r=>({k:r.querySelector('[data-f="k"]').value||('m'+uid().replace(/-/g,'').slice(0,8)),
        l:r.querySelector('[data-f="l"]').value.trim(),unit:r.querySelector('[data-f="unit"]').value.trim()||'次',
        target:+r.querySelector('[data-f="target"]').textContent||0,src:r.querySelector('[data-f="src"]').value||'manual'})).filter(x=>x.l);
      g.title=title;setDue(g,due);g.event=m.querySelector('#gb-event').value.trim();g.status=m.querySelector('#gb-status').value;
      g.metrics=metrics;g.moves=readMoves(m);
      {const w=parseFloat(m.querySelector('#gb-wpm').value);g.weightPerMonth=Number.isFinite(w)&&w>=0&&w<=10?Math.round(w*10)/10:1;}
      // 舊版 App 只認得 targets：內建的三項同步寫一份
      g.targets={move:0,shoulder:0,bed:0};metrics.forEach(x=>{if(x.src in g.targets)g.targets[x.src]=x.target;});
      g.updatedAt=Date.now();sv(S);syncStateDebounced();close();softToast('存好了 ✓',2000);
    });
  });
}
// 「今天也做了」卡的 ✏️：只編運動選項；習慣在「方向」開關
function openMovesEditor(){
  const g=movesGoal();
  if(!g){softToast('先在「方向」新增一個身體目標，才有運動選項',2800);return;}
  modal('今天也做了 · 狀況',`
    <div class="fm-lbl">運動選項（點一下就記，分鐘會加進運動紀錄）</div>
    <div id="gb-moves">${movesOf(g).map(moveRowHTML).join('')}</div>
    <button type="button" class="focus-btn" id="gb-add-move">＋ 新增運動</button>
    <div class="fm-lbl">今天狀況（勾「不計目標」＝那天不算進每週目標）</div>
    <div id="gm-tags">${tagsOf(g).map(tagRowHTML).join('')}</div>
    <button type="button" class="focus-btn" id="gm-add-tag">＋ 新增狀況</button>
    <div class="fm-lbl">習慣</div>
    <div class="fm-hint">習慣的開關在「方向」頁，關掉的不會出現在這裡，紀錄都保留。</div>
    <div class="fm-actions"><button class="focus-btn" id="gm-habits">到「方向」管理習慣</button>
      <button class="focus-btn primary" id="gm-save" style="margin-left:auto;">儲存</button></div>`,
  (m,close)=>{
    const vb=m.querySelector('#gb-moves');bindRows(vb,'[data-vrow]');
    m.querySelector('#gb-add-move').addEventListener('click',()=>{vb.insertAdjacentHTML('beforeend',moveRowHTML({t:'',m:20}));bindRows(vb,'[data-vrow]');vb.lastElementChild.querySelector('input').focus();});
    const tb=m.querySelector('#gm-tags');bindRows(tb,'[data-trow]');
    m.querySelector('#gm-add-tag').addEventListener('click',()=>{tb.insertAdjacentHTML('beforeend',tagRowHTML({l:''}));bindRows(tb,'[data-trow]');tb.lastElementChild.querySelector('input').focus();});
    m.querySelector('#gm-habits').addEventListener('click',()=>{close();document.querySelector('.nav-btn[data-page="direction"]')?.click();});
    m.querySelector('#gm-save').addEventListener('click',()=>{g.moves=readMoves(m);g.dayTags=[...m.querySelectorAll('[data-trow]')].map(r=>({l:r.querySelector('[data-f="l"]').value.trim(),rest:r.querySelector('[data-f="rest"]').checked})).filter(x=>x.l);g.updatedAt=Date.now();sv(S);syncStateDebounced();close();softToast('存好了 ✓',2000);});
  });
}
function stepRowHTML(x){
  return `<div class="fm-row" data-srow style="grid-template-columns:minmax(0,1fr) 110px 26px;">
    <input class="fm-in" data-f="label" value="${esc(x.label||'')}" placeholder="例如：戴牙套" maxlength="20"/>
    <input class="fm-in" type="time" data-f="at" value="${esc(x.at||'20:00')}"/>
    <button type="button" class="fm-del" data-del title="刪除這一步">✕</button>
    <input type="hidden" data-f="k" value="${esc(x.k||'')}"/><input type="hidden" data-f="id" value="${esc(x.id||'')}"/></div>`;
}
function openPlanEditor(){
  const p=C.planFor(data(),ds());
  const wantSh=wantsShoulder();
  const base=p?(Array.isArray(p.steps)?p.steps:baseSteps(p,wantSh)):baseSteps({phone:'00:30'},wantSh);
  const rows=[...base.map(x=>({...x})),...(p?.extras||[]).map(x=>({...x,k:''}))].sort((a,b)=>C.targetAt(today(),a.at)-C.targetAt(today(),b.at));
  modal('今晚的流程',`
    <div class="fm-lbl">幾點收手機、上床、起床</div>
    <div class="goal-chips">${C.stages.map(x=>`<button type="button" class="focus-btn${p&&p.bed===x.bed&&p.phone===x.phone?' done':''}" data-stage="${x.id}">${x.bed} 上床</button>`).join('')}</div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;font-size:11px;color:var(--tc2);margin-top:8px;">
      <label>收手機<input class="fm-in" type="time" id="gp-phone" value="${esc(p?.phone||'00:30')}"/></label>
      <label>上床<input class="fm-in" type="time" id="gp-bed" value="${esc(p?.bed||'01:00')}"/></label>
      <label>起床<input class="fm-in" type="time" id="gp-wake" value="${esc(p?.wake||'08:30')}"/></label></div>
    <div class="fm-lbl">收手機之前的每一步（名字、時間都可以改；不要的按 ✕）</div>
    <div id="gp-steps">${rows.map(stepRowHTML).join('')}</div>
    <div class="goal-chips"><button type="button" class="focus-btn" id="gp-add">＋ 新增一步</button>
      <button type="button" class="focus-btn" id="gp-reset" title="收工＝收手機前 60 分、肩背＝前 50 分、洗澡＝前 20 分">照收手機時間重排</button></div>
    <div class="fm-hint">「收手機」和「上床」固定在最後，時間在上面改。今晚起生效，之前的紀錄不會變。</div>
    <div class="fm-actions"><button class="focus-btn" id="gp-pause">${p?.status==='paused'?'恢復練習':'先暫停'}</button>
      <button class="focus-btn primary" id="gp-save" style="margin-left:auto;">儲存</button></div>`,
  (m,close)=>{
    const box=m.querySelector('#gp-steps');
    const bindRow=r=>{
      r.querySelector('[data-del]').addEventListener('click',()=>r.remove());
      r.querySelector('[data-f="at"]').addEventListener('input',()=>{r.dataset.touched='1';});
    };
    box.querySelectorAll('[data-srow]').forEach(bindRow);
    // 收手機時間一改，還沒手動改過時間的內建步驟跟著平移
    const phoneIn=m.querySelector('#gp-phone');let lastPhone=phoneIn.value;
    const shiftBuiltins=()=>{
      if(!C.validTime(phoneIn.value)||!C.validTime(lastPhone))return;
      const diff=toMin(phoneIn.value)-toMin(lastPhone);lastPhone=phoneIn.value;if(!diff)return;
      box.querySelectorAll('[data-srow]').forEach(r=>{
        if(!r.querySelector('[data-f="k"]').value||r.dataset.touched)return;
        const at=r.querySelector('[data-f="at"]');if(C.validTime(at.value))at.value=hm(toMin(at.value)+diff);
      });
    };
    phoneIn.addEventListener('change',shiftBuiltins);
    m.querySelector('#gp-add').addEventListener('click',()=>{box.insertAdjacentHTML('beforeend',stepRowHTML({}));const r=box.lastElementChild;bindRow(r);r.querySelector('input').focus();});
    m.querySelector('#gp-reset').addEventListener('click',()=>{
      const ph=phoneIn.value;if(!C.validTime(ph))return;
      const keep=[...box.querySelectorAll('[data-srow]')].filter(r=>!r.querySelector('[data-f="k"]').value);
      box.innerHTML=baseSteps({phone:ph},wantSh).map(stepRowHTML).join('');
      keep.forEach(r=>box.appendChild(r));
      box.querySelectorAll('[data-srow]').forEach(r=>{if(r.querySelector('[data-f="k"]').value)bindRow(r);});
      softToast('照收手機時間重排了',1800);
    });
    m.querySelectorAll('[data-stage]').forEach(b=>b.addEventListener('click',()=>{
      const st=C.stages.find(x=>x.id===b.dataset.stage);
      phoneIn.value=st.phone;shiftBuiltins();m.querySelector('#gp-bed').value=st.bed;m.querySelector('#gp-wake').value=st.wake;
      m.querySelectorAll('[data-stage]').forEach(x=>x.classList.toggle('done',x===b));
    }));
    const push=status=>{
      const ph=phoneIn.value,bd=m.querySelector('#gp-bed').value,wk=m.querySelector('#gp-wake').value;
      if(![ph,bd,wk].every(C.validTime)){softToast('時間格式怪怪的',2400);return false;}
      if(C.targetAt(today(),ph)>C.targetAt(today(),bd)){softToast('收手機要在上床之前喔',2600);return false;}
      const st=C.stages.find(x=>x.phone===ph&&x.bed===bd);
      const all=[...m.querySelectorAll('[data-srow]')].map(r=>({k:r.querySelector('[data-f="k"]').value,id:r.querySelector('[data-f="id"]').value,
        label:r.querySelector('[data-f="label"]').value.trim(),at:r.querySelector('[data-f="at"]').value})).filter(x=>x.label&&C.validTime(x.at));
      const steps=all.filter(x=>x.k).map(x=>({k:x.k,label:x.label,at:x.at}));
      const extras=all.filter(x=>!x.k).map(x=>({id:x.id||uid(),label:x.label,at:x.at}));
      data().revisions.push({id:uid(),stageId:st?st.id:'custom',effectiveFrom:today(),phone:ph,bed:bd,wake:wk,status,steps,extras,updatedAt:Date.now()});
      sv(S);syncStateDebounced();return true;
    };
    m.querySelector('#gp-save').addEventListener('click',()=>{if(push('active')){close();softToast('今晚照這個流程 🌙',2200);}});
    m.querySelector('#gp-pause').addEventListener('click',()=>{if(push(p?.status==='paused'?'active':'paused'))close();});
  });
}
// 一次貼上多個目標：貼文字 → 預覽（每一格都能改）→ 加入
function openQuickGoals(){
  const ph='例如：\n1.作品A(11月底做完)\n2.作品B(12/31)\n3.作品C(明年五月，工程很大)\n---\n生活影片\n1.送朋友的禮物(11/14)\n2.送媽媽的禮物(明年過年前)';
  modal('一次貼上多個目標',`
    <div class="fm-hint">一行一個目標。括號裡寫日期：「11/14」「11月底」「明年五月」「過年前」都看得懂；沒有編號的一行會當成分類。</div>
    <textarea class="fm-in" id="qg-text" rows="9" style="width:100%;resize:vertical;line-height:1.6;" placeholder="${esc(ph)}"></textarea>
    <div class="fm-actions"><button class="focus-btn primary" id="qg-parse" style="margin-left:auto;">整理看看</button></div>
    <div id="qg-preview"></div>`,
  (m,close)=>{
    const box=m.querySelector('#qg-preview'),ta=m.querySelector('#qg-text');
    const rowHTML=r=>`<div class="qg-row" data-qrow>
      <div class="qg-1"><input class="fm-in" data-f="title" value="${esc(r.title)}" maxlength="60" placeholder="目標名稱"/>
        <input class="fm-in" data-f="due" value="${r.due?(r.due.slice(0,4)!==curDay().slice(0,4)?r.due.slice(0,4)+'/':'')+md(r.due):''}" placeholder="日期" maxlength="12" title="打 11/14 這樣；明年的寫 2027/5/31"/>
        <button type="button" class="fm-del" data-del title="不要這個">✕</button></div>
      <div class="qg-2"><input class="fm-in" data-f="group" value="${esc(r.group)}" maxlength="12" placeholder="分類"/>
        <input class="fm-in" data-f="note" value="${esc(r.note)}" maxlength="200" placeholder="備註（選填）"/></div>
      <input type="hidden" data-f="fulldue" value="${esc(r.due)}"/></div>`;
    m.querySelector('#qg-parse').addEventListener('click',()=>{
      const rows=C.parseGoalLines(ta.value,curDay());
      if(!rows.length){softToast('沒有看到目標，一行寫一個',2400);return;}
      box.innerHTML=`<div class="fm-lbl">看看對不對（日期、名稱都能直接改）</div>${rows.map(rowHTML).join('')}
        <div class="fm-hint">加入後，有日期的目標會在 Google 日曆放一個「🏁 截止」；階段之後再拆也可以。</div>
        <div class="fm-actions"><button class="focus-btn primary" id="qg-add" style="margin-left:auto;">加入這些目標</button></div>`;
      box.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>b.closest('[data-qrow]').remove()));
      box.querySelectorAll('[data-f="due"]').forEach(inp=>inp.addEventListener('input',()=>{inp.closest('[data-qrow]').querySelector('[data-f="fulldue"]').value='';}));
      box.querySelector('#qg-add').addEventListener('click',()=>{
        const made=[];let bad=false;
        box.querySelectorAll('[data-qrow]').forEach(r=>{
          const f=k=>r.querySelector(`[data-f="${k}"]`).value.trim();
          if(!f('title'))return;
          let due=f('fulldue');                       // 沒改過日期就用整理好的完整日期（含年份）
          if(!due){const raw=f('due');due=raw?parseMD(raw):'';}
          if(due===null){r.querySelector('[data-f="due"]').classList.add('bad');bad=true;return;}
          made.push({id:uid(),kind:'project',title:f('title'),dueDate:due||'',event:'',status:'active',group:f('group'),note:f('note'),
            milestones:[],next:{id:uid(),text:'',small:''},startOn:curDay(),createdAt:Date.now(),updatedAt:Date.now()});
        });
        if(bad){softToast('有日期看不懂（紅框），打成 11/14 這樣就好',2800);return;}
        if(!made.length){softToast('沒有可以加入的',2000);return;}
        data().projects.push(...made);sv(S);syncStateDebounced();
        focusGoalOn(projectGoals()[0].id);close();softToast(`加入 ${made.length} 個目標 ✓`,2600);
      });
    });
    ta.focus();
  });
}
// 常用四階段：從今天到截止日平均排開（沒有階段時，展開的清單底下會出現這個按鈕）
function applyStageTemplate(g){
  const d=curDay();if(!g.dueDate){softToast('先設截止日，才能把階段排開',2600);return;}
  const names=['準備素材','初稿','修改','完成輸出'],total=Math.max(0,daysBetween(d,g.dueDate));
  g.milestones=names.map((t,i)=>({id:uid(),title:t,done:false,due:shiftDay(d,Math.round(total*(i+1)/names.length)),hard:i===names.length-1}));
  saveGoal(g);softToast('排好了，日期可以直接改。日曆也會放上去',3200);
}
function openMore(){
  const f=data(),archived=f.projects.filter(x=>x.status==='archived'||x.status==='complete');
  const cloud=!GAS_URL?'目前只存在這台裝置。':(cloudSupported===false?'⚠️ 後端還是舊版，目標還沒同步到雲端。':'');
  modal('新增目標・封存・備份',`
    ${cloud?`<div class="fm-hint" style="color:#B0602A;">${esc(cloud)}</div>`:''}
    <div class="fm-lbl">新增目標</div>
    <div class="goal-chips"><button class="focus-btn primary" id="gm-quick">＋ 一次貼上多個目標</button></div>
    <div class="goal-chips" style="margin-top:6px;"><button class="focus-btn" data-new="project">🎬 作品型（有階段）</button><button class="focus-btn" data-new="body">🏃 身體型（每週次數）</button></div>
    ${archived.length?`<div class="fm-lbl">已完成／封存（點一下恢復）</div><div class="goal-chips">${archived.map(x=>`<button class="focus-btn" data-restore="${esc(x.id)}">${esc(x.title)}</button>`).join('')}</div>`:''}
    <div class="fm-lbl">備份</div>
    <div class="goal-chips" style="align-items:center;"><button class="focus-btn" id="gm-export">下載完整備份</button>
      <label class="fm-hint">還原目標與睡前紀錄 <input id="focus-import" type="file" accept="application/json,.json"/></label></div>`,
  (m,close)=>{
    m.querySelector('#gm-quick').addEventListener('click',()=>{m.remove();openQuickGoals();});
    m.querySelectorAll('[data-new]').forEach(b=>b.addEventListener('click',()=>{
      const isBody=b.dataset.new==='body';
      const g={id:uid(),kind:isBody?'body':'project',title:isBody?'新的身體目標':'新的作品',dueDate:'',event:'',status:'active',
        milestones:[],next:isBody?null:{id:uid(),text:'',small:''},targets:isBody?{move:3,shoulder:0,bed:0}:undefined,metrics:isBody?BODY_METRICS.map(x=>({k:x.k,l:x.l,unit:x.unit,target:x.k==='move'?3:0,src:x.k})):undefined,startOn:curDay(),createdAt:Date.now(),updatedAt:Date.now()};
      data().projects.push(g);sv(S);syncStateDebounced();m.remove();
      (isBody?openBodyEditor:openProjectEditor)(g);
    }));
    m.querySelectorAll('[data-restore]').forEach(b=>b.addEventListener('click',()=>{
      const g=data().projects.find(x=>x.id===b.dataset.restore);if(g){g.status='active';delete g.closure;g.updatedAt=Date.now();sv(S);syncStateDebounced();}close();
    }));
    m.querySelector('#gm-export').addEventListener('click',()=>{
      if(typeof flushAutoDraft==='function')flushAutoDraft();
      const blob=new Blob([JSON.stringify({format:'grandol-focus-backup',version:1,exportedAt:new Date().toISOString(),state:S},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='forest-backup-'+today()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    m.querySelector('#focus-import').addEventListener('change',async ev=>{
      const el=ev.target;if(!el.files[0])return;
      try{
        if(el.files[0].size>20*1024*1024)throw new Error('檔案過大');
        const b=JSON.parse(await el.files[0].text());
        if(b.format!=='grandol-focus-backup'||b.version!==1||!b.state||!Array.isArray(b.state.entries))throw new Error('不支援的備份格式');
        const records=b.state.entries.filter(e=>C.validDate(e.date)&&e.date<=today()&&e.health?.sleep?.windDown).map(e=>[e.date,e.health.sleep.windDown]);
        if(!confirm('合併備份裡的目標與較新的睡前紀錄？日記、待辦和其他健康紀錄不會被覆寫。'))return;
        S.focus=C.merge(S.focus,b.state.focus);
        for(const [day,w] of records){
          if(!w.targetSnapshot||!C.validTime(w.targetSnapshot.bed)||!Number.isFinite(Date.parse(w.targetSnapshot.bedAt)))continue;
          if([w.inBedAt,w.phoneAwayAt].some(x=>x&&!Number.isFinite(Date.parse(x))))continue;
          const h=health(day);h.sleep=h.sleep||{};
          if((+w.updatedAt||0)>(+h.sleep.windDown?.updatedAt||0)){h.sleep.windDown=w;saveHealth(day,h);}
        }
        sv(S);syncStateDebounced();close();softToast('已合併目標與睡前紀錄 ✓',2600);
      }catch(e){softToast('無法還原：'+e.message,3200);}
    });
  });
}
// ══ 首頁上的操作 ═════════════════════════════════
function onMounts(type,fn){mounts.forEach(m=>m.addEventListener(type,fn));}
function ensureStepInToday(g){
  const c=stickyCtx();
  const i=c.items.findIndex(x=>x.id===g.next.id);
  if(i>=0)return i;
  const row={id:g.next.id,goalId:g.id,theme:g.title,task:g.next.text,c:0};
  if(c.todayMode){
    // 目標的這一步放在清單最上面（完成狀態依「身分」對應，不會因為位置變了而勾錯）
    setTodayTDL([row,...c.items]);todayListEdited=true;markTodayListEdited();
    writeDraftEntry(true);markDirty('e:'+ds());syncEntryFor(ds()).catch(()=>{});
  }else{
    const e=getOrCreateEntry(ds());
    e.tdlItems=buildTdlSnapshot([...c.items,row],c.done);
    e.tdlTotal=e.tdlItems.length;e.tdlDone=e.tdlItems.filter(x=>x.done).length;e.savedAt=Date.now();
    markDirty('e:'+ds());syncEntryFor(ds()).catch(()=>{});
  }
  sv(S);renderStickyNote();
  return stickyCtx().items.findIndex(x=>x.id===g.next.id);
}
function addStepTomorrow(g){
  if(typeof tdlRows==='undefined'||!g.next||!g.next.text)return;
  if(tdlRows.some(r=>r.id===g.next.id))return;
  const blank=tdlRows.findIndex(r=>!r.theme&&!r.task);
  const row={id:g.next.id,goalId:g.id,theme:g.title,task:g.next.text,confirmed:true,c:0};
  if(blank>=0)tdlRows[blank]=row;else tdlRows.push(row);
  tdlPlanEdited=true;persistTdlEdit();renderTDL();
}
function setNext(g,text){
  text=(text||'').trim();if(!text)return;
  document.activeElement?.blur();
  g.next={id:uid(),text,small:(g.next&&g.next.small)||''};
  justDone='';saveGoal(g);
  if(isEvening()){addStepTomorrow(g);softToast('排到明天了 🌙',2200);}
  else{ensureStepInToday(g);softToast('放進今天要做 ✅',2200);}
  render(true);
}
function doStep(k){
  const d=ds();
  // 補做了跳過的步驟 → 跳過標記清掉
  {const h0=health(d);if(h0.night&&h0.night.skip&&h0.night.skip[k]){h0.night={...h0.night,skip:{...h0.night.skip}};delete h0.night.skip[k];}}
  if(k==='phone'||k==='bed'){
    const key=k==='phone'?'phoneAwayAt':'inBedAt',w=health(d).sleep?.windDown||{};
    if(w[key]||d!==curDay()){editing=k;render(true);return;}
    updateWind(d,x=>{x[key]=new Date().toISOString();});
    if(k==='bed'&&C.result(health(d).sleep.windDown,C.planFor(data(),d),d,new Date()).kind==='onTime')autoHabit('sleep');
    softToast(k==='phone'?'📱 手機收好了，故事留到明天':'🛏 晚安',2400);return;
  }
  const h=health(d);
  if(k==='shoulder'){h.body={...(h.body||{})};if(h.body.shoulder)delete h.body.shoulder;else h.body.shoulder=Date.now();saveHealth(d,h);if(h.body.shoulder)softToast('💪 肩背完成',1800);return;}
  h.night={...(h.night||{})};
  if(h.night[k])delete h.night[k];else h.night[k]=Date.now();
  saveHealth(d,h);
}
onMounts('click',ev=>{
  const el=ev.target.closest('[data-action],[data-move],[data-ms],[data-ms-flag],[data-ms-del],[data-edit-goal],[data-step],[data-skip],[data-postpone],[data-metric],[data-metric-set],[data-metric-keep],[data-day-tag]');
  if(!el)return;
  if(el.tagName==='A')ev.preventDefault();
  if(el.dataset.editGoal){const g=data().projects.find(x=>x.id===el.dataset.editGoal);if(g)(g.kind==='body'?openBodyEditor:openProjectEditor)(g);return;}
  const a=el.dataset.action;
  if(a==='hero-ms'){try{localStorage.setItem('grandol_hero_ms',heroOpen()?'0':'1');}catch(e){}render(true);return;}
  if(a==='edit-plan'){openPlanEditor();return;}
  if(a==='focus-goal'){focusGoalOn(el.dataset.g);render(true);return;}
  if(a==='pl-fold'){const k=el.dataset.k;if(plOpenSet.has(k))plOpenSet.delete(k);else plOpenSet.add(k);render(true);return;}
  if(a==='others-toggle'){try{localStorage.setItem('grandol_others_all',localStorage.getItem('grandol_others_all')==='1'?'0':'1');}catch(e){}render(true);return;}
  if(a==='cp-toggle'){const k=el.dataset.k;if(cpOpenSet.has(k))cpOpenSet.delete(k);else cpOpenSet.add(k);render(true);return;}
  if(a==='plan-import'){if(writable())openPlanImport();return;}
  if(a==='rhy-edit'){if(writable())openRhythmEditor();return;}
  if(a==='rhy-later'){if(rhyLaterOpen.has('later'))rhyLaterOpen.delete('later');else rhyLaterOpen.add('later');render(true);return;}
  if(a==='rhy-tap'){
    if(!writable())return;const pl=planOf(),it=pl&&pl.items.find(x=>x.id===el.dataset.id);if(!it)return;
    const day=ds(),h=health(day),cur=(h.rhythm||{})[it.id],lv=el.dataset.lv;
    const auto=C.itemDay(it,rhyCtx(it,day),undefined)[lv];
    if(auto&&cur!==lv){softToast('這個已經從紀錄自動算到了',2000);return;}
    const rh={...(h.rhythm||{})};
    if(cur===lv)delete rh[it.id];else rh[it.id]=lv;
    h.rhythm=rh;saveHealth(day,h);return;
  }
  if(a==='cp-ok'||a==='cp-no'||a==='cp-undo'){
    if(!writable())return;const {g,c}=cpOf(el);if(!g||!c)return;
    if(a==='cp-undo'){delete c.result;}else c.result={ok:a==='cp-ok',on:curDay()};
    c.updatedAt=Date.now();saveGoal(g);
    if(a==='cp-ok')softToast('記下了：達標 ✓',1800);else if(a==='cp-no')softToast('沒關係，照退路走，不用重新想',2800);return;
  }
  if(a==='cp-sp-due'){   // 重算的日期不會自動套用；按了才改（setDue 會留改期紀錄，日曆同步會先刪舊的再建新的）
    if(!writable())return;const g=data().projects.find(x=>x.id===el.dataset.g);if(!g)return;
    const calc=C.speedCalc(g.speed,speedOpts(g));
    if(!calc||calc.finished||!C.validDate(calc.eta)){softToast('先把已做、總共、開始日填好',2400);return;}
    setDue(g,calc.eta);saveGoal(g);softToast(`截止日改成 ${md(calc.eta)} ✓（改期有留紀錄）`,2600);return;
  }
  if(a==='plan-add'){
    if(!writable())return;const pl=ensurePlan(),kind=el.dataset.kind,id='pl-'+uid(),now=Date.now(),d=curDay();
    if(kind==='events')pl.events=[...pl.events,{id,title:'新行程',from:d,to:d,tentative:false,updatedAt:now}];
    else pl.periods=[...pl.periods,{id,label:'新趕工週',from:d,to:shiftDay(d,6),mode:'floor',updatedAt:now}];
    savePlan();setTimeout(()=>$q(`[data-plan-f][data-id="${id}"]`)?.select(),80);return;
  }
  if(a==='plan-del'){
    if(!writable())return;const pl=planOf();if(!pl)return;const it=(pl[el.dataset.kind]||[]).find(x=>x.id===el.dataset.id);
    if(it){it.deleted=true;it.updatedAt=Date.now();savePlan();softToast('刪掉了（日曆上的也會拿掉）',2200);}return;
  }
  if(a==='todo-del'){
    if(!writable())return;const pl=planOf();const it=pl&&pl.todos.find(x=>x.id===el.dataset.id);
    if(it){it.deleted=true;it.updatedAt=Date.now();savePlan();}return;
  }
  if(a==='goal-add'){if(writable())openAddGoal();return;}
  if(a==='quick-goals'){openQuickGoals();return;}
  if(a==='stage-template'){const g=data().projects.find(x=>x.id===el.dataset.g);if(g)applyStageTemplate(g);return;}
  if(a==='tonight-toggle'){try{localStorage.setItem('grandol_tonight',tonightOpen()?'0':'1');}catch(e){}render(true);return;}
  if(a==='cal-retry'){
    const g=calOwner(el.dataset.g);if(!g)return;
    if(calSync.err[g.id])softToast('上次失敗的原因：'+calSync.err[g.id],3800);
    syncGoalCal(g);return;
  }
  if(el.dataset.postpone!==undefined){if(writable()){postponeTdlItem(+el.dataset.postpone);render(true);}return;}
  if(a==='bring-next'){const g=data().projects.find(x=>x.id===el.dataset.g);if(g&&writable()){addStepTomorrow(g);render(true);softToast('排到明天了 🌙',2000);}return;}
  if(a==='more'){openMore();return;}
  if(!writable())return;
  const d=ds();
  if(el.dataset.skip){
    const h=health(d);h.night={...(h.night||{})};h.night.skip={...(h.night.skip||{}),[el.dataset.skip]:Date.now()};
    saveHealth(d,h);softToast('沒關係，下一步就好 🌙',2000);return;
  }
  if(el.dataset.step){doStep(el.dataset.step);return;}
  if(el.dataset.dayTag){
    const h=health(d),t=el.dataset.dayTag,cur=h.dayTags||[];
    h.dayTags=cur.indexOf(t)>=0?cur.filter(x=>x!==t):[...cur,t];
    saveHealth(d,h);return;
  }
  if(el.dataset.metricSet||el.dataset.metricKeep){
    const g=data().projects.find(x=>x.id===el.dataset.g);if(!g)return;
    const list=metricsOf(g).map(x=>({...x})),m=list.find(x=>x.k===(el.dataset.metricSet||el.dataset.metricKeep));if(!m)return;
    if(el.dataset.metricSet){m.target=+el.dataset.n;softToast('目標改成 '+m.target+' '+m.unit+' ✓',2000);}else m.noSuggest=true;
    g.metrics=list;g.targets={move:0,shoulder:0,bed:0};list.forEach(x=>{if(x.src in g.targets)g.targets[x.src]=x.target;});
    saveGoal(g);return;
  }
  if(a==='goal-finish'){const g=data().projects.find(x=>x.id===el.dataset.g);if(g){g.closure={kind:'done',on:curDay(),note:''};g.status='complete';g.updatedAt=Date.now();sv(S);syncStateDebounced();softToast('🎉 '+g.title+' 完成',2600);render(true);}return;}
  if(a==='goal-close'){const g=data().projects.find(x=>x.id===el.dataset.g);if(g)openCloseGoal(g,el.dataset.kind);return;}
  if(a==='goal-redate'){$q(`[data-goal-due="${el.dataset.g}"]`)?.focus();return;}
  if(a==='goal-nodate'){const g=data().projects.find(x=>x.id===el.dataset.g);if(g){setDue(g,'');g.event='';saveGoal(g);softToast('繼續做，不倒數了 🌿',2200);}return;}
  if(el.dataset.metric){
    const h=health(d),key='m_'+el.dataset.metric;h.body={...(h.body||{})};
    if(h.body[key])delete h.body[key];else h.body[key]=Date.now();
    saveHealth(d,h);if(h.body[key])softToast('記好了 ✓',1400);return;
  }
  if(el.dataset.msFlag!==undefined||el.dataset.msDel!==undefined){
    const g=data().projects.find(x=>x.id===el.dataset.g);if(!g)return;
    const k=+(el.dataset.msFlag??el.dataset.msDel),m=g.milestones[k];if(!m)return;
    if(el.dataset.msFlag!==undefined){m.hard=!m.hard;saveGoal(g);return;}
    if(!confirm(`刪除階段「${m.title}」？`))return;
    g.milestones.splice(k,1);saveGoal(g);softToast('刪掉了',1600);return;
  }
  if(el.dataset.ms!==undefined){
    const g=data().projects.find(x=>x.id===el.dataset.g);const m=g&&g.milestones[+el.dataset.ms];if(!m)return;
    m.done=!m.done;if(m.done)m.doneOn=d;else delete m.doneOn;
    saveGoal(g);
    if(m.done){
      softToast(`🎉 「${m.title}」完成了`,2400);autoHabit('create');
      // 今天這一步寫的就是這個階段 → 便利貼上那一條也勾起來
      const n=g.next,i=n&&n.text&&n.text.trim()===m.title.trim()?stickyCtx().items.findIndex(x=>x.id===n.id):-1;
      if(i>=0&&!stickyCtx().done['t'+i])document.querySelector(`#sticky-items .sticky-check[data-k="t${i}"]`)?.click();
    }
    return;
  }
  if(el.dataset.move){
    const t=el.dataset.move,mins=+el.dataset.min||0,h=health(d),e=h.exercise||{},types=exTypesOf(e),on=types.indexOf(t)>=0;
    const next=on?types.filter(x=>x!==t):[...types,t];
    h.exercise={...e,types:next,type:next[0]||'',duration:Math.max(0,(+e.duration||0)+(on?-mins:mins)),restDay:false};
    saveHealth(d,h);
    if(!on){softToast(`🌿 ${t} ${mins} 分鐘`,1800);if(t==='跳舞')autoHabit('dance');}
    return;
  }
  if(a==='step-done'){
    const g=data().projects.find(x=>x.id===el.dataset.g);if(!g?.next?.text)return;
    const i=ensureStepInToday(g),wasDone=!!stickyCtx().done['t'+i];
    document.querySelector(`#sticky-items .sticky-check[data-k="t${i}"]`)?.click();
    if(!wasDone){justDone=g.id;autoHabit('create');}
    render(true);return;
  }
  if(a==='set-next-stage'){
    const g=data().projects.find(x=>x.id===el.dataset.g);const cur=g&&(g.milestones||[]).find(m=>!m.done);
    if(g&&cur)setNext(g,cur.title);return;
  }
  if(a==='set-next'){
    const g=data().projects.find(x=>x.id===el.dataset.g),inp=$q(`[data-next-in="${el.dataset.g}"]`);
    if(g&&inp)setNext(g,inp.value);return;
  }
  if(a==='clear-time'){const key=el.dataset.k==='phone'?'phoneAwayAt':'inBedAt';editing='';updateWind(d,x=>{delete x[key];});return;}
  if(a==='rest'){
    const h=health(d);h.exercise=h.exercise||{};
    if(!h.exercise.restDay&&exTypesOf(h.exercise).length){softToast('今天已經有活動了，先取消再標休息',2600);return;}
    h.exercise.restDay=!h.exercise.restDay;saveHealth(d,h);return;
  }
  if(a==='quick-plan'){
    const s=C.stages.find(x=>x.id===el.dataset.stage)||C.stages[0];
    const prev=C.planFor(data(),today());
    data().revisions.push({id:uid(),stageId:s.id,effectiveFrom:today(),phone:s.phone,bed:s.bed,wake:s.wake,status:'active',extras:prev&&prev.extras?prev.extras:defaultExtras(),...(prev&&Array.isArray(prev.steps)?{steps:prev.steps}:{}),updatedAt:Date.now()});
    sv(S);syncStateDebounced();render(true);softToast(`🌙 今晚：${s.phone} 收手機、${s.bed} 上床`,3000);return;
  }
});
document.getElementById('also-edit')?.addEventListener('click',()=>openMovesEditor());
// 卡片上「看起來像文字、點了就能改」的欄位：Enter＝存好離開、Esc＝還原
const FIELD_KEYS=['msTitle','msDue','stepText','smallText','goalDue','goalNote','cpF','cpDue','cpSp','planF','planD','todoText','todoDue','rhyF','rhyD'];
const isField=t=>!!(t&&t.dataset&&FIELD_KEYS.some(k=>t.dataset[k]!==undefined));
onMounts('keydown',ev=>{
  const t=ev.target;
  if(ev.key==='Enter'&&!isImeEnter(ev)&&t.dataset&&t.dataset.todoAdd!==undefined){
    ev.preventDefault();const v=t.value.trim();if(!v||!writable())return;
    const pl=ensurePlan();pl.todos=[...pl.todos,{id:'td-'+uid(),text:v,done:false,due:'',project:'',updatedAt:Date.now()}];
    t.value='';savePlanNow();setTimeout(()=>$q('[data-todo-add]')?.focus(),0);return;
  }
  if(ev.key==='Enter'&&!isImeEnter(ev)&&t.dataset&&t.dataset.msAdd!==undefined){
    ev.preventDefault();
    const g=data().projects.find(x=>x.id===t.dataset.msAdd),v=t.value.trim();if(!g||!v||!writable())return;
    const [title,due]=splitTitleDate(v);if(!title)return;
    const list=[...(g.milestones||[])],item={id:uid(),title,done:false,due,hard:false};
    const at=due?list.findIndex(m=>!m.done&&m.due&&m.due>due):-1;   // 有日期 → 插在第一個比它晚的階段前面
    if(at>=0)list.splice(at,0,item);else list.push(item);
    g.milestones=list;
    t.value='';saveGoal(g);setTimeout(()=>$q(`[data-ms-add="${g.id}"]`)?.focus(),0);return;
  }
  if(ev.key==='Enter'&&!isImeEnter(ev)&&isField(t)){
    ev.preventDefault();t.blur();return;
  }
  if(ev.key==='Escape'&&isField(t)){
    t.value=t.defaultValue;t.blur();return;
  }
  const inp=ev.target.closest('[data-next-in]');
  if(!inp||ev.key!=='Enter'||isImeEnter(ev))return;
  ev.preventDefault();
  const g=data().projects.find(x=>x.id===inp.dataset.nextIn);if(g)setNext(g,inp.value);
});
onMounts('focusout',ev=>{
  const inp=ev.target.closest('[data-next-in]');
  if(!inp||inp.value.trim())return;
  setTimeout(()=>{if(justDone&&!inMounts(document.activeElement)){justDone='';render(true);}},150);
});
// ── 計畫、檢查日、待確認：欄位改完就存 ──
onMounts('change',ev=>{
  const el=ev.target;if(!el.dataset||el.dataset.weight===undefined)return;
  if(!writable()){el.value=el.defaultValue;return;}
  const d=ds(),raw=(el.value||'').trim();
  const h=health(d);h.body={...(h.body||{})};
  if(!raw){if(h.body.weight===undefined)return;delete h.body.weight;saveHealth(d,h);render(true);softToast('這天的體重刪掉了',1600);return;}
  const v=parseFloat(raw.replace('，','.'));
  if(!Number.isFinite(v)||v<20||v>300){el.value=el.defaultValue;softToast('體重看不懂，打成 62.4 這樣就好',2600);return;}
  h.body.weight=Math.round(v*10)/10;saveHealth(d,h);render(true);softToast('記好了 ✓',1200);
});
onMounts('change',ev=>{
  const el=ev.target,dd=el.dataset||{};
  if(!isField(el)&&dd.todoDone===undefined&&dd.planC===undefined)return;
  if(dd.cpF===undefined&&dd.cpDue===undefined&&dd.cpSp===undefined&&dd.todoDone===undefined&&dd.todoText===undefined&&dd.todoDue===undefined&&dd.planF===undefined&&dd.planD===undefined&&dd.planC===undefined)return;
  if(!writable()){el.value=el.defaultValue;return;}
  const now=Date.now(),v=(el.value||'').trim();
  if(dd.cpSp!==undefined){   // 實測速度的格子：屬於專案（g.speed），不是某一個檢查日
    const g=data().projects.find(x=>x.id===el.dataset.g);if(!g)return;
    let raw=v;
    if(dd.cpSp==='sinceDay'&&v){raw=parseMD(v);if(raw===null){el.value=el.defaultValue;softToast('日期看不懂，打成 11/9 這樣就好',2600);return;}}
    const r=C.speedSet(g.speed,dd.cpSp,raw,{today:curDay()});
    if(r.error){el.value=el.defaultValue;softToast(r.error,2600);return;}
    if(r.speed)g.speed=r.speed;else delete g.speed;   // 全部清空＝沒有實測資料，檢查日上的格子也跟著收起來
    el.defaultValue=el.value;saveQuiet(g);softToast('存好了 ✓',1200);return;
  }
  if(dd.cpF!==undefined||dd.cpDue!==undefined){
    const {g,c}=cpOf(el);if(!g||!c)return;
    if(dd.cpDue!==undefined){const due=v?parseMD(v):'';if(due===null){el.value=el.defaultValue;softToast('日期看不懂，打成 12/7 這樣就好',2600);return;}c.due=due;el.value=dateIn(due);}
    else c[dd.cpF]=v;
    c.updatedAt=now;el.defaultValue=el.value;saveQuiet(g);softToast('存好了 ✓',1200);return;
  }
  const pl=planOf();if(!pl)return;
  if(dd.todoDone!==undefined||dd.todoText!==undefined||dd.todoDue!==undefined){
    const t=pl.todos.find(x=>x.id===(dd.todoDone||dd.todoText||dd.todoDue));if(!t)return;
    if(dd.todoDone!==undefined)t.done=el.checked;
    else if(dd.todoText!==undefined){if(!v){el.value=el.defaultValue;softToast('不要的話按 ✕ 刪除',2200);return;}t.text=v;}
    else{const due=v?parseMD(v):'';if(due===null){el.value=el.defaultValue;softToast('日期看不懂，打成 12/7 這樣就好',2600);return;}t.due=due;el.value=dateIn(due);}
    t.updatedAt=now;el.defaultValue=el.value;savePlan();return;
  }
  if(dd.planC==='calDetail'){pl.calDetail=el.checked;savePlan();softToast(el.checked?'階段和檢查日會放進日曆':'日曆只留截止日，其他的會被拿掉',2600);return;}
  const it=(pl[dd.kind]||[]).find(x=>x.id===dd.id);if(!it)return;
  if(dd.planF!==undefined){if(!v){el.value=el.defaultValue;return;}it[dd.planF]=v;}
  else if(dd.planD!==undefined){
    const due=v?parseMD(v):'';if(due===null){el.value=el.defaultValue;softToast('日期看不懂，打成 12/7 這樣就好',2600);return;}
    if(dd.planD==='from'&&!due){el.value=el.defaultValue;return;}
    it[dd.planD]=due||(dd.planD==='to'?it.from:'');
    if(it.to&&it.from&&it.to<it.from){const t=it.from;it.from=it.to;it.to=t;}
    el.value=dateIn(it[dd.planD]);
  }else if(dd.planC==='tentative')it.tentative=el.checked;
  else if(dd.planC==='pause')it.mode=el.checked?'pause':'floor';
  it.updatedAt=now;el.defaultValue=el.value;savePlan();softToast('存好了 ✓',1200);
});
onMounts('change',ev=>{
  const el=ev.target,dd=el.dataset||{};
  if(dd.goalNote!==undefined){
    if(!writable()){el.value=el.defaultValue;return;}
    const g=data().projects.find(x=>x.id===dd.goalNote);if(!g)return;
    g.note=el.value.trim();el.defaultValue=el.value;saveQuiet(g);softToast('存好了 ✓',1200);return;
  }
  if(dd.goalDue!==undefined){
    if(!writable()){el.value=el.defaultValue;return;}
    const g=data().projects.find(x=>x.id===dd.goalDue);if(!g)return;
    const v=el.value.trim(),due=v?parseMD(v):'';
    if(due===null){el.value=el.defaultValue;softToast('日期看不懂，打成 10/31 這樣就好',2600);return;}
    setDue(g,due);el.value=due?md(due):'';el.defaultValue=el.value;
    saveQuiet(g);softToast(due?'截止日改成 '+md(due)+' ✓':'拿掉截止日了',1600);return;
  }
  if(dd.msTitle!==undefined||dd.msDue!==undefined||dd.stepText!==undefined||dd.smallText!==undefined){
    if(!writable()){el.value=el.defaultValue;return;}
    const g=data().projects.find(x=>x.id===(dd.g||dd.stepText||dd.smallText));if(!g)return;
    const v=el.value.trim();
    if(dd.msTitle!==undefined){
      const m=g.milestones[+dd.msTitle];if(!m)return;
      const [title,due]=splitTitleDate(v);
      if(!title){el.value=el.defaultValue;softToast('階段要有名字；不要的話按 ✕ 刪除',2600);return;}
      m.title=title;if(due)m.due=due;el.value=title;el.defaultValue=title;
    }else if(dd.msDue!==undefined){
      const m=g.milestones[+dd.msDue];if(!m)return;
      const due=v?parseMD(v):'';
      if(due===null){el.value=el.defaultValue;softToast('日期看不懂，打成 10/8 這樣就好',2600);return;}
      m.due=due;el.value=due?md(due):'';el.defaultValue=el.value;
    }else if(dd.stepText!==undefined){
      if(!v){el.value=el.defaultValue;softToast('這一步不能是空的；做完了按「完成」',2600);return;}
      renameStep(g,v);el.defaultValue=v;
    }else{
      g.next={...(g.next||{id:uid(),text:''}),small:v};el.defaultValue=v;
    }
    saveQuiet(g);softToast('存好了 ✓',1200);return;
  }
  if(!dd.edit||!writable())return;
  const key=el.dataset.edit==='phone'?'phoneAwayAt':'inBedAt';
  const tt=C.validTime(el.value)?C.targetAt(ds(),el.value):null;
  if(!tt){softToast('時間格式怪怪的 🥲',2200);return;}
  if(tt>new Date()){softToast('還沒到那個時間喔',2400);return;}
  editing='';el.blur();updateWind(ds(),x=>{x[key]=tt.toISOString();});
});
// ══ 回顧與分析：一段期間（一週／一個月）的目標進度 ══════════
// 回顧頁的卡片和「複製給 Claude」都用這一份，兩邊的數字才會一致
function nightInfo(day){
  const f=data(),wd=health(day).sleep?.windDown,plan=C.planFor(f,day);
  let r=C.result(wd,plan,day,new Date());
  const t=(wd&&wd.targetSnapshot)||C.snapshot(plan,day);
  // 今晚還沒到時間 → pending，不算「沒記錄」
  let kind=(r.kind==='missing'&&r.label==='尚未到時間')?'pending':r.kind,asleep='';
  // 一晚的睡眠紀錄寫在隔天早上：沒按「上床」時用它判斷，不用同一件事記兩次
  if(kind==='missing'&&t){
    asleep=health(shiftDay(day,1)).sleep?.sleepTime||'';
    const sr=asleep?C.sleepResult(asleep,t.bedAt,day):null;
    if(sr){r=sr;kind=sr.kind;}
    else{asleep='';if(day>=curDay())kind='pending';}   // 今晚要到明天才可能有紀錄
  }
  const n=health(day).night||{};
  return {day,target:t?t.bed:'',off:clock(n.off),phone:clock(wd&&wd.phoneAwayAt),bed:clock(wd&&wd.inBedAt)||asleep,kind,label:r.label,delta:r.delta};
}
// 身體目標從哪天開始算：有 startOn 用它；早期版本沒記，就用第一次記錄肩背或收尾的那天
function bodyStart(g){
  if(g.startOn)return g.startOn;
  const hit=(S.entries||[]).filter(e=>e.health&&(e.health.body?.shoulder||e.health.sleep?.windDown)).map(e=>e.date).sort()[0];
  return hit||curDay();
}
function periodGoals(dates){
  const last=dates[dates.length-1],upto=dates.filter(d=>d<=curDay());
  const out=[];
  const closed=data().projects.filter(g=>g.closure&&dates.indexOf(g.closure.on)>=0);
  data().projects.filter(g=>g.status==='active'||(g.closure&&dates.indexOf(g.closure.on)>=0)).forEach(g=>{
    if(g.kind==='body'){
      const mets=metricsOf(g),c={rest:0,minutes:0};mets.forEach(m=>{c[m.k]=0;});
      const start=bodyStart(g),counted=upto.filter(day=>day>=start);
      counted.forEach(day=>{
        const h=health(day)||{};
        if(exTypesOf(h.exercise).length)c.minutes+=(+h.exercise.duration||0);
        if(h.exercise&&h.exercise.restDay)c.rest++;
        mets.forEach(m=>{if(metricHit(m,day))c[m.k]++;});
      });
      // 目標是「每週幾次」→ 依「目標開始後、到今天為止」的天數換算，
      // 不會出現目標才開始兩天、分母卻是整個月的情況
      const restDays=counted.filter(isRestDay),active=counted.filter(day=>!isRestDay(day));
      const scale=active.length/7;
      const want={};mets.forEach(m=>{const tt=+m.target||0;want[m.k]=tt&&active.length?Math.max(1,Math.round(tt*scale)):0;});
      // 上床只算有紀錄的夜晚：沒記錄不等於沒做到，今晚還沒到也不算
      const nightsPast=active.filter(day=>['onTime','late'].includes(nightInfo(day).kind)).length;
      mets.filter(m=>m.src==='bed'&&+m.target).forEach(m=>{want[m.k]=nightsPast?Math.max(1,Math.round(+m.target*nightsPast/7)):0;});
      out.push({g,kind:'body',c,want,days:counted.length,start,restDays});
    }else{
      const ms=g.milestones||[];
      const doneIn=ms.filter(m=>m.done&&m.doneOn&&dates.indexOf(m.doneOn)>=0);
      let steps=0,stepsDone=0;const stepList=[];
      upto.forEach(day=>{(tdlItemsOf(day)||[]).forEach(x=>{if(x.goalId===g.id||(!x.goalId&&x.theme===g.title)){steps++;if(x.done)stepsDone++;stepList.push({day,task:x.task,done:!!x.done});}});});
      const done=ms.filter(m=>m.done).length,remaining=ms.length-done;
      const left=g.dueDate?daysBetween(curDay(),g.dueDate)+1:null;
      out.push({g,kind:'project',ms,done,remaining,doneIn,steps,stepsDone,stepList,left});
    }
  });
  const nights=upto.map(nightInfo).filter(n=>n.target&&n.kind!=='pending');
  return {goals:out,nights,last,closed};
}
function paceText(x){
  if(!x.ms.length)return '還沒拆階段';
  if(!x.remaining)return '全部階段完成';
  // 有階段日期就照日期說：目前那段還有幾天、有沒有晚了
  const cur=x.ms.find(m=>!m.done);
  if(cur&&cur.due){
    const left=daysBetween(curDay(),cur.due);
    return left<0?`「${cur.title}」原定 ${md(cur.due)}，晚了 ${-left} 天`:`現在「${cur.title}」，${md(cur.due)} 前完成（${left===0?'就是今天':'還有 '+left+' 天'}）`;
  }
  if(x.left==null)return `還有 ${x.remaining} 段`;
  if(x.left<=0)return `已過截止日，還有 ${x.remaining} 段`;
  const per=x.left/x.remaining;
  return per>=1?`還有 ${x.remaining} 段、${x.left} 天：每 ${Math.floor(per*10)/10} 天要完成 1 段`:`還有 ${x.remaining} 段、${x.left} 天：每天要完成 ${Math.ceil(x.remaining/x.left)} 段`;
}
function reviewHTML(dates,isWeek){
  const P=periodGoals(dates);
  if(!P.goals.length&&!P.nights.length)return '';
  const unit=isWeek?'這週':'這個月';
  const blocks=P.goals.map(x=>{
    if(x.kind==='body'){
      const row=metricsOf(x.g).filter(m=>x.want[m.k]>0).map(m=>{
        const n=x.c[m.k],w=x.want[m.k];
        return `<div class="goal-stat${n>=w?' hit':''}"><div class="goal-stat-l">${esc(m.l)}</div><div class="goal-stat-n">${n}<small> / ${w} ${m.unit}</small></div></div>`;
      }).join('');
      return `<div style="margin-bottom:12px;"><div class="goal-sub" style="font-weight:800;color:var(--tc);margin-bottom:6px;">${fi('1f3c3',16)} ${esc(x.g.title)}${x.g.dueDate?' · '+md(x.g.dueDate)+(x.g.event?' '+esc(x.g.event):''):''}</div>
        ${row?`<div class="goal-stats">${row}</div>`:''}
        <div class="goal-sub muted" style="margin-top:5px;">從 ${md(x.start)} 開始算 ${x.days} 天 · 活動共 ${x.c.minutes} 分鐘${x.c.rest?`，休息 ${x.c.rest} 天`:''}${x.restDays.length?`，不舒服 ${x.restDays.length} 天不算進目標`:''}</div></div>`;
    }
    const segs=x.ms.length?`<div class="goal-segs" style="margin:6px 0;">${x.ms.map(m=>`<span class="goal-seg${m.done?' done':''}" style="cursor:default;" title="${esc(m.title)}"></span>`).join('')}</div>`:'';
    return `<div style="margin-bottom:12px;"><div class="goal-sub" style="font-weight:800;color:var(--tc);">${fi('1f3ac',16)} ${esc(x.g.title)}${x.g.dueDate?' · '+md(x.g.dueDate)+' 截止':''}</div>
      ${segs}
      <div class="goal-sub">${x.doneIn.length?`${unit}完成的階段：${x.doneIn.map(m=>esc(m.title)).join('、')}`:`${unit}沒有新完成的階段`}</div>
      <div class="goal-sub">${unit}的每日一步：完成 ${x.stepsDone} / ${x.steps}</div>
      <div class="goal-sub${x.remaining&&x.left!=null&&x.left/x.remaining<2?' warn':' muted'}">${esc(paceText(x))}</div></div>`;
  }).join('');
  const nights=P.nights.length?`<div class="goal-sub" style="font-weight:800;color:var(--tc);margin-bottom:6px;">${fi('1f319',16)} 收尾與上床（綠＝準時、金＝晚了、灰＝沒記錄）</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">${P.nights.map(n=>`<div title="${esc(n.label)}" style="text-align:center;font-size:11px;color:var(--tc2);min-width:44px;">
      <div class="focus-dot${n.kind==='onTime'?' ontime':(n.kind==='late'?' late':'')}" style="margin:0 auto 3px;width:11px;height:11px;"></div>
      ${md(n.day)}<br/>${n.bed||'—'}</div>`).join('')}</div>
    <div class="goal-sub muted" style="margin-top:6px;">準時 ${P.nights.filter(n=>n.kind==='onTime').length} 晚 · 晚了 ${P.nights.filter(n=>n.kind==='late').length} 晚 · 沒記錄 ${P.nights.filter(n=>n.kind==='missing').length} 晚</div>`:'';
  return `<div class="gcard"><div class="sec-hd">目標進度</div>${blocks}${nights}</div>`;
}
// 給 Claude 的文字：先講目標是什麼，再講這段期間做到多少，分析才有對照
function copyLines(dates,label){
  const P=periodGoals(dates);
  if(!P.goals.length&&!P.nights.length)return [];
  const nextP={'今天':'明天','這週':'下週','這個月':'下個月'}[label]||'接下來';
  const L=[`🎯 目前的目標（請對照這些目標分析我的進度，給我${nextP}具體可行的調整）`];
  P.goals.forEach(x=>{
    if(x.kind==='body'){
      L.push(`  🏃 ${x.g.title}${x.g.dueDate?'：'+x.g.dueDate+(x.g.event?' '+x.g.event:''):''}`);
      L.push('    每週目標：'+activeMetrics(x.g).map(m=>m.l+' '+m.target+' '+m.unit).join('、'));
      L.push(`    ${label}實際（${md(x.start)} 開始算，共 ${x.days} 天）：`+activeMetrics(x.g).map(m=>`${m.l} ${x.c[m.k]}${x.want[m.k]?'/'+x.want[m.k]:''} ${m.unit}`).join('、')+(x.restDays.length?`（不舒服 ${x.restDays.length} 天不算進目標）`:'')+`；活動共 ${x.c.minutes} 分鐘${x.c.rest?`、休息 ${x.c.rest} 天`:''}`);
    }else{
      L.push(`  🎬 ${x.g.group?'['+x.g.group+'] ':''}${x.g.title}${x.g.dueDate?'：'+x.g.dueDate+' 截止':''}`);
      if(x.g.note)L.push(`    備註：${x.g.note}`);
      if(x.ms.length)L.push('    階段：'+x.ms.map(m=>(m.done?'✓':'○')+m.title+(m.due?'〔'+(m.hard?'🚩硬期限 ':'預計 ')+md(m.due)+'〕':'')+(m.doneOn?'(完成 '+md(m.doneOn)+(m.due&&m.doneOn>m.due?'，晚 '+daysBetween(m.due,m.doneOn)+' 天':'')+')':'')).join(' → '));
      if((x.g.dueHistory||[]).length)L.push('    改期：'+x.g.dueHistory.map(h=>`${md(h.on)} 從 ${md(h.from)||'沒有日期'} 改成 ${md(h.to)||'沒有日期'}`).join('；'));
      {const sl=speedLine(x.g);if(sl)L.push('    '+sl);}
      L.push(`    ${label}完成的階段：${x.doneIn.map(m=>m.title).join('、')||'無'}；每日一步完成 ${x.stepsDone}/${x.steps}`);
      x.stepList.forEach(s2=>L.push(`      ${s2.done?'✅':'⬜'} ${md(s2.day)} ${s2.task}`));
      L.push('    進度：'+paceText(x));
      if(x.g.next&&x.g.next.text)L.push('    目前的下一步：'+x.g.next.text+(x.g.next.small?'（沒電版：'+x.g.next.small+'）':''));
    }
  });
  const p=C.planFor(data(),P.last>curDay()?curDay():P.last);
  if(p)L.push(`  🌙 作息練習：${p.phone} 收手機、${p.bed} 上床、${p.wake} 起床${p.status==='paused'?'（暫停中）':''}`);
  (P.closed||[]).forEach(g=>L.push(`  🏁 ${g.title}：${md(g.closure.on)} ${CLOSE_LABEL[g.closure.kind]||'結束'}${g.closure.note?'｜'+g.closure.note:''}`));
  if(P.nights.length){
    L.push(`  🌙 ${label}收尾：準時 ${P.nights.filter(n=>n.kind==='onTime').length} 晚、晚了 ${P.nights.filter(n=>n.kind==='late').length} 晚、沒記錄 ${P.nights.filter(n=>n.kind==='missing').length} 晚`);
    // 沒記錄的晚上不逐行列（上面已經有總數），省掉一大串空白
    P.nights.filter(n=>n.kind==='onTime'||n.kind==='late').forEach(n=>L.push(`      ${md(n.day)} 目標 ${n.target}${n.off?'｜收工 '+n.off:''}${n.phone?'｜收手機 '+n.phone:''}｜${n.label}`));
  }
  L.push('');
  return L;
}
// ══ 回顧 → 實驗 → 每天 → 下次回顧 的迴圈 ══════════════════
// 回顧帶走最多 3 個「實驗」，放進 App 每天會看到的地方；下次回顧先檢查上次的實驗。
// 日記深讀的「我是怎樣的人」存成 insights，內心花園按月排成時間線。
const DEEP_PROMPT=['請深讀我這段期間的日記（Highlights／Reflection／Gratitude／金句）。用自然的段落寫，不要套固定模板或條列，也不要為了簡短而壓縮。',
'我想看的是自己還沒發現的東西。人際關係、內在、感受、進步、我是怎樣的人都可以談，但不用每項都寫，挑真的有東西可講的。',
'下面列的「之前已經講過」不要再講一次，除非這次有新證據，或證據推翻了它。',
'請跟前面幾個月一起看：什麼每個月都在發生、什麼真的變了。跨月數字在「跨月對照」那段。',
'每個判斷都附日期或原句，並在句子裡分清楚「日記裡看到的」和「你的推測」。日記裡可能貼了別人的訊息或 AI 摘要，不要當成我說的話。語氣溫和但誠實，不要只說好聽的。'];
const PLACES={night:'今晚流程',tdl:'便利貼（今天）',checkin:'每天打卡'};
function exps(){return data().experiments;}
function insightsAll(){return data().insights;}
function insightsShown(){return insightsAll().filter(x=>!x.deleted);}
function saveFocus(){sv(S);syncStateDebounced();}
function monthKeyOf(d){return d.slice(0,7);}
function prevMonthKey(k){const [y,m]=k.split('-').map(Number);const d=new Date(y,m-2,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
function periodKey(dates,kind){return kind==='week'?'w:'+dates[0]:'m:'+monthKeyOf(dates[0]);}
// 這段期間有在進行的實驗（開始得比期間結束早、而且沒在期間開始前就結束）
function expsIn(dates){
  const a=dates[0],b=dates[dates.length-1];
  return exps().filter(e=>(e.startOn||'')<=b&&!(e.status==='archived'&&e.endedOn&&e.endedOn<a));
}
function expLabelFreq(e){return e.freq==='daily'?'每天':(e.freq==='weekly'?'每週 '+(e.n||1)+' 次':'一次');}
// 自動算出實際做了幾次（打卡、今晚流程打勾、便利貼完成）
function expCount(e,dates){
  const upto=dates.filter(d=>d<=curDay());
  if(e.place==='night')return upto.filter(d=>(health(d).night||{})['x_'+e.extraId]).length;
  if(e.place==='tdl'){let done=0;upto.forEach(d=>(tdlItemsOf(d)||[]).forEach(x=>{if(x.id===e.tdlId&&x.done)done++;}));return done;}
  return upto.filter(d=>(e.log||{})[d]).length;
}
function expCountText(e,dates){
  const n=expCount(e,dates);
  if(e.place==='tdl')return n?'已完成':'還沒完成';
  return (e.place==='night'?'做了 ':'打卡 ')+n+' 天';
}
// ── 首頁：進行中的實驗（今晚流程和便利貼的，已經在那兩個地方了，這裡只放打卡型）
function homeExperiments(){
  const d=ds(),list=exps().filter(e=>e.status!=='archived'&&e.place==='checkin');
  if(!list.length)return '';
  const mon=mondayOfDs(d),week=[...Array(7)].map((_,i)=>shiftDay(mon,i));
  return `<div class="gcard" style="margin-bottom:12px;"><div class="goal-hd" style="margin-bottom:8px;"><span class="goal-title">進行中的實驗</span>
    <span class="goal-sub muted" style="margin-left:auto;">點一下＝今天做了</span></div>
    <div style="display:flex;flex-direction:column;gap:7px;">${list.map(e=>{
      const on=!!(e.log||{})[d],wk=week.filter(x=>x<=d&&(e.log||{})[x]).length;
      const goal=e.freq==='weekly'?(e.n||1):(e.freq==='daily'?7:1);
      return `<div class="dots-row"><span style="flex:1;min-width:0;">${esc(e.text)}</span>
        <span class="goal-sub muted">${e.freq==='once'?'':'本週 '+wk+'/'+goal}</span>
        <button class="focus-btn${on?' done':''}" data-exp-log="${esc(e.id)}">${on?'✓ 今天做了':'今天做了'}</button></div>`;}).join('')}</div></div>`;
}
// ── 回顧頁最上面：上次的實驗 ──────────────────────
function loopReviewHTML(dates,kind){
  const key=periodKey(dates,kind),list=expsIn(dates);
  const title=kind==='week'?'這週的實驗':'這個月的實驗';
  const rows=list.map(e=>{
    const r=(e.reviews||{})[key]||{};
    const btn=(v,l,cls)=>`<button class="focus-btn${r.status===v?' '+cls:''}" data-exp-review="${esc(e.id)}" data-key="${key}" data-v="${v}">${l}</button>`;
    return `<div style="border-top:1px solid rgba(var(--secondary-rgb),.18);padding-top:9px;margin-top:9px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="flex:1;min-width:160px;font-size:13px;color:var(--tc);font-weight:700;">${esc(e.text)}
          <span class="goal-sub muted" style="font-weight:500;">· ${expLabelFreq(e)} · ${PLACES[e.place]||''} · ${expCountText(e,dates)}${e.status==='archived'?' · 已結束':''}</span></span>
        ${btn('done','做到','done')}${btn('half','一半','rest')}${btn('no','沒做','rest')}
      </div>
      <input class="goal-in" data-exp-note="${esc(e.id)}" data-key="${key}" value="${esc(r.note||'')}" placeholder="一句話：為什麼？（選填）" style="width:100%;margin-top:6px;"/>
      ${e.status!=='archived'?`<button class="goal-more" data-exp-end="${esc(e.id)}" style="margin:4px 0 0;">結束這個實驗</button>`:''}
    </div>`;
  }).join('');
  return `<div class="gcard"><div class="sec-hd">${title}</div>
    ${rows||`<div class="goal-sub muted">還沒有實驗。回顧完把 Claude 的建議貼回來，或自己加一個。</div>`}
    <div class="goal-chips" style="margin-top:12px;">
      <button class="focus-btn primary" data-loop-paste="${esc(dates[0])}" data-kind="${kind}">貼上 Claude 的回覆</button>
      <button class="focus-btn" data-loop-add="1">＋ 自己加一個實驗</button></div></div>`;
}
// ── 複製給 Claude：開頭放上次的實驗結果；結尾請 Claude 用固定格式回答 ──
function loopCopyLines(dates,kind){
  const key=periodKey(dates,kind),list=expsIn(dates);
  if(!list.length)return [];
  const st={done:'做到',half:'做了一半',no:'沒做'};
  const L=[`🧪 ${kind==='week'?'這週':'這個月'}的實驗結果`];
  list.forEach(e=>{const r=(e.reviews||{})[key]||{};
    L.push(`  • ${e.text}（${expLabelFreq(e)}，${PLACES[e.place]||''}）→ ${st[r.status]||'還沒回顧'}；${expCountText(e,dates)}${r.note?'；我的想法：'+r.note:''}`);});
  L.push('');return L;
}
function loopRequestLines(dates,kind,opts){
  opts=opts||{};
  const L=[];
  if(opts.deep){
    L.push('━━━ 日記深讀 ━━━',...DEEP_PROMPT);
    if(opts.prev){
      const mk=monthKeyOf(dates[0]),prev=insightsShown().filter(x=>x.period&&x.period<mk).sort((a,b)=>a.period.localeCompare(b.period));
      if(prev.length){
        const re={yes:'（我覺得像我）',no:'（我覺得不太像）'};
        L.push('','之前已經講過（請不要重講，可以拿來比較）：',...prev.map(x=>`  ${x.period} ${x.kind==='progress'?'✦ 進步':'◆ 特質'}：${x.text}${re[x.reaction]||''}`));
      }
    }
    L.push('');
  }
  L.push(opts.deep?'分析寫完之後，最後另外附幾行給 App（不影響前面的長度和深度）：':'最後請用這個格式整理（我會貼回 App）：');
  if(opts.deep)L.push('◆ 特質：……｜證據：……','✦ 進步：……｜證據：……');
  L.push('▶ 實驗：……｜頻率：一次／每天／每週 N 次｜放哪：便利貼／今晚流程／每天打卡',
    `（實驗最多 3 個，要小到${kind==='week'?'下週':'這週'}就能開始）`);
  return L;
}
// ── 貼回 Claude 的回覆：拆成實驗卡與觀察卡 ───────────
function parseReply(text){
  const out={exps:[],traits:[]};
  const fields=line=>line.split(/[｜|]/).map(x=>x.trim()).filter(Boolean);
  const val=(fs,k)=>{const f=fs.find(x=>x.startsWith(k));return f?f.replace(new RegExp('^'+k+'\\s*[:：]?\\s*'),''):'';};
  String(text||'').split(/\n/).forEach(raw=>{
    const line=raw.trim().replace(/^[-*•]\s*/,'');
    let m;
    if((m=line.match(/^[▶►➤]\s*(?:實驗\s*[:：])?\s*(.+)$/))){
      const fs=fields(m[1]),t=fs[0].replace(/^實驗\s*[:：]\s*/,'');
      const fq=val(fs,'頻率'),pl=val(fs,'放哪');
      let freq='once',n=1;
      if(/每天|每日/.test(fq))freq='daily';
      else if(/每週|每周/.test(fq)){freq='weekly';n=+((fq.match(/(\d+)/)||[])[1])||1;}
      let place=/今晚|睡前|流程/.test(pl)?'night':(/便利貼|TDL/i.test(pl)?'tdl':'checkin');
      if(place==='tdl'&&freq!=='once')place='checkin';
      const at=(t.match(/(\d{1,2}:\d{2})/)||[])[1]||'';
      if(t)out.exps.push({text:t,freq,n,place,at});
    }else if((m=line.match(/^([◆◇✦✧])\s*(?:(特質|進步)\s*[:：])?\s*(.+)$/))){
      const fs=fields(m[3]);
      const kind=(m[2]==='進步'||m[1]==='✦'||m[1]==='✧')?'progress':'trait';
      if(fs[0])out.traits.push({text:fs[0],evidence:val(fs,'證據'),kind});
    }
  });
  out.exps=out.exps.slice(0,3);
  return out;
}
function openPasteModal(startDate,kind){
  modal('貼上 Claude 的回覆',`
    <div class="fm-hint">整段貼上就好，App 會找出「▶ 實驗」「◆ 特質」「✦ 進步」那幾行。</div>
    <textarea class="fm-in" id="lp-text" rows="7" style="margin-top:8px;resize:vertical;" placeholder="▶ 實驗：23:30 收工時寫下明天第一步｜頻率：每天｜放哪：今晚流程"></textarea>
    <div class="fm-actions"><button class="focus-btn primary" id="lp-parse" style="margin-left:auto;">拆開來看</button></div>
    <div id="lp-out"></div>`,
  (m,close)=>{
    m.querySelector('#lp-parse').addEventListener('click',()=>{
      const r=parseReply(m.querySelector('#lp-text').value);
      if(!r.exps.length&&!r.traits.length){softToast('找不到 ▶／◆／✦ 開頭的行，請確認 Claude 有照格式整理',3200);return;}
      const box=m.querySelector('#lp-out');
      box.innerHTML=(r.exps.length?`<div class="fm-lbl">🧪 實驗（選要放哪，不要的選「不要」）</div>`+r.exps.map((e,i)=>`
        <div data-lp-exp="${i}" style="margin-bottom:10px;"><div style="font-size:13px;color:var(--tc);font-weight:700;">${esc(e.text)} <span class="goal-sub muted">· ${expLabelFreq(e)}</span></div>
          <div class="goal-chips" style="margin-top:5px;align-items:center;">${['night','tdl','checkin','skip'].map(pl=>`<button type="button" class="focus-btn${e.place===pl?' done':''}" data-pl="${pl}">${pl==='skip'?'不要':PLACES[pl]}</button>`).join('')}
          <input class="focus-time" type="time" data-at value="${esc(e.at||'22:00')}" style="${e.place==='night'?'':'display:none;'}"/></div></div>`).join(''):'')+
        (r.traits.length?`<div class="fm-lbl">🌱 Claude 看見的我（會存進內心花園）</div>`+r.traits.map((t,i)=>`
        <div data-lp-trait="${i}" style="margin-bottom:9px;"><div style="font-size:13px;color:var(--tc);">${t.kind==='progress'?'✦ ':''}${esc(t.text)}</div>
          ${t.evidence?`<div class="goal-sub muted">證據：${esc(t.evidence)}</div>`:''}
          <div class="goal-chips" style="margin-top:4px;">${[['yes','像我'],['no','不太像'],['skip','不存']].map(([v,l])=>`<button type="button" class="focus-btn" data-re="${v}">${l}</button>`).join('')}</div></div>`).join(''):'')+
        `<div class="fm-actions"><button class="focus-btn primary" id="lp-save" style="margin-left:auto;">存起來</button></div>`;
      box.querySelectorAll('[data-lp-exp]').forEach(row=>row.querySelectorAll('[data-pl]').forEach(b=>b.addEventListener('click',()=>{
        row.querySelectorAll('[data-pl]').forEach(x=>x.classList.toggle('done',x===b));
        row.querySelector('[data-at]').style.display=b.dataset.pl==='night'?'':'none';
      })));
      box.querySelectorAll('[data-lp-trait]').forEach(row=>row.querySelectorAll('[data-re]').forEach(b=>b.addEventListener('click',()=>{
        row.querySelectorAll('[data-re]').forEach(x=>x.classList.toggle('done',x===b));
      })));
      box.querySelector('#lp-save').addEventListener('click',()=>{
        let nE=0,nT=0;
        box.querySelectorAll('[data-lp-exp]').forEach(row=>{
          const e=r.exps[+row.dataset.lpExp],pl=(row.querySelector('[data-pl].done')||{}).dataset?.pl||e.place;
          if(pl==='skip')return;
          addExperiment({...e,place:pl,at:row.querySelector('[data-at]').value});nE++;
        });
        const period=monthKeyOf(startDate);
        box.querySelectorAll('[data-lp-trait]').forEach(row=>{
          const t=r.traits[+row.dataset.lpTrait],re=(row.querySelector('[data-re].done')||{}).dataset?.re||'';
          if(re==='skip')return;
          insightsAll().push({id:uid(),period,text:t.text,evidence:t.evidence,kind:t.kind,reaction:re,createdAt:Date.now(),updatedAt:Date.now()});nT++;
        });
        saveFocus();close();refreshPages();
        softToast(`存好了：${nE} 個實驗、${nT} 則觀察 ✓`,2800);
      });
    });
  });
}
// 新增一個實驗，並放到它該在的地方
function addExperiment(e){
  // 便利貼只放得下「今天做一次」的事；重複的實驗改放每天打卡，下週才會繼續出現
  if(e.place==='tdl'&&e.freq&&e.freq!=='once')e={...e,place:'checkin'};
  const x={id:uid(),text:e.text,freq:e.freq||'once',n:e.n||1,place:e.place||'checkin',startOn:curDay(),status:'active',
    log:{},reviews:{},createdAt:Date.now(),updatedAt:Date.now()};
  if(x.place==='night'){
    const p=C.planFor(data(),today());
    if(!p){x.place='checkin';softToast('還沒設定今晚的時間，這個實驗先放「每天打卡」',3200);}
    else{
      x.extraId='e'+x.id.slice(0,8);
      const extras=[...(p.extras||[]),{id:x.extraId,label:x.text.replace(/\d{1,2}:\d{2}\s*/,'').slice(0,20),at:C.validTime(e.at)?e.at:'22:00'}];
      data().revisions.push({...p,id:uid(),effectiveFrom:today(),extras,updatedAt:Date.now()});
    }
  }
  if(x.place==='tdl'){
    x.tdlId='exp-'+x.id.slice(0,8);
    const c=stickyCtx();
    if(c.todayMode){setTodayTDL([...c.items,{id:x.tdlId,theme:'實驗',task:x.text,c:0}]);todayListEdited=true;markTodayListEdited();writeDraftEntry(true);markDirty('e:'+curDay());syncEntryFor(curDay()).catch(()=>{});renderStickyNote();}
  }
  exps().push(x);
  return x;
}
function openAddExperiment(){
  modal('自己加一個實驗',`
    <div class="fm-lbl">想試什麼？（越小越好）</div>
    <input class="fm-in" id="ae-text" placeholder="例如：每週一傳訊息給一個朋友" maxlength="60"/>
    <div class="fm-lbl">多常</div>
    <div class="goal-chips" id="ae-freq">${[['once','一次'],['daily','每天'],['weekly','每週']].map(([v,l],i)=>`<button type="button" class="focus-btn${i===1?' done':''}" data-v="${v}">${l}</button>`).join('')}
      <input class="fm-in" id="ae-n" type="number" min="1" max="7" value="3" style="width:64px;display:none;"/></div>
    <div class="fm-lbl">放哪</div>
    <div class="goal-chips" id="ae-place">${Object.entries(PLACES).map(([v,l],i)=>`<button type="button" class="focus-btn${v==='checkin'?' done':''}" data-v="${v}">${l}</button>`).join('')}
      <input class="focus-time" id="ae-at" type="time" value="22:00" style="display:none;"/></div>
    <div class="fm-actions"><button class="focus-btn primary" id="ae-save" style="margin-left:auto;">開始</button></div>`,
  (m,close)=>{
    const pick=(id,cb)=>m.querySelectorAll('#'+id+' [data-v]').forEach(b=>b.addEventListener('click',()=>{m.querySelectorAll('#'+id+' [data-v]').forEach(x=>x.classList.toggle('done',x===b));cb&&cb(b.dataset.v);}));
    pick('ae-freq',v=>{m.querySelector('#ae-n').style.display=v==='weekly'?'':'none';});
    pick('ae-place',v=>{m.querySelector('#ae-at').style.display=v==='night'?'':'none';});
    m.querySelector('#ae-save').addEventListener('click',()=>{
      const text=m.querySelector('#ae-text').value.trim();if(!text){softToast('寫一下想試什麼',2200);return;}
      const freq=m.querySelector('#ae-freq .done').dataset.v,place=m.querySelector('#ae-place .done').dataset.v;
      addExperiment({text,freq,n:+m.querySelector('#ae-n').value||1,place,at:m.querySelector('#ae-at').value});
      saveFocus();close();refreshPages();softToast('🧪 實驗開始',2000);
    });
  });
}
// ── 內心花園：每個月的我 ────────────────────────────
function insightsHTML(){
  const all=insightsShown();
  if(!all.length)return `<div class="goal-sub muted">月回顧時勾「日記深讀」，把 Claude 的回覆貼回來，這裡就會一個月一個月長出來。</div>`;
  const periods=[...new Set(all.map(x=>x.period))].sort().reverse();
  return periods.map(pk=>{
    const items=all.filter(x=>x.period===pk);
    return `<div style="display:flex;gap:12px;padding:8px 0;border-top:1px solid rgba(var(--secondary-rgb),.15);">
      <span style="width:46px;flex-shrink:0;font-size:12px;color:var(--tc3);font-weight:700;">${+pk.slice(5)} 月</span>
      <div style="flex:1;display:flex;flex-direction:column;gap:5px;">${items.map(x=>`
        <div style="font-size:13px;color:${x.kind==='progress'?'var(--ok)':'var(--tc)'};" title="${esc(x.evidence?'證據：'+x.evidence:'')}">
          <span style="${x.reaction==='no'?'opacity:.45;text-decoration:line-through;':''}">${x.kind==='progress'?'✦ 進步：':''}${esc(x.text)}</span>
          <span style="white-space:nowrap;margin-left:4px;">
            <button class="goal-edit" data-ins="${esc(x.id)}" data-re="yes" title="像我" style="font-size:12px;${x.reaction==='yes'?'color:var(--ok);font-weight:800;':''}">${x.reaction==='yes'?'✓ 像我':'像我'}</button>
            <button class="goal-edit" data-ins="${esc(x.id)}" data-re="no" title="不太像" style="font-size:12px;${x.reaction==='no'?'font-weight:800;':''}">不太像</button>
            <button class="goal-edit" data-ins-del="${esc(x.id)}" title="刪除" style="font-size:11px;">✕</button></span></div>`).join('')}</div></div>`;
  }).join('');
}
function renderInsights(){const el=document.getElementById('insights-timeline');if(el)el.innerHTML=insightsHTML();}
function refreshPages(){
  render(true);renderInsights();
  if(document.getElementById('page-week')?.classList.contains('active')&&typeof renderWeekly==='function')renderWeekly();
  if(document.getElementById('page-month')?.classList.contains('active')&&typeof renderMonthly==='function')renderMonthly();
}
// 回顧頁、內心花園的按鈕是 index.html 畫出來的，用全域代理接事件
document.addEventListener('click',ev=>{
  const el=ev.target.closest('[data-exp-review],[data-exp-end],[data-loop-paste],[data-loop-add],[data-ins],[data-ins-del],[data-exp-log]');
  if(!el)return;
  if(el.dataset.loopPaste){openPasteModal(el.dataset.loopPaste,el.dataset.kind);return;}
  if(!writable())return;
  if(el.dataset.loopAdd){openAddExperiment();return;}
  if(el.dataset.expLog){
    const e=exps().find(x=>x.id===el.dataset.expLog);if(!e)return;
    e.log={...(e.log||{})};const d=ds();if(e.log[d])delete e.log[d];else e.log[d]=Date.now();
    e.updatedAt=Date.now();saveFocus();render(true);if(e.log[d])softToast('🧪 記下了',1600);return;
  }
  if(el.dataset.expReview){
    const e=exps().find(x=>x.id===el.dataset.expReview);if(!e)return;
    e.reviews={...(e.reviews||{})};const r={...(e.reviews[el.dataset.key]||{})};
    r.status=r.status===el.dataset.v?'':el.dataset.v;e.reviews[el.dataset.key]=r;
    e.updatedAt=Date.now();saveFocus();refreshPages();return;
  }
  if(el.dataset.expEnd){
    const e=exps().find(x=>x.id===el.dataset.expEnd);if(!e||!confirm(`結束「${e.text}」這個實驗？（紀錄會留著）`))return;
    e.status='archived';e.endedOn=curDay();e.updatedAt=Date.now();
    // 放在今晚流程的，從之後的流程拿掉
    if(e.place==='night'&&e.extraId){const p=C.planFor(data(),today());if(p&&(p.extras||[]).some(x=>x.id===e.extraId))data().revisions.push({...p,id:uid(),effectiveFrom:today(),extras:p.extras.filter(x=>x.id!==e.extraId),updatedAt:Date.now()});}
    saveFocus();refreshPages();return;
  }
  if(el.dataset.ins){
    const x=insightsAll().find(i=>i.id===el.dataset.ins);if(!x)return;
    x.reaction=x.reaction===el.dataset.re?'':el.dataset.re;x.updatedAt=Date.now();saveFocus();renderInsights();return;
  }
  if(el.dataset.insDel){
    const f=data(),i=f.insights.findIndex(x=>x.id===el.dataset.insDel);if(i<0||!confirm('刪掉這則觀察？'))return;
    // 刪除也要能同步：標記成 deleted 而不是直接移除（另一台裝置的舊資料才不會把它合併回來）
    f.insights[i]={...f.insights[i],deleted:true,text:f.insights[i].text,updatedAt:Date.now()};saveFocus();renderInsights();
  }
});
document.addEventListener('input',ev=>{
  const el=ev.target.closest('[data-exp-note]');if(!el)return;
  const e=exps().find(x=>x.id===el.dataset.expNote);if(!e)return;
  e.reviews={...(e.reviews||{})};e.reviews[el.dataset.key]={...(e.reviews[el.dataset.key]||{}),note:el.value};
  e.updatedAt=Date.now();saveFocus();
});

// ══ 跨月對照 ══════════════════════════════════════
// 只算真的有寫的內容：「yy」這種佔位不算日記；還沒到的日子不算
function dayRec(day){
  const e=(S.entries||[]).find(x=>x.date===day),now=day===curDay();
  return {checked:now?Object.keys(S.checked||{}):(e&&e.checked)||[],diary:(now?S.diary:e&&e.diary)||{},health:(now?S.health:e&&e.health)||null,items:tdlItemsOf(day)||[]};
}
function monthDays(key){
  const [y,m]=key.split('-').map(Number),n=new Date(y,m,0).getDate(),out=[];
  for(let i=1;i<=n;i++){const day=key+'-'+String(i).padStart(2,'0');if(day<=curDay())out.push(day);}
  return out;
}
const realText=t=>String(t||'').trim().length>=3;
function monthStat(key){
  const r={key,diary:0,tdl:0,sleep:0,move:0,diet:0,water:0,sick:0,bedSum:0,durSum:0,recovery:[],habits:{}};
  monthDays(key).forEach(day=>{
    const x=dayRec(day),h=x.health||{},sl=h.sleep||{};
    if(['hl','rf','gr'].some(k=>realText(x.diary[k])))r.diary++;
    if(x.items.length)r.tdl++;
    if(exTypesOf(h.exercise).length)r.move++;
    if(healthHas(h,'diet'))r.diet++;
    if(healthHas(h,'water'))r.water++;
    if(isRestDay(day))r.sick++;
    x.checked.forEach(k=>{r.habits[k]=(r.habits[k]||0)+1;});
    if(C.validTime(sl.sleepTime)){
      const m=toMin(sl.sleepTime);r.sleep++;r.bedSum+=m<720?m+1440:m;
      const dur=typeof sleepMinutes==='function'?sleepMinutes(sl):0;if(dur)r.durSum+=dur;
      // 睡到很晚或很晚才睡：多半是趕工或身體不舒服，統計時要看得出來
      if((m>=240&&m<720)||(C.validTime(sl.wakeTime)&&toMin(sl.wakeTime)>=720))r.recovery.push(day);
    }
  });
  r.bed=r.sleep?hm(Math.round(r.bedSum/r.sleep)):'';
  r.dur=r.sleep&&r.durSum?Math.round(r.durSum/r.sleep):0;
  return r;
}
function trendMonths(upTo){
  const keys=[...new Set((S.entries||[]).map(e=>String(e.date).slice(0,7)))].filter(k=>k<=upTo).sort();
  return keys.slice(-6);
}
const durTxt=m=>m?Math.floor(m/60)+' 小時 '+(m%60)+' 分':'—';
const rangeTxt=list=>{  // 連續的日子併成一段：10/9–10/11、10/23
  const out=[];let a=null,b=null;
  list.forEach(d=>{if(b&&shiftDay(b,1)===d){b=d;return;}if(a)out.push(a===b?md(a):md(a)+'–'+md(b));a=b=d;});
  if(a)out.push(a===b?md(a):md(a)+'–'+md(b));
  return out.join('、');
};
// 習慣的連續段（中間空一天也算同一段）：看得出每個習慣通常撐多久
function habitRuns(keys){
  const days=keys.flatMap(monthDays),out=[];
  HABITS.forEach(h=>{
    const hit=days.filter(d=>dayRec(d).checked.indexOf(h.k)>=0);if(!hit.length)return;
    const runs=[];let a=hit[0],b=hit[0],n=1;
    hit.slice(1).forEach(d=>{if(daysBetween(b,d)<=2){b=d;n++;}else{runs.push([a,b,n]);a=b=d;n=1;}});
    runs.push([a,b,n]);
    const long=runs.filter(x=>x[2]>=3).map(x=>`${md(x[0])}–${md(x[1])}（${x[2]} 天）`);
    if(long.length)out.push(`  ${h.l}：${long.join('、')}`);
  });
  return out;
}
function trendLines(dates){
  const mk=monthKeyOf(dates[0]),keys=trendMonths(mk);if(!keys.length)return [];
  const L=['━━━ 跨月對照 ━━━','月份｜日記｜TDL｜睡眠紀錄｜平均入睡｜平均睡眠｜運動｜飲食｜喝水｜不舒服（天數）'];
  keys.map(monthStat).forEach(r=>L.push(`${r.key}｜${r.diary}｜${r.tdl}｜${r.sleep}｜${r.bed||'—'}｜${durTxt(r.dur)}｜${r.move}｜${r.diet}｜${r.water}｜${r.sick}`));
  const cur=monthStat(mk);
  if(cur.recovery.length)L.push(`這個月作息特別亂的日子（凌晨 4 點後才睡或中午後才起）：${rangeTxt(cur.recovery)}。看數字時請分開看，原因不一定是沒做到。`);
  const runs=habitRuns(keys);
  if(runs.length)L.push('習慣的連續段（3 天以上，中間空一天算同一段）：',...runs);
  L.push('說明：欄位天數少可能只是沒記錄，不等於沒做。');
  return L;
}
function renderTrend(dates){
  const el=document.getElementById('mo-trend');if(!el)return;
  const mk=monthKeyOf(dates[0]),keys=trendMonths(mk);
  if(keys.length<2){el.innerHTML='';el.hidden=true;return;}
  el.hidden=false;
  const stats=keys.map(monthStat),cur=stats.find(x=>x.key===mk);
  el.innerHTML=`<div class="gcard dt-card"><div class="sec-hd">跨月對照</div><div class="dt-wrap"><table class="ds-table"><thead><tr><th>月份</th><th>日記</th><th>TDL</th><th>睡眠紀錄</th><th>平均入睡</th><th>平均睡眠</th><th>運動</th><th>飲食</th><th>喝水</th><th>不舒服</th></tr></thead><tbody>
    ${stats.map(r=>`<tr${r.key===mk?' class="today"':''}><td>${+r.key.slice(5)} 月</td><td>${r.diary}</td><td>${r.tdl}</td><td>${r.sleep}</td><td>${r.bed||'—'}</td><td>${durTxt(r.dur)}</td><td>${r.move}</td><td>${r.diet}</td><td>${r.water}</td><td>${r.sick}</td></tr>`).join('')}
    </tbody></table></div><div class="goal-sub muted" style="margin-top:8px;">單位是天。天數少可能只是沒記錄，不等於沒做。${cur&&cur.recovery.length?` · 作息特別亂的日子：${esc(rangeTxt(cur.recovery))}`:''}</div></div>`;
}
// ══ 搜尋全部紀錄 ══════════════════════════════════
const SEARCH_FIELDS=[['hl','Highlights'],['rf','Reflection'],['gr','Gratitude'],['quote','金句']];
function searchRecords(q){
  q=String(q||'').trim().toLowerCase();if(!q)return [];
  const days=[...new Set([...(S.entries||[]).map(e=>e.date),...Object.keys(S.calNotes||{}),curDay()])].sort().reverse(),out=[];
  days.forEach(day=>{
    const x=dayRec(day),h=x.health||{},push=(label,text)=>{if(text&&String(text).toLowerCase().indexOf(q)>=0)out.push({day,label,text:String(text)});};
    SEARCH_FIELDS.forEach(([k,l])=>push(l,x.diary[k]));
    push('備註',S.calNotes&&S.calNotes[day]);push('狀況',(h.dayTags||[]).join('、'));
    x.items.forEach(it=>push('TDL',(it.theme?it.theme+'：':'')+(it.task||'')));
    push('睡眠備註',h.sleep&&h.sleep.note);push('飲食',h.diet&&[...(h.diet.tags||[]),h.diet.note].filter(Boolean).join('、'));push('運動備註',h.exercise&&h.exercise.note);
  });
  return out;
}
function snippetHTML(text,q){
  const low=text.toLowerCase(),at=low.indexOf(q.toLowerCase());
  const a=Math.max(0,at-50),b=Math.min(text.length,at+q.length+90);
  const part=(a>0?'…':'')+text.slice(a,at),hit=text.slice(at,at+q.length),rest=text.slice(at+q.length,b)+(b<text.length?'…':'');
  return esc(part)+'<mark>'+esc(hit)+'</mark>'+esc(rest);
}
function renderSearch(q){
  const box=document.getElementById('rv-search-results');if(!box)return;
  q=String(q||'').trim();
  if(!q){box.hidden=true;box.innerHTML='';return;}
  const hits=searchRecords(q);box.hidden=false;
  box.innerHTML=`<div class="gcard"><div class="sec-hd">「${esc(q)}」找到 ${hits.length} 筆${hits.length>60?'（顯示最新 60 筆）':''}</div>
    ${hits.length?`<div class="sr-list">${hits.slice(0,60).map(x=>{
      const links=(x.text.match(/https?:\/\/[^\s，。）)]+/g)||[]).slice(0,3);
      return `<div class="sr-row" data-day="${esc(x.day)}" title="打開這一天"><span class="sr-d">${md(x.day)}</span><span class="sr-l">${esc(x.label)}</span>
        <span class="sr-t">${snippetHTML(x.text,q)}${links.map(u=>`<a class="sr-link" href="${esc(u)}" target="_blank" rel="noopener">開連結</a>`).join('')}</span></div>`;}).join('')}</div>`
    :'<div class="goal-sub muted">沒有找到。可以試更短的字，或搜「http」看所有存下來的連結。</div>'}</div>`;
}
(function(){
  const inp=document.getElementById('rv-search'),box=document.getElementById('rv-search-results');if(!inp||!box)return;
  let t=null;
  inp.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(()=>renderSearch(inp.value),180);});
  inp.addEventListener('keydown',e=>{if(e.key==='Escape'){inp.value='';renderSearch('');}});
  box.addEventListener('click',e=>{
    if(e.target.closest('a'))return;
    const r=e.target.closest('.sr-row');if(!r)return;
    viewDate=r.dataset.day===curDay()?null:r.dataset.day;applyViewDate(true);
  });
})();
// 這晚的每一步：做了／跳過／沒做（只有其中有動作才列）
function nightLine(day){
  const r=routine(day);if(!r)return '';
  if(!r.steps.some(x=>x.done||x.skipped))return '';
  return '🌙 睡前流程（目標 '+r.p.bed+' 上床）：'+r.steps.map(x=>{
    const t=(x.k==='phone'||x.k==='bed')&&x.done?clock(x.done):x.at;
    return `${t} ${x.label} ${x.done?'✓':(x.skipped?'跳過':'沒做')}`;
  }).join('｜');
}
// 這一天的最低標準狀況（給每日明細用）
function rhythmLine(day){
  const pl=planOf(),items=rhyItems();if(!pl||!items.length)return '';
  const per=dayPeriod(day);if(per&&per.mode==='pause')return `🧭 最低標準：習慣暫停（${per.label}）`;
  const parts=items.map(it=>{const r=rhyDay(it,day);return `${it.label} ${r.target?'理想✓':(r.floor?'最低✓':'—')}`;});   // 沒做到或沒記錄都用「—」，不寫叉叉
  return `🧭 最低標準（${per?(per.mode==='rest'?'低能量日·':'趕工日·')+per.label:'平常日'}）：${parts.join('｜')}`;
}
// 計畫的期間摘要：趕工週、檢查日、最低標準統計、待確認
function planLines(dates){
  const pl=planOf(),L=[];
  {const bg=bodyGoal(),pm=bg&&bg.weightPerMonth!==undefined?(+bg.weightPerMonth||0):1,t=C.weightTrend(weightList(),curDay(),pm);
   if(t&&t.recent!=null){
     const inRange=weightList().filter(x=>x.day>=dates[0]&&x.day<=dates[dates.length-1]);
     L.push(`⚖️ 體重（看平均，一天的數字會跳）：這段期間記了 ${inRange.length} 天；近 7 天平均 ${t.recent} kg`+(t.ready?`，起點 ${t.start}（${md(t.first)} 起），比起點 ${wSign(t.delta)}`+(t.expect!=null?`；每月 −${pm} 的速度現在約 ${wSign(t.expect)}`:''):'（記滿兩週才開始跟起點比）'));}}
  {const lows=dates.filter(x=>x<=curDay()&&isRestDay(x));
   if(lows.length)L.push(`🌙 低能量日 ${lows.length} 天（月經或不舒服；這幾天只要求睡飽，不計失敗）：${lows.slice(0,12).map(md).join('、')}${lows.length>12?'…':''}`);}
  if(!pl)return L;
  const first=dates[0],last=dates[dates.length-1],past=dates.filter(x=>x<=curDay());
  const per=live(pl.periods).filter(x=>x.from<=last&&x.to>=first);
  if(per.length)L.push('🛡 這段期間的趕工週與暫停：'+per.map(x=>`${md(x.from)}–${md(x.to)} ${x.label}${x.mode==='pause'?'（習慣暫停，不計失敗）':''}`).join('；'));
  const cps=allCheckpoints().filter(x=>x.c.due&&((x.c.due>=first&&x.c.due<=last)||(!x.c.result&&x.c.due<first))).sort(byDue);
  if(cps.length){L.push('◆ 檢查日（先寫好沒達標就怎麼做，到那天照表決定）：');
    cps.forEach(x=>{const r=x.c.result,sl=spWanted(x.g,x.c)?speedLine(x.g):'';L.push(`  ${md(x.c.due)} ${x.g.title}：${x.c.title}｜看什麼：${x.c.check||'—'}｜門檻：${x.c.bar||'—'}｜沒達標就：${x.c.fallback||'—'}${sl?'｜'+sl:''}｜結果：${r?(r.ok?'達標（'+md(r.on)+'）':'沒達標（'+md(r.on)+'）'+(x.c.decision?'，我決定：'+x.c.decision:'')):(x.c.due<curDay()?'還沒檢查（已過期）':'還沒到')}`);});}
  const items=rhyItems();
  if(items.length&&past.length){
    const active=past.filter(day=>{const p=C.periodOf(pl,day);return !(p&&p.mode==='pause');});
    const rec=active.filter(day=>{const x=dayRec(day);return x.checked.length||x.items.length||Object.values(x.diary).some(Boolean)||healthAny(x.health);});
    L.push(`🧭 每天的最低標準（有記錄的 ${rec.length} 天；沒記錄的日子不算沒做到；習慣暫停的日子不算）：`);
    items.forEach(it=>{
      let f=0,t=0,ff=0,fn=0,tf=0,tn=0;
      rec.forEach(day=>{const r=rhyDay(it,day),floorDay=!!C.periodOf(pl,day);if(floorDay){fn++;if(r.floor)ff++;}else{tn++;if(r.floor)tf++;}if(r.floor)f++;if(r.target)t++;});
      L.push(`  ${it.label}：最低版 ${f}/${rec.length} 天（趕工日 ${ff}/${fn}、平常日 ${tf}/${tn}）｜理想版做到 ${t} 天${it.weekly?`（每週理想 ${it.weekly} 次）`:''}｜最低：${it.floor||'—'}${it.target?'｜理想：'+it.target:''}`);
    });
  }
  const td=live(pl.todos).filter(x=>!x.done);
  if(td.length)L.push('☐ 還沒確認的事：'+td.map(x=>x.text+(x.due?`（${md(x.due)} 前）`:'')).join('；'));
  return L;
}
// 匯出的期間補充：回顧頁或狀態裡有，但每日明細放不進去的
function periodExtraLines(dates){
  const L=[],f=data(),first=dates[0],last=dates[dates.length-1];
  L.push(...planLines(dates));
  const inP=ts=>{if(!ts)return false;const x=C.dateKey(new Date(ts));return x>=first&&x<=last;};
  // 不適日、狀況
  const tagged={};dates.filter(d=>d<=curDay()).forEach(d=>((health(d)||{}).dayTags||[]).forEach(t=>{(tagged[t]=tagged[t]||[]).push(d);}));
  if(Object.keys(tagged).length)L.push('🏷 狀況標記：'+Object.keys(tagged).map(t=>`${t} ${tagged[t].length} 天（${rangeTxt(tagged[t])}）`).join('；'));
  // 作息計畫改動
  const rev=f.revisions.filter(p=>p.effectiveFrom>=first&&p.effectiveFrom<=last);
  if(rev.length)L.push('🌙 作息改動：'+rev.map(p=>`${md(p.effectiveFrom)} 起 ${p.phone} 收手機／${p.bed} 上床／${p.wake} 起床${p.status==='paused'?'（暫停）':''}`).join('；'));
  // 誇誇牆
  const praise=(S.treasures||[]).filter(t=>t&&t.type==='praise'&&inP(t.ts));
  if(praise.length){L.push('💛 誇誇牆新增：');praise.forEach(t=>L.push(`  ${md(C.dateKey(new Date(t.ts)))} ${t.title||''}：${t.desc||'（圖片）'}${t.mine?'｜我也覺得：'+t.mine:''}${t.thanks?'｜回贈：'+t.thanks:''}`));}
  // EXP 明細（App 只留最近 100 筆）
  const log=(S.expLog||[]).filter(x=>inP(x.t));
  if(log.length){L.push(`⭐ EXP 明細（App 只保留最近 100 筆，共 ${log.length} 筆在這段期間）：`);log.forEach(x=>L.push(`  ${md(C.dateKey(new Date(x.t)))} ${x.d>0?'+':''}${x.d} ${x.r||''}`));}
  // 目前狀態
  const achieved=(S.achievements||[]).length;
  L.push(`🌳 目前狀態：累積 ${S.exp||0} EXP（Lv.${Math.floor((S.exp||0)/100)+1}）｜連續 ${S.streak||0} 天｜樹上小蘋果 ${(S.apples||[]).length||0}、大蘋果 ${S.bigApples||0}、金果 ${S.goldFruits||0}、樹苗 ${S.seedlings||0}、新樹 ${S.trees||0}｜草地的花 ${(S.flowers||[]).length||0}｜成就 ${achieved} 個`);
  L.push('');
  return L;
}
// 便利貼上勾了目標的那一步（index.html 呼叫）：不用再去目標卡和習慣各勾一次
function onStepToggle(item,done,day){
  if(!item||!item.goalId)return;
  const g=data().projects.find(x=>x.id===item.goalId);if(!g||g.kind==='body')return;
  const m=(g.milestones||[]).find(x=>x.title.trim()===String(item.task||'').trim());
  if(done&&day===curDay())autoHabit('create');
  if(!m)return;
  if(done&&!m.done){m.done=true;m.doneOn=day;saveGoal(g);softToast(`🎉 「${m.title}」完成了`,2400);}
  else if(!done&&m.done&&m.doneOn===day){m.done=false;delete m.doneOn;saveGoal(g);}
}
window.FocusUI={
  onStepToggle,trendLines,renderTrend,nightLine,periodExtraLines,rhythmLine,isLowEnergy:isRestDay,
  updateCount,
  periodGoals,reviewHTML,copyLines,loopReviewHTML,loopCopyLines,loopRequestLines,renderInsights,
  render(){render(false);},
  setCloudSupport(v){cloudSupported=v;if(v)cloudReady=true;render(false);},
  exportLines(){
    const f=data();
    return ['','━━━ 目標與作息 ━━━',
      ...f.projects.map(p=>p.title+' · '+p.status+' · '+(p.dueDate||'無日期')+(p.event?' '+p.event:'')+
        (p.kind==='body'?'':'\n階段：'+((p.milestones||[]).map(m=>(m.done?'✓':'○')+m.title).join(' → ')||'未設定')+'\n今天這一步：'+(p.next?.text||'')+(speedLine(p)?'\n'+speedLine(p):''))),
      ...f.revisions.map(p=>p.effectiveFrom+' 起：'+p.phone+' 收手機／'+p.bed+' 上床／'+p.wake+' 起床 · '+p.status),
      ...S.entries.filter(e=>e.health?.sleep?.windDown||e.health?.body?.shoulder).map(e=>e.date+'：收手機 '+(clock(e.health.sleep?.windDown?.phoneAwayAt)||'—')+'／上床 '+(clock(e.health.sleep?.windDown?.inBedAt)||'—')+(e.health.body?.shoulder?'／肩背 ✓':''))];
  }
};
seed();
seedExtras();
render(true);
})();
