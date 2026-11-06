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
  function clean(v){
    v=v&&typeof v==='object'?v:{};
    // experiments：回顧帶走的實驗；insights：Claude 從日記看見的我（每月一批）
    const arr=(x,ok)=>Array.isArray(x)?x.filter(o=>o&&typeof o.id==='string'&&ok(o)):[];
    const extra={experiments:arr(v.experiments,o=>typeof o.text==='string'),insights:arr(v.insights,o=>typeof o.text==='string')};
    return {...extra,version:1,revisions:Array.isArray(v.revisions)?v.revisions.filter(x=>x&&typeof x.id==='string'&&validDate(x.effectiveFrom)&&validTime(x.bed)&&validTime(x.phone)&&validTime(x.wake)):[],projects:Array.isArray(v.projects)?v.projects.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string').map(x=>({...x,milestones:Array.isArray(x.milestones)?x.milestones.filter(m=>m&&typeof m.title==='string'):[],next:x.next&&typeof x.next==='object'?x.next:null})):[]};
  }
  function merge(a,b){
    a=clean(a);b=clean(b);
    const combine=(xs,ys)=>{const m=new Map();[...xs,...ys].forEach(x=>{const p=m.get(x.id);if(!p||(+x.updatedAt||0)>=(+p.updatedAt||0))m.set(x.id,x);});return [...m.values()];};
    return {version:1,revisions:combine(a.revisions,b.revisions),projects:combine(a.projects,b.projects),
      experiments:combine(a.experiments,b.experiments),insights:combine(a.insights,b.insights)};
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
  const api={stages,dateKey,validDate,validTime,targetAt,clean,merge,planFor,snapshot,result,sleepResult,mergeWind,parseDateText,parseGoalLines};
  root.FocusCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
