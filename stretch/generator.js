// Pure routine generator (also usable from Node for tests).
(function(root){
const REST_DEFAULT=30, SWITCH=5; // rest/transition between stretches (setting: 15/30/45/60 s)
const FOCUSES={trail:'Trail running',sleep:'Sleep & relaxation',upper:'Upper body',lower:'Lower body',hipsback:'Hips & lower back',full:'Full body / random'};
const LEGACY={balanced:'full',legs:'lower',upper:'upper'}; // old "bias" setting values
function normFocus(f){f=LEGACY[f]&&!FOCUSES[f]?LEGACY[f]:f;return FOCUSES[f]?f:'full'}
// ---- Equipment ----
const EQUIP={wall:'Wall',step:'Step or stair',door:'Doorframe',chair:'Chair',weight:'Dumbbell or kettlebell',strap:'Band, strap or towel',block:'Yoga block',roller:'Foam roller',box:'Bench or box'};
const FREE=['wall']; // wall and floor are always available
const OWNABLE=Object.keys(EQUIP).filter(k=>!FREE.includes(k));
function equipFor(s,kg){const e=(s.equip||[]).slice();if(s.kind==='loaded'&&kg>0&&!e.includes('weight'))e.push('weight');return e}
function availOf(settings){return settings&&settings.noEquip?FREE.slice():FREE.concat((settings&&settings.owned)||OWNABLE)}
function fits(s,avail,kg){return !avail||equipFor(s,0).every(x=>avail.includes(x))}
// closest bodyweight version (follows swap chain); kg is handled by the caller (weight -> tempo)
function resolve(s,lib,avail){let n=0;while(s&&!fits(s,avail)&&s.swap&&n++<4)s=lib.find(x=>x.id===s.swap)||null;return s&&fits(s,avail)?s:null}
function pickWeighted(pool, w){let t=pool.reduce((a,s)=>a+w(s),0),r=Math.random()*t;for(const s of pool){r-=w(s);if(r<=0)return s}return pool[pool.length-1]}
function cost(s,h){return (s.sides? 2*h + SWITCH : h)}
function generate(lib,{targetSec=900,focus,bias,avail=null,rest=REST_DEFAULT}={}){
  const TRANSITION=rest;
  const all=lib;
  focus=normFocus(focus||bias||'full');
  // Sleep: longer, slower holds so there are fewer, calmer stretches.
  const base=s=>focus==='sleep'?Math.max(45,Math.round(s.secs*1.5)):s.secs;
  lib=lib.filter(s=>!s.kind&&!s.swapOnly).map(s=>{const r=resolve(s,all,avail);return r&&r!==s?{...r,swappedFrom:s.name,focus:s.focus,order:s.order}:r}).filter(Boolean);
  lib=lib.filter((s,i)=>lib.findIndex(x=>x.id===s.id)===i); // warm-up, loaded, end-range and breathing drills are only used by Develop/Top-up/Pre-run
  let pool=focus==='full'?lib.slice():lib.filter(s=>(s.focus||[]).includes(focus));
  if(!pool.length)pool=lib.slice();
  let chosen=[],total=0;
  while(pool.length){
    const s=pickWeighted(pool,()=>1);pool=pool.filter(x=>x!==s);
    const c=cost(s,base(s))+(chosen.length?TRANSITION:0);
    if(total+c>targetSec+20)continue;
    chosen.push(s);total+=c; if(total>=targetSec-25)break;
  }
  // Order: full/random keeps the random order (original behaviour). Every other focus goes
  // standing/warm-up moves first -> kneeling -> seated/all-fours -> lying, so running warms up first
  // and sleep winds down to the floor and finishes lying still (legs up the wall last).
  if(focus!=='full')chosen.sort((a,b)=>(a.order||4)-(b.order||4));
  // Holds never go below the evidence floor (30 s): fit the time by dropping stretches, not by shortening holds.
  const MIN=(root.EVIDENCE&&root.EVIDENCE.rules.holdMin)||30;let items;
  for(;;){const fixed=(chosen.length-1)*TRANSITION+chosen.filter(s=>s.sides).length*SWITCH;
    const holdSum=chosen.reduce((a,s)=>a+(s.sides?2:1)*base(s),0);const k=(targetSec-fixed)/holdSum;
    items=chosen.map(s=>({...s,hold:Math.max(MIN,Math.round(base(s)*k))}));
    const tot=fixed+items.reduce((a,s)=>a+(s.sides?2:1)*s.hold,0);if(tot<=targetSec+30||chosen.length<=1)break;chosen=chosen.slice(0,-1)}
  return {items,steps:toSteps(items,rest),focus};
}
function toSteps(items,rest=REST_DEFAULT){
  const steps=[];
  items.forEach((s,i)=>{
    if(i>0)steps.push({type:'transition',secs:rest,next:s,label:'Get ready'});
    if(s.sides){steps.push({type:'hold',secs:s.hold,ex:s,side:'Left'});steps.push({type:'switch',secs:SWITCH,next:s,label:'Switch sides'});steps.push({type:'hold',secs:s.hold,ex:s,side:'Right'});}
    else steps.push({type:'hold',secs:s.hold,ex:s,side:null});
  });return steps;
}
const totalSec=steps=>steps.reduce((a,s)=>a+s.secs,0);
const api={REST_DEFAULT,generate,toSteps,totalSec,FOCUSES,normFocus,EQUIP,FREE,OWNABLE,equipFor,availOf,fits,resolve};
if(typeof module!=='undefined')module.exports=api;else root.Gen=api;
})(this);
