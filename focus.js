/* 🌱 這陣子：首頁的一條小條。
   平常只按三顆按鈕（收手機／上床／動一動），設定收在下面的面板裡。
   每日紀錄仍然存在既有的健康卡與 TDL，這裡只是更快的入口。 */
(function(){
'use strict';
const C=FocusCore, hub=document.getElementById('focus-hub');
if(!hub)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>(crypto.randomUUID?crypto.randomUUID():'id'+Date.now()+Math.random().toString(16).slice(2));
const STEP=10;                    // 動一動：點一下記 10 分鐘，再點就累加
let editing='',cloudSupported=null;
function data(){S.focus=C.clean(S.focus);return S.focus;}
function ds(){return viewDate||curDay();}
function health(d){return d===curDay()?S.health:((S.entries||[]).find(e=>e.date===d)?.health||emptyHealth());}
function clock(t){if(!t)return '';const d=new Date(t);return isNaN(d)?'':String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function writable(){if(VIEWER_MODE){softToast('監督模式是唯讀的 👀',2200);return false;}return true;}
function saveState(){sv(S);syncStateDebounced();render();}
// 寫進當天的健康紀錄：跟健康卡共用同一份資料，不會變成第二套紀錄
function saveHealth(d,h){
  if(!writable())return;
  const old=S.exp;
  reconcileHealthExp(h,d);
  if(d===curDay()){
    S.health=h;localStorage.setItem('grandol_live_ts',String(Date.now()));
    writeDraftEntry(true);
  }
  const e=getOrCreateEntry(d);e.health=JSON.parse(JSON.stringify(h));e.savedAt=Date.now();e.exp=S.exp;
  markDirty('e:'+d);sv(S);syncEntryFor(d).catch(()=>{});syncStateDebounced();
  checkLevelUp(old,S.exp);renderFlowers();renderExpBar();
  if(d===ds())renderHealth();
  render();
}
function updateWind(d,fn){
  const h=health(d);h.sleep=h.sleep||{};
  const p=C.planFor(data(),d),w=h.sleep.windDown||{nightDate:d,targetSnapshot:C.snapshot(p,d)};
  if(!w.targetSnapshot){softToast('先在下面設定今晚的作息目標 🌙',2600);return;}
  const before={...w};fn(w);
  w.updatedAt=Date.now();w.fieldUpdatedAt=w.fieldUpdatedAt||{};
  for(const k of ['phoneAwayAt','inBedAt','obstacle'])if(before[k]!==w[k])w.fieldUpdatedAt[k]=w.updatedAt;
  h.sleep.windDown=w;saveHealth(d,h);
}
// 這一晚的實際時間：當天中午到隔天中午之間（午夜後上床也算同一晚）
function nightTimeISO(d,hhmm){
  if(!C.validTime(hhmm))return null;
  const t=C.targetAt(d,hhmm);
  return t?t.toISOString():null;
}
// ── 一、今晚 ────────────────────────────────────────
function sleepLine(d){
  const f=data(),p=C.planFor(f,d),w=health(d).sleep?.windDown||{},t=w.targetSnapshot||C.snapshot(p,d);
  if(!t)return `<div class="focus-line"><span class="focus-lbl">🌙 今晚</span>
    <button class="focus-btn" data-action="open-plan">設定想幾點上床</button>
    <span class="focus-note">一次往前推一點點就好</span></div>`;
  const r=C.result(w,p,d,new Date());
  const btn=(key,icon,label,val)=>editing===key
    ? `<input class="focus-time" type="time" data-edit="${key}" value="${esc(clock(val))}" placeholder="--:--"/>
       <button class="focus-btn" data-action="clear-time" data-k="${key}">清除</button>`
    : `<button class="focus-btn${val?' done':''}" data-action="${key}">${val?'✓ '+clock(val)+' '+label:icon+' '+label}</button>`;
  const late=r.kind==='late';
  return `<div class="focus-line">
    <span class="focus-lbl">🌙 今晚 ${esc(t.bed)} 上床</span>
    ${btn('phone','📱','收手機',w.phoneAwayAt)}
    ${btn('bed','🛏','上床',w.inBedAt)}
    <span class="focus-note${late?' warn':''}">${esc(r.kind==='missing'?(t.phone+' 開始收尾'):r.label)}</span>
    ${sevenDots(d)}
  </div>`;
}
// 最近七晚：準時＝綠點、晚了＝金點、沒記錄＝灰點
function sevenDots(d){
  const f=data();let out='';
  for(let n=6;n>=0;n--){
    const day=shiftDay(d,-n),wd=health(day).sleep?.windDown;
    const rr=C.result(wd,C.planFor(f,day),day,new Date());
    const cls=rr.kind==='onTime'?' ontime':(rr.kind==='late'?' late':'');
    out+=`<span class="focus-dot${cls}" title="${esc(day.slice(5)+' '+rr.label)}"></span>`;
  }
  return `<span class="focus-dots" title="最近七晚">${out}</span>`;
}
// ── 二、這陣子的目標（例如動畫）────────────────────
function projectLine(d){
  const active=data().projects.filter(p=>p.status==='active');
  if(!active.length)return `<div class="focus-line"><span class="focus-lbl">🎬 這陣子</span>
    <button class="focus-btn" data-action="open-project">設定一個階段目標</button>
    <span class="focus-note">只要一句「下一步」就夠</span></div>`;
  return active.map(p=>{
    const list=(typeof stickyCtx==='function'?stickyCtx().items:[])||[];
    const i=list.findIndex(x=>x.id===p.next?.id);
    const done=i>=0&&!!(stickyCtx().done['t'+i]);
    const later=(S.tomorrowTDL||[]).some(x=>x.id===p.next?.id);
    const dueTxt=p.dueDate?`${p.dueDate.slice(5).replace('-','/')} 前`:'';
    return `<div class="focus-line">
      <span class="focus-lbl">🎬 ${esc(p.title)}${dueTxt?' · '+esc(dueTxt):''}</span>
      <span class="focus-note">下一步：${esc(p.next?.text||'還沒寫')}</span>
      ${p.next?.text?(i>=0
        ? `<button class="focus-btn${done?' done':''}" data-action="toggle-task" data-id="${esc(p.next.id)}">${done?'✓ 今天完成了':'完成這一步'}</button>`
        : `<button class="focus-btn" data-action="add-task" data-id="${esc(p.id)}"${later?' disabled':''}>${later?'已排進明天':'排進今天'}</button>`):''}
      ${p.next?.small?`<span class="focus-note">沒電時：${esc(p.next.small)}</span>`:''}
    </div>`;
  }).join('');
}
// ── 三、動一動 ─────────────────────────────────────
const MOVES=['走路','跑步','跳舞','伸展','肌力'];
function moveLine(d){
  const e=health(d).exercise||{},types=exTypesOf(e),mins=+e.duration||0;
  const chips=[...new Set([...MOVES,...types])].map(t=>
    `<span class="ebtn focus-chip${types.indexOf(t)>=0?' on':''}" data-move="${esc(t)}" title="點一下記 ${STEP} 分鐘，再點就加上去">${exIconHTML(t,18)} ${esc(t)}</span>`).join('');
  const sum=e.restDay?'今天休息 🌿':(types.length?`${esc(types.join('、'))} · ${mins} 分鐘`:'點一下就記，先求動起來');
  return `<div class="focus-line">
    <span class="focus-lbl">🌿 今天動一動</span>
    ${chips}
    <button class="focus-btn${e.restDay?' rest':''}" data-action="rest">${e.restDay?'取消休息':'今天休息'}</button>
    <span class="focus-note">${sum}</span>
    ${(types.length||mins)?`<button class="focus-btn" data-action="clear-move" title="清掉今天的活動紀錄">✕</button>`:''}
  </div>`;
}
// ── 設定面板（平常收起來）──────────────────────────
function planForm(p){
  return `<form data-form="plan"><div class="focus-fields">
    <label>參考階段<select name="stage">${C.stages.map(x=>`<option value="${x.id}"${p?.stageId===x.id?' selected':''}>${x.id} · ${x.bed} 上床／${x.wake} 起床</option>`).join('')}</select></label>
    <label>從哪一晚開始<input name="effective" type="date" value="${esc(p?today():today())}" min="${today()}" required/></label>
    <label>收手機<input name="phone" type="time" value="${esc(p?.phone||'01:30')}" required/></label>
    <label>上床<input name="bed" type="time" value="${esc(p?.bed||'02:00')}" required/></label>
    <label>參考起床<input name="wake" type="time" value="${esc(p?.wake||'09:30')}" required/></label>
    <label>狀態<select name="status"><option value="active">練習中</option><option value="paused"${p?.status==='paused'?' selected':''}>暫停</option></select></label>
  </div>
  <p class="focus-note">先試 3–4 晚再看要不要往前移，不會自動升級。累的時候維持原樣也可以。</p>
  <button class="mini-btn" type="submit">${p?'儲存':'開始練習'}</button></form>`;
}
function projectForm(p){
  return `<form data-form="project" data-id="${esc(p?.id||'')}"><div class="focus-fields">
    <label>目標名稱<input name="title" value="${esc(p?p.title:(hub.dataset.project||''))}" maxlength="100" required/></label>
    <label>截止日（選填）<input name="due" type="date" value="${esc(p?p.dueDate||'':(hub.dataset.due||''))}"/></label>
    <label class="wide">下一步（今天要做的那一小步）<input name="next" value="${esc(p?.next?.text||'')}" maxlength="200"/></label>
    <label class="wide">沒電版本（選填）<input name="small" value="${esc(p?.next?.small||'')}" maxlength="200"/></label>
    <label class="wide">怎樣算完成？（選填）<textarea name="definition" maxlength="1000">${esc(p?.definition||'')}</textarea></label>
    <label class="wide">階段（選填，一行一個）<textarea name="stages" rows="3" maxlength="1000">${esc((p?.milestones||[]).map(m=>m.title).join('\n'))}</textarea></label>
    ${p?'<label class="wide"><input type="checkbox" name="newAction"/> 這是新的下一步（舊的待辦留著）</label>':''}
    <label>狀態<select name="status">${['active','paused','complete','archived'].map((x,i)=>`<option value="${x}"${p?.status===x?' selected':''}>${['進行中','暫停','已完成','封存'][i]}</option>`).join('')}</select></label>
  </div><button class="mini-btn" type="submit">${p?'儲存':'建立目標'}</button></form>`;
}
function panel(d){
  const f=data(),p=C.planFor(f,d);
  const projects=f.projects.filter(x=>x.status!=='archived');
  const cloud=!GAS_URL?'目前只存在這台裝置':(cloudSupported===false?'⚠️ 後端還是舊版，這個目標還沒同步到雲端（設定頁可看版本）':'');
  return `<details class="focus-panel" id="focus-panel"${editing==='plan'||editing==='project'?' open':''}>
    <summary>⚙️ 作息、目標與備份${cloud?' · '+esc(cloud):''}</summary>
    <div class="focus-lbl" style="margin-top:9px;">🌙 作息計畫</div>${planForm(p)}
    <div class="focus-lbl" style="margin-top:12px;">🎬 階段目標</div>
    ${projects.map(x=>projectForm(x)).join('<hr style="border:none;border-top:1px solid rgba(var(--secondary-rgb),.2);margin:10px 0;"/>')||projectForm(null)}
    ${projects.length?`<p class="focus-note" style="margin-top:8px;">要新增另一個目標，先把上面的狀態改成「已完成／封存」再建立。</p>`:''}
    <div class="focus-lbl" style="margin-top:12px;">💾 備份</div>
    <div class="focus-line" style="border:none;padding:0;margin-top:6px;">
      <button class="focus-btn" data-action="export">下載完整備份</button>
      <label class="focus-note">還原這個功能的紀錄 <input id="focus-import" type="file" accept="application/json,.json"/></label>
    </div>
    <p class="focus-note">備份包含全部本機資料。還原只會合併目標與睡前紀錄，不會覆寫日記、待辦和其他健康紀錄。</p>
  </details>`;
}
function render(){
  if(!hub)return;
  // 正在打字時不重繪，游標才不會被同步打斷
  if(hub.contains(document.activeElement)&&/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName||''))return;
  const d=ds();
  const open=document.getElementById('focus-panel')?.open;
  hub.innerHTML=`<div class="gcard" style="margin-bottom:12px;">
    <div class="sec-hd">🌱 這陣子${d!==curDay()?' · 補記 '+esc(d.slice(5).replace('-','/')):''}</div>
    <div class="focus-strip">${sleepLine(d)}${projectLine(d)}${moveLine(d)}</div>
    ${panel(d)}
  </div>`;
  const pn=document.getElementById('focus-panel');
  if(pn&&(open||editing))pn.open=true;
  if(editing==='phone'||editing==='bed'){const el=hub.querySelector('[data-edit]');if(el)el.focus();}
  if(VIEWER_MODE)hub.querySelectorAll('button,input,textarea,select').forEach(el=>{el.disabled=true;});
}
// ── 互動 ───────────────────────────────────────────
hub.addEventListener('click',ev=>{
  const chip=ev.target.closest('[data-move]');
  const b=ev.target.closest('[data-action]');
  if(!chip&&!b)return;
  if(!writable())return;
  const d=ds();
  if(chip){
    const t=chip.dataset.move,h=health(d);
    const e=h.exercise||{};
    const types=exTypesOf(e);
    const has=types.indexOf(t)>=0;
    const next=has?types:[...types,t];
    h.exercise={...e,types:next,type:next[0]||'',duration:(+e.duration||0)+STEP,restDay:false};
    saveHealth(d,h);
    softToast(`🌿 ${t} ${h.exercise.duration} 分鐘`,1800);
    return;
  }
  const a=b.dataset.action;
  if(a==='phone'||a==='bed'){
    const key=a==='phone'?'phoneAwayAt':'inBedAt';
    const w=health(d).sleep?.windDown||{};
    if(w[key]){editing=a;render();return;}          // 已經記了 → 點一下改時間
    if(d!==curDay()){editing=a;render();softToast('補記的話直接填時間 🌙',2400);return;}
    updateWind(d,x=>{x[key]=new Date().toISOString();});
    softToast(a==='phone'?'📱 收好手機了':'🛏 上床了，晚安',2400);
  }
  if(a==='clear-time'){
    const key=b.dataset.k==='phone'?'phoneAwayAt':'inBedAt';
    updateWind(d,x=>{delete x[key];});editing='';render();
  }
  if(a==='rest'){
    const h=health(d);h.exercise=h.exercise||{};
    if(!h.exercise.restDay&&exTypesOf(h.exercise).length){softToast('今天已經有活動紀錄了，先按 ✕ 清掉再標休息',2800);return;}
    h.exercise.restDay=!h.exercise.restDay;saveHealth(d,h);
  }
  if(a==='clear-move'){
    const h=health(d);h.exercise={...(h.exercise||{}),types:[],type:'',duration:0,restDay:false};saveHealth(d,h);
  }
  if(a==='open-plan'||a==='open-project'){
    editing=a==='open-plan'?'plan':'project';render();
    document.getElementById('focus-panel')?.scrollIntoView({behavior:'smooth',block:'center'});
  }
  if(a==='add-task'){
    const p=data().projects.find(x=>x.id===b.dataset.id);if(!p?.next?.text)return;
    const c=stickyCtx();
    if(c.items.some(x=>x.id===p.next.id))return;
    const row={id:p.next.id,goalId:p.id,theme:p.title,task:p.next.text,c:0};
    if(c.todayMode){
      setTodayTDL([...c.items,row]);todayListEdited=true;markTodayListEdited();
      writeDraftEntry(true);markDirty('e:'+d);syncEntryFor(d).catch(()=>{});
    }else{
      const e=getOrCreateEntry(d);
      e.tdlItems=buildTdlSnapshot([...c.items,row],c.done);
      e.tdlTotal=e.tdlItems.length;e.tdlDone=e.tdlItems.filter(x=>x.done).length;e.savedAt=Date.now();
      markDirty('e:'+d);syncEntryFor(d).catch(()=>{});
    }
    sv(S);renderStickyNote();syncStateDebounced();render();
    softToast('已排進便利貼 📋',2200);
  }
  if(a==='toggle-task'){
    const i=stickyCtx().items.findIndex(x=>x.id===b.dataset.id);
    if(i>=0)document.querySelector(`#sticky-items .sticky-check[data-k="t${i}"]`)?.click();
    render();
  }
  if(a==='export'){
    if(typeof flushAutoDraft==='function')flushAutoDraft();
    const blob=new Blob([JSON.stringify({format:'grandol-focus-backup',version:1,exportedAt:new Date().toISOString(),state:S},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='forest-backup-'+today()+'.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
});
// 改時間：填好就存（時間屬於「這一晚」＝當天中午到隔天中午）
hub.addEventListener('change',async ev=>{
  const el=ev.target;
  if(!writable())return;
  if(el.dataset.edit){
    const key=el.dataset.edit==='phone'?'phoneAwayAt':'inBedAt';
    const iso=nightTimeISO(ds(),el.value);
    if(!iso){softToast('時間格式怪怪的 🥲',2200);return;}
    if(new Date(iso)>new Date()){softToast('還沒到那個時間喔',2400);return;}
    updateWind(ds(),x=>{x[key]=iso;});editing='';render();
    return;
  }
  if(el.name==='stage'){const s=C.stages.find(x=>x.id===el.value);if(s)for(const k of ['phone','bed','wake'])el.form.elements[k].value=s[k];}
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
      saveState();softToast('已合併目標與睡前紀錄 ✓',2600);
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
    editing='';saveState();softToast('作息目標設好了 🌙',2400);
  }
  if(form.dataset.form==='project'){
    if(!v('title')||(v('due')&&!C.validDate(v('due')))){softToast('請填目標名稱與有效的截止日',2600);return;}
    const f=data(),old=f.projects.find(p=>p.id===form.dataset.id);
    const lines=v('stages').split('\n').map(x=>x.trim()).filter(Boolean);
    const same=old&&JSON.stringify(lines)===JSON.stringify((old.milestones||[]).map(m=>m.title));
    const p={id:old?.id||uid(),title:v('title'),dueDate:v('due'),definition:v('definition'),status:v('status')||'active',url:old?.url||'',
      createdAt:old?.createdAt||Date.now(),updatedAt:Date.now(),
      milestones:same?old.milestones:lines.map(title=>({id:uid(),title,done:false})),
      next:{id:(old?.next?.id&&!fd.has('newAction'))?old.next.id:uid(),text:v('next'),small:v('small')}};
    if(old)f.projects[f.projects.indexOf(old)]=p;else f.projects.push(p);
    // 已經排進待辦的那一步，改名時跟著改，不會變成兩筆
    if(old&&p.next.id===old.next?.id){
      const upd=r=>r.id===p.next.id?{...r,theme:p.title,task:p.next.text}:r;
      setTodayTDL((S.todayTDL||[]).map(upd));
      tdlRows=tdlRows.map(upd);
      S.tomorrowTDL=(S.tomorrowTDL||[]).map(upd);
      if((S.todayTDL||[]).some(r=>r.id===p.next.id)){writeDraftEntry(true);markDirty('e:'+curDay());syncEntryFor(curDay()).catch(()=>{});}
      renderStickyNote();renderTDL();
    }
    editing='';saveState();softToast('目標更新了 🎬',2400);
  }
});
window.FocusUI={
  render,
  setCloudSupport(v){cloudSupported=v;render();},
  exportLines(){
    const f=data();
    return ['','━━━ 階段目標與作息 ━━━',
      ...f.projects.map(p=>p.title+' · '+p.status+' · '+(p.dueDate||'無截止日')+'\n下一步：'+(p.next?.text||'')),
      ...f.revisions.map(p=>p.effectiveFrom+' 起：'+p.phone+' 收手機／'+p.bed+' 上床／'+p.wake+' 起床 · '+p.status),
      ...S.entries.filter(e=>e.health?.sleep?.windDown).map(e=>e.date+' 晚：收手機 '+clock(e.health.sleep.windDown.phoneAwayAt)+'／上床 '+clock(e.health.sleep.windDown.inBedAt))];
  }
};
render();
})();
