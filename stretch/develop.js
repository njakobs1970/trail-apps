// Develop / Light / Top-up / Pre-run session builder, weekly plan, variation engine, progression and progress tests.
// Pure functions (no DOM) so they run in Node tests. State object "dev" lives in localStorage.
// All evidence-based thresholds come from evidence.js (generated from evidence.json).
(function(root){
const E=root.EVIDENCE||require('./evidence.js');const R=E.rules;
const TR=30, SW=5;
const AREAS={
  calves:   {name:'Calves/soleus & ankle',patterns:['calf-bent','calf-straight'],key:['calf-bent'],tests:['ktwL','ktwR']},
  hamstrings:{name:'Hamstrings',patterns:['ham-hinge','ham-supine'],key:['ham-hinge','ham-supine'],tests:['sar','aslrL','aslrR']},
  hipflex:  {name:'Hip flexors/quads',patterns:['hipflex','quad'],key:['hipflex'],tests:['thomasLcm','thomasRcm']},
  hips:     {name:'Glutes/hips (rotation, adductors)',patterns:['hip-er','hip-rot','adductor'],key:['hip-rot','adductor'],tests:['hipIRL','hipIRR','hipERL','hipERR','straddle']},
  feet:     {name:'Feet/plantar fascia',secondary:true,pnf:['toe-sit'],loaded:'tib-raise',end:'toe-mob',tests:[]},
  thoracic: {name:'Thoracic spine (climb posture)',secondary:true,pnf:['thread-needle','open-book'],loaded:null,end:'tspine-lift',tests:['shoulder']},
};
const DEFAULT_AREAS=['calves','hamstrings','hipflex','hips'];
const N=R.retestNoise||{};
const TESTS={
  ktwL:{name:'Knee-to-wall, left',unit:'cm',thr:N.ktw||2,target:12,area:'calves'},
  ktwR:{name:'Knee-to-wall, right',unit:'cm',thr:N.ktw||2,target:12,area:'calves'},
  sar:{name:'Sit-and-reach (cm past toes, negative if short)',unit:'cm',thr:N.sar||3,target:5,area:'hamstrings'},
  aslrL:{name:'Active straight-leg raise, left',unit:'°',thr:N.deg||5,target:80,area:'hamstrings'},
  aslrR:{name:'Active straight-leg raise, right',unit:'°',thr:N.deg||5,target:80,area:'hamstrings'},
  thomasLcm:{name:'Thomas test, left (thigh above bed, cm; 0 = flat)',unit:'cm',thr:N.thomasCm||2,target:0,lower:true,area:'hipflex'},
  thomasRcm:{name:'Thomas test, right (thigh above bed, cm; 0 = flat)',unit:'cm',thr:N.thomasCm||2,target:0,lower:true,area:'hipflex'},
  hipIRL:{name:'Seated hip internal rotation, left',unit:'°',thr:N.deg||5,target:35,area:'hips'},
  hipIRR:{name:'Seated hip internal rotation, right',unit:'°',thr:N.deg||5,target:35,area:'hips'},
  hipERL:{name:'Seated hip external rotation, left',unit:'°',thr:N.deg||5,target:45,area:'hips'},
  hipERR:{name:'Seated hip external rotation, right',unit:'°',thr:N.deg||5,target:45,area:'hips'},
  straddle:{name:'Long-sit straddle width (heel to heel)',unit:'cm',thr:N.sar||3,target:null,area:'hips'},
  thomasL:{name:'Thomas test, left (old pass/fail)',unit:'pass',area:'hipflex',legacy:true},
  thomasR:{name:'Thomas test, right (old pass/fail)',unit:'pass',area:'hipflex',legacy:true},
  shoulder:{name:'Lying shoulder flexion',unit:'pass',area:'thoracic'},
};
const WARM_POOL=['leg-swing','leg-swing-side','ankle-circles','knee-wall','walking-lunge','worlds-greatest','cat-cow'];
const PRE_RUN=['leg-swing','leg-swing-side','ankle-circles','knee-wall','walking-lunge','worlds-greatest','cossack']; // dynamic only
const PLAN=['A','light','B','light','A','light','B']; // Mon..Sun
function fresh(now=Date.now()){return {v:2,start:now,areas:DEFAULT_AREAS.slice(),maint:[],prog:{},pp:{},hist:[],emph:{},loads:{'deficit-calf':0,jefferson:4,'sl-rdl':0,cossack:0,'tib-raise':0},endHold:{},boost:{},flatActed:{},ratings:[],secs:{},tests:[],rotate:0,notes:[]}}
// Safe, additive migration: never deletes or rewrites old fields (prog, ratings, tests, secs, loads stay as they were).
function migrate(dev,now=Date.now()){
  if(!dev||typeof dev!=='object')return fresh(now);
  const f=fresh(now);for(const k of Object.keys(f))if(dev[k]==null)dev[k]=f[k];
  if((dev.v||1)<2){
    for(const [a,p] of Object.entries(dev.prog||{})){const A=AREAS[a];if(!A||!A.patterns||!p)continue;
      for(const pat of A.patterns)if(!dev.pp[pat])dev.pp[pat]={tier:Math.min(3,(p.level||0)+1),final:Math.max(R.holdMin,Math.min(R.finalHoldCap,p.final||45)),rounds:Math.min(R.pnf.roundsMax,Math.max(R.pnf.roundsMin,p.rounds||3)),sets:1}}
    dev.v=2;dev.migratedAt=new Date(now).toISOString();
  }
  dev.areas=dev.areas.filter(a=>AREAS[a]);dev.maint=dev.maint.filter(a=>AREAS[a]);
  return dev;
}
function prog(dev,a){return dev.prog[a]||(dev.prog[a]={level:0,final:45,rounds:3,loadSteps:0})} // legacy (kept for old data)
function pp(dev,pat){return dev.pp[pat]||(dev.pp[pat]={tier:1,final:45,rounds:3,sets:1})}
function weekIndex(dev,now=Date.now()){return Math.floor((now-dev.start)/(7*864e5))+1}
function isDeload(dev,now){return weekIndex(dev,now)%R.deloadEvery===0}
function monday(t){const d=new Date(t);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d}
function dayKey(t){const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
const dayNum=k=>Math.round(new Date(k+'T12:00').getTime()/864e5);
function weekSecs(dev,now=Date.now()){const m=monday(now).getTime(),out={};for(const [k,v] of Object.entries(dev.secs))if(new Date(k+'T12:00').getTime()>=m&&new Date(k+'T12:00').getTime()<m+7*864e5)for(const [a,s] of Object.entries(v))out[a]=(out[a]||0)+s;return out}
function weekDays(dev,a,now=Date.now()){const m=monday(now).getTime();return Object.entries(dev.secs).filter(([k,v])=>{const t=new Date(k+'T12:00').getTime();return t>=m&&t<m+7*864e5&&v[a]>0}).length}
function credit(dev,area,secs,now=Date.now()){if(!area||!(secs>0))return;const k=dayKey(now);(dev.secs[k]=dev.secs[k]||{});dev.secs[k][area]=(dev.secs[k][area]||0)+Math.round(secs)}
const AREA_OF={calves:'calves',feet:'feet',hamstrings:'hamstrings',quads:'hipflex',hips:'hips',glutes:'hips',back:'thoracic',shoulders:'thoracic'};
function areaOf(ex){if(ex.parea)return ex.parea;for(const a of ex.area||[])if(AREA_OF[a])return AREA_OF[a];return null}
function vol(dev,a,now){return (isDeload(dev,now)?R.deloadFactor:1)*(dev.boost[a]||1)}
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function hash(s){let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0}
// ---- Weekly plan ----
function groups(dev){const a=dev.areas,h=Math.ceil(a.length/2);return {A:a.slice(0,h),B:a.slice(h)}}
function planFor(dev,{now=Date.now(),today='rest',lastLong=null,maintenance=false}={}){
  const k=dayKey(now),afterLong=!!lastLong&&dayNum(k)-dayNum(lastLong)===1;
  if(today==='prerun')return {type:'prerun',label:'Pre-run warm-up',afterLong};
  if(today==='longrun')return {type:'light',flavor:'postlong',label:'Post-long-run flexibility flow',afterLong};
  if(maintenance)return {type:'light',label:'Maintenance (light)',afterLong};
  const slot=PLAN[(new Date(now).getDay()+6)%7];
  if(slot==='light')return {type:'light',label:'Light day',afterLong};
  if(afterLong)return {type:'light',label:'Light day (day after long run)',afterLong};
  return {type:'develop',group:slot,label:'Develop '+slot,afterLong};
}
// ---- Variation engine ----
function context(dev,lib,avail,now,seed){
  const today=dayNum(dayKey(now)),last={},lastRole={},pats={};const m=monday(now).getTime();
  for(const h of dev.hist||[]){const d=today-dayNum(h.d);if(d<0)continue;const inWeek=new Date(h.d+'T12:00').getTime()>=m;
    for(const it of h.items){if(last[it.id]==null||d<last[it.id])last[it.id]=d;const rk=it.id+'|'+it.role;if(lastRole[rk]==null||d<lastRole[rk])lastRole[rk]=d;
      if(inWeek&&it.pattern){(pats[it.pattern]=pats[it.pattern]||new Set()).add(h.d)}}}
  return {dev,lib,avail,now,rand:rng(seed),used:new Set(),penal:new Set(),last,lastRole,pats,G:root.Gen||require('./generator.js')};
}
function roleOf(s){return s.kind==='loaded'?'L':s.kind==='endrange'?'E':'S'}
function pick(ctx,area,role,{pattern=null,strictNew=true}={}){
  const {lib,dev}=ctx;
  let c=lib.filter(s=>s.parea===area&&!s.swapOnly&&(role==='L'?s.kind==='loaded':role==='E'?s.kind==='endrange':!s.kind&&(role!=='P'||s.pnf)));
  if(pattern){const c2=c.filter(s=>s.pattern===pattern);if(c2.length)c=c2}
  const tierOK=c.filter(s=>(s.diff||1)<=pp(dev,s.pattern).tier+1);if(tierOK.length)c=tierOK;
  if(ctx.noCalfEcc&&area==='calves'&&role==='L')return null;
  let opts=c.map(s=>{const r=ctx.G.resolve(s,lib,ctx.avail);return r&&{s:r===s?s:{...r,swappedFrom:s.name,pattern:s.pattern,parea:s.parea,diff:s.diff,pnf:s.pnf&&r.pnf!==false},base:s}}).filter(Boolean)
    .filter(o=>!ctx.used.has(o.s.id)&&!ctx.used.has(o.base.id));
  if(!opts.length)return null;
  const ds=o=>Math.min(ctx.last[o.s.id]??99,ctx.last[o.base.id]??99);
  const fresh=opts.filter(o=>ds(o)>R.noRepeatDays);
  if(!fresh.length&&pattern)return pick(ctx,area,role,{strictNew});
  if(fresh.length)opts=fresh;else if(strictNew)opts=[opts.sort((a,b)=>ds(b)-ds(a))[0]];
  const w=o=>{let x=1;const lr=ctx.lastRole[o.base.id+'|'+role];if(lr!=null&&lr<=R.sameRoleDays)x*=0.15;if((o.base.diff||1)>pp(dev,o.base.pattern).tier)x*=0.5;if(ctx.penal.has(o.base.id))x*=0.05;return x};
  let t=opts.reduce((a,o)=>a+w(o),0),r=ctx.rand()*t,ch=opts[opts.length-1];for(const o of opts){r-=w(o);if(r<=0){ch=o;break}}
  ctx.used.add(ch.s.id);ctx.used.add(ch.base.id);return ch.s;
}
// key (retest-matched) pattern for an area needs >= retestPatternMinPerWeek days
function needKey(ctx,a){const A=AREAS[a];if(!A.key)return null;const need=R.retestPatternMinPerWeek||3;
  const have=k=>(ctx.pats[k]?ctx.pats[k].size:0);const low=A.key.filter(k=>have(k)<need).sort((x,y)=>have(x)-have(y));return low[0]||null}
function secPick(ctx,a){const A=AREAS[a];const L=Object.fromEntries(ctx.lib.map(s=>[s.id,s]));const ids=A.pnf.filter(id=>!ctx.used.has(id));const id=ids[Math.floor(ctx.rand()*ids.length)]||A.pnf[0];ctx.used.add(id);const s=L[id];const r=ctx.G.resolve(s,ctx.lib,ctx.avail)||s;return r!==s?{...r,swappedFrom:s.name}:r}
function holdSteps(ex,list,extra={}){
  const one=side=>list.map(x=>({type:x.type||'hold',secs:x.secs,ex,side,phase:x.phase,...extra}));
  return ex.sides?[...one('Left'),{type:'switch',secs:SW,next:ex,label:'Switch sides'},...one('Right')]:one(null);
}
function deficit(dev,a,now){const t=(dev.maint.includes(a)?R.weeklyFloorMinPerArea:R.weeklyTargetMinPerArea)*60;return Math.max(0,t-(weekSecs(dev,now)[a]||0))/t}
function mainIds(items){return items.filter(i=>i.kind!=='warmup'&&i.kind!=='breath'&&i.block&&!/Warm-up|Breathing/.test(i.block)).map(i=>i.baseId||i.id)}
function overlap(a,b){const A=new Set(a),B=new Set(b);const i=[...A].filter(x=>B.has(x)).length;const u=new Set([...A,...B]).size;return u?i/u:0}
function build(type,dev,lib,opt={}){
  const now=opt.now||Date.now();
  if(type==='plan'){const p=planFor(dev,{now,...(opt.plan||{})});const r=build(p.type,dev,lib,{...opt,group:p.group,flavor:p.flavor,afterLong:p.afterLong});r.plan=p;r.planned=true;return r}
  if(type==='develop'||type==='light'||type==='topup'){
    // variation guard: rebuild with new seeds until overlap with every session of the same type in the window <= maxOverlap
    const today=dayNum(dayKey(now));const prev=(dev.hist||[]).filter(h=>h.t===type&&today-dayNum(h.d)>0&&today-dayNum(h.d)<=R.varietyWindowDays).map(h=>h.items.map(i=>i.id));
    let best=null;for(let tries=0;tries<16;tries++){const r=build1(type,dev,lib,{...opt,now,seedTry:tries,penal:best&&best.over});const ids=mainIds(r.items);
      const mo=prev.length?Math.max(...prev.map(p=>overlap(ids,p))):0;r.maxOverlap=mo;r.over=new Set(prev.flatMap(p=>p.filter(x=>ids.includes(x))));
      if(!best||mo<best.maxOverlap)best=r;if(mo<=R.maxOverlap)break}
    delete best.over;return best}
  return build1(type,dev,lib,{...opt,now});
}
function build1(type,dev,lib,{now=Date.now(),k,avail=null,rest=TR,drop=0,maxSec=0,group,flavor,afterLong=false,seed=0,seedTry=0,penal=null,longHolds=false}={}){
  if(type==='develop'&&k==null){let r;for(const kk of [3,2]){r=build1(type,dev,lib,{now,k:kk,avail,rest,maxSec:maxSec||2100,group,afterLong,seed,seedTry,penal,longHolds});if(r.total<=(maxSec||2100))break}return r}
  if(type==='prerun'&&!drop){let r,dd=0;do{r=build1(type,dev,lib,{now,avail,rest,maxSec,drop:dd||-1});dd++}while(r.total>Math.min(480,maxSec||480)&&PRE_RUN.length-dd>=4);return r}
  const G=root.Gen||require('./generator.js');const hasW=!avail||avail.includes('weight');
  const ctx=context(dev,lib,avail,now,hash(dayKey(now)+'|'+type+'|'+seed+'|'+seedTry));if(penal)ctx.penal=penal;ctx.noCalfEcc=!!afterLong&&R.noHeavyCalfEccAfterLongRun;
  const L0=Object.fromEntries(lib.map(s=>[s.id,s]));const L=new Proxy(L0,{get:(o,id)=>{const s=o[id];if(!s)return s;const r=G.resolve(s,lib,avail)||s;return r!==s?{...r,swappedFrom:s.name}:r}});
  const blocks=[];const deload=isDeload(dev,now);const cap=longHolds?(R.finalHoldCapOptional||[90])[0]:R.finalHoldCap;
  const add=(name,kind,ex,steps,note,rate)=>blocks.push({name,kind,ex,steps,note,rate});
  const H=s=>Math.max(R.holdMin,Math.round(s));
  let areasToday=[];
  if(type==='prerun'){
    for(const id of (drop>0?PRE_RUN.slice(0,PRE_RUN.length-drop):PRE_RUN)){const ex=L[id];add('Dynamic warm-up','warmup',ex,holdSteps(ex,[{secs:ex.secs,phase:'Keep moving'}]),`${ex.secs}s${ex.sides?' each side':''} · dynamic`)}
  } else if(type==='light'){
    const all=dev.areas.concat(dev.maint);const h=flavor==='postlong'?R.recoveryHold:R.lightHold;
    const slots={};for(const a of all)slots[a]=AREAS[a].secondary||dev.maint.includes(a)?1:(deficit(dev,a,now)>0.5?2:1);
    let tot=Object.values(slots).reduce((x,y)=>x+y,0);const byDef=all.filter(a=>!AREAS[a].secondary).sort((x,y)=>deficit(dev,y,now)-deficit(dev,x,now));
    for(let i=0;tot<6&&i<8;i++){slots[byDef[i%byDef.length]]++;tot++}
    const picks=[];for(const a of all){for(let i=0;i<slots[a];i++){const ex=AREAS[a].secondary?secPick(ctx,a):pick(ctx,a,'S',{pattern:i===0?needKey(ctx,a):null});if(ex)picks.push({a,ex})}}
    picks.sort((x,y)=>(x.ex.order||4)-(y.ex.order||4));areasToday=all;
    for(const {a,ex} of picks)add(flavor==='postlong'?'Easy flexibility flow':'Light holds','topup',ex,holdSteps(ex,[{secs:H(h*(deload?0.85:1)),phase:'Hold & breathe'}],{area:a}),`${H(h)}s hold${ex.sides?' each side':''}`);
  } else if(type==='topup'){
    for(const a of dev.areas.concat(dev.maint)){const ex=AREAS[a].secondary?secPick(ctx,a):pick(ctx,a,'P',{pattern:needKey(ctx,a)});if(!ex)continue;const h=deload?40:60;
      add(AREAS[a].name,'topup',ex,holdSteps(ex,[{secs:h,phase:'Hold & breathe'}],{area:a}),`${h}s hold${ex.sides?' each side':''}`)}
  } else { // develop
    const ws=[];const warm=WARM_POOL.slice();for(let i=0;i<3&&warm.length;i++)ws.push(warm.splice(Math.floor(ctx.rand()*warm.length),1)[0]);
    for(const id of ws){const ex=L[id];const s=ex.sides?20:30;add('1 · Warm-up','warmup',ex,holdSteps(ex,[{secs:s,phase:'Keep moving'}]),`${s}s${ex.sides?' each side':''} · dynamic`)}
    const g=groups(dev);let today=(group?g[group]:dev.areas.slice(0,2)).slice();
    if(!today.length)today=dev.areas.slice(0,2);
    // weekly dose drives selection: add the area furthest behind its weekly target (if any) as a third area
    const behind=dev.areas.filter(a=>!today.includes(a)).sort((x,y)=>deficit(dev,y,now)-deficit(dev,x,now))[0];
    if(behind&&deficit(dev,behind,now)>0.75&&(new Date(now).getDay()+6)%7>=3)today.push(behind);
    today=today.slice(0,k||3);areasToday=today.slice();
    for(const a of today){const A=AREAS[a];const v=vol(dev,a,now);
      const ex=A.secondary?secPick(ctx,a):pick(ctx,a,'P',{pattern:needKey(ctx,a)});if(!ex)continue;const pat=ex.pattern||a;const p=pp(dev,pat);
      const rounds=Math.max(1,Math.round(p.rounds*Math.min(v,1.25))),fin=H(Math.min(p.final,cap)*(deload?R.deloadFactor:1));
      const seq=[];for(let r=0;r<rounds;r++)seq.push({secs:R.pnf.contractSec,phase:`Contract ~30% (${r+1}/${rounds})`,type:'contract'},{secs:R.pnf.relaxSec,phase:'Relax, breathe out',type:'relax'},{secs:R.pnf.sinkSec,phase:`Sink deeper (${r+1}/${rounds})`});
      seq.push({secs:fin,phase:'Final hold'});
      add('2 · PNF: '+A.name,'pnf',ex,holdSteps(ex,seq,{area:a}),`PNF ${rounds}×(${R.pnf.contractSec}s contract · ${R.pnf.relaxSec}s relax · ${R.pnf.sinkSec}s deeper) + ${fin}s final${ex.sides?' · each side':''}`,{kind:'pnf',area:a,pattern:pat});
      if(!A.secondary&&today.indexOf(a)<2){const other=A.patterns.find(x=>x!==pat);const ex2=pick(ctx,a,'S',{pattern:other});if(ex2){const sets=deload?1:p.sets;const sq=[];for(let s=0;s<sets;s++){sq.push({secs:fin,phase:`Static hold${sets>1?` (${s+1}/${sets})`:''}`});if(s<sets-1)sq.push({secs:10,phase:'Ease off',type:'relax'})}
        add('2 · Static: '+A.name,'static',ex2,holdSteps(ex2,sq,{area:a}),`${sets}×${fin}s${ex2.sides?' each side':''}`)}}}
    for(const a of dev.maint.slice(0,1)){const ex=AREAS[a].secondary?secPick(ctx,a):pick(ctx,a,'S');if(ex)add('2 · Maintenance: '+AREAS[a].name,'topup',ex,holdSteps(ex,[{secs:45,phase:'Maintenance hold'}],{area:a}),'45s maintenance hold')}
    // one loaded end-range block (emphasis 'loaded' areas first), one end-range isometric from a different area
    const ord=today.slice().sort((x,y)=>(dev.emph[y]==='loaded')-(dev.emph[x]==='loaded')||ctx.rand()-0.5);
    let lx=null,la=null;for(const a of ord){lx=AREAS[a].secondary?null:pick(ctx,a,'L');if(lx){la=a;break}}
    if(lx){const id=lx.id;const bw=!hasW||!!lx.swappedFrom;const kg=bw?0:(dev.loads[id]||0);const tempo=(dev.tempo||{})[id]||3;const sets=deload?1:(dev.emph[la]==='loaded'?3:2);const seq=[];
      for(let s=0;s<sets;s++){seq.push({secs:40,phase:`Slow lowering${bw?' '+tempo+' s down'+((dev.pauseBottom||{})[id]?' + 2 s pause':''):''} · set ${s+1}/${sets}${kg?' · '+kg+' kg':''}`});if(s<sets-1)seq.push({secs:20,phase:'Rest',type:'relax'})}
      add('3 · Loaded / slow lowering','loaded',lx,holdSteps(lx,seq,{area:la,kg}),`${sets}×40s slow lowering${lx.sides?' each side':''} · ${bw?'bodyweight, '+tempo+' s lowering (add a weight when you can: stronger evidence)':kg?kg+' kg':'set a starting load below'}`,{kind:'loaded',ex:id,bw})}
    const eo=today.filter(a=>a!==la).concat(la?[la]:[]);let ee=null,ea=null;for(const a of eo){ee=AREAS[a].secondary?null:pick(ctx,a,'E');if(ee){ea=a;break}}
    if(ee){const id=ee.id;const h=Math.max(R.holdMin,dev.endHold[id]||R.holdMin);const reps=deload?1:2;const seq=[];for(let r=0;r<reps;r++){seq.push({secs:h,phase:`Hold at end range (${r+1}/${reps})`});if(r<reps-1)seq.push({secs:10,phase:'Rest',type:'relax'})}
      add('4 · End-range strength','endrange',ee,holdSteps(ee,seq,{area:ea}),`${reps}×${h}s holds${ee.sides?' each side':''}`,{kind:'endrange',ex:id})}
    add('5 · Breathing','breath',L.breathing,holdSteps(L.breathing,[{secs:120,phase:'Slow breathing: 4 in, 6 out'}]),'2 min');
  }
  if(maxSec){const dur=b=>b.steps.reduce((a,s)=>a+s.secs,0)+rest;let tot=()=>blocks.reduce((a,b)=>a+dur(b),0)-rest;
    const order=['topup-maint','static','endrange','loaded','breath-trim','warmup','pnf','topup','breath'];
    for(const kind of order){while(tot()>maxSec&&blocks.length>1){let i=-1;
        if(kind==='topup-maint')i=type==='develop'?blocks.findIndex(b=>b.kind==='topup'):-1;
        else if(kind==='breath-trim'){const b=blocks.find(b=>b.kind==='breath');if(b&&b.steps[0].secs>60){b.steps=b.steps.map(s=>({...s,secs:60}));b.note='1 min';continue}break}
        else if(kind==='warmup'){const w=blocks.filter(b=>b.kind==='warmup');if(w.length>(type==='prerun'?2:1))i=blocks.lastIndexOf(w.at(-1))}
        else if(kind==='pnf'){const p=blocks.filter(b=>b.kind==='pnf');if(p.length>1)i=blocks.lastIndexOf(p.at(-1))}
        else{for(let x=blocks.length-1;x>=0;x--)if(blocks[x].kind===kind){i=x;break}if(kind==='topup'&&blocks.filter(b=>b.kind==='topup').length<=1)i=-1}
        if(i<0)break;blocks.splice(i,1)}}}
  const steps=[];const items=[];
  blocks.forEach((b,i)=>{if(i>0)steps.push({type:'transition',secs:rest,next:b.ex,label:'Get ready'});steps.push(...b.steps.map(s=>({...s,block:b.name})));
    if(b.rate)steps.push({type:'rate',secs:0,rate:b.rate,ex:b.ex,block:b.name});
    items.push({...b.ex,baseId:b.ex.id,bw:b.rate&&b.rate.bw,hold:b.steps.find(s=>s.type==='hold').secs,planNote:b.note,block:b.name,kg:b.steps[0].kg,role:b.kind});});
  return {items,steps,type,focus:type==='prerun'?'trail':null,deload,week:weekIndex(dev,now),areasToday:type==='develop'?blocks.filter(b=>b.kind==='pnf').map(b=>b.rate.area):areasToday,group:group||null,total:steps.reduce((a,x)=>a+x.secs,0)};
}
// Record what was done (feeds the no-repeat and variety rules). Keeps ~60 sessions.
function record(dev,routine,now=Date.now()){
  const items=(routine.items||[]).filter(i=>i.kind!=='warmup'&&i.kind!=='breath'&&!/Warm-up|Breathing/.test(i.block||'')).map(i=>({id:i.id,role:i.kind==='loaded'?'L':i.kind==='endrange'?'E':'S',pattern:i.pattern||null}));
  dev.hist=(dev.hist||[]).concat({d:dayKey(now),t:routine.type,items}).slice(-60);
}
function nextRotation(dev,used=3){dev.rotate=((dev.rotate||0)+Math.min(used,dev.areas.length))%Math.max(1,dev.areas.length)}

// Progression after a block rating (0-10 discomfort/effort, pain flag). Progress weekly time first (hold up to the cap,
// more PNF rounds, a second static set), then a harder variation tier. Loads follow the rating (RPE-style).
function applyRating(dev,rate,rating,pain,now=Date.now()){
  const easy=rating<=4&&!pain, hard=pain||rating>=8; let msg='no change (rating 5-7)';
  if(rate.kind==='pnf'){const pat=rate.pattern||rate.area,p=pp(dev,pat),cap=R.finalHoldCap;
    if(hard){if(p.tier>1){p.tier--;p.final=45;p.rounds=R.pnf.roundsMin;p.sets=1;msg='stepped back to easier variations'}else{p.final=Math.max(R.holdMin,p.final-15);msg=`final hold cut to ${p.final}s`}}
    else if(easy){
      if(p.final<cap){p.final=Math.min(cap,p.final+15);msg=`final hold now ${p.final}s`}
      else if(p.rounds<R.pnf.roundsMax){p.rounds++;msg=`PNF rounds now ${p.rounds}`}
      else if(p.sets<2){p.sets=2;msg='added a second static set'}
      else if(p.tier<3){p.tier++;p.final=45;p.rounds=R.pnf.roundsMin;p.sets=1;msg='harder variations unlocked'}
      else msg='at the top of the ladder; holding steady'}
  } else if(rate.kind==='loaded'&&rate.bw){const id=rate.ex;dev.tempo=dev.tempo||{};dev.pauseBottom=dev.pauseBottom||{};
    if(hard){if(dev.pauseBottom[id]){dev.pauseBottom[id]=false;msg='bottom pause removed'}else{dev.tempo[id]=Math.max(2,(dev.tempo[id]||3)-1);msg=`lowering tempo ${dev.tempo[id]} s`}}else if(easy)msg=bwUp(dev,id);
  } else if(rate.kind==='loaded'){const id=rate.ex,c=dev.loads[id]||0;
    if(hard){dev.loads[id]=Math.max(0,c-1);msg=`load down to ${dev.loads[id]} kg`}
    else if(rating<=3&&!pain){dev.loads[id]=c+1;msg=`load up to ${dev.loads[id]} kg`}
    else if(rating===4&&!pain){dev.loads[id]=c+0.5;msg=`load up to ${dev.loads[id]} kg`}
  } else if(rate.kind==='endrange'){const id=rate.ex,h=Math.max(R.holdMin,dev.endHold[id]||R.holdMin);
    if(hard){dev.endHold[id]=Math.max(R.holdMin,h-5);msg=`end-range hold ${dev.endHold[id]}s`}else if(easy){dev.endHold[id]=Math.min(45,h+5);msg=`end-range hold ${dev.endHold[id]}s`}}
  dev.ratings.push({date:new Date(now).toISOString(),...rate,rating,pain:!!pain,msg});
  return msg;
}
const BW={'deficit-calf':'floor-calf-ecc',jefferson:'pike-lower'};
function bwUp(dev,id){dev.tempo=dev.tempo||{};dev.pauseBottom=dev.pauseBottom||{};const t=dev.tempo[id]||3;
  if(t<6){dev.tempo[id]=t+1;return `bodyweight: lowering tempo now ${t+1} s`}
  if(!dev.pauseBottom[id]){dev.pauseBottom[id]=true;return 'bodyweight: add a 2 s pause at the bottom'}
  return 'bodyweight: at max tempo; next step is a weight or a harder variation'}

// Progress tests every R.retestDays (28) days, standardised (same time of day, after the same warm-up, best of 3)
function testDue(dev,now=Date.now()){const t=dev.tests[dev.tests.length-1];return !t||now-new Date(t.date).getTime()>=R.retestDays*864e5}
function nextTestDate(dev){const t=dev.tests[dev.tests.length-1];return t?new Date(new Date(t.date).getTime()+R.retestDays*864e5):new Date()}
function metricMet(k,v){const T=TESTS[k];if(!T||v==null||v==='')return null;if(T.unit==='pass')return !!v;if(T.target==null)return null;return T.lower?v<=T.target:v>=T.target}
function analyzeTests(dev,now=Date.now()){
  const out=[];const tl=dev.tests;if(!tl.length)return out;
  const last=tl[tl.length-1];
  for(const a of Object.keys(AREAS)){const ks=AREAS[a].tests;if(!ks.length)continue;
    const vals=ks.map(k=>last[k]).filter(v=>v!=null&&v!=='');if(!vals.length)continue;
    let streak=0;for(let i=tl.length-1;i>0;i--){const num=ks.filter(k=>TESTS[k].unit!=='pass'&&tl[i][k]!=null&&tl[i-1][k]!=null);if(!num.length)break;
      if(num.every(k=>Math.abs(tl[i][k]-tl[i-1][k])<TESTS[k].thr))streak++;else break}
    const met=ks.every(k=>metricMet(k,last[k])!==false)&&ks.some(k=>metricMet(k,last[k])===true);
    if(met&&dev.areas.includes(a)){dev.areas=dev.areas.filter(x=>x!==a);if(!dev.maint.includes(a))dev.maint.push(a);
      const cand=Object.keys(AREAS).filter(x=>!dev.areas.includes(x)&&!dev.maint.includes(x));
      const weak=cand.sort((x,y)=>score(dev,x)-score(dev,y))[0];if(weak)dev.areas.push(weak);
      out.push(`${AREAS[a].name}: target met → maintenance (gains fade if you stop, so it keeps a lighter weekly dose)${weak?'; promoted '+AREAS[weak].name:''}`)}
    else if(streak>=2&&dev.flatActed[a]!==tl.length&&dev.areas.includes(a)){dev.flatActed[a]=tl.length;
      if(!dev.boost[a]){dev.boost[a]=R.flatBoost;out.push(`${AREAS[a].name}: two flat retests → +${Math.round((R.flatBoost-1)*100)}% volume`)}
      else{dev.emph[a]=dev.emph[a]==='loaded'?'stretch':'loaded';out.push(`${AREAS[a].name}: still flat → emphasis switched to ${dev.emph[a]==='loaded'?'loaded end-range work':'stretching'}`)}}
    else out.push(`${AREAS[a].name}: ${streak?'flat (change below measurement noise)':'tracking'}`)}
  dev.notes=out;return out;
}
function score(dev,a){const ks=AREAS[a].tests,last=dev.tests[dev.tests.length-1]||{};if(!ks.length)return AREAS[a].secondary?0.6:0.5;const m=ks.map(k=>metricMet(k,last[k]));return m.filter(x=>x===true).length/ks.length}
const api={E,R,AREAS,TESTS,DEFAULT_AREAS,PRE_RUN,PLAN,fresh,migrate,prog,pp,build,record,planFor,groups,applyRating,weekIndex,isDeload,weekSecs,weekDays,credit,areaOf,dayKey,testDue,nextTestDate,analyzeTests,nextRotation,overlap,mainIds,TR,SW};
if(typeof module!=='undefined')module.exports=api;else root.Dev=api;
})(this);
