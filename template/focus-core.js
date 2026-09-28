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
    return {version:1,revisions:Array.isArray(v.revisions)?v.revisions.filter(x=>x&&typeof x.id==='string'&&validDate(x.effectiveFrom)&&validTime(x.bed)&&validTime(x.phone)&&validTime(x.wake)):[],projects:Array.isArray(v.projects)?v.projects.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string').map(x=>({...x,milestones:Array.isArray(x.milestones)?x.milestones.filter(m=>m&&typeof m.title==='string'):[],next:x.next&&typeof x.next==='object'?x.next:null})):[]};
  }
  function merge(a,b){
    a=clean(a);b=clean(b);
    const combine=(xs,ys)=>{const m=new Map();[...xs,...ys].forEach(x=>{const p=m.get(x.id);if(!p||(+x.updatedAt||0)>=(+p.updatedAt||0))m.set(x.id,x);});return [...m.values()];};
    return {version:1,revisions:combine(a.revisions,b.revisions),projects:combine(a.projects,b.projects)};
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
  const api={stages,dateKey,validDate,validTime,targetAt,clean,merge,planFor,snapshot,result,mergeWind};
  root.FocusCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
