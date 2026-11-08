/* Pure, shared focus data helpers. No storage or network side effects. */
(function(root){
  'use strict';
  const stages=[
    {id:'A',phone:'01:30',bed:'02:00',wake:'09:30'},
    {id:'B',phone:'01:00',bed:'01:30',wake:'09:00'},
    {id:'C',phone:'00:30',bed:'01:00',wake:'08:30'},
    {id:'D',phone:'00:00',bed:'00:30',wake:'08:30'},
    {id:'E',phone:'23:30',bed:'00:00',wake:'08:30'}
  ];
  function dateKey(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
  function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const d=new Date(s+'T12:00:00');return !isNaN(d)&&dateKey(d)===s;}
  function validTime(s){return /^([01]\d|2[0-3]):[0-5]\d$/.test(s||'');}
  function targetAt(ds,time){
    if(!validDate(ds)||!validTime(time))return null;
    const [h,m]=time.split(':').map(Number),d=new Date(ds+'T12:00:00');
    if(h<12)d.setDate(d.getDate()+1);
    d.setHours(h,m,0,0);return d;
  }
  // ── 計畫（plan）：地板週、行程限制、待確認、每天的底線 ──────────────────
  // 每個項目都有固定的 id；刪除用 deleted 標記，不然另一台裝置合併時會把它救回來
  const plist=x=>Array.isArray(x)?x.filter(o=>o&&typeof o.id==='string'):[];
  function cleanPlan(p){
    if(!p||typeof p!=='object')return undefined;
    return {id:'__plan',version:1,title:String(p.title||''),updatedAt:+p.updatedAt||0,importedAt:+p.importedAt||0,
      calDetail:p.calDetail!==false,cal:(p.cal&&typeof p.cal==='object')?p.cal:{},
      periods:plist(p.periods),events:plist(p.events),todos:plist(p.todos),items:plist(p.items)};
  }
  function mergePlan(a,b){
    if(!a)return b;if(!b)return a;
    const newer=(+b.updatedAt||0)>=(+a.updatedAt||0)?b:a;
    return {...newer,periods:combine(a.periods,b.periods),events:combine(a.events,b.events),todos:combine(a.todos,b.todos),items:combine(a.items,b.items)};
  }
  function clean(v){
    v=v&&typeof v==='object'?v:{};
    // experiments：回顧帶走的實驗；insights：Claude 從日記看見的我（每月一批）
    const arr=(x,ok)=>Array.isArray(x)?x.filter(o=>o&&typeof o.id==='string'&&ok(o)):[];
    const extra={experiments:arr(v.experiments,o=>typeof o.text==='string'),insights:arr(v.insights,o=>typeof o.text==='string')};
    const pl=cleanPlan(v.plan);if(pl)extra.plan=pl;
    return {...extra,version:1,revisions:Array.isArray(v.revisions)?v.revisions.filter(x=>x&&typeof x.id==='string'&&validDate(x.effectiveFrom)&&validTime(x.bed)&&validTime(x.phone)&&validTime(x.wake)):[],projects:Array.isArray(v.projects)?v.projects.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string').map(x=>({...x,milestones:Array.isArray(x.milestones)?x.milestones.filter(m=>m&&typeof m.title==='string'):[],next:x.next&&typeof x.next==='object'?x.next:null})):[]};
  }
  const combine=(xs,ys)=>{const m=new Map();[...(xs||[]),...(ys||[])].forEach(x=>{const p=m.get(x.id);if(!p||(+x.updatedAt||0)>=(+p.updatedAt||0))m.set(x.id,x);});return [...m.values()];};
  function merge(a,b){
    a=clean(a);b=clean(b);
    const out={version:1,revisions:combine(a.revisions,b.revisions),projects:combine(a.projects,b.projects),
      experiments:combine(a.experiments,b.experiments),insights:combine(a.insights,b.insights)};
    const pl=mergePlan(a.plan,b.plan);if(pl)out.plan=pl;
    return out;
  }
  function planFor(f,ds){return clean(f).revisions.filter(x=>x.effectiveFrom<=ds).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)||(+a.updatedAt||0)-(+b.updatedAt||0)).at(-1)||null;}
  function snapshot(p,ds){if(!p||p.status==='paused')return null;return {stageId:p.stageId,revisionId:p.id,phone:p.phone,bed:p.bed,wake:p.wake,bedAt:targetAt(ds,p.bed).toISOString(),phoneAt:targetAt(ds,p.phone).toISOString()};}
  function result(w,p,ds,now){
    const t=(w&&w.targetSnapshot)||snapshot(p,ds);
    if(!t)return {label:'未啟用／暫停',kind:'inactive'};
    if(!w||!w.inBedAt)return {label:new Date(t.bedAt)>now?'尚未到時間':'未記錄',kind:'missing'};
    const delta=Math.round((new Date(w.inBedAt)-new Date(t.bedAt))/60000);
    if(!Number.isFinite(delta))return {label:'時間待修正',kind:'missing'};
    return {label:delta<=0?'準時上床':'晚 '+delta+' 分鐘',kind:delta<=0?'onTime':'late',delta};
  }
  // 沒按「上床」但有填睡眠紀錄：拿入睡時間跟目標比（凌晨的時間算隔天）。沒資料回 null，不當成沒達標
  function sleepResult(sleepTime,bedAtIso,ds){
    const at=targetAt(ds,sleepTime);
    if(!at||!bedAtIso)return null;
    const delta=Math.round((at-new Date(bedAtIso))/60000);
    if(!Number.isFinite(delta))return null;
    return {label:'入睡 '+sleepTime+(delta<=0?'（準時）':'（晚 '+delta+' 分）'),kind:delta<=0?'onTime':'late',delta};
  }
  // Per-field timestamps preserve independent phone/bed edits and explicit clears.
  function mergeWind(a,b){
    if(!a)return b;if(!b)return a;
    const newer=(+b.updatedAt||0)>=(+a.updatedAt||0)?b:a;
    const out={...newer,fieldUpdatedAt:{}};
    for(const key of ['phoneAwayAt','inBedAt','obstacle']){
      const stamp=x=>x.fieldUpdatedAt?.[key]??(Object.hasOwn(x,key)?(+x.updatedAt||0):-1);
      const sa=stamp(a),sb=stamp(b),winner=sb>=sa?b:a;
      if(Object.hasOwn(winner,key))out[key]=winner[key];else delete out[key];
      if(Math.max(sa,sb)>=0)out.fieldUpdatedAt[key]=Math.max(sa,sb);
    }
    return out;
  }
  // ── 匯入計畫檔（format: grandol-plan）──────────────────────────────
  // 同一個 key 重複匯入只會更新，不會多一份；完成狀態、決定結果、待確認的勾選都保留
  function applyPlan(f,src,opts){
    opts=opts||{};const now=opts.now||Date.now(),today=opts.today||dateKey(new Date(now));
    if(!src||src.format!=='grandol-plan'||src.version!==1)return {error:'這不是格蘭朵的計畫檔'};
    const rep={added:0,updated:0,stages:0,checkpoints:0,events:0,periods:0,todos:0,items:0,matched:[],warnings:[]};
    const out=clean(f);out.projects=out.projects.map(x=>({...x,milestones:(x.milestones||[]).map(m=>({...m}))}));
    const D=x=>validDate(x)?x:'';
    const keep=(arr,key,make)=>{            // 依 key 更新或新增，其他沒有 key 的（使用者自己加的）不動
      const list=(arr||[]).map(x=>({...x}));
      const i=list.findIndex(x=>x.planKey===key);
      if(i>=0){list[i]=make(list[i],false);return {list,item:list[i],isNew:false};}
      const item=make(null,true);list.push(item);return {list,item,isNew:true};
    };
    (src.projects||[]).forEach(pj=>{
      if(!pj||!pj.key||!pj.title){rep.warnings.push('有一個目標缺少 key 或名稱，已略過');return;}
      let g=out.projects.find(p=>p.planKey===pj.key);
      if(!g&&Array.isArray(pj.match))g=out.projects.find(p=>p.kind!=='body'&&p.status!=='archived'&&!p.planKey&&pj.match.some(m=>String(p.title).includes(m)));
      if(g&&!g.planKey)rep.matched.push(g.title+' → '+pj.title);
      if(!g){g={id:'plan-'+pj.key,kind:'project',status:'active',milestones:[],next:{id:'plan-'+pj.key+'-next',text:'',small:''},createdAt:now};out.projects.push(g);rep.added++;}else rep.updated++;
      g.planKey=pj.key;g.title=pj.title;g.group=pj.group||g.group||'';g.note=pj.note||'';
      const due=D(pj.due);
      if(due&&g.dueDate&&g.dueDate!==due)g.dueHistory=[...(g.dueHistory||[]),{from:g.dueDate,to:due,on:today}];
      if(due)g.dueDate=due;
      g.startOn=D(pj.start)||g.startOn||today;
      g.phases=(pj.phases||[]).filter(x=>x&&D(x.from)&&D(x.to)).map((x,i)=>({id:g.id+'-ph'+i,label:String(x.label||''),from:x.from,to:x.to}));
      (pj.stages||[]).forEach(st=>{
        if(!st||!st.key||!st.title)return;
        const r=keep(g.milestones,st.key,(old,isNew)=>({...(old||{id:g.id+'-'+st.key,done:false}),planKey:st.key,title:String(st.title),due:D(st.due),from:D(st.from),hard:!!st.hard,note:st.note||''}));
        g.milestones=r.list;rep.stages++;
      });
      // 沒有 key 的階段（使用者自己加的）放在計畫階段後面，已經有的順序不亂
      const plan=g.milestones.filter(m=>m.planKey),mine=g.milestones.filter(m=>!m.planKey);
      const order=(pj.stages||[]).map(x=>x.key);plan.sort((x,y)=>order.indexOf(x.planKey)-order.indexOf(y.planKey));
      g.milestones=[...mine.filter(m=>m.done),...plan,...mine.filter(m=>!m.done)];
      (pj.checkpoints||[]).forEach(cp=>{
        if(!cp||!cp.key||!cp.title)return;
        const r=keep(g.checkpoints,cp.key,(old)=>({...(old||{id:g.id+'-'+cp.key}),planKey:cp.key,title:String(cp.title),due:D(cp.due),approx:!!cp.approx,check:cp.check||'',bar:cp.bar||'',fallback:cp.fallback||'',updatedAt:now}));
        g.checkpoints=r.list;rep.checkpoints++;
      });
      g.updatedAt=now;
    });
    const pl=out.plan||{id:'__plan',version:1,title:'',updatedAt:0,importedAt:0,calDetail:true,cal:{},periods:[],events:[],todos:[],items:[]};
    const into=(field,list,make,counter)=>{
      (list||[]).forEach(x=>{
        if(!x||!x.key)return;
        const r=keep(pl[field],x.key,(old)=>({...(old||{id:'pl-'+x.key}),...make(x),planKey:x.key,deleted:false,updatedAt:now}));
        pl[field]=r.list;rep[counter]++;
      });
    };
    into('events',src.events,x=>({title:String(x.title||''),from:D(x.from),to:D(x.to||x.from),tentative:!!x.tentative,color:x.color||''}),'events');
    into('periods',src.periods,x=>({label:String(x.label||''),from:D(x.from),to:D(x.to),mode:x.mode==='pause'?'pause':'floor'}),'periods');
    into('items',src.items,x=>({label:String(x.label||''),floor:x.floor||'',target:x.target||'',weekly:+x.weekly||0,floorRule:x.floorRule||null,targetRule:x.targetRule||null,redline:x.redline||null,note:x.note||''}),'items');
    (src.todos||[]).forEach(x=>{
      if(!x||!x.key)return;
      const r=keep(pl.todos,x.key,(old)=>({...(old||{id:'pl-'+x.key,done:!!x.done}),text:String(x.text||''),due:D(x.due),project:x.project||'',planKey:x.key,deleted:false,updatedAt:now}));
      pl.todos=r.list;rep.todos++;
    });
    pl.title=String(src.title||pl.title||'');pl.importedAt=now;pl.updatedAt=now;
    if(pl.cal===undefined)pl.cal={};
    out.plan=pl;
    const size=JSON.stringify(out).length;
    return {focus:out,report:rep,size};
  }
  // ── 每天的底線：地板版（一定要做到）與目標版 ───────────────────────────
  const toMin=(t,bed)=>{const a=String(t).split(':').map(Number);let x=a[0]*60+(a[1]||0);if(bed&&a[0]<12)x+=1440;return x;};
  // ctx：{wake:'08:30', bed:'02:10', minutes:30, shoulder:true, habit:true}
  function ruleMet(rule,ctx){
    if(!rule||!rule.type)return false;
    if(rule.type==='wake'){
      if(!validTime(ctx.wake))return false;
      let max=rule.max;   // 前一晚太晚睡，起床時間放寬
      if(rule.grace&&validTime(ctx.bed)&&toMin(ctx.bed,true)>=toMin(rule.grace.bedAfter,true))max=rule.grace.max;
      if(toMin(ctx.wake)>toMin(max))return false;
      // 睡滿幾小時才算：起床晚一點沒關係，但睡太少不行（有入睡紀錄才算，沒有就只看起床時間）
      if(rule.minHours&&validTime(ctx.bed)){const mins=((toMin(ctx.wake)-toMin(ctx.bed))%1440+1440)%1440;if(mins<rule.minHours*60)return false;}
      return true;
    }
    if(rule.type==='bed')return validTime(ctx.bed)&&toMin(ctx.bed,true)<=toMin(rule.max,true);
    if(rule.type==='exercise')return (+ctx.minutes||0)>=(+rule.minutes||0)&&(+rule.minutes>0)||(!!rule.orShoulder&&!!ctx.shoulder);
    if(rule.type==='habit')return !!ctx.habit;
    return false;
  }
  function itemDay(item,ctx,manual){
    const floor=ruleMet(item.floorRule,ctx)||manual==='floor'||manual==='target';
    const target=ruleMet(item.targetRule,ctx)||manual==='target';
    return {floor,target};
  }
  function periodOf(plan,day){
    const list=((plan&&plan.periods)||[]).filter(x=>!x.deleted&&x.from<=day&&day<=x.to);
    return list.find(x=>x.mode==='pause')||list[0]||null;   // 暫停優先於地板
  }
  // ── 一次貼上多個目標：「作品A(希望在11月底做完)」→ 標題、日期、備註、分類 ──────────
  // 農曆新年（除夕前一天是 eve）；超過表格的年份就不猜
  const CNY={2027:'2027-02-06',2028:'2028-01-26',2029:'2029-02-13',2030:'2030-02-03'};
  const ZH={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,十一:11,十二:12};
  const monthNum=t=>/^\d+$/.test(t)?+t:(ZH[t]||0);
  const addDays=(ds,n)=>{const d=new Date(ds+'T12:00:00');d.setDate(d.getDate()+n);return dateKey(d);};
  const daysFrom=(a,b)=>Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/86400000);
  // 沒說年份：過去超過 60 天就當作明年（跟卡片上打 10/8 的規則一樣）
  function guessYear(today,m,d){
    const y=+today.slice(0,4),t=new Date(y,m-1,d,12);
    return (daysFrom(dateKey(t),today)>60)?y+1:y;
  }
  const MON='(\\d{1,2}|十[一二]?|[一二三四五六七八九])';
  function parseDateText(txt,today){
    txt=String(txt||'');let m;
    const ty=+today.slice(0,4);
    // 年前＝除夕那天（要在團圓之前做好）
    if((m=txt.match(/(?:明年)?(?:過年前|年前)/))){
      const eve=Object.values(CNY).map(x=>addDays(x,-1)).find(x=>x>=today);
      return eve?{due:eve,text:m[0]}:null;
    }
    // 11/14、11月14日
    if((m=txt.match(/(明年)?\s*(\d{1,2})\s*(?:[\/.]|月)\s*(\d{1,2})\s*[日號号]?/))){
      const mo=+m[2],d=+m[3];if(mo<1||mo>12||d<1||d>31)return null;
      const y=m[1]?ty+1:guessYear(today,mo,d),due=dateKey(new Date(y,mo-1,d,12));
      return validDate(due)&&+due.slice(5,7)===mo?{due,text:m[0]}:null;
    }
    // 11月底、明年五月（只說月份＝那個月底）
    if((m=txt.match(new RegExp('(今年|明年)?\\s*'+MON+'\\s*月\\s*(?:底|末|前)?')))){
      const mo=monthNum(m[2]);if(mo<1||mo>12)return null;
      const y=m[1]==='明年'?ty+1:(m[1]==='今年'?ty:guessYear(today,mo,new Date(ty,mo,0).getDate()));
      return {due:dateKey(new Date(y,mo,0,12)),text:m[0]};
    }
    return null;
  }
  const BULLET=/^\s*(?:\d+\s*[.、)．）]|[-*•・])\s*(.+?)\s*$/;
  const FILLER=/[希望可能大概預計要在做完完成做好前之的，,。!！?？\s（）()]/g;
  function parseGoalLines(text,today){
    const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const hasBullets=lines.some(l=>BULLET.test(l)),out=[];let group='';
    lines.forEach(line=>{
      if(/^[-—–_=*]{3,}$/.test(line)){group='';return;}
      const bm=line.match(BULLET);
      if(hasBullets&&!bm){   // 沒有編號的一行＝分類標題（「生活影片剪輯」「我現在有一些創作目標：」）
        group=line.replace(/[：:]\s*$/,'').replace(/^我(現在|目前)?(有|還有)?(一些|幾個)?/,'').trim();return;
      }
      const body=bm?bm[1]:line;
      const pm=body.match(/^(.*?)\s*[（(](.*)[）)]\s*$/);
      let title,inner='';
      if(pm){title=pm[1].trim();inner=pm[2].trim();}else title=body;
      // 日期先看括號裡，沒有再看整行
      let dt=inner?parseDateText(inner,today):null,from=inner;
      if(!dt){dt=parseDateText(pm?title:body,today);from=pm?title:body;}
      let note='';
      if(pm){
        const rest=dt?inner.replace(dt.text,''):inner;
        if(rest.replace(FILLER,'').length>=2)note=inner;   // 括號裡除了日期還有別的話，留成備註
      }
      if(dt&&!pm)title=body.replace(dt.text,'').replace(/[\s,，、]+$/,'').replace(/(希望|要|在|前|做完|完成|做好)+$/,'').replace(/^(希望|在)/,'').trim();
      if(!title)return;
      out.push({group,title,due:dt?dt.due:'',note});
    });
    return out;
  }
  const api={stages,dateKey,validDate,validTime,targetAt,clean,merge,planFor,snapshot,result,sleepResult,mergeWind,parseDateText,parseGoalLines,applyPlan,ruleMet,itemDay,periodOf,mergePlan,cleanPlan,toMin};
  root.FocusCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
