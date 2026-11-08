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
    into('items',src.items,x=>({label:String(x.label||''),floor:x.floor||'',target:x.target||'',weekly:+x.weekly||0,floorRule:x.floorRule||null,targetRule:x.targetRule||null,redline:x.redline||null,note:x.note||'',later:!!x.later}),'items');
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
  // ── 實測速度重算（決定點用）──────────────────────────────────────────
  // 預估常常偏樂觀，所以到決定點時用「這段實際做了多少、花了幾天」重算剩下的要多久。
  // speed：{unit,total,doneAmt,sinceDay,days,asOf}，都是使用者自己填的（或沿用專案開始日）。
  // asOf＝填「已做」那天：之後再打開，推算還是以那天為準，不會因為日子過去而數字自己漂移。
  // 只呈現「做到的」與推算：沒填就回 null（不算失敗）、不評分、不自動改日期。
  const r6=x=>Math.round(x*1e6)/1e6;
  const numOf=x=>{const n=typeof x==='number'?x:parseFloat(String(x==null?'':x).replace(/[,，\s]/g,''));return Number.isFinite(n)?n:NaN;};
  function fmtNum(n){
    if(!Number.isFinite(n))return '';
    const a=Math.abs(n);
    return String(+n.toFixed(a>=100?0:(a>=10?1:(a>=1?2:(a>=0.01?3:4)))));   // 太小的數字（每秒幾天）多留幾位
  }
  // 預估日期的顯示：跟參考日同一年就只寫月/日，不同年才加年
  function mdText(s,ref){
    if(!validDate(s))return '';
    const md=(+s.slice(5,7))+'/'+(+s.slice(8,10));
    return ref&&s.slice(0,4)!==String(ref).slice(0,4)?s.slice(0,4)+'/'+md:md;
  }
  const SPEED_KEYS=['unit','total','doneAmt','sinceDay','days'];
  const speedHas=sp=>!!sp&&typeof sp==='object'&&SPEED_KEYS.some(k=>sp[k]!==undefined&&sp[k]!=='');
  // 已花的天數：有手動填就用手動的；沒有就從開始日算到「填數字的那天」。opts：{today,startOn}
  function speedDays(speed,opts){
    opts=opts||{};const sp=speed&&typeof speed==='object'?speed:{};
    const today=validDate(opts.today)?opts.today:dateKey(new Date());
    const asOf=validDate(sp.asOf)?sp.asOf:today;
    const since=validDate(sp.sinceDay)?sp.sinceDay:(validDate(opts.startOn)?opts.startOn:'');
    const auto=since?daysFrom(since,asOf):NaN,manual=numOf(sp.days);
    return {asOf,since,auto:auto>0?auto:NaN,manual:manual>0?manual:NaN,days:manual>0?manual:(auto>0?auto:NaN)};
  }
  // 還缺什麼才算得出來（給卡片上的提示；都有就回空陣列）
  function speedMissing(speed,opts){
    const sp=speed&&typeof speed==='object'?speed:{},out=[];
    if(!(numOf(sp.total)>0))out.push('總量');
    if(!(numOf(sp.doneAmt)>0))out.push('已做的量');
    if(!(speedDays(sp,opts).days>0))out.push('開始日或天數');
    return out;
  }
  // opts：{today,due,startOn}。算不出來（沒填、已做是 0、天數不夠）就回 null
  function speedCalc(speed,opts){
    opts=opts||{};
    if(!speedHas(speed))return null;
    const total=numOf(speed.total),done=numOf(speed.doneAmt);
    if(!(total>0)||!(done>0))return null;
    const t=speedDays(speed,opts),days=t.days;
    if(!(days>0))return null;
    const remain=Math.max(0,r6(total-done)),perDay=done/days,perUnit=days/done;
    const needDays=remain>0?Math.ceil(r6(remain*days/done)):0;
    const eta=addDays(t.asOf,needDays),due=validDate(opts.due)?opts.due:'';
    return {unit:String(speed.unit||'').trim()||'單位',total,doneAmt:done,remain,days,autoDays:t.auto,manualDays:t.manual,asOf:t.asOf,
      perDay,perUnit,needDays,eta,due,diff:due?daysFrom(due,eta):null,finished:remain<=0};
  }
  // 「這段做了 X、用了 Y 天 → 每單位 Z 天；剩下 W 要 N 天，預計 日期；比現在的截止日 晚／早 M 天」
  function speedText(calc){
    if(!calc)return null;
    const u=calc.unit,ref=calc.asOf;
    const pu=fmtNum(calc.perUnit),day=`平均每天 ${fmtNum(calc.perDay)} ${u}`;
    // 單位很小（每秒、每字）時每單位只有零點零幾天，照實寫；小到顯示成 0 就只留「平均每天」
    const pace=`這段做了 ${fmtNum(calc.doneAmt)} ${u}、用了 ${fmtNum(calc.days)} 天 → ${pu&&pu!=='0'?`每${u} ${pu} 天（${day}）`:day}`;
    if(calc.finished)return {pace,plan:`已經做完了（${fmtNum(calc.doneAmt)} / ${fmtNum(calc.total)} ${u}）`,full:`${pace}；已經做完了`};
    let plan=`剩下 ${fmtNum(calc.remain)} ${u}要 ${calc.needDays} 天，預計 ${mdText(calc.eta,ref)}`;
    if(calc.due){
      const d=calc.diff;
      plan+=`；比現在的截止日 ${mdText(calc.due,ref)} ${d>0?'晚 '+d+' 天':(d<0?'早 '+(-d)+' 天':'剛好')}`;
    }else plan+='（目前沒有設截止日）';
    return {pace,plan,full:pace+'；'+plan};
  }
  // 卡片上改一格：回 {speed}（全部清空時 speed 是 null）或 {error}
  // key：unit／total／doneAmt／sinceDay（要先轉成 YYYY-MM-DD）／days。填「已做」時記下那天當作推算基準
  function speedSet(speed,key,raw,opts){
    if(SPEED_KEYS.indexOf(key)<0)return {error:'不認得這一格'};
    opts=opts||{};const s={...(speed&&typeof speed==='object'?speed:{})},v=String(raw==null?'':raw).trim();
    if(!v)delete s[key];
    else if(key==='unit')s.unit=v.slice(0,8);
    else if(key==='sinceDay'){if(!validDate(v))return {error:'日期看不懂，打成 11/9 這樣就好'};s.sinceDay=v;}
    else{
      const n=numOf(v);
      if(!Number.isFinite(n)||n<0||(key!=='doneAmt'&&n===0))return {error:key==='days'?'天數打大於 0 的數字就好':'打數字就好，例如 1200'};
      s[key]=n;
    }
    if(key==='doneAmt'){if(s.doneAmt!==undefined)s.asOf=validDate(opts.today)?opts.today:dateKey(new Date());else delete s.asOf;}
    return {speed:speedHas(s)?s:null};
  }
  // ── 體重：看平均，不看一天的起伏 ────────────────────────────────────
  // list：[{day,kg}]。起點＝第一筆起 7 天的平均；現在＝最近 7 天的平均。
  // 每月想減 perMonth 公斤：照天數推算「現在大約該到哪」，只呈現、不評分。
  // 兩個平均的中心差 (days-6) 天，所以預期變化＝-perMonth×(days-6)/30.4；滿 14 天才開始比，避免兩段重疊。
  function weightTrend(list,today,perMonth){
    const pm=Number.isFinite(+perMonth)&&+perMonth>=0?+perMonth:1;
    const pts=(list||[]).map(x=>({day:x&&x.day,kg:numOf(x&&x.kg)})).filter(x=>validDate(x.day)&&x.day<=today&&x.kg>=20&&x.kg<=300)
      .sort((a,b)=>a.day<b.day?-1:a.day>b.day?1:0);
    if(!pts.length)return null;
    const shift=(d,n)=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return dateKey(x);};
    const avg=a=>a.length?a.reduce((t,x)=>t+x.kg,0)/a.length:null;
    const r1=x=>x==null?null:Math.round(x*10)/10;
    const first=pts[0].day,days=Math.round((new Date(today+'T12:00:00')-new Date(first+'T12:00:00'))/86400000);
    const start=avg(pts.filter(x=>x.day<=shift(first,6))),recent=avg(pts.filter(x=>x.day>=shift(today,-6)));
    const ready=days>=13;
    return {n:pts.length,first,days,ready,perMonth:pm,start:r1(start),recent:r1(recent),
      delta:ready&&recent!=null?r1(recent-start):null,
      expect:ready&&pm>0?r1(-pm*(days-6)/30.4):null};
  }
  // ── 入睡時間：看趨勢，和「哪一晚最晚」，不看單一晚 ─────────────────────
  // list：[{day,bed:'HH:MM'}]，day＝紀錄日期（那一晚的隔天早上）。凌晨的時間算同一晚（toMin 的第二個參數）。
  const m2t=m=>{m=((Math.round(m)%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
  const shiftD=(d,n)=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return dateKey(x);};
  const bedPts=(list,today)=>(list||[]).filter(x=>x&&validDate(x.day)&&validTime(x.bed)&&x.day<=today);
  // 近 7 晚平均入睡，跟前 7 晚比（diff＞0＝這 7 晚比較早）。兩邊都要有 4 晚以上才比，不然只給平均。
  function sleepTrend(list,today){
    const pts=bedPts(list,today),win=(a,b)=>pts.filter(x=>x.day>=a&&x.day<=b).map(x=>toMin(x.bed,true));
    const avg=a=>a.length?a.reduce((t,v)=>t+v,0)/a.length:null;
    const cur=win(shiftD(today,-6),today),prev=win(shiftD(today,-13),shiftD(today,-7)),a=avg(cur),b=avg(prev);
    return {n:cur.length,prevN:prev.length,avg:a==null?null:m2t(a),diff:(cur.length>=4&&prev.length>=4)?Math.round(b-a):null};
  }
  // 過去 days 天裡，哪個星期幾的「晚上」平均最晚睡。每個星期幾要有 minN 晚以上，而且比整體平均晚 gap 分鐘以上才算。
  // 回傳 dow（0＝週日…6＝週六，指「那天晚上」，也就是紀錄日期的前一天）。
  function worstNight(list,today,opt){
    const days=(opt&&opt.days)||90,minN=(opt&&opt.minN)||4,gap=(opt&&opt.gap)||20,lo=shiftD(today,-days);
    const pts=bedPts(list,today).filter(x=>x.day>=lo);if(!pts.length)return null;
    const by={};pts.forEach(x=>{const dow=new Date(shiftD(x.day,-1)+'T12:00:00').getDay();(by[dow]=by[dow]||[]).push(toMin(x.bed,true));});
    const all=pts.map(x=>toMin(x.bed,true)),overall=all.reduce((t,v)=>t+v,0)/all.length;
    let best=null;
    Object.keys(by).forEach(k=>{const v=by[k];if(v.length<minN)return;const a=v.reduce((t,x)=>t+x,0)/v.length;if(!best||a>best.a)best={dow:+k,a,n:v.length};});
    if(!best||best.a-overall<gap)return null;
    return {dow:best.dow,avg:m2t(best.a),n:best.n,overall:m2t(overall)};
  }
  const api={stages,dateKey,validDate,validTime,targetAt,clean,merge,planFor,snapshot,result,sleepResult,mergeWind,parseDateText,parseGoalLines,applyPlan,ruleMet,itemDay,periodOf,mergePlan,cleanPlan,toMin,
    speedHas,speedDays,speedMissing,speedCalc,speedText,speedSet,fmtNum,mdText,weightTrend,sleepTrend,worstNight};
  root.FocusCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
