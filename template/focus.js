/* 🎯 目標優先的首頁（v123）
   ① 現在要做：依時間自動切換（白天＝動畫今天這一步；晚上＝睡前流程走到哪）
   ② 兩張目標卡：作品型＝階段清單（每段可有日期、硬期限紅旗）；身體型＝本週點點
   ③ 今晚時間軸：收工 → 肩背 → 洗澡 → 收手機 → 上床，點一下＝做完
   編輯一律用彈窗（點卡片上的 ✏️），不再是首頁下面一大片表單。
   每日紀錄仍存在既有的健康卡與 TDL：記一次，健康卡、便利貼、習慣都會一起更新。 */
(function(){
'use strict';
const C=FocusCore, hub=document.getElementById('focus-hub');
if(!hub)return;
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
function routine(d){
  const p=C.planFor(data(),d);
  if(!p||p.status==='paused')return null;
  const ph=toMin(p.phone),bd=toMin(p.bed);
  const bg=bodyGoal(),wantSh=!!(bg&&(+((bg.targets||{}).shoulder)||0)>0);
  const h=health(d),w=h.sleep?.windDown||{},n=h.night||{};
  const steps=[{k:'off',label:'收工',hint:'寫下明天第一步',at:hm(ph-60),done:n.off}];
  if(wantSh)steps.push({k:'shoulder',label:'肩背 30 分',hint:'到 '+hm(ph-20),at:hm(ph-50),done:h.body&&h.body.shoulder});
  steps.push({k:'shower',label:'洗澡洗漱',hint:'熱水澡幫助入睡',at:hm(ph-20),done:n.shower});
  steps.push({k:'phone',label:'收手機',hint:'放到床上拿不到的地方',at:p.phone,done:w.phoneAwayAt});
  steps.push({k:'bed',label:'上床',hint:'晚安 🌙',at:p.bed,done:w.inBedAt});
  const skip=n.skip||{},now=new Date();
  steps.forEach(s=>{s.abs=C.targetAt(d,s.at);s.skipped=!s.done&&!!skip[s.k];});
  // 現在這一步：第一個「還沒做、沒跳過」的步驟——但如果下一步的時間已經到了，
  // 就當它錯過了往前走，不會卡在沒做的那一步
  let next=null;
  for(let i=0;i<steps.length;i++){
    const st=steps[i];if(st.done||st.skipped)continue;
    const after=steps[i+1];
    if(!after||now<after.abs||d!==curDay()){next=st;break;}
    st.missed=true;
  }
  return {p,steps,next};
}
// ── ① 現在要做 ────────────────────────────────────
function nowCard(){
  const d=ds();if(d!==curDay())return '';                 // 補記過去的日子不顯示
  const now=new Date(),r=routine(d),pg=projectGoal();
  // 晚上：收工前 90 分鐘起，到上床後 3 小時
  if(r&&r.next){
    const first=r.steps[0].abs,bedAbs=r.steps[r.steps.length-1].abs;
    if(now>=new Date(first-90*60000)&&now<new Date(+bedAbs+180*60000)){
      const s=r.next,late=now>=s.abs;
      const mins=Math.round((s.abs-now)/60000);
      return `<div class="gcard now-card"><span class="now-ic">🌙</span><div class="now-txt">
        <div class="now-lbl">${late?'現在該做':'下一步 · 還有 '+(mins>=60?Math.floor(mins/60)+' 小時 '+(mins%60)+' 分':mins+' 分')}</div>
        <div class="now-main">${esc(s.at)} ${esc(s.label)}</div><div class="now-sub">${esc(s.hint)}</div></div>
        <div style="display:flex;gap:6px;"><button class="focus-btn" data-skip="${s.k}" title="今天沒做，先跳到下一步">跳過</button>
        <button class="focus-btn primary" data-step="${s.k}">做完了</button></div></div>`;
    }
  }
  if(!pg)return '';
  // 白天：動畫今天這一步；另外提醒快到的硬期限
  const ms=pg.milestones||[],cur=ms.find(m=>!m.done);
  let alert='';
  const hard=ms.filter(m=>!m.done&&m.due&&m.hard).sort((a,b)=>a.due.localeCompare(b.due))[0];
  if(hard){const left=daysBetween(d,hard.due);if(left<=3)alert=left<0?`🚩 ${hard.title} 已經過了期限 ${md(hard.due)}`:`🚩 ${hard.title} ${left===0?'就是今天':'還有 '+left+' 天'}（${md(hard.due)}）`;}
  else if(cur&&cur.due&&daysBetween(d,cur.due)<0)alert=`「${cur.title}」原定 ${md(cur.due)}，已經晚了 ${-daysBetween(d,cur.due)} 天`;
  const n=pg.next||{};
  const i=n.id?stickyCtx().items.findIndex(x=>x.id===n.id):-1;
  const isDone=i>=0&&!!stickyCtx().done['t'+i];
  if(!n.text||justDone===pg.id)
    return `<div class="gcard now-card"><span class="now-ic">🎬</span><div class="now-txt">
      <div class="now-lbl">${justDone===pg.id?'做完了 ✓ 下一步是？':esc(pg.title)+' · 今天要做哪一步？'}</div>
      <input class="goal-in" data-next-in="${esc(pg.id)}" placeholder="${cur?'例如：'+esc(cur.title)+'的第一部分':'今天這一小步'}" maxlength="200" style="margin-top:6px;width:100%;"/>
      ${alert?`<div class="now-sub alert">${esc(alert)}</div>`:''}</div>
      <button class="focus-btn primary" data-action="set-next" data-g="${esc(pg.id)}">好</button></div>`;
  return `<div class="gcard now-card"><span class="now-ic">${isDone?'🎉':'🎬'}</span><div class="now-txt">
    <div class="now-lbl">${isDone?'今天這一步完成了':'今天這一步'}${cur?' · '+esc(cur.title):''}</div>
    <div class="now-main">${esc(n.text)}</div>
    ${n.small&&!isDone?`<div class="now-sub">沒電時：${esc(n.small)}</div>`:''}
    ${alert?`<div class="now-sub alert">${esc(alert)}</div>`:''}</div>
    <button class="focus-btn${isDone?' done':' primary'}" data-action="step-done" data-g="${esc(pg.id)}">${isDone?'✓ 完成了':'完成'}</button></div>`;
}
// ── ② 作品型目標卡：階段清單 ─────────────────────
function dueTxt(g){
  if(!g.dueDate)return '';
  const left=daysBetween(ds(),g.dueDate);
  return `${md(g.dueDate)}${g.event?' '+esc(g.event):''} · ${left>0?left+' 天':(left===0?'今天':'已過 '+(-left)+' 天')}`;
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
      <span class="goal-sub" style="margin-left:auto;">${dueTxt(g)}</span><button class="goal-edit" data-edit-goal="${esc(g.id)}" title="編輯">✏️</button></div>
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
  const e=health(d).exercise||{},types=exTypesOf(e);
  const chips=MOVES.map(x=>{const on=types.indexOf(x.t)>=0;return `<button class="focus-btn${on?' done':''}" data-move="${esc(x.t)}" data-min="${x.m}">${esc(x.t)} ${x.m}${on?' ✓':''}</button>`;}).join('');
  return `<div class="gcard goal-card"><div class="goal-hd"><span>${fi('1f3c3',20)}</span><span class="goal-title">${esc(g.title)}</span>
      <span class="goal-sub" style="margin-left:auto;">${dueTxt(g)}</span><button class="goal-edit" data-edit-goal="${esc(g.id)}" title="編輯">✏️</button></div>
    ${rows?`<div class="goal-sub muted">本週（週一重新開始）</div><div style="display:flex;flex-direction:column;gap:7px;">${rows}</div>`:''}
    <div class="goal-step" style="display:block;"><div class="goal-chips">${chips}
      <button class="focus-btn${e.restDay?' rest':''}" data-action="rest">${e.restDay?'休息 ✓':'休息'}</button></div>
      ${types.length?`<div class="goal-sub muted" style="margin-top:6px;">今天：${esc(types.join('、'))} · ${+e.duration||0} 分鐘</div>`:''}</div>
  </div>`;
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
  const cells=r.steps.map(s=>{
    const isNext=r.next&&r.next.k===s.k;
    if(editing===s.k&&(s.k==='phone'||s.k==='bed'))
      return `<div class="tl-step next"><div class="t">幾點${esc(s.label)}？</div><input class="focus-time" type="time" data-edit="${s.k}" value="${esc(clock(s.done))}" style="width:88px;margin:3px auto 0;display:block;"/>
        <button class="focus-btn" data-action="clear-time" data-k="${s.k}" style="margin-top:4px;padding:3px 9px;">清除</button></div>`;
    const doneAt=(s.k==='phone'||s.k==='bed')?clock(s.done):'';
    const off=!s.done&&(s.skipped||s.missed);
    return `<button class="tl-step${s.done?' done':(isNext?' next':(off?' missed':''))}" data-step="${s.k}" title="${off?'沒做 · 補做了就點一下':esc(s.hint)}">
      <div class="t">${s.done&&doneAt?'✓ '+doneAt:(off?'沒做 · ':'')+esc(s.at)}</div><div class="n">${s.done&&!doneAt?'✓ ':''}${esc(s.label)}</div></button>`;
  }).join('');
  return `<div class="gcard" style="margin-bottom:12px;"><div class="goal-hd" style="margin-bottom:10px;"><span>${fi('1f319',19)}</span>
      <span class="goal-title">今晚 ${esc(r.p.bed)} 上床</span>
      <span class="goal-sub${res.kind==='late'?' warn':''}" style="margin-left:auto;">${res.kind==='missing'?'點一下＝做完了':esc(res.label)}</span>
      ${sevenDots(d)}<button class="goal-edit" data-action="edit-plan" title="調整時間">✏️</button></div>
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
  if(!hub)return;
  const a=document.activeElement;
  const typing=a&&hub.contains(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName||'');
  if(typing&&!force)return;
  const keep={};hub.querySelectorAll('[data-next-in]').forEach(x=>{if(x.value)keep[x.dataset.nextIn]=x.value;});
  const gs=goals();
  const cards=gs.map(g=>g.kind==='body'?bodyCard(g):projectCard(g)).join('');
  hub.innerHTML=`${nowCard()}${cards?`<div class="goal-grid">${cards}</div>`:''}${tonightCard()}
    <button class="goal-more" data-action="more">⚙️ 新增目標・封存・備份</button>`;
  hub.querySelectorAll('[data-next-in]').forEach(x=>{if(keep[x.dataset.nextIn])x.value=keep[x.dataset.nextIn];});
  if(editing==='phone'||editing==='bed')hub.querySelector('[data-edit]')?.focus();
  if(justDone)hub.querySelector(`[data-next-in="${justDone}"]`)?.focus();
  if(VIEWER_MODE)hub.querySelectorAll('button,input').forEach(el=>{el.disabled=true;});
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
function openPlanEditor(){
  const p=C.planFor(data(),ds());
  modal('調整今晚的時間',`
    <div class="fm-lbl">選一個階段（一次往前推一格就好）</div>
    <div class="goal-chips">${C.stages.map(x=>`<button type="button" class="focus-btn${p&&p.bed===x.bed&&p.phone===x.phone?' done':''}" data-stage="${x.id}">${x.bed} 上床</button>`).join('')}</div>
    <div class="fm-lbl">或自己設</div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;font-size:11px;color:var(--tc2);">
      <label>收手機<input class="fm-in" type="time" id="gp-phone" value="${esc(p?.phone||'00:30')}"/></label>
      <label>上床<input class="fm-in" type="time" id="gp-bed" value="${esc(p?.bed||'01:00')}"/></label>
      <label>起床<input class="fm-in" type="time" id="gp-wake" value="${esc(p?.wake||'08:30')}"/></label></div>
    <div class="fm-hint">收工、肩背、洗澡會依「收手機」自動往前推：收工＝前 60 分、肩背＝前 50 分、洗澡＝前 20 分。今晚起生效。</div>
    <div class="fm-actions"><button class="focus-btn" id="gp-pause">${p?.status==='paused'?'恢復練習':'先暫停'}</button>
      <button class="focus-btn primary" id="gp-save" style="margin-left:auto;">儲存</button></div>`,
  (m,close)=>{
    m.querySelectorAll('[data-stage]').forEach(b=>b.addEventListener('click',()=>{
      const s=C.stages.find(x=>x.id===b.dataset.stage);
      m.querySelector('#gp-phone').value=s.phone;m.querySelector('#gp-bed').value=s.bed;m.querySelector('#gp-wake').value=s.wake;
      m.querySelectorAll('[data-stage]').forEach(x=>x.classList.toggle('done',x===b));
    }));
    const push=status=>{
      const ph=m.querySelector('#gp-phone').value,bd=m.querySelector('#gp-bed').value,wk=m.querySelector('#gp-wake').value;
      if(![ph,bd,wk].every(C.validTime)){softToast('時間格式怪怪的',2400);return false;}
      if(C.targetAt(today(),ph)>C.targetAt(today(),bd)){softToast('收手機要在上床之前喔',2600);return false;}
      const st=C.stages.find(x=>x.phone===ph&&x.bed===bd);
      data().revisions.push({id:uid(),stageId:st?st.id:'custom',effectiveFrom:today(),phone:ph,bed:bd,wake:wk,status,updatedAt:Date.now()});
      sv(S);syncStateDebounced();return true;
    };
    m.querySelector('#gp-save').addEventListener('click',()=>{if(push('active')){close();softToast('今晚照這個時間 🌙',2200);}});
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
function ensureStepInToday(g){
  const c=stickyCtx();
  const i=c.items.findIndex(x=>x.id===g.next.id);
  if(i>=0)return i;
  const row={id:g.next.id,goalId:g.id,theme:g.title,task:g.next.text,c:0};
  if(c.todayMode){
    setTodayTDL([...c.items,row]);todayListEdited=true;markTodayListEdited();
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
function setNext(g,text){
  text=(text||'').trim();if(!text)return;
  document.activeElement?.blur();
  g.next={id:uid(),text,small:(g.next&&g.next.small)||''};
  justDone='';saveGoal(g);ensureStepInToday(g);render(true);
  softToast('排進今天的便利貼了 📋',2200);
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
hub.addEventListener('click',ev=>{
  const el=ev.target.closest('[data-action],[data-move],[data-ms],[data-edit-goal],[data-step],[data-skip]');
  if(!el)return;
  if(el.tagName==='A')ev.preventDefault();
  if(el.dataset.editGoal){const g=data().projects.find(x=>x.id===el.dataset.editGoal);if(g)(g.kind==='body'?openBodyEditor:openProjectEditor)(g);return;}
  const a=el.dataset.action;
  if(a==='edit-plan'){openPlanEditor();return;}
  if(a==='more'){openMore();return;}
  if(!writable())return;
  const d=ds();
  if(el.dataset.skip){
    const h=health(d);h.night={...(h.night||{})};h.night.skip={...(h.night.skip||{}),[el.dataset.skip]:Date.now()};
    saveHealth(d,h);softToast('沒關係，下一步就好 🌙',2000);return;
  }
  if(el.dataset.step){doStep(el.dataset.step);return;}
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
    const g=data().projects.find(x=>x.id===el.dataset.g),inp=hub.querySelector(`[data-next-in="${el.dataset.g}"]`);
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
    data().revisions.push({id:uid(),stageId:s.id,effectiveFrom:today(),phone:s.phone,bed:s.bed,wake:s.wake,status:'active',updatedAt:Date.now()});
    sv(S);syncStateDebounced();render(true);softToast(`🌙 今晚：${s.phone} 收手機、${s.bed} 上床`,3000);return;
  }
});
hub.addEventListener('keydown',ev=>{
  const inp=ev.target.closest('[data-next-in]');
  if(!inp||ev.key!=='Enter'||isImeEnter(ev))return;
  ev.preventDefault();
  const g=data().projects.find(x=>x.id===inp.dataset.nextIn);if(g)setNext(g,inp.value);
});
hub.addEventListener('focusout',ev=>{
  const inp=ev.target.closest('[data-next-in]');
  if(!inp||inp.value.trim())return;
  setTimeout(()=>{if(justDone&&!hub.contains(document.activeElement)){justDone='';render(true);}},150);
});
hub.addEventListener('change',ev=>{
  const el=ev.target;
  if(!el.dataset.edit||!writable())return;
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
window.FocusUI={
  periodGoals,reviewHTML,copyLines,
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
render(true);
})();
