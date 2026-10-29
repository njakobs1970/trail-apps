// Pure routine generator (also usable from Node for tests).
(function(root){
const TRANSITION=8, SWITCH=5;
const FOCUSES={trail:'Trail running',sleep:'Sleep & relaxation',upper:'Upper body',lower:'Lower body',hipsback:'Hips & lower back',full:'Full body / random'};
const LEGACY={balanced:'full',legs:'lower',upper:'upper'}; // old "bias" setting values
function normFocus(f){f=LEGACY[f]&&!FOCUSES[f]?LEGACY[f]:f;return FOCUSES[f]?f:'full'}
function pickWeighted(pool, w){let t=pool.reduce((a,s)=>a+w(s),0),r=Math.random()*t;for(const s of pool){r-=w(s);if(r<=0)return s}return pool[pool.length-1]}
function cost(s,h){return (s.sides? 2*h + SWITCH : h)}
function generate(lib,{targetSec=900,focus,bias}={}){
  focus=normFocus(focus||bias||'full');
  // Sleep: longer, slower holds so there are fewer, calmer stretches.
  const base=s=>focus==='sleep'?Math.max(45,Math.round(s.secs*1.5)):s.secs;
  lib=lib.filter(s=>!s.kind); // warm-up, loaded, end-range and breathing drills are only used by Develop/Top-up/Pre-run
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
  const fixed=(chosen.length-1)*TRANSITION+chosen.filter(s=>s.sides).length*SWITCH;
  const holdSum=chosen.reduce((a,s)=>a+(s.sides?2:1)*base(s),0);
  const k=(targetSec-fixed)/holdSum;
  const items=chosen.map(s=>({...s,hold:Math.max(20,Math.round(base(s)*k))}));
  return {items,steps:toSteps(items),focus};
}
function toSteps(items){
  const steps=[];
  items.forEach((s,i)=>{
    if(i>0)steps.push({type:'transition',secs:TRANSITION,next:s,label:'Get ready'});
    if(s.sides){steps.push({type:'hold',secs:s.hold,ex:s,side:'Left'});steps.push({type:'switch',secs:SWITCH,next:s,label:'Switch sides'});steps.push({type:'hold',secs:s.hold,ex:s,side:'Right'});}
    else steps.push({type:'hold',secs:s.hold,ex:s,side:null});
  });return steps;
}
const totalSec=steps=>steps.reduce((a,s)=>a+s.secs,0);
const api={generate,toSteps,totalSec,FOCUSES,normFocus};
if(typeof module!=='undefined')module.exports=api;else root.Gen=api;
})(this);
