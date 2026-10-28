// Pure routine generator (also usable from Node for tests).
(function(root){
const TRANSITION=8, SWITCH=5;
function pickWeighted(pool, w){let t=pool.reduce((a,s)=>a+w(s),0),r=Math.random()*t;for(const s of pool){r-=w(s);if(r<=0)return s}return pool[pool.length-1]}
function cost(s,h){return (s.sides? 2*h + SWITCH : h)}
function generate(lib,{targetSec=900,bias='balanced'}={}){
  const focus={legs:['hips','hamstrings','quads','calves','glutes','feet'],upper:['back','shoulders','neck']}[bias]||null;
  const w=s=>focus&&s.area.some(a=>focus.includes(a))?3:1;
  let pool=lib.slice(),chosen=[],total=0;
  while(pool.length){
    const s=pickWeighted(pool,w);pool=pool.filter(x=>x!==s);
    const c=cost(s,s.secs)+(chosen.length?TRANSITION:0);
    if(total+c>targetSec+20)continue;
    chosen.push(s);total+=c; if(total>=targetSec-25)break;
  }
  // Order: rough flow standing -> floor isn't known; keep random but put neck/shoulder ones last-ish if legs bias.
  // Scale holds so total lands on target.
  const fixed=(chosen.length-1)*TRANSITION+chosen.filter(s=>s.sides).length*SWITCH;
  const holdSum=chosen.reduce((a,s)=>a+(s.sides?2:1)*s.secs,0);
  const k=(targetSec-fixed)/holdSum;
  const items=chosen.map(s=>({...s,hold:Math.max(20,Math.round(s.secs*k))}));
  return {items,steps:toSteps(items)};
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
const api={generate,toSteps,totalSec};
if(typeof module!=='undefined')module.exports=api;else root.Gen=api;
})(this);
