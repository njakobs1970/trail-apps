// Develop / Top-up / Pre-run session builder, progression rules and progress-test analysis.
// Pure functions (no DOM) so they run in Node tests. State object "dev" lives in localStorage.
(function(root){
const TR=8, SW=5;
const AREAS={
  calves:   {name:'Calves/soleus & ankle',pnf:['calf-wall','soleus','step-calf'],loaded:'deficit-calf',end:'soleus-iso',tests:['ktwL','ktwR']},
  hamstrings:{name:'Hamstrings',pnf:['supine-ham','standing-ham','seated-fold'],loaded:'jefferson',alt:'sl-rdl',end:'alsr-hold',tests:['sar','aslrL','aslrR']},
  hipflex:  {name:'Hip flexors/quads',pnf:['kneel-hip-flexor','couch'],loaded:'cossack',end:'kneel-lift',tests:['thomasL','thomasR']},
  hips:     {name:'Glutes/hips (rotation, adductors)',pnf:['figure4','90-90','pigeon'],loaded:'cossack',end:'9090-lift',tests:[]},
  feet:     {name:'Feet/plantar fascia',secondary:true,pnf:['toe-sit'],loaded:'tib-raise',end:'toe-mob',tests:[]},
  thoracic: {name:'Thoracic spine (climb posture)',secondary:true,pnf:['thread-needle','open-book'],loaded:null,end:'tspine-lift',tests:['shoulder']},
};
const DEFAULT_AREAS=['calves','hamstrings','hipflex','hips'];
const TESTS={
  ktwL:{name:'Knee-to-wall, left',unit:'cm',thr:2,target:12,area:'calves'},
  ktwR:{name:'Knee-to-wall, right',unit:'cm',thr:2,target:12,area:'calves'},
  sar:{name:'Sit-and-reach (cm past toes, negative if short)',unit:'cm',thr:2,target:5,area:'hamstrings'},
  aslrL:{name:'Active straight-leg raise, left',unit:'°',thr:5,target:80,area:'hamstrings'},
  aslrR:{name:'Active straight-leg raise, right',unit:'°',thr:5,target:80,area:'hamstrings'},
  thomasL:{name:'Thomas test, left',unit:'pass',area:'hipflex'},
  thomasR:{name:'Thomas test, right',unit:'pass',area:'hipflex'},
  shoulder:{name:'Lying shoulder flexion',unit:'pass',area:'thoracic'},
};
const WARMUP_DEV=['leg-swing','ankle-circles','knee-wall','cossack'];             // ~3 min
const PRE_RUN=['leg-swing','leg-swing-side','ankle-circles','knee-wall','walking-lunge','worlds-greatest','cossack']; // ~6-7 min, dynamic only
function fresh(now=Date.now()){return {v:1,start:now,areas:DEFAULT_AREAS.slice(),maint:[],prog:{},loads:{'deficit-calf':0,jefferson:4,'sl-rdl':0,cossack:0,'tib-raise':0},endHold:{},boost:{},flatActed:{},ratings:[],secs:{},tests:[],rotate:0,notes:[]}}
function prog(dev,a){return dev.prog[a]||(dev.prog[a]={level:0,final:45,rounds:3,loadSteps:0})}
function weekIndex(dev,now=Date.now()){return Math.floor((now-dev.start)/(7*864e5))+1}
function isDeload(dev,now){return weekIndex(dev,now)%4===0}
function monday(t){const d=new Date(t);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d}
function dayKey(t){const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function weekSecs(dev,now=Date.now()){const m=monday(now).getTime(),out={};for(const [k,v] of Object.entries(dev.secs))if(new Date(k+'T12:00').getTime()>=m&&new Date(k+'T12:00').getTime()<m+7*864e5)for(const [a,s] of Object.entries(v))out[a]=(out[a]||0)+s;return out}
function credit(dev,area,secs,now=Date.now()){if(!area||!(secs>0))return;const k=dayKey(now);(dev.secs[k]=dev.secs[k]||{});dev.secs[k][area]=(dev.secs[k][area]||0)+Math.round(secs)}
const AREA_OF={calves:'calves',feet:'feet',hamstrings:'hamstrings',quads:'hipflex',hips:'hips',glutes:'hips',back:'thoracic',shoulders:'thoracic'};
function areaOf(ex){for(const a of ex.area||[])if(AREA_OF[a])return AREA_OF[a];return null}
function vol(dev,a,now){return (isDeload(dev,now)?0.6:1)*(dev.boost[a]||1)}

function holdSteps(ex,list,extra={}){ // list of {secs,phase,type?}; repeats per side
  const one=side=>list.map(x=>({type:x.type||'hold',secs:x.secs,ex,side,phase:x.phase,...extra}));
  return ex.sides?[...one('Left'),{type:'switch',secs:SW,next:ex,label:'Switch sides'},...one('Right')]:one(null);
}
function build(type,dev,lib,{now=Date.now(),k,avail=null}={}){
  if(type==='develop'&&k==null){let r=build(type,dev,lib,{now,k:3,avail});if(r.total>1500)r=build(type,dev,lib,{now,k:2,avail});return r}
  const G=root.Gen||require('./generator.js');const hasW=!avail||avail.includes('weight');
  const L0=Object.fromEntries(lib.map(s=>[s.id,s]));const L=new Proxy(L0,{get:(o,id)=>{const s=o[id];if(!s)return s;const r=G.resolve(s,lib,avail)||s;return r!==s?{...r,swappedFrom:s.name}:r}});const blocks=[];const deload=isDeload(dev,now);
  const add=(name,kind,ex,steps,note,rate)=>blocks.push({name,kind,ex,steps,note,rate});
  if(type==='prerun'){
    for(const id of PRE_RUN){const ex=L[id];add('Dynamic warm-up','warmup',ex,holdSteps(ex,[{secs:ex.secs,phase:'Keep moving'}]),`${ex.secs}s${ex.sides?' each side':''} · dynamic`)}
  } else if(type==='topup'){
    for(const a of dev.areas.concat(dev.maint)){const p=prog(dev,a),ex=L[AREAS[a].pnf[Math.min(p.level,AREAS[a].pnf.length-1)]];const h=deload?40:60;
      add(AREAS[a].name,'topup',ex,holdSteps(ex,[{secs:h,phase:'Hold & breathe'}],{area:a}),`${h}s hold${ex.sides?' each side':''}`)}
  } else { // develop
    for(const id of WARMUP_DEV){const ex=L[id];const s=id==='cossack'?40:(ex.sides?20:30);add('1 · Warm-up','warmup',ex,holdSteps(ex,[{secs:s,phase:'Keep moving'}]),`${s}s${ex.sides?' each side':''} · dynamic`)}
    // 3 priority areas per session (rotating when 4 are picked) keeps the session at 20-25 min.
    const n=dev.areas.length; k=Math.min(k||3,n); const start=(dev.rotate||0)%Math.max(1,n);
    const today=[];for(let i=0;i<k;i++)today.push(dev.areas[(start+i)%n]);
    for(const a of today){const p=prog(dev,a),lvl=Math.min(p.level,AREAS[a].pnf.length-1),ex=L[AREAS[a].pnf[lvl]],v=vol(dev,a,now);
      const rounds=Math.max(1,Math.round(p.rounds*Math.min(v,1.25))),fin=Math.max(30,Math.round(p.final*(deload?0.6:1)));
      const seq=[];for(let r=0;r<rounds;r++)seq.push({secs:5,phase:`Contract ~30% (${r+1}/${rounds})`,type:'contract'},{secs:2,phase:'Relax, breathe out',type:'relax'},{secs:25,phase:`Sink deeper (${r+1}/${rounds})`});
      seq.push({secs:fin,phase:'Final hold'});
      add('2 · PNF: '+AREAS[a].name,'pnf',ex,holdSteps(ex,seq,{area:a}),`PNF ${rounds}×(5s contract · 2s relax · 25s deeper) + ${fin}s final${ex.sides?' · each side':''}`,{kind:'pnf',area:a,bw:!hasW||!!(AREAS[a].loaded&&L[AREAS[a].loaded].swappedFrom)})}
    for(const a of dev.maint.slice(0,1)){const ex=L[AREAS[a].pnf[Math.min(prog(dev,a).level,AREAS[a].pnf.length-1)]];add('2 · Maintenance: '+AREAS[a].name,'topup',ex,holdSteps(ex,[{secs:45,phase:'Maintenance hold'}],{area:a}),'45s maintenance hold')}
    const loadedIds=[...new Set(today.map(a=>(prog(dev,a).loadSteps>=3&&AREAS[a].alt)||AREAS[a].loaded).filter(Boolean))].slice(0,1);
    for(const id0 of loadedIds){const ex=L[id0],id=ex.id;const bw=!hasW||!!ex.swappedFrom;const kg=bw?0:(dev.loads[id]||0);const tempo=(dev.tempo||{})[id]||3;const sets=deload?1:2;const seq=[];for(let s=0;s<sets;s++){seq.push({secs:40,phase:`Slow lowering${bw?' '+tempo+' s down'+((dev.pauseBottom||{})[id]?' + 2 s pause':''):''} · set ${s+1}/${sets}${kg?' · '+kg+' kg':''}`});if(s<sets-1)seq.push({secs:15,phase:'Rest',type:'relax'})}
      add('3 · Loaded / slow lowering','loaded',ex,holdSteps(ex,seq,{area:areaOf(ex),kg}),`${sets}×40s slow lowering${ex.sides?' each side':''} · ${bw?'bodyweight, '+tempo+' s lowering':kg+' kg'}`,{kind:'loaded',ex:id,bw})}
    const ends=[...new Set(today.map(a=>AREAS[a].end))].slice(0,1);
    for(const id0 of ends){const ex=L[id0],id=ex.id;const h=dev.endHold[id]||20;const reps=deload?1:2;const seq=[];for(let r=0;r<reps;r++){seq.push({secs:h,phase:`Hold at end range (${r+1}/${reps})`});if(r<reps-1)seq.push({secs:10,phase:'Rest',type:'relax'})}
      add('4 · End-range strength','endrange',ex,holdSteps(ex,seq,{area:areaOf(ex)}),`${reps}×${h}s holds${ex.sides?' each side':''}`,{kind:'endrange',ex:id})}
    add('5 · Breathing','breath',L.breathing,holdSteps(L.breathing,[{secs:120,phase:'Slow breathing: 4 in, 6 out'}]),'2 min');
  }
  // flatten with transitions; a 0-10 rating step after each rated block
  const steps=[];const items=[];
  blocks.forEach((b,i)=>{if(i>0)steps.push({type:'transition',secs:type==='develop'?5:TR,next:b.ex,label:'Get ready'});steps.push(...b.steps.map(s=>({...s,block:b.name})));
    if(b.rate)steps.push({type:'rate',secs:0,rate:b.rate,ex:b.ex,block:b.name});
    items.push({...b.ex,bw:b.rate&&b.rate.bw,hold:b.steps.find(s=>s.type==='hold').secs,planNote:b.note,block:b.name,kg:b.steps[0].kg});});
  return {items,steps,type,focus:type==='prerun'?'trail':null,deload,week:weekIndex(dev,now),areasToday:type==='develop'?blocks.filter(b=>b.kind==='pnf').map(b=>b.rate.area):[],total:steps.reduce((a,x)=>a+x.secs,0)};
}
function nextRotation(dev,used=3){dev.rotate=((dev.rotate||0)+Math.min(used,dev.areas.length))%Math.max(1,dev.areas.length)}

// Progression after a block rating (0-10 discomfort, pain flag)
function applyRating(dev,rate,rating,pain,now=Date.now()){
  const easy=rating<=4&&!pain, hard=pain||rating>=8; let msg='no change (rating 5-7)';
  if(rate.kind==='pnf'){const a=rate.area,p=prog(dev,a),max=AREAS[a].pnf.length-1,ld=AREAS[a].loaded;
    if(hard){if(p.level>0){p.level--;p.final=45;p.rounds=3;msg='stepped back to an easier variation'}else{p.final=Math.max(30,p.final-15);msg='final hold cut by 15s'}}
    else if(easy){
      if(p.final<90){p.final=Math.min(90,p.final+15);msg=`final hold now ${p.final}s`}
      else if(p.rounds<5){p.rounds++;msg=`PNF rounds now ${p.rounds}`}
      else if(ld&&p.loadSteps<3){p.loadSteps++;if(rate.bw){msg=bwUp(dev,BW[ld]||ld)}else{dev.loads[ld]=(dev.loads[ld]||0)+1;msg=`+1 kg on ${ld}`}}
      else if(p.level<max){p.level++;p.final=45;p.rounds=3;p.loadSteps=0;msg='moved to a harder variation'}
      else msg='at the top of the ladder; holding steady'}
  } else if(rate.kind==='loaded'&&rate.bw){const id=rate.ex;dev.tempo=dev.tempo||{};dev.pauseBottom=dev.pauseBottom||{};
    if(hard){if(dev.pauseBottom[id]){dev.pauseBottom[id]=false;msg='bottom pause removed'}else{dev.tempo[id]=Math.max(2,(dev.tempo[id]||3)-1);msg=`lowering tempo ${dev.tempo[id]} s`}}else if(easy)msg=bwUp(dev,id);
  } else if(rate.kind==='loaded'){const id=rate.ex;
    if(hard){dev.loads[id]=Math.max(0,(dev.loads[id]||0)-1);msg=`load down to ${dev.loads[id]} kg`}
    else if(easy){dev.loads[id]=(dev.loads[id]||0)+1;msg=`load up to ${dev.loads[id]} kg`}
  } else if(rate.kind==='endrange'){const id=rate.ex,h=dev.endHold[id]||20;
    if(hard){dev.endHold[id]=Math.max(10,h-5);msg=`end-range hold ${dev.endHold[id]}s`}else if(easy){dev.endHold[id]=Math.min(45,h+5);msg=`end-range hold ${dev.endHold[id]}s`}}
  dev.ratings.push({date:new Date(now).toISOString(),...rate,rating,pain:!!pain,msg});
  return msg;
}

const BW={'deficit-calf':'floor-calf-ecc',jefferson:'pike-lower'};
function bwUp(dev,id){dev.tempo=dev.tempo||{};dev.pauseBottom=dev.pauseBottom||{};const t=dev.tempo[id]||3;
  if(t<6){dev.tempo[id]=t+1;return `bodyweight: lowering tempo now ${t+1} s`}
  if(!dev.pauseBottom[id]){dev.pauseBottom[id]=true;return 'bodyweight: add a 2 s pause at the bottom'}
  return 'bodyweight: at max tempo; next step is a harder variation (single-leg / off a step when available)'}
// Progress tests every 3 weeks
function testDue(dev,now=Date.now()){const t=dev.tests[dev.tests.length-1];return !t||now-new Date(t.date).getTime()>=21*864e5}
function metricMet(k,v){const T=TESTS[k];if(v==null||v==='')return null;return T.unit==='pass'?!!v:v>=T.target}
function analyzeTests(dev,now=Date.now()){
  const out=[];const tl=dev.tests;if(!tl.length)return out;
  const last=tl[tl.length-1];
  for(const a of Object.keys(AREAS)){const ks=AREAS[a].tests;if(!ks.length)continue;
    const vals=ks.map(k=>last[k]).filter(v=>v!=null&&v!=='');if(!vals.length)continue;
    // flat streak: consecutive retests where every numeric metric moved less than its noise threshold
    let streak=0;for(let i=tl.length-1;i>0;i--){const num=ks.filter(k=>TESTS[k].unit!=='pass'&&tl[i][k]!=null&&tl[i-1][k]!=null);if(!num.length)break;
      if(num.every(k=>Math.abs(tl[i][k]-tl[i-1][k])<TESTS[k].thr))streak++;else break}
    const met=ks.every(k=>metricMet(k,last[k])!==false)&&ks.some(k=>metricMet(k,last[k])===true);
    if(met&&dev.areas.includes(a)){dev.areas=dev.areas.filter(x=>x!==a);if(!dev.maint.includes(a))dev.maint.push(a);
      const cand=Object.keys(AREAS).filter(x=>!dev.areas.includes(x)&&!dev.maint.includes(x));
      const weak=cand.sort((x,y)=>score(dev,x)-score(dev,y))[0];if(weak)dev.areas.push(weak);
      out.push(`${AREAS[a].name}: target met → maintenance${weak?'; promoted '+AREAS[weak].name:''}`)}
    else if(streak>=2&&dev.flatActed[a]!==tl.length&&dev.areas.includes(a)){dev.flatActed[a]=tl.length;
      if(!dev.boost[a]){dev.boost[a]=1.25;out.push(`${AREAS[a].name}: two flat retests → +25% volume`)}
      else{const p=prog(dev,a);p.level=(p.level+1)%AREAS[a].pnf.length;p.final=45;p.rounds=3;out.push(`${AREAS[a].name}: still flat → switched method to ${AREAS[a].pnf[p.level]}`)}}
    else out.push(`${AREAS[a].name}: ${streak?'flat (change below noise: <2 cm / <5°)':'tracking'}`)}
  dev.notes=out;return out;
}
// lower = weaker: fraction of test targets met (areas without tests count as 0.5)
function score(dev,a){const ks=AREAS[a].tests,last=dev.tests[dev.tests.length-1]||{};if(!ks.length)return AREAS[a].secondary?0.6:0.5;const m=ks.map(k=>metricMet(k,last[k]));return m.filter(x=>x===true).length/ks.length}
const api={AREAS,TESTS,DEFAULT_AREAS,PRE_RUN,fresh,prog,build,applyRating,weekIndex,isDeload,weekSecs,credit,areaOf,dayKey,testDue,analyzeTests,nextRotation,TR,SW};
if(typeof module!=='undefined')module.exports=api;else root.Dev=api;
})(this);
