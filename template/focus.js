/* 🎯 目標優先的首頁
   最上面兩張目標卡（作品型：階段＋今天這一步；身體型：本週三項），下面是今晚的收尾條。
   目標全部是資料、隨時可改（點卡片右上角的日期）。每日紀錄仍然存在既有的健康卡與 TDL，
   這裡按一下，健康卡、便利貼、習慣打勾會一起更新——記一次就好。 */
(function(){
'use strict';
const C=FocusCore, hub=document.getElementById('focus-hub');
if(!hub)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>(crypto.randomUUID?crypto.randomUUID():'id'+Date.now()+Math.random().toString(16).slice(2));
// 預設的動一動選項：點一下記錄，再點一下取消
const MOVES=[{t:'跑步',m:30},{t:'跳舞',m:30},{t:'走路',m:20},{t:'伸展',m:15}];
const SHOULDER_MIN=30;
const BODY_METRICS=[
  {k:'move',l:'每天動',unit:'天',def:7},
  {k:'shoulder',l:'肩背彈力帶',unit:'次',def:7},
  {k:'bed',l:'準時上床',unit:'晚',def:7}
];
let editing='',editGoal='',cloudSupported=null,justDone='';

function data(){S.focus=C.clean(S.focus);return S.focus;}
function ds(){return viewDate||curDay();}
function health(d){return d===curDay()?S.health:((S.entries||[]).find(e=>e.date===d)?.health||emptyHealth());}
function clock(t){if(!t)return '';const d=new Date(t);return isNaN(d)?'':String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function md(s){return s?(+s.slice(5,7))+'/'+(+s.slice(8,10)):'';}
function daysBetween(a,b){return Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/86400000);}
function writable(){if(VIEWER_MODE){softToast('監督模式是唯讀的 👀',2200);return false;}return true;}
function saveGoal(g){g.updatedAt=Date.now();sv(S);syncStateDebounced();render(true);}
// 第一次使用時放好兩個預設目標。用固定 id：兩台裝置各自建立也會在同步時合成同一個，
// updatedAt=0 讓任何真正的修改都優先。之後改名、改日期、封存都不會再被放回來。
function seed(){
  const f=data();
  if(!f.projects.some(p=>p.id==='seed-anim'))f.projects.push({id:'seed-anim',kind:'project',title:hub.dataset.project||'完成作品',
    dueDate:hub.dataset.due||'',status:'active',milestones:[],next:{id:'seed-anim-next',text:'',small:''},createdAt:0,updatedAt:0});
  if(!f.projects.some(p=>p.id==='seed-body'))f.projects.push({id:'seed-body',kind:'body',title:'體態',
    dueDate:hub.dataset.bodyDue||'',event:hub.dataset.bodyEvent||'',status:'active',
    targets:{move:7,shoulder:7,bed:7},milestones:[],next:null,startOn:curDay(),createdAt:0,updatedAt:0});
  S.focus=f;
}
function goals(){return data().projects.filter(p=>p.status==='active');}
// 寫進當天的健康紀錄：跟健康卡是同一份資料
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
// 記一次，習慣也跟著亮：沿用習慣卡本身的點擊（EXP、花朵、動畫都照原本的規則）
function autoHabit(k){
  if(!ctxIsToday()||S.checked[k])return;
  if(typeof isArchived==='function'&&isArchived(k))return;
  const chip=document.querySelector(`#habits .neo-chip[data-k="${k}"]`);
  if(chip)chip.click();
}
function updateWind(d,fn){
  const h=health(d);h.sleep=h.sleep||{};
  const p=C.planFor(data(),d),w=h.sleep.windDown||{nightDate:d,targetSnapshot:C.snapshot(p,d)};
  if(!w.targetSnapshot){softToast('先設定今晚想幾點上床 🌙',2600);return;}
  const before={...w};fn(w);
  w.updatedAt=Date.now();w.fieldUpdatedAt=w.fieldUpdatedAt||{};
  for(const k of ['phoneAwayAt','inBedAt','obstacle'])if(before[k]!==w[k])w.fieldUpdatedAt[k]=w.updatedAt;
  h.sleep.windDown=w;saveHealth(d,h);
  if(w.inBedAt&&C.result(w,p,d,new Date()).kind==='onTime'&&d===curDay())autoHabit('sleep');
}
// ── 本週統計（週一開始，不累積欠債）──────────────
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
  return {move,shoulder,bed,daysSoFar:daysBetween(mon,d)+1};
}
// ── 日期標籤：還有幾天 ───────────────────────────
function dueChip(g,cls){
  if(!g.dueDate)return `<button class="goal-due ${cls}" data-edit-goal="${esc(g.id)}">設定日期</button>`;
  const left=daysBetween(ds(),g.dueDate);
  const when=left>0?`還有 ${left} 天`:(left===0?'就是今天':`已過 ${-left} 天`);
  return `<button class="goal-due ${cls}${left<0?' late':''}" data-edit-goal="${esc(g.id)}" title="點一下編輯這個目標">${md(g.dueDate)}${g.event?' '+esc(g.event):''} · ${when}</button>`;
}
// ── 作品型目標（動畫）────────────────────────────
function projectCard(g){
  const ms=g.milestones||[],done=ms.filter(m=>m.done).length,cur=ms.findIndex(m=>!m.done);
  const segs=ms.length?`<div class="goal-segs">${ms.map((m,i)=>`<button class="goal-seg${m.done?' done':(i===cur?' cur':'')}" data-seg="${i}" data-g="${esc(g.id)}" title="${esc(m.title)}${m.done?'（完成，點一下取消）':'（點一下標成完成）'}"></button>`).join('')}</div>`:'';
  let status='';
  if(!ms.length)status=`<div class="goal-sub muted">還沒拆階段。<a href="#" data-edit-goal="${esc(g.id)}" style="color:var(--secondary);">拆成幾段</a>，就能看到自己跟不跟得上。</div>`;
  else if(cur<0)status=`<div class="goal-sub ok">全部階段完成了 🎉 確認成果後可以把目標封存</div>`;
  else{
    const remaining=ms.length-done;
    let pace='';
    if(g.dueDate){
      const left=daysBetween(ds(),g.dueDate)+1;          // 包含今天
      if(left<=0)pace=`<div class="goal-sub warn">已過截止日，還有 ${remaining} 段——要不要調整日期或範圍？</div>`;
      else{
        const per=left/remaining;
        pace=per>=1
          ?`<div class="goal-sub${per<2?' warn':''}">照這個速度：每 ${Math.floor(per*10)/10} 天要完成 1 段</div>`
          :`<div class="goal-sub warn">照這個速度：每天要完成 ${Math.ceil(remaining/left)} 段</div>`;
      }
    }
    status=`<div class="goal-sub">階段 ${done}/${ms.length} · 現在：${esc(ms[cur].title)}</div>${pace}`;
  }
  // 今天這一步
  const n=g.next||{};
  let step;
  if(justDone===g.id||!n.text){
    step=`<div class="goal-step"><div class="goal-step-txt" style="flex-basis:100%;"><div class="goal-step-lbl">${justDone===g.id?'做完了 ✓ 下一步是？':'今天這一步要做什麼？'}</div></div>
      <input class="goal-in" data-next-in="${esc(g.id)}" placeholder="例如：畫完第三段的中割" maxlength="200"/>
      <button class="focus-btn primary" data-action="set-next" data-g="${esc(g.id)}">好</button></div>`;
  }else{
    const list=(typeof stickyCtx==='function'?stickyCtx().items:[])||[];
    const i=list.findIndex(x=>x.id===n.id);
    const isDone=i>=0&&!!stickyCtx().done['t'+i];
    step=`<div class="goal-step"><div class="goal-step-txt"><div class="goal-step-lbl">今天這一步</div>
      <div class="goal-step-task">${esc(n.text)}</div>${n.small?`<div class="goal-sub muted">沒電時：${esc(n.small)}</div>`:''}</div>
      <button class="focus-btn${isDone?' done':' primary'}" data-action="step-done" data-g="${esc(g.id)}">${isDone?'✓ 完成了':'完成'}</button></div>`;
  }
  return `<div class="gcard goal-card"><div class="goal-hd"><span>${fi('1f3ac',20)}</span><span class="goal-title">${esc(g.title)}</span>${dueChip(g,'')}</div>
    ${segs}${status}${step}</div>`;
}
// ── 身體型目標（體態）────────────────────────────
function bodyCard(g){
  const d=ds(),st=weekStats(d),t=g.targets||{};
  const stats=BODY_METRICS.filter(m=>(+t[m.k]||0)>0).map(m=>{
    const n=st[m.k],goal=+t[m.k];
    return `<div class="goal-stat${n>=goal?' hit':''}"><div class="goal-stat-l">${m.l}</div><div class="goal-stat-n">${n}<small> / ${goal} ${m.unit}</small></div></div>`;
  }).join('');
  const e=health(d).exercise||{},types=exTypesOf(e);
  const chips=MOVES.map(x=>{
    const on=types.indexOf(x.t)>=0;
    return `<button class="focus-btn${on?' done':''}" data-move="${esc(x.t)}" data-min="${x.m}">${esc(x.t)} ${x.m} 分${on?' ✓':''}</button>`;
  }).join('');
  const others=types.filter(t2=>!MOVES.some(x=>x.t===t2));
  return `<div class="gcard goal-card"><div class="goal-hd"><span>${fi('1f3c3',20)}</span><span class="goal-title">${esc(g.title)}</span>${dueChip(g,'body')}</div>
    ${stats?`<div class="goal-stats">${stats}</div><div class="goal-sub muted">本週 · 每週一重新開始，不累積欠的</div>`:''}
    <div class="goal-step" style="display:block;"><div class="goal-step-lbl" style="margin-bottom:7px;">今天動一動（點一下就記，再點一下取消）</div>
      <div class="goal-chips">${chips}
        <button class="focus-btn${e.restDay?' rest':''}" data-action="rest">${e.restDay?'今天休息 ✓':'今天休息'}</button></div>
      ${others.length||(+e.duration||0)?`<div class="goal-sub muted" style="margin-top:6px;">今天：${esc(types.join('、')||'—')} · 共 ${+e.duration||0} 分鐘（下面的運動卡可以細改）</div>`:''}
    </div></div>`;
}
// ── 今晚：肩背 → 收手機 → 上床 ───────────────────
function tonightBar(){
  const d=ds(),f=data(),p=C.planFor(f,d),h=health(d),w=h.sleep?.windDown||{},t=w.targetSnapshot||C.snapshot(p,d);
  const bodyGoal=goals().find(g=>g.kind==='body');
  const wantShoulder=!!(bodyGoal&&(+((bodyGoal.targets||{}).shoulder)||0)>0);
  const sh=!!(h.body&&h.body.shoulder);
  if(!t)return `<div class="gcard tonight"><span>${fi('1f319',19)}</span><span class="tonight-lbl">今晚</span>
    <span class="tonight-note">想幾點上床？一次往前推一點點就好</span>
    <div class="tonight-acts"><button class="focus-btn primary" data-action="quick-plan" data-stage="A">從 02:00 開始練習</button>
    <button class="focus-btn" data-action="open-plan">自己設定</button></div></div>`;
  const r=C.result(w,p,d,new Date());
  const timeBtn=(key,label,val)=>editing===key
    ?`<input class="focus-time" type="time" data-edit="${key}" value="${esc(clock(val))}"/><button class="focus-btn" data-action="clear-time" data-k="${key}">清除</button>`
    :`<button class="focus-btn${val?' done':''}" data-action="${key}">${val?'✓ '+clock(val)+' '+label:label+(key==='phone'?' '+esc(t.phone):'')}</button>`;
  const arrow='<span class="tonight-arrow">→</span>';
  return `<div class="gcard tonight"><span>${fi('1f319',19)}</span>
    <span class="tonight-lbl">今晚 ${esc(t.bed)} 上床</span>
    <span class="tonight-note${r.kind==='late'?' warn':''}">${r.kind==='missing'?'兩個目標共同的地基':esc(r.label)}</span>
    <div class="tonight-acts">
      ${wantShoulder?`<button class="focus-btn${sh?' done':''}" data-action="shoulder">${sh?'✓ ':''}肩背 ${SHOULDER_MIN} 分</button>${arrow}`:''}
      ${timeBtn('phone','收手機',w.phoneAwayAt)}${arrow}${timeBtn('bed','上床',w.inBedAt)}
      ${sevenDots(d)}
    </div></div>`;
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
// ── 編輯面板（平常收起來；點日期標籤會直接打開那個目標）──
function goalForm(g){
  const isBody=g.kind==='body';
  const t=g.targets||{};
  return `<form data-form="goal" data-id="${esc(g.id)}"><div class="focus-sec">${isBody?'🏃':'🎬'} ${esc(g.title)}</div><div class="focus-fields">
    <label>目標名稱<input name="title" value="${esc(g.title)}" maxlength="60" required/></label>
    <label>日期<input name="due" type="date" value="${esc(g.dueDate||'')}"/></label>
    ${isBody?`<label>那一天是（選填）<input name="event" value="${esc(g.event||'')}" placeholder="例如：見朋友、旅行" maxlength="20"/></label>`:''}
    ${isBody?BODY_METRICS.map(m=>`<label>${m.l}（每週幾${m.unit}，0＝不追）<input name="t_${m.k}" type="number" min="0" max="7" step="1" value="${+t[m.k]||0}"/></label>`).join(''):''}
    ${!isBody?`<label class="wide">階段（一行一個，照順序）<textarea name="stages" rows="4" maxlength="1000" placeholder="分鏡&#10;原畫&#10;中割&#10;上色合成&#10;聲音輸出">${esc((g.milestones||[]).map(m=>m.title).join('\n'))}</textarea></label>
      <label class="wide">今天這一步<input name="next" value="${esc(g.next?.text||'')}" maxlength="200"/></label>
      <label class="wide">沒電版本（選填）<input name="small" value="${esc(g.next?.small||'')}" maxlength="200" placeholder="例如：只修 3 張關鍵格"/></label>`:''}
    <label>狀態<select name="status">${['active','paused','complete','archived'].map((x,i)=>`<option value="${x}"${g.status===x?' selected':''}>${['進行中','暫停','已完成','封存'][i]}</option>`).join('')}</select></label>
  </div><button class="mini-btn" type="submit">儲存</button></form>`;
}
function planForm(p){
  return `<form data-form="plan"><div class="focus-sec">🌙 作息</div><div class="focus-fields">
    <label>參考階段<select name="stage">${C.stages.map(x=>`<option value="${x.id}"${p?.stageId===x.id?' selected':''}>${x.id} · ${x.bed} 上床／${x.wake} 起床</option>`).join('')}</select></label>
    <label>從哪一晚開始<input name="effective" type="date" value="${esc(today())}" min="${today()}" required/></label>
    <label>收手機<input name="phone" type="time" value="${esc(p?.phone||'01:30')}" required/></label>
    <label>上床<input name="bed" type="time" value="${esc(p?.bed||'02:00')}" required/></label>
    <label>參考起床<input name="wake" type="time" value="${esc(p?.wake||'09:30')}" required/></label>
    <label>狀態<select name="status"><option value="active">練習中</option><option value="paused"${p?.status==='paused'?' selected':''}>暫停</option></select></label>
  </div><p class="focus-note">先試 3–4 晚再往前移一格。累的時候維持原樣也可以。理想：00:00 上床、08:30 起床。</p>
  <button class="mini-btn" type="submit">${p?'儲存':'開始練習'}</button></form>`;
}
function panel(){
  const f=data(),p=C.planFor(f,ds());
  const all=f.projects.filter(x=>x.status!=='archived');
  const archived=f.projects.filter(x=>x.status==='archived');
  const cloud=!GAS_URL?'只存在這台裝置':(cloudSupported===false?'⚠️ 後端還是舊版，目標還沒同步到雲端':'');
  const open=editing==='panel'||editing==='plan'||!!editGoal;
  const order=editGoal?[...all.filter(x=>x.id===editGoal),...all.filter(x=>x.id!==editGoal)]:all;
  return `<details class="focus-panel" id="focus-panel"${open?' open':''}><summary>⚙️ 編輯目標、作息與備份${cloud?' · '+esc(cloud):''}</summary>
    <div class="gcard">
      ${order.map(goalForm).join('<hr class="focus-hr"/>')}
      <hr class="focus-hr"/>
      <div class="focus-sec">＋ 新增目標</div>
      <div class="goal-chips" style="margin:8px 0;">
        <button class="focus-btn" data-action="new-goal" data-kind="project">🎬 作品型（有階段、每天一步）</button>
        <button class="focus-btn" data-action="new-goal" data-kind="body">🏃 身體型（每週次數）</button>
      </div>
      ${archived.length?`<p class="focus-note">已封存：${archived.map(x=>`<a href="#" data-unarchive="${esc(x.id)}" style="color:var(--secondary);">${esc(x.title)}</a>`).join('、')}（點一下恢復）</p>`:''}
      <hr class="focus-hr"/>${planForm(p)}
      <hr class="focus-hr"/><div class="focus-sec">💾 備份</div>
      <div class="goal-chips" style="margin:8px 0;align-items:center;">
        <button class="focus-btn" data-action="export">下載完整備份</button>
        <label class="focus-note">還原目標與睡前紀錄 <input id="focus-import" type="file" accept="application/json,.json"/></label>
      </div>
    </div></details>`;
}
// force：使用者自己按的操作，一定要重繪；背景同步觸發的（force=false）碰到正在打字就先跳過。
// 重繪時把打到一半的字放回去，不會因為點了別的地方就不見。
function render(force){
  if(!hub)return;
  const a=document.activeElement;
  const typing=a&&hub.contains(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName||'');
  if(typing&&!force)return;
  const keep={};
  hub.querySelectorAll('[data-next-in]').forEach(x=>{if(x.value)keep[x.dataset.nextIn]=x.value;});
  const wasOpen=document.getElementById('focus-panel')?.open;
  const gs=goals();
  const cards=gs.map(g=>g.kind==='body'?bodyCard(g):projectCard(g)).join('');
  hub.innerHTML=`${cards?`<div class="goal-grid">${cards}</div>`:''}${tonightBar()}${panel()}`;
  hub.querySelectorAll('[data-next-in]').forEach(x=>{if(keep[x.dataset.nextIn])x.value=keep[x.dataset.nextIn];});
  const pn=document.getElementById('focus-panel');
  if(pn&&wasOpen)pn.open=true;
  if(editing==='phone'||editing==='bed')hub.querySelector('[data-edit]')?.focus();
  if(justDone)hub.querySelector(`[data-next-in="${justDone}"]`)?.focus();
  if(editGoal){const fm=hub.querySelector(`form[data-id="${editGoal}"]`);if(fm)fm.scrollIntoView({behavior:'smooth',block:'center'});editGoal='';}
  if(VIEWER_MODE)hub.querySelectorAll('button,input,textarea,select').forEach(el=>{el.disabled=true;});
}
// ── 把「今天這一步」接到便利貼 ────────────────────
function ensureStepInToday(g){
  const c=stickyCtx();
  let i=c.items.findIndex(x=>x.id===g.next.id);
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
  document.activeElement?.blur();            // 輸入框還有焦點時 render 會跳過重繪
  g.next={id:uid(),text,small:(g.next&&g.next.small)||''};
  justDone='';saveGoal(g);
  ensureStepInToday(g);render(true);
  softToast('排進今天的便利貼了 📋',2200);
}
// ── 互動 ───────────────────────────────────────────
hub.addEventListener('click',ev=>{
  const el=ev.target.closest('[data-action],[data-move],[data-seg],[data-edit-goal],[data-unarchive]');
  if(!el)return;
  if(el.tagName==='A')ev.preventDefault();
  if(el.dataset.editGoal){editGoal=el.dataset.editGoal;render(true);return;}
  if(!writable())return;
  const d=ds();
  if(el.dataset.unarchive){const g=data().projects.find(x=>x.id===el.dataset.unarchive);if(g){g.status='active';saveGoal(g);}return;}
  if(el.dataset.seg!==undefined){
    const g=data().projects.find(x=>x.id===el.dataset.g);const m=g&&g.milestones[+el.dataset.seg];if(!m)return;
    m.done=!m.done;
    if(m.done)m.doneOn=ds();else delete m.doneOn;
    saveGoal(g);
    if(m.done)softToast(`🎉 「${m.title}」完成了`,2400);
    return;
  }
  if(el.dataset.move){
    const t=el.dataset.move,mins=+el.dataset.min||0,h=health(d),e=h.exercise||{},types=exTypesOf(e);
    const on=types.indexOf(t)>=0;
    const next=on?types.filter(x=>x!==t):[...types,t];
    h.exercise={...e,types:next,type:next[0]||'',duration:Math.max(0,(+e.duration||0)+(on?-mins:mins)),restDay:false};
    saveHealth(d,h);
    if(!on){softToast(`🌿 ${t} ${mins} 分鐘`,1800);if(t==='跳舞')autoHabit('dance');}
    return;
  }
  const a=el.dataset.action;
  if(a==='step-done'){
    const g=data().projects.find(x=>x.id===el.dataset.g);if(!g?.next?.text)return;
    const i=ensureStepInToday(g);
    const box=document.querySelector(`#sticky-items .sticky-check[data-k="t${i}"]`);
    const wasDone=!!stickyCtx().done['t'+i];
    if(box)box.click();                       // 便利貼的打勾：EXP、達成率都照原本的算
    if(!wasDone){justDone=g.id;autoHabit('create');}
    render(true);return;
  }
  if(a==='set-next'){
    const g=data().projects.find(x=>x.id===el.dataset.g);
    const inp=hub.querySelector(`[data-next-in="${el.dataset.g}"]`);
    if(g&&inp)setNext(g,inp.value);
    return;
  }
  if(a==='phone'||a==='bed'){
    const key=a==='phone'?'phoneAwayAt':'inBedAt',w=health(d).sleep?.windDown||{};
    if(w[key]||d!==curDay()){editing=a;render(true);return;}   // 已經記了、或在補記 → 直接改時間
    updateWind(d,x=>{x[key]=new Date().toISOString();});
    softToast(a==='phone'?'📱 手機收好了，故事留到明天':'🛏 上床了，晚安',2400);
    return;
  }
  if(a==='clear-time'){
    const key=el.dataset.k==='phone'?'phoneAwayAt':'inBedAt';
    editing='';updateWind(d,x=>{delete x[key];});return;
  }
  if(a==='shoulder'){
    const h=health(d);h.body={...(h.body||{})};
    if(h.body.shoulder)delete h.body.shoulder;else h.body.shoulder=Date.now();
    saveHealth(d,h);
    if(h.body.shoulder)softToast('💪 肩背完成，背挺起來了',2200);
    return;
  }
  if(a==='rest'){
    const h=health(d);h.exercise=h.exercise||{};
    if(!h.exercise.restDay&&exTypesOf(h.exercise).length){softToast('今天已經有活動了，先取消再標休息',2600);return;}
    h.exercise.restDay=!h.exercise.restDay;saveHealth(d,h);return;
  }
  if(a==='quick-plan'){
    const s=C.stages.find(x=>x.id===el.dataset.stage)||C.stages[0];
    data().revisions.push({id:uid(),stageId:s.id,effectiveFrom:today(),phone:s.phone,bed:s.bed,wake:s.wake,status:'active',updatedAt:Date.now()});
    sv(S);syncStateDebounced();render(true);softToast(`🌙 今晚開始：${s.phone} 收手機、${s.bed} 上床`,3000);return;
  }
  if(a==='open-plan'){editing='plan';render(true);hub.querySelector('form[data-form="plan"]')?.scrollIntoView({behavior:'smooth',block:'center'});editing='';return;}
  if(a==='new-goal'){
    const isBody=el.dataset.kind==='body';
    const g={id:uid(),kind:isBody?'body':'project',title:isBody?'新的身體目標':'新的作品',dueDate:'',event:'',status:'active',
      milestones:[],next:isBody?null:{id:uid(),text:'',small:''},targets:isBody?{move:7,shoulder:0,bed:7}:undefined,startOn:curDay(),createdAt:Date.now(),updatedAt:Date.now()};
    data().projects.push(g);editGoal=g.id;saveGoal(g);return;
  }
  if(a==='export'){
    if(typeof flushAutoDraft==='function')flushAutoDraft();
    const blob=new Blob([JSON.stringify({format:'grandol-focus-backup',version:1,exportedAt:new Date().toISOString(),state:S},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='forest-backup-'+today()+'.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
});
// 「下一步」輸入框：Enter 送出（注音選字的 Enter 不算）
hub.addEventListener('keydown',ev=>{
  const inp=ev.target.closest('[data-next-in]');
  if(!inp||ev.key!=='Enter'||isImeEnter(ev))return;
  ev.preventDefault();
  const g=data().projects.find(x=>x.id===inp.dataset.nextIn);
  if(g)setNext(g,inp.value);
});
hub.addEventListener('focusout',ev=>{
  // 做完一步後沒填下一步就離開 → 收起來，卡片回到原本的樣子
  const inp=ev.target.closest('[data-next-in]');
  if(!inp||inp.value.trim())return;
  setTimeout(()=>{if(justDone&&!hub.contains(document.activeElement)){justDone='';render(true);}},150);
});
hub.addEventListener('change',async ev=>{
  const el=ev.target;
  if(!writable())return;
  if(el.dataset.edit){
    const key=el.dataset.edit==='phone'?'phoneAwayAt':'inBedAt';
    const tt=C.validTime(el.value)?C.targetAt(ds(),el.value):null;
    if(!tt){softToast('時間格式怪怪的 🥲',2200);return;}
    if(tt>new Date()){softToast('還沒到那個時間喔',2400);return;}
    editing='';el.blur();updateWind(ds(),x=>{x[key]=tt.toISOString();});
    return;
  }
  if(el.name==='stage'&&el.form?.dataset.form==='plan'){const s=C.stages.find(x=>x.id===el.value);if(s)for(const k of ['phone','bed','wake'])el.form.elements[k].value=s[k];}
  if(el.id==='focus-import'&&el.files[0]){
    try{
      if(el.files[0].size>20*1024*1024)throw new Error('檔案過大');
      const b=JSON.parse(await el.files[0].text());
      if(b.format!=='grandol-focus-backup'||b.version!==1||!b.state||!Array.isArray(b.state.entries))throw new Error('不支援的備份格式');
      const records=b.state.entries.filter(e=>C.validDate(e.date)&&e.date<=today()&&e.health?.sleep?.windDown).map(e=>[e.date,e.health.sleep.windDown]);
      if(C.validDate(b.state.dayKey)&&b.state.dayKey<=today()&&b.state.health?.sleep?.windDown)records.push([b.state.dayKey,b.state.health.sleep.windDown]);
      if(!confirm('合併備份裡的目標與較新的睡前紀錄？日記、待辦和其他健康紀錄不會被覆寫。'))return;
      S.focus=C.merge(S.focus,b.state.focus);
      for(const [day,w] of records){
        if(!w.targetSnapshot||!C.validTime(w.targetSnapshot.bed)||!Number.isFinite(Date.parse(w.targetSnapshot.bedAt)))continue;
        if([w.inBedAt,w.phoneAwayAt].some(x=>x&&!Number.isFinite(Date.parse(x))))continue;
        const h=health(day);h.sleep=h.sleep||{};
        if((+w.updatedAt||0)>(+h.sleep.windDown?.updatedAt||0)){h.sleep.windDown=w;saveHealth(day,h);}
      }
      sv(S);syncStateDebounced();render(true);softToast('已合併目標與睡前紀錄 ✓',2600);
    }catch(e){softToast('無法還原：'+e.message,3200);}
  }
});
hub.addEventListener('submit',ev=>{
  ev.preventDefault();
  if(!writable())return;
  const form=ev.target,fd=new FormData(form),v=k=>String(fd.get(k)||'').trim();
  if(form.dataset.form==='plan'){
    if(!C.validDate(v('effective'))||v('effective')<today()||!['phone','bed','wake'].every(k=>C.validTime(v(k)))){softToast('請填有效的時間與今天以後的日期',2800);return;}
    if(C.targetAt(v('effective'),v('phone'))>C.targetAt(v('effective'),v('bed'))){softToast('收手機要在上床之前喔',2600);return;}
    data().revisions.push({id:uid(),stageId:v('stage'),effectiveFrom:v('effective'),phone:v('phone'),bed:v('bed'),wake:v('wake'),status:v('status'),updatedAt:Date.now()});
    sv(S);syncStateDebounced();document.activeElement?.blur();render(true);softToast('作息設好了 🌙',2400);return;
  }
  if(form.dataset.form==='goal'){
    const g=data().projects.find(x=>x.id===form.dataset.id);if(!g)return;
    if(!v('title')){softToast('目標要有名字',2400);return;}
    if(v('due')&&!C.validDate(v('due'))){softToast('日期格式怪怪的',2400);return;}
    g.title=v('title');g.dueDate=v('due');g.status=v('status')||'active';
    if(g.kind==='body'){
      g.event=v('event');
      g.targets={};BODY_METRICS.forEach(m=>{g.targets[m.k]=Math.max(0,Math.min(7,parseInt(v('t_'+m.k),10)||0));});
    }else{
      // 階段：名字沒變的保留完成狀態，新的從未完成開始
      const lines=v('stages').split('\n').map(x=>x.trim()).filter(Boolean);
      const old=g.milestones||[];
      g.milestones=lines.map(title=>{const o=old.find(m=>m.title===title);return o?o:{id:uid(),title,done:false};});
      const text=v('next'),small=v('small');
      if(!g.next||g.next.text!==text){
        const oldId=g.next&&g.next.id;
        g.next={id:(g.next&&g.next.text&&text&&oldId)?oldId:uid(),text,small};
        // 已經排進便利貼的那一步，改字時跟著改，不會變成兩筆
        if(oldId&&g.next.id===oldId){
          const upd=r=>r.id===oldId?{...r,theme:g.title,task:text}:r;
          setTodayTDL((S.todayTDL||[]).map(upd));S.tomorrowTDL=(S.tomorrowTDL||[]).map(upd);
          if((S.todayTDL||[]).some(r=>r.id===oldId)){writeDraftEntry(true);markDirty('e:'+curDay());syncEntryFor(curDay()).catch(()=>{});}
          renderStickyNote();
        }
      }else g.next.small=small;
    }
    document.activeElement?.blur();
    saveGoal(g);softToast('目標更新了 ✓',2200);
  }
});
// ══ 回顧與分析：一段期間（一週／一個月）的目標進度 ══════════
// 回顧頁的卡片和「複製給 Claude」都用這一份，兩邊的數字才會一致
function nightInfo(day){
  const f=data(),wd=health(day).sleep?.windDown;
  const r=C.result(wd,C.planFor(f,day),day,new Date());
  const t=(wd&&wd.targetSnapshot)||C.snapshot(C.planFor(f,day),day);
  // 今晚還沒到時間 → pending，不算「沒記錄」
  const kind=(r.kind==='missing'&&r.label==='尚未到時間')?'pending':r.kind;
  return {day,target:t?t.bed:'',phone:clock(wd&&wd.phoneAwayAt),bed:clock(wd&&wd.inBedAt),kind,label:r.label,delta:r.delta};
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
      if(x.ms.length)L.push('    階段：'+x.ms.map(m=>(m.done?'✓':'○')+m.title+(m.doneOn?'('+md(m.doneOn)+')':'')).join(' → '));
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
    P.nights.forEach(n=>L.push(`      ${md(n.day)} 目標 ${n.target}｜收手機 ${n.phone||'—'}｜上床 ${n.bed||'—'}｜${n.label}`));
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
