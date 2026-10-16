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
  goalrow:document.getElementById('focus-goalrow'),moves:document.getElementById('focus-moves'),
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
let editing='',cloudSupported=null,justDone='';

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
function projectGoal(){return goals().find(g=>g.kind!=='body');}
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
function weekStats(d){
  const f=data(),mon=mondayOfDs(d);let move=0,shoulder=0,bed=0;
  for(let i=0;i<7;i++){
    const day=shiftDay(mon,i);if(day>d)break;
    const h=health(day)||{};
    if(exTypesOf(h.exercise).length)move++;
    if(h.body&&h.body.shoulder)shoulder++;
    const wd=h.sleep&&h.sleep.windDown;
    if(wd&&C.result(wd,C.planFor(f,day),day,new Date()).kind==='onTime')bed++;
  }
  return {move,shoulder,bed};
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
  const bg=bodyGoal(),wantSh=!!(bg&&(+((bg.targets||{}).shoulder)||0)>0);
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
function isEvening(){
  const d=ds();if(d!==curDay())return false;
  const r=routine(d);if(!r)return false;
  const core=r.steps.find(x=>x.k==='off'),bed=r.steps.find(x=>x.k==='bed'),now=new Date();
  return now>=new Date(core.abs-90*60000)&&now<new Date(+bed.abs+180*60000);
}
// 階段清單預設展開（按「階段 ▴」收起來，會記住）
function heroOpen(){try{return localStorage.getItem('grandol_hero_ms')!=='0';}catch(e){return true;}}
// 今天頁的目標卡：每一個欄位都可以直接點了改（名稱、日期、🚩、這一步、沒電版本），✏️ 打開完整編輯
function nowCard(){
  const d=ds();if(d!==curDay())return '';                 // 補記過去的日子不顯示
  const pg=projectGoal();if(!pg)return '';
  const ms=pg.milestones||[],done=ms.filter(m=>m.done).length,curI=ms.findIndex(m=>!m.done);
  let meta='';
  if(pg.dueDate){const left=daysBetween(d,pg.dueDate);meta=`截止 ${md(pg.dueDate)} · ${left<0?'<b class="warn">已過 '+(-left)+' 天</b>':(left===0?'今天':'還有 '+left+' 天')}`;}
  const hard=ms.filter(m=>!m.done&&m.due&&m.hard).sort((x,y)=>x.due.localeCompare(y.due))[0];
  if(hard&&daysBetween(d,hard.due)<=5)meta+=`${meta?' · ':''}<b class="warn">🚩 ${esc(hard.title)} ${md(hard.due)}</b>`;
  const n=pg.next||{};
  const i=n.id?stickyCtx().items.findIndex(x=>x.id===n.id):-1;
  const isDone=i>=0&&!!stickyCtx().done['t'+i];
  const cur=curI>=0?ms[curI]:null;
  let main;
  if(!n.text||justDone===pg.id){
    main=`<div class="hero-main"><input class="goal-in" data-next-in="${esc(pg.id)}" maxlength="200"
        placeholder="${justDone===pg.id?'做完了 ✓ 下一步是？':(cur?'今天要做「'+esc(cur.title)+'」的哪一步？':'今天要做哪一步？')}"/>
      <button class="focus-btn primary" data-action="set-next" data-g="${esc(pg.id)}">好</button></div>`;
  }else{
    main=`<div class="hero-main"><input class="hero-step${isDone?' is-done':''}" data-step-text="${esc(pg.id)}" value="${esc(n.text)}" maxlength="200" title="點一下就可以改"/>
      <button class="focus-btn${isDone?' done':' primary'}" data-action="step-done" data-g="${esc(pg.id)}">${isDone?'✓ 完成了':'完成'}</button></div>
      ${isDone?'':`<div class="hero-sub"><span>沒電時：</span><input class="hero-small" data-small-text="${esc(pg.id)}" value="${esc(n.small||'')}" placeholder="寫一個最小版本（選填）" maxlength="200"/></div>`}`;
  }
  const segs=`<div class="hero-segs">${ms.map((m,k)=>`<span class="goal-seg${m.done?' done':(k===curI?' cur':'')}" title="${esc(m.title)}${m.due?' · '+md(m.due):''}"></span>`).join('')}
      <button class="hero-toggle" data-action="hero-ms">${ms.length?`階段 ${done}/${ms.length}`:'階段'} ${heroOpen()?'▴':'▾'}</button></div>`;
  const list=heroOpen()?`<div class="ms-list">${msEditRows(pg)}</div>`:'';
  return `<div class="gcard hero day"><div class="hero-top"><span>🎬 ${esc(pg.title)} · 今天這一步</span>
      <span class="hero-meta">${meta}</span><button class="card-edit" data-edit-goal="${esc(pg.id)}" title="名稱、截止日、狀態">✏️ 編輯</button></div>
    ${main}${segs}${list}</div>`;
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
  }).join('')+`<div class="ms-row ms-add"><span class="ms-dot">＋</span><input class="ms-title" data-ms-add="${gid}" placeholder="新增階段，可以順便打日期：送印 10/8" maxlength="70"/></div>`;
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
function msRows(g){
  const d=ds(),ms=g.milestones||[],cur=ms.findIndex(m=>!m.done);
  return ms.map((m,i)=>{
    let cls=m.done?' done':(i===cur?' cur':'');
    let date='';
    if(m.due){
      const left=daysBetween(d,m.due);
      if(!m.done&&left<0){cls=' over';date=`${md(m.due)} · 晚了 ${-left} 天`;}
      else if(i===cur)date=`${md(m.due)} · ${left===0?'今天':'還有 '+left+' 天'}`;
      else date=md(m.due);
      if(m.hard)date='🚩 '+date;
    }
    return `<div class="ms-row${cls}"><button class="ms-dot" data-ms="${i}" data-g="${esc(g.id)}" title="${m.done?'點一下取消完成':'點一下標成完成'}">${m.done?'✅':(i===cur?'🟡':'⚪')}</button>
      <span class="ms-name">${esc(m.title)}</span>${date?`<span class="ms-date${m.hard?' hard':''}">${date}</span>`:''}</div>`;
  }).join('');
}
function projectCard(g){
  const d=ds(),ms=g.milestones||[],cur=ms.findIndex(m=>!m.done);
  const rows=ms.map((m,i)=>{
    let cls=m.done?' done':(i===cur?' cur':'');
    let date='';
    if(m.due){
      const left=daysBetween(d,m.due);
      if(!m.done&&left<0){cls=' over';date=`${md(m.due)} · 晚了 ${-left} 天`;}
      else if(i===cur)date=`${md(m.due)} · ${left===0?'今天':'還有 '+left+' 天'}`;
      else date=md(m.due);
      if(m.hard)date='🚩 '+date;
    }
    return `<div class="ms-row${cls}"><button class="ms-dot" data-ms="${i}" data-g="${esc(g.id)}" title="${m.done?'點一下取消完成':'點一下標成完成'}">${m.done?'✅':(i===cur?'🟡':'⚪')}</button>
      <span class="ms-name">${esc(m.title)}</span>${date?`<span class="ms-date${m.hard?' hard':''}">${date}</span>`:''}</div>`;
  }).join('');
  const done=ms.filter(m=>m.done).length;
  let pace='';
  if(ms.length&&cur>=0&&!ms[cur].due&&g.dueDate){
    const left=daysBetween(d,g.dueDate)+1,rem=ms.length-done;
    if(left>0){const per=left/rem;pace=per>=1?`平均每 ${Math.floor(per*10)/10} 天要完成 1 段`:`平均每天要完成 ${Math.ceil(rem/left)} 段`;}
  }
  return `<div class="gcard goal-card"><div class="goal-hd"><span>${fi('1f3ac',20)}</span><span class="goal-title">${esc(g.title)}</span>
      <span class="goal-sub" style="margin-left:auto;">${dueTxt(g)}</span><button class="card-edit" data-edit-goal="${esc(g.id)}" title="編輯">✏️ 編輯</button></div>
    ${ms.length?`<div class="ms-list">${rows}</div><div class="goal-sub muted">${done}/${ms.length} 段${pace?' · '+pace:''}</div>`
      :`<div class="goal-sub muted">還沒拆階段。<a href="#" data-edit-goal="${esc(g.id)}" style="color:var(--secondary);">點這裡拆成幾段</a>，每段可以寫日期。</div>`}
  </div>`;
}
// ── 身體型目標卡：本週點點＋動一動 ──────────────
function bodyCard(g){
  const d=ds(),st=weekStats(d),t=g.targets||{};
  const rows=BODY_METRICS.filter(m=>(+t[m.k]||0)>0).map(m=>{
    const n=st[m.k],goal=+t[m.k];
    return `<div class="dots-row${n>=goal?' hit':''}"><span class="dl">${m.l}</span><span class="dd">${Array.from({length:goal},(_,i)=>`<i class="${i<n?'on':''}"></i>`).join('')}</span><span class="dn">${n}/${goal}</span></div>`;
  }).join('');
  return `<div class="gcard goal-card"><div class="goal-hd"><span>${fi('1f3c3',20)}</span><span class="goal-title">${esc(g.title)}</span>
      <span class="goal-sub" style="margin-left:auto;">${dueTxt(g)}</span><button class="card-edit" data-edit-goal="${esc(g.id)}" title="編輯">✏️ 編輯</button></div>
    ${rows?`<div class="goal-sub muted">本週（週一重新開始）</div><div style="display:flex;flex-direction:column;gap:7px;">${rows}</div>`:'<div class="goal-sub muted">還沒設每週目標，點 ✏️ 設定</div>'}
  </div>`;
}
// 今天的清單下面：動一動（每天的行動放在「今天」，體態目標只看本週）
function movesRow(){
  if(!bodyGoal())return '';
  const e=health(ds()).exercise||{},types=exTypesOf(e);
  const chips=MOVES.map(x=>{const on=types.indexOf(x.t)>=0;return `<button class="focus-btn${on?' done':''}" data-move="${esc(x.t)}" data-min="${x.m}">${esc(x.t)} ${x.m}${on?' ✓':''}</button>`;}).join('');
  return `<div class="moves-row"><span class="goal-sub" style="font-weight:700;">🌿 今天動一動</span>${chips}
    <button class="focus-btn${e.restDay?' rest':''}" data-action="rest">${e.restDay?'休息 ✓':'休息'}</button>
    ${types.length?`<span class="goal-sub muted">${esc(types.join('、'))} · ${+e.duration||0} 分</span>`:''}</div>`;
}
// ── 今天頁：目標一條（點開看詳細）────────────────
function stripOpen(){try{return localStorage.getItem('grandol_strip')==='1';}catch(e){return false;}}
function goalStrip(gs){
  if(!gs.length)return '';
  const d=ds();
  const items=gs.map(g=>{
    if(g.kind==='body'){
      const st=weekStats(d),t=g.targets||{};
      const parts=BODY_METRICS.filter(m=>+t[m.k]).map(m=>`${m.l} ${st[m.k]}/${t[m.k]}`).join(' · ');
      return `<span class="gs-item">🏃 <b>${esc(g.title)}</b> · 本週 ${parts||'未設定'}</span>`;
    }
    const ms=g.milestones||[],cur=ms.find(m=>!m.done),done=ms.filter(m=>m.done).length;
    let curTxt='';
    if(cur){
      curTxt=esc(cur.title);
      if(cur.due){const left=daysBetween(d,cur.due);curTxt+=left<0?` <span class="gs-warn">晚了 ${-left} 天</span>`:(left<=2?` <span class="gs-warn">還有 ${left} 天</span>`:` 還有 ${left} 天`);}
    }
    const hard=ms.filter(m=>!m.done&&m.due&&m.hard).sort((a,b)=>a.due.localeCompare(b.due))[0];
    const hardTxt=hard&&daysBetween(d,hard.due)<=3?` · <span class="gs-warn">🚩 ${esc(hard.title)} ${md(hard.due)}</span>`:'';
    return `<span class="gs-item">🎬 <b>${esc(g.title)}</b> · ${ms.length?`階段 ${done}/${ms.length}${curTxt?' · '+curTxt:''}`:'還沒拆階段'}${hardTxt}</span>`;
  }).join('');
  const ev=gs.find(g=>g.kind==='body'&&g.dueDate);
  const open=stripOpen();
  return `<div class="gcard goal-strip" data-action="strip" title="點一下${open?'收起':'看詳細'}">${items}
    <span class="gs-more">${ev?esc((ev.event||'')+' '+daysBetween(d,ev.dueDate)+' 天')+' · ':''}${open?'收起 ▴':'詳細 ▾'}</span></div>`;
}
// ── 今天要做：清單最上面的「動畫這一步」───────────────
function goalRow(){
  const d=ds(),pg=projectGoal();if(!pg||d!==curDay())return '';
  const n=pg.next||{};
  if(!n.text||justDone===pg.id)
    return `<div class="goal-row"><span class="gr-tag">🎬 ${esc(pg.title)}</span>
      <input class="goal-in" data-next-in="${esc(pg.id)}" placeholder="${justDone===pg.id?'做完了 ✓ 下一步是？':'今天要做哪一步？'}" maxlength="200" style="flex:1;min-width:160px;"/>
      <button class="focus-btn primary" data-action="set-next" data-g="${esc(pg.id)}">好</button></div>`;
  // 已經在清單裡 → 清單那一列會用金色標出來，這裡不重複
  if(stickyCtx().items.some(x=>x.id===n.id))return '';
  return `<div class="goal-row"><button class="ms-dot" data-action="step-done" data-g="${esc(pg.id)}" title="完成">⬜</button>
    <span class="gr-txt">${esc(n.text)}</span><span class="gr-tag">🎬 動畫這一步${n.small?' · 沒電時：'+esc(n.small):''}</span></div>`;
}
// 實驗：跟 TDL 長得一樣的一列
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
function moveChips(){
  if(!bodyGoal())return '';
  const e=health(ds()).exercise||{},types=exTypesOf(e);
  return `<div class="also-chips">${MOVES.map(x=>{const on=types.indexOf(x.t)>=0;return `<button class="focus-btn${on?' done':''}" data-move="${esc(x.t)}" data-min="${x.m}">${esc(x.t)} ${x.m}${on?' ✓':''}</button>`;}).join('')}
    <button class="focus-btn${e.restDay?' rest':''}" data-action="rest">${e.restDay?'休息 ✓':'休息'}</button></div>`;
}
// ── 收工面板：今天沒做完的（不順延＝如實記成沒完成）＋把動畫下一步排到明天 ──
function undoneList(){
  const c=stickyCtx();if(!c.todayMode)return '';
  const rows=c.items.map((x,i)=>({x,i})).filter(o=>!c.done['t'+o.i]);
  if(!rows.length){
    const pg=projectGoal(),n=pg&&pg.next,j=n?c.items.findIndex(x=>x.id===n.id):-1;
    const stepLeft=n&&n.text&&!(j>=0&&c.done['t'+j]);
    return stepLeft?`<div class="goal-sub" style="margin-bottom:10px;">清單做完了，還差動畫這一步：${esc(n.text)}</div>`
      :`<div class="goal-sub ok" style="margin-bottom:10px;">今天的清單都做完了 🎉</div>`;
  }
  return `<div class="goal-sub" style="font-weight:700;margin-bottom:4px;">今天還沒做完的 <span class="goal-sub muted" style="font-weight:500;">（不順延就照實記成沒完成）</span></div>
    ${rows.map(o=>`<div class="undone-row"><span>${o.x.theme?esc(o.x.theme)+'：':''}${esc(o.x.task)}${(+o.x.c||0)?' <span class="goal-sub muted">⏩'+o.x.c+'</span>':''}</span>
      <button class="focus-btn" data-postpone="${o.i}">⏩ 排到明天</button></div>`).join('')}
    <div style="height:10px;"></div>`;
}
function bringNext(){
  const pg=projectGoal();if(!pg||!pg.next||!pg.next.text)return '';
  const id=pg.next.id;
  if((typeof tdlRows!=='undefined'&&tdlRows.some(r=>r.id===id))||(S.tomorrowTDL||[]).some(r=>r.id===id))return '';
  const c=stickyCtx(),i=c.items.findIndex(x=>x.id===id);
  if(i>=0&&c.done['t'+i])return '';            // 今天已經做完的就不用帶
  if(i>=0)return '';                            // 還在今天的清單 → 上面「沒做完的」可以直接排到明天
  return `<button class="focus-btn" data-action="bring-next" data-g="${esc(pg.id)}" style="margin-top:8px;">＋ 把「${esc(pg.next.text)}」排到明天</button>`;
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
function goalListCard(gs){
  const rows=gs.map(g=>{
    let sub='';
    if(g.kind==='body'){const t=g.targets||{};sub=BODY_METRICS.filter(m=>+t[m.k]).map(m=>m.l+' '+t[m.k]+m.unit).join('・')||'還沒設每週目標';}
    else{const ms=g.milestones||[];sub=ms.length?`階段 ${ms.filter(m=>m.done).length}/${ms.length}`:'還沒拆階段';}
    return `<div class="dots-row" style="padding:7px 0;border-top:1px solid rgba(var(--secondary-rgb),.15);">
      <span>${g.kind==='body'?'🏃':'🎬'}</span><span style="flex:1;min-width:0;font-weight:700;color:var(--tc);">${esc(g.title)}</span>
      <span class="goal-sub muted">${sub}${g.dueDate?' · '+dueTxt(g):''}</span>
      <button class="card-edit" data-edit-goal="${esc(g.id)}" title="編輯">✏️ 編輯</button></div>`;
  }).join('');
  return `<div class="gcard" style="margin-bottom:12px;"><div class="goal-hd"><span>🎯</span><span class="goal-title">這陣子的目標</span>
    <span class="goal-sub muted" style="margin-left:auto;">卡片在「今天」</span></div>
    ${rows||'<div class="goal-sub muted" style="margin-top:6px;">還沒有目標。</div>'}
    <div class="goal-chips" style="margin-top:10px;"><button class="focus-btn" data-action="more">＋ 新增目標・封存・備份</button></div></div>`;
}
// 方向頁：作息一覽＋所有進行中的實驗
function planSummaryCard(){
  const p=C.planFor(data(),ds());
  const r=p?routine(ds()):null;
  const ex=r?r.steps.filter(x=>x.k!=='phone'&&x.k!=='bed').map(x=>`${esc(x.at)} ${esc(x.label)}`).join('、'):'';
  return `<div class="gcard" style="margin-bottom:12px;"><div class="goal-hd"><span>${fi('1f319',19)}</span><span class="goal-title">作息與睡前流程</span>
    <button class="card-edit" data-action="edit-plan" title="改時間、改每一步" style="margin-left:auto;">✏️ 編輯</button></div>
    ${p?`<div class="goal-sub" style="margin-top:6px;">${p.status==='paused'?'（暫停中）':''}${esc(p.phone)} 收手機 · <b>${esc(p.bed)} 上床</b> · ${esc(p.wake)} 起床</div>
      <div class="goal-sub muted" style="margin-top:3px;">${ex||'收手機前沒有其他步驟'}</div>`
      :`<div class="goal-sub muted" style="margin-top:6px;">還沒設定。<a href="#" data-action="edit-plan" style="color:var(--secondary);">設定想幾點上床</a></div>`}</div>`;
}
function expOverviewCard(){
  const list=data().experiments.filter(e=>e.status!=='archived');
  return `<div class="gcard" style="margin-bottom:12px;"><div class="goal-hd"><span>🧪</span><span class="goal-title">進行中的實驗</span>
    <span class="goal-sub muted" style="margin-left:auto;">回顧時決定，最多 3 個</span></div>
    ${list.length?list.map(e=>`<div class="dots-row" style="padding:6px 0;border-top:1px solid rgba(var(--secondary-rgb),.15);">
        <span style="flex:1;min-width:0;">${esc(e.text)}</span><span class="goal-sub muted">${expLabelFreq(e)} · ${PLACES[e.place]||''}</span>
        <button class="goal-more" data-exp-end="${esc(e.id)}" style="margin:0;">結束</button></div>`).join('')
      :'<div class="goal-sub muted" style="margin-top:6px;">還沒有。在「回顧」把 Claude 的建議貼回來，或自己加一個。</div>'}
    <div class="goal-chips" style="margin-top:10px;"><button class="focus-btn" data-loop-add="1">＋ 自己加一個實驗</button></div></div>`;
}
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
  const cells=r.steps.map(s=>{
    const isNext=r.next&&r.next.k===s.k;
    if(editing===s.k&&(s.k==='phone'||s.k==='bed'))
      return `<div class="tl-step next"><div class="t">幾點${esc(s.label)}？</div><input class="focus-time" type="time" data-edit="${s.k}" value="${esc(clock(s.done))}" style="width:88px;margin:3px auto 0;display:block;"/>
        <button class="focus-btn" data-action="clear-time" data-k="${s.k}" style="margin-top:4px;padding:3px 9px;">清除</button></div>`;
    const doneAt=(s.k==='phone'||s.k==='bed')?clock(s.done):'';
    const off=!s.done&&(s.skipped||s.missed);
    const step=`<button class="tl-step${s.done?' done':(isNext?' next':(off?' missed':''))}" data-step="${s.k}" title="${off?'沒做 · 補做了就點一下':(s.done?'點一下取消':'點一下＝做完了')}">
      <div class="t">${s.done&&doneAt?'✓ '+doneAt:(off?'沒做 · ':'')+esc(s.at)}</div><div class="n">${s.done&&!doneAt?'✓ ':''}${esc(s.label)}</div></button>`;
    if(!isNext||!live)return step;
    return `<div class="tl-now">${step}<button class="focus-btn" data-skip="${s.k}">跳過</button><button class="focus-btn primary" data-step="${s.k}">做完了</button></div>`;
  }).join('');
  const done=r.steps.filter(x=>x.done).length;
  return `<div class="gcard tonight-card${live?' live':''}"><div class="tn-hd"><span>${fi('1f319',18)}</span>
      <span class="tn-title">今晚 ${esc(r.p.bed)} 上床</span><span class="tn-count">${done}/${r.steps.length}</span>
      <button class="card-edit" data-action="edit-plan" title="改時間、改每一步">✏️ 編輯</button></div>
    <div class="tn-sub"><span class="${res.kind==='late'?'warn':''}">${res.kind==='missing'?(live?'現在這一步做完就按「做完了」':'點一下＝做完了'):esc(res.label)}</span>${sevenDots(d)}</div>
    <div class="tl">${cells}</div></div>`;
}
function sevenDots(d){
  const f=data();let out='';
  for(let n=6;n>=0;n--){
    const day=shiftDay(d,-n),wd=health(day).sleep?.windDown;
    const rr=C.result(wd,C.planFor(f,day),day,new Date());
    out+=`<span class="focus-dot${rr.kind==='onTime'?' ontime':(rr.kind==='late'?' late':'')}" title="${esc(md(day)+' '+rr.label)}"></span>`;
  }
  return `<span class="focus-dots" title="最近七晚：綠＝準時、金＝晚了、灰＝沒記錄">${out}</span>`;
}
function render(force){
  if(!mounts.length)return;
  const a=document.activeElement;
  const typing=inMounts(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName||'');
  if(typing&&!force)return;
  const keep={};$qa('[data-next-in]').forEach(x=>{if(x.value)keep[x.dataset.nextIn]=x.value;});
  const gs=goals();
  const cards=gs.map(g=>g.kind==='body'?bodyCard(g):projectCard(g)).join('');
  if(M.now)M.now.innerHTML=nowCard();
  if(M.today)M.today.innerHTML=expRows();
  if(M.tonight)M.tonight.innerHTML=tonightCard();
  // 短期目標卡放在「今天」：每天打開就看得到；「方向」只放一行一個的清單，用來調整
  if(M.cards)M.cards.innerHTML=gs.filter(g=>g.kind==='body').map(bodyCard).join('');
  {const pg=projectGoal(),tl=document.querySelector('.list-card');
   if(tl)tl.classList.toggle('hero-on',!!(pg&&pg.next&&pg.next.text&&ds()===curDay()));}
  if(M.goalrow)M.goalrow.innerHTML=goalRow();
  if(M.moves)M.moves.innerHTML=moveChips();
  if(M.undone)M.undone.innerHTML=undoneList();
  if(M.bring)M.bring.innerHTML=bringNext();
  updateCount();applyListTab();
  if(M.goals)M.goals.innerHTML=`${goalListCard(gs)}${planSummaryCard()}${expOverviewCard()}`;
  $qa('[data-next-in]').forEach(x=>{if(keep[x.dataset.nextIn])x.value=keep[x.dataset.nextIn];});
  if(editing==='phone'||editing==='bed')$q('[data-edit]')?.focus();
  if(justDone)$q(`[data-next-in="${justDone}"]`)?.focus();
  if(VIEWER_MODE)$qa('button,input').forEach(el=>{el.disabled=true;});
}
// 「現在要做」跟著時間走：每分鐘更新一次（打字中不動）
setInterval(()=>{if(!document.hidden)render(false);},60000);
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
      g.title=title;g.dueDate=due||'';g.milestones=list;g.status=m.querySelector('#ge-status').value;
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
function openBodyEditor(g){
  const t=g.targets||{};
  modal(`編輯：${esc(g.title)}`,`
    <div class="fm-lbl">名稱／日期／那一天是</div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 80px minmax(0,1fr);gap:6px;">
      <input class="fm-in" id="gb-title" value="${esc(g.title)}" maxlength="60"/>
      <input class="fm-in" id="gb-due" value="${esc(g.dueDate?md(g.dueDate):'')}" placeholder="10/31" maxlength="10"/>
      <input class="fm-in" id="gb-event" value="${esc(g.event||'')}" placeholder="例如：見朋友" maxlength="20"/></div>
    <div class="fm-lbl">每週目標（0＝不追這一項）</div>
    ${BODY_METRICS.map(mt=>`<div class="fm-step"><span class="fs-l">${mt.l}</span><button type="button" data-dec="${mt.k}">−</button>
      <span class="fs-n" id="gb-${mt.k}">${+t[mt.k]||0}</span><button type="button" data-inc="${mt.k}">＋</button><span style="width:18px;">${mt.unit}</span></div>`).join('')}
    <div class="fm-actions">
      <select class="fm-in" id="gb-status" style="width:auto;">${['active','paused','complete','archived'].map((x,i)=>`<option value="${x}"${g.status===x?' selected':''}>${['進行中','暫停','已完成','封存'][i]}</option>`).join('')}</select>
      <button class="focus-btn primary" id="gb-save" style="margin-left:auto;">儲存</button></div>`,
  (m,close)=>{
    m.querySelectorAll('[data-inc],[data-dec]').forEach(b=>b.addEventListener('click',()=>{
      const k=b.dataset.inc||b.dataset.dec,el=m.querySelector('#gb-'+k);
      el.textContent=Math.max(0,Math.min(7,(+el.textContent||0)+(b.dataset.inc?1:-1)));
    }));
    m.querySelector('#gb-save').addEventListener('click',()=>{
      const title=m.querySelector('#gb-title').value.trim();if(!title){softToast('目標要有名字',2400);return;}
      const raw=m.querySelector('#gb-due').value,due=raw.trim()?parseMD(raw):'';
      if(due===null){m.querySelector('#gb-due').classList.add('bad');softToast('日期看不懂，打成 10/31 這樣就好',2800);return;}
      g.title=title;g.dueDate=due||'';g.event=m.querySelector('#gb-event').value.trim();g.status=m.querySelector('#gb-status').value;
      g.targets={};BODY_METRICS.forEach(mt=>{g.targets[mt.k]=+m.querySelector('#gb-'+mt.k).textContent||0;});
      g.updatedAt=Date.now();sv(S);syncStateDebounced();close();softToast('存好了 ✓',2000);
    });
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
  const bg=bodyGoal(),wantSh=!!(bg&&(+((bg.targets||{}).shoulder)||0)>0);
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
function openMore(){
  const f=data(),archived=f.projects.filter(x=>x.status==='archived'||x.status==='complete');
  const cloud=!GAS_URL?'目前只存在這台裝置。':(cloudSupported===false?'⚠️ 後端還是舊版，目標還沒同步到雲端。':'');
  modal('新增目標・封存・備份',`
    ${cloud?`<div class="fm-hint" style="color:#B0602A;">${esc(cloud)}</div>`:''}
    <div class="fm-lbl">新增目標</div>
    <div class="goal-chips"><button class="focus-btn" data-new="project">🎬 作品型（有階段）</button><button class="focus-btn" data-new="body">🏃 身體型（每週次數）</button></div>
    ${archived.length?`<div class="fm-lbl">已完成／封存（點一下恢復）</div><div class="goal-chips">${archived.map(x=>`<button class="focus-btn" data-restore="${esc(x.id)}">${esc(x.title)}</button>`).join('')}</div>`:''}
    <div class="fm-lbl">備份</div>
    <div class="goal-chips" style="align-items:center;"><button class="focus-btn" id="gm-export">下載完整備份</button>
      <label class="fm-hint">還原目標與睡前紀錄 <input id="focus-import" type="file" accept="application/json,.json"/></label></div>`,
  (m,close)=>{
    m.querySelectorAll('[data-new]').forEach(b=>b.addEventListener('click',()=>{
      const isBody=b.dataset.new==='body';
      const g={id:uid(),kind:isBody?'body':'project',title:isBody?'新的身體目標':'新的作品',dueDate:'',event:'',status:'active',
        milestones:[],next:isBody?null:{id:uid(),text:'',small:''},targets:isBody?{move:3,shoulder:0,bed:0}:undefined,startOn:curDay(),createdAt:Date.now(),updatedAt:Date.now()};
      data().projects.push(g);sv(S);syncStateDebounced();m.remove();
      (isBody?openBodyEditor:openProjectEditor)(g);
    }));
    m.querySelectorAll('[data-restore]').forEach(b=>b.addEventListener('click',()=>{
      const g=data().projects.find(x=>x.id===b.dataset.restore);if(g){g.status='active';g.updatedAt=Date.now();sv(S);syncStateDebounced();}close();
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
  const el=ev.target.closest('[data-action],[data-move],[data-ms],[data-ms-flag],[data-ms-del],[data-edit-goal],[data-step],[data-skip],[data-postpone]');
  if(!el)return;
  if(el.tagName==='A')ev.preventDefault();
  if(el.dataset.editGoal){const g=data().projects.find(x=>x.id===el.dataset.editGoal);if(g)(g.kind==='body'?openBodyEditor:openProjectEditor)(g);return;}
  const a=el.dataset.action;
  if(a==='hero-ms'){try{localStorage.setItem('grandol_hero_ms',heroOpen()?'0':'1');}catch(e){}render(true);return;}
  if(a==='strip'){if(ev.target.closest('[data-edit-goal]'))return;try{localStorage.setItem('grandol_strip',stripOpen()?'0':'1');}catch(e){}render(true);return;}
  if(a==='edit-plan'){openPlanEditor();return;}
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
    saveGoal(g);if(m.done)softToast(`🎉 「${m.title}」完成了`,2400);return;
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
onMounts('keydown',ev=>{
  const t=ev.target;
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
  if(ev.key==='Enter'&&!isImeEnter(ev)&&t.dataset&&(t.dataset.msTitle!==undefined||t.dataset.msDue!==undefined||t.dataset.stepText!==undefined||t.dataset.smallText!==undefined)){
    ev.preventDefault();t.blur();return;
  }
  if(ev.key==='Escape'&&t.dataset&&(t.dataset.msTitle!==undefined||t.dataset.msDue!==undefined||t.dataset.stepText!==undefined||t.dataset.smallText!==undefined)){
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
onMounts('change',ev=>{
  const el=ev.target,dd=el.dataset||{};
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
  const f=data(),wd=health(day).sleep?.windDown;
  const r=C.result(wd,C.planFor(f,day),day,new Date());
  const t=(wd&&wd.targetSnapshot)||C.snapshot(C.planFor(f,day),day);
  // 今晚還沒到時間 → pending，不算「沒記錄」
  const kind=(r.kind==='missing'&&r.label==='尚未到時間')?'pending':r.kind;
  const n=health(day).night||{};
  return {day,target:t?t.bed:'',off:clock(n.off),phone:clock(wd&&wd.phoneAwayAt),bed:clock(wd&&wd.inBedAt),kind,label:r.label,delta:r.delta};
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
  goals().forEach(g=>{
    if(g.kind==='body'){
      const t=g.targets||{},c={move:0,shoulder:0,bed:0,rest:0,minutes:0};
      const start=bodyStart(g),counted=upto.filter(day=>day>=start);
      counted.forEach(day=>{
        const h=health(day)||{};
        if(exTypesOf(h.exercise).length){c.move++;c.minutes+=(+h.exercise.duration||0);}
        if(h.exercise&&h.exercise.restDay)c.rest++;
        if(h.body&&h.body.shoulder)c.shoulder++;
        if(nightInfo(day).kind==='onTime')c.bed++;
      });
      // 目標是「每週幾次」→ 依「目標開始後、到今天為止」的天數換算，
      // 不會出現目標才開始兩天、分母卻是整個月的情況
      const scale=counted.length/7;
      const want={};BODY_METRICS.forEach(m=>{const tt=+t[m.k]||0;want[m.k]=tt&&counted.length?Math.max(1,Math.round(tt*scale)):0;});
      // 上床看的是「已經過去的夜晚」：今晚還沒到，不算進分母
      const nightsPast=counted.filter(day=>nightInfo(day).kind!=='pending').length;
      if(+t.bed)want.bed=nightsPast?Math.max(1,Math.round(+t.bed*nightsPast/7)):0;
      out.push({g,kind:'body',c,want,days:counted.length,start});
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
  const nights=upto.map(nightInfo).filter(n=>n.target);
  return {goals:out,nights,last};
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
      const row=BODY_METRICS.filter(m=>x.want[m.k]>0).map(m=>{
        const n=x.c[m.k],w=x.want[m.k];
        return `<div class="goal-stat${n>=w?' hit':''}"><div class="goal-stat-l">${m.l}</div><div class="goal-stat-n">${n}<small> / ${w} ${m.unit}</small></div></div>`;
      }).join('');
      return `<div style="margin-bottom:12px;"><div class="goal-sub" style="font-weight:800;color:var(--tc);margin-bottom:6px;">${fi('1f3c3',16)} ${esc(x.g.title)}${x.g.dueDate?' · '+md(x.g.dueDate)+(x.g.event?' '+esc(x.g.event):''):''}</div>
        ${row?`<div class="goal-stats">${row}</div>`:''}
        <div class="goal-sub muted" style="margin-top:5px;">從 ${md(x.start)} 開始算 ${x.days} 天 · 活動共 ${x.c.minutes} 分鐘${x.c.rest?`，休息 ${x.c.rest} 天`:''}</div></div>`;
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
  return `<div class="gcard"><div class="sec-hd">🎯 目標進度</div>${blocks}${nights}</div>`;
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
      L.push('    每週目標：'+BODY_METRICS.filter(m=>(+((x.g.targets||{})[m.k])||0)>0).map(m=>m.l+' '+(+x.g.targets[m.k])+' '+m.unit).join('、'));
      L.push(`    ${label}實際（${md(x.start)} 開始算，共 ${x.days} 天）：`+BODY_METRICS.filter(m=>x.want[m.k]>0).map(m=>`${m.l} ${x.c[m.k]}/${x.want[m.k]} ${m.unit}`).join('、')+`；活動共 ${x.c.minutes} 分鐘${x.c.rest?`、休息 ${x.c.rest} 天`:''}`);
    }else{
      L.push(`  🎬 ${x.g.title}${x.g.dueDate?'：'+x.g.dueDate+' 截止':''}`);
      if(x.ms.length)L.push('    階段：'+x.ms.map(m=>(m.done?'✓':'○')+m.title+(m.due?'〔'+(m.hard?'🚩硬期限 ':'預計 ')+md(m.due)+'〕':'')+(m.doneOn?'(完成 '+md(m.doneOn)+')':'')).join(' → '));
      L.push(`    ${label}完成的階段：${x.doneIn.map(m=>m.title).join('、')||'無'}；每日一步完成 ${x.stepsDone}/${x.steps}`);
      x.stepList.forEach(s2=>L.push(`      ${s2.done?'✅':'⬜'} ${md(s2.day)} ${s2.task}`));
      L.push('    進度：'+paceText(x));
      if(x.g.next&&x.g.next.text)L.push('    目前的下一步：'+x.g.next.text+(x.g.next.small?'（沒電版：'+x.g.next.small+'）':''));
    }
  });
  const p=C.planFor(data(),P.last>curDay()?curDay():P.last);
  if(p)L.push(`  🌙 作息練習：${p.phone} 收手機、${p.bed} 上床、${p.wake} 起床${p.status==='paused'?'（暫停中）':''}`);
  if(P.nights.length){
    L.push(`  🌙 ${label}收尾：準時 ${P.nights.filter(n=>n.kind==='onTime').length} 晚、晚了 ${P.nights.filter(n=>n.kind==='late').length} 晚、沒記錄 ${P.nights.filter(n=>n.kind==='missing').length} 晚`);
    P.nights.forEach(n=>L.push(`      ${md(n.day)} 目標 ${n.target}｜收工 ${n.off||'—'}｜收手機 ${n.phone||'—'}｜上床 ${n.bed||'—'}｜${n.label}`));
  }
  L.push('');
  return L;
}
// ══ 回顧 → 實驗 → 每天 → 下次回顧 的迴圈 ══════════════════
// 回顧帶走最多 3 個「實驗」，放進 App 每天會看到的地方；下次回顧先檢查上次的實驗。
// 日記深讀的「我是怎樣的人」存成 insights，內心花園按月排成時間線。
const DEEP_PROMPT=['請從我這段期間的日記（Highlights／Reflection／Gratitude／金句）深讀，分成：',
'1. 人際關係：我常提到誰、和他們的互動帶給我什麼感受、有沒有變化',
'2. 內在：我反覆出現的想法、在意的事、對自己說話的語氣',
'3. 感受：情緒怎麼起伏，什麼時候輕鬆、什麼時候卡住',
'4. 進步：和上一期的觀察相比，我哪裡不一樣了',
'5. 我是怎樣一個人：3～5 個你從文字裡看到的特質',
'每一點都附上日記的日期或原句當證據，並分清楚「從文字看到的」和「你的推測」。語氣溫和但誠實，不要只說好聽的。'];
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
  return `<div class="gcard" style="margin-bottom:12px;"><div class="goal-hd" style="margin-bottom:8px;"><span>🧪</span><span class="goal-title">進行中的實驗</span>
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
  return `<div class="gcard"><div class="sec-hd">🧪 ${title}</div>
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
      const pk=prevMonthKey(monthKeyOf(dates[0])),prev=insightsShown().filter(x=>x.period===pk);
      if(prev.length){
        const re={yes:'（我覺得像我）',no:'（我覺得不太像）'};
        L.push('','上一期你看見的我（請和這次比較）：',...prev.map(x=>`  ${x.kind==='progress'?'✦ 進步':'◆ 特質'}：${x.text}${re[x.reaction]||''}`));
      }
    }
    L.push('');
  }
  L.push('最後請用這個格式整理（我會貼回 App）：');
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

window.FocusUI={
  updateCount,
  periodGoals,reviewHTML,copyLines,loopReviewHTML,loopCopyLines,loopRequestLines,renderInsights,
  render(){render(false);},
  setCloudSupport(v){cloudSupported=v;render(false);},
  exportLines(){
    const f=data();
    return ['','━━━ 目標與作息 ━━━',
      ...f.projects.map(p=>p.title+' · '+p.status+' · '+(p.dueDate||'無日期')+(p.event?' '+p.event:'')+
        (p.kind==='body'?'':'\n階段：'+((p.milestones||[]).map(m=>(m.done?'✓':'○')+m.title).join(' → ')||'未設定')+'\n今天這一步：'+(p.next?.text||''))),
      ...f.revisions.map(p=>p.effectiveFrom+' 起：'+p.phone+' 收手機／'+p.bed+' 上床／'+p.wake+' 起床 · '+p.status),
      ...S.entries.filter(e=>e.health?.sleep?.windDown||e.health?.body?.shoulder).map(e=>e.date+'：收手機 '+(clock(e.health.sleep?.windDown?.phoneAwayAt)||'—')+'／上床 '+(clock(e.health.sleep?.windDown?.inBedAt)||'—')+(e.health.body?.shoulder?'／肩背 ✓':''))];
  }
};
seed();
seedExtras();
render(true);
})();
