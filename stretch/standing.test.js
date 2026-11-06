// Standing-only filter, default-routine regression, and PNF timing checks.
// Run: node --test stretch/standing.test.js
const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');

const root=path.join(__dirname);
let Lib,Dev,Gen,lib,E;
const NOW=new Date(2026,10,2,12,0,0).getTime(); // local Monday 2 Nov 2026, noon
const FLOOR=['pigeon','figure4','90-90','butterfly','frog','toe-sit','thread-needle','open-book','breathing','downdog','worlds-greatest','kneel-hip-flexor','levator','bench-pigeon','childs','supine-ham','seated-fold','cobra','cat-cow'];

before(()=>{
  global.window=global;
  require(path.join(root,'stretches.js'));
  E=require(path.join(root,'evidence.js'));
  global.EVIDENCE=E;
  Lib=require(path.join(root,'library.js'));
  Lib.install(global.STRETCHES);
  Gen=require(path.join(root,'generator.js'));
  global.Gen=Gen;
  Dev=require(path.join(root,'develop.js'));
  lib=global.STRETCHES;
  assert.equal(new Date(NOW).getDay(),1);
});

function fresh(){return Dev.fresh(NOW)}
function ids(r){const s=new Set();for(const i of r.items||[])s.add(i.id);for(const st of r.steps||[]){if(st.ex)s.add(st.ex.id);if(st.next)s.add(st.next.id)}return [...s]}
function pnfSig(r){return r.steps.filter(s=>s.pnf).map(s=>s.pnf+':'+s.secs+':'+(s.side||'')+':'+(s.round||0)).join('|')}

test('every exercise was classified from its instructions',()=>{
  assert.equal(lib.length,Object.keys(Lib.STAND).length);
  for(const s of lib){
    assert.equal(Lib.STAND[s.id]!=null,true,s.id);
    assert.equal(s.standUnreviewed,false,s.id);
    assert.equal(typeof s.stand,'boolean');
    if(!s.stand)assert.ok(s.standAssume,s.id+' needs a reason');
  }
  const ghost={id:'not-a-real-move'};
  Lib.applyStand([ghost]);
  assert.equal(ghost.stand,false);
  assert.equal(ghost.standUnreviewed,true);
  assert.match(ghost.standAssume,/Unreviewed/);
});

test('reviewed standing and non-standing examples',()=>{
  const by=Object.fromEntries(lib.map(s=>[s.id,s]));
  for(const id of ['calf-wall','soleus','standing-ham','quad-stand','heel-chair-ham','standing-hf','hip-cars','leg-swing','it-cross','doorway','wall-chest','sl-rdl','floor-calf-ecc'])assert.equal(by[id].stand,true,id);
  for(const id of FLOOR)assert.equal(by[id].stand,false,id);
  assert.match(by['knee-wall'].standAssume,/split stance/);
  assert.match(by['neck-side'].standAssume,/sit or stand/i);
  assert.match(by['levator'].standAssume,/no standing option/i);
  assert.match(by['bench-pigeon'].standAssume,/not make this standing/i);
  assert.match(by['worlds-greatest'].standAssume,/floor/);
  assert.match(by['deep-squat'].standAssume,/feet/);
  assert.equal(by['thread-needle'].stand,false);
});

test('default routines match v24 selections and PNF timings',()=>{
  const golden={
    develop:['walking-lunge','ankle-circles','worlds-greatest','soleus','downdog','seated-fold','supine-ham','sl-rdl','soleus-iso','breathing'],
    light:['deep-squat','kneel-soleus','half-split','lizard','rfe-hip-flexor','90-90','butterfly','supine-ham'],
    topup:['soleus','heel-chair-ham','kneel-hip-flexor','90-90'],
    prerun:['leg-swing','leg-swing-side','ankle-circles','knee-wall','walking-lunge']
  };
  for(const t of ['develop','light','topup','prerun','plan']){
    const off=Dev.build(t,fresh(),lib,{now:NOW,seed:1,rest:30});
    const explicit=Dev.build(t,fresh(),lib,{now:NOW,seed:1,rest:30,standingOnly:false});
    assert.deepEqual(off.items.map(i=>i.id),explicit.items.map(i=>i.id));
    assert.equal(pnfSig(off),pnfSig(explicit));
    assert.equal(off.standingOnly,false);
    assert.equal(off.standNote,'');
    assert.deepEqual(off.standGaps,[]);
    const key=t==='plan'?'develop':t;
    assert.deepEqual(off.items.map(i=>i.id),golden[key],t);
  }
  const dev=Dev.build('develop',fresh(),lib,{now:NOW,seed:1,rest:30});
  const pnf=dev.steps.filter(s=>s.pnf);
  assert.ok(pnf.length>0);
  assert.deepEqual([...new Set(pnf.map(s=>s.pnf))],['contract','relax','sink','final']);
  assert.ok(pnf.filter(s=>s.pnf==='contract').every(s=>s.secs===E.rules.pnf.contractSec));
  assert.ok(pnf.filter(s=>s.pnf==='relax').every(s=>s.secs===E.rules.pnf.relaxSec));
  assert.ok(pnf.filter(s=>s.pnf==='sink').every(s=>s.secs===E.rules.pnf.sinkSec));
  assert.ok(pnf.filter(s=>s.pnf==='final').every(s=>s.secs===45));
  assert.ok(pnf.every(s=>s.round!=null&&s.rounds===3));
  const devState=fresh();
  const msg=Dev.applyRating(devState,{kind:'pnf',area:'calves',pattern:'calf-straight'},3,false,NOW);
  assert.match(msg,/final hold now 60s/);
  assert.equal(Dev.pp(devState,'calf-straight').final,60);
  assert.equal(E.version,'2026.11');
  assert.ok(E.sources.some(s=>s.url.includes('pmc.ncbi.nlm.nih.gov/articles/PMC10980866')));
});

test('standing only keeps standing moves and PNF timings',()=>{
  for(const t of ['develop','light','topup','prerun','plan']){
    const r=Dev.build(t,fresh(),lib,{now:NOW,seed:1,rest:30,standingOnly:true});
    assert.equal(r.standingOnly,true);
    assert.ok(r.standNote.length>0,t);
    for(const id of ids(r)){
      const s=lib.find(x=>x.id===id);
      assert.equal(s.stand,true,t+' included '+id);
      assert.equal(FLOOR.includes(id),false,id);
    }
    const pnf=r.steps.filter(s=>s.pnf);
    if(pnf.length){
      assert.ok(pnf.filter(s=>s.pnf==='contract').every(s=>s.secs===E.rules.pnf.contractSec));
      assert.ok(pnf.filter(s=>s.pnf==='relax').every(s=>s.secs===E.rules.pnf.relaxSec));
      assert.ok(pnf.filter(s=>s.pnf==='sink').every(s=>s.secs===E.rules.pnf.sinkSec));
      assert.ok(pnf.filter(s=>s.pnf==='final').every(s=>s.secs>=E.rules.holdMin));
      assert.ok(pnf.every(s=>s.ex&&s.ex.stand));
    }
  }
  const dev=Dev.build('develop',fresh(),lib,{now:NOW,seed:1,rest:30,standingOnly:true});
  assert.equal(dev.items.some(i=>i.id==='breathing'),false);
  assert.match(dev.standNote,/crocodile|lying face down/);
  assert.ok(dev.steps.some(s=>s.pnf==='contract'&&s.secs===5));
  const pre=Dev.build('prerun',fresh(),lib,{now:NOW,seed:1,rest:30,standingOnly:true});
  assert.equal(pre.items.some(i=>i.id==='worlds-greatest'||i.id==='cat-cow'),false);
  assert.ok(pre.items.length>=4);
});

test('mixed areas skip groups with no standing stretch and say so',()=>{
  const dev=fresh();
  dev.areas=['calves','hamstrings','feet','thoracic'];
  dev.maint=[];
  const r=Dev.build('topup',dev,lib,{now:NOW,seed:3,standingOnly:true});
  assert.ok(r.items.length>=2);
  assert.ok(r.items.every(i=>i.stand));
  assert.ok(r.items.some(i=>i.parea==='calves'));
  assert.ok(r.items.some(i=>i.parea==='hamstrings'));
  assert.deepEqual(r.standGaps.sort(),['feet','thoracic']);
  assert.match(r.standNote,/Feet\/plantar fascia/);
  assert.match(r.standNote,/Thoracic spine/);
  assert.match(r.standNote,/skipped|left out|not written/i);
  for(const id of ['toe-sit','shin','thread-needle','open-book','childs'])assert.equal(ids(r).includes(id),false);
  const hips=Dev.build('topup',fresh(),lib,{now:NOW,seed:1,standingOnly:true});
  assert.ok(hips.items.some(i=>i.parea==='hips'),'hips still has standing static holds');
  assert.match(hips.standNote,/No standing PNF/);
  assert.equal(hips.standGaps.includes('hips'),false);
});

test('incompatible filters produce an empty routine and name the gap',()=>{
  const dev=fresh();
  dev.areas=['feet','thoracic'];
  dev.maint=[];
  const before=JSON.stringify({areas:dev.areas,hist:dev.hist,tests:dev.tests,loads:dev.loads,ratings:dev.ratings,secs:dev.secs});
  const r=Dev.build('topup',dev,lib,{now:NOW,seed:1,standingOnly:true});
  assert.equal(r.items.length,0);
  assert.equal(r.steps.length,0);
  assert.deepEqual(r.standGaps.sort(),['feet','thoracic']);
  assert.match(r.standNote,/no eligible moves/i);
  assert.match(r.standNote,/Feet\/plantar fascia/);
  assert.match(r.standNote,/no new standing versions/i);
  assert.equal(JSON.stringify({areas:dev.areas,hist:dev.hist,tests:dev.tests,loads:dev.loads,ratings:dev.ratings,secs:dev.secs}),before);
  const lie={id:'lie',name:'Lie down',kind:'',stand:true,equip:['step'],swap:'floor',focus:['trail'],secs:40,sides:false,order:1,area:['back'],setup:'Stand on a step.',steps:['Stand.'],cue:'Stand.'};
  const floor={id:'floor',name:'Floor fold',kind:'',stand:false,equip:[],focus:['trail'],secs:40,sides:false,order:4,area:['back'],setup:'Sit on the floor.',steps:['Sit.'],cue:'Sit.',standAssume:'Sits.'};
  const empty=Gen.generate([lie,floor],{standingOnly:true,avail:['wall'],focus:'trail',targetSec:600,rest:30});
  assert.equal(empty.items.length,0);
  assert.match(empty.standNote,/no stretches|no new standing/i);
  const kept=Gen.generate([lie,floor],{standingOnly:true,avail:['wall','step'],focus:'trail',targetSec:600,rest:30});
  assert.deepEqual(kept.items.map(i=>i.id),['lie']);
  const swapped=Gen.generate([lie,floor],{standingOnly:false,avail:['wall'],focus:'trail',targetSec:600,rest:30});
  assert.equal(swapped.items[0].id,'floor');
});

test('bodyweight standing routines do not swap in floor versions',()=>{
  const avail=Gen.availOf({noEquip:true});
  assert.deepEqual(avail,['wall']);
  const r=Dev.build('develop',fresh(),lib,{now:NOW,seed:1,rest:30,standingOnly:true,avail});
  assert.ok(r.items.length>0);
  for(const id of ids(r)){
    const s=lib.find(x=>x.id===id);
    assert.equal(s.stand,true,id);
    assert.ok(Gen.fits(s,avail),id+' needs equipment outside bodyweight');
  }
  assert.equal(ids(r).includes('downdog'),false);
  assert.equal(ids(r).includes('heel-chair-ham'),false);
});

test('random and relax honor standing only and the default can still include floor work',()=>{
  let sawFloor=false;
  for(let i=0;i<25&&!sawFloor;i++){
    const r=Gen.generate(lib,{targetSec:15*60,focus:'trail',rest:30});
    if(r.items.some(s=>s.stand===false))sawFloor=true;
    assert.equal(r.standingOnly,false);
    assert.equal(r.standNote,'');
  }
  assert.equal(sawFloor,true);
  for(const focus of ['trail','full','upper','lower','sleep']){
    const r=Gen.generate(lib,{targetSec:15*60,focus,rest:30,standingOnly:true});
    assert.ok(r.items.every(s=>s.stand),focus+' '+r.items.map(s=>s.id).join(','));
    assert.ok(r.standNote.length>0);
  }
  const sleep=Gen.generate(lib,{targetSec:15*60,focus:'sleep',rest:30,standingOnly:true});
  assert.ok(sleep.items.length<4);
  assert.ok(sleep.items.every(s=>s.stand));
  assert.match(sleep.standNote,/short|floor|left out/i);
  assert.equal(sleep.items.some(s=>s.id==='levator'||s.id==='childs'||s.id==='cobra'),false);
});

test('standing choice persists in settings and does not rewrite history',()=>{
  const settings={minutes:15,focus:'trail',type:'plan',today:'postrun',rest:45,noEquip:true,maintenance:false,longHolds:true,owned:['chair','step'],shortcut:'Log Stretch'};
  assert.equal(Gen.standingOn(settings),false);
  assert.equal(Gen.standingOn(null),false);
  settings.standingOnly=true;
  const saved=JSON.parse(JSON.stringify(settings));
  assert.equal(Gen.standingOn(saved),true);
  assert.equal(saved.focus,'trail');
  assert.equal(saved.type,'plan');
  assert.equal(saved.today,'postrun');
  assert.equal(saved.rest,45);
  assert.equal(saved.noEquip,true);
  assert.equal(saved.longHolds,true);
  assert.deepEqual(saved.owned,['chair','step']);
  assert.equal(saved.shortcut,'Log Stretch');
  saved.standingOnly=false;
  assert.equal(Gen.standingOn(saved),false);
  assert.equal(saved.type,'plan');
  const dev=fresh();
  dev.hist=[{d:'2026-10-20',t:'develop',items:[{id:'pigeon',role:'S',pattern:'hip-er'}]}];
  dev.tests=[{date:'2026-09-01T00:00:00.000Z',ktwL:9}];
  const hist=JSON.stringify(dev.hist),tests=JSON.stringify(dev.tests),areas=dev.areas.slice();
  Dev.build('light',dev,lib,{now:NOW,seed:4,standingOnly:true});
  assert.equal(JSON.stringify(dev.hist),hist);
  assert.equal(JSON.stringify(dev.tests),tests);
  assert.deepEqual(dev.areas,areas);
});

test('v25 is visible to the page and the service worker',()=>{
  const version=fs.readFileSync(path.join(root,'version.js'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(version,/VERSION=25/);
  assert.match(sw,/v25/);
  assert.match(sw,/importScripts\('version\.js'\)/);
  for(const f of ['index.html','style.css','app.js','version.js','generator.js','develop.js','library.js','stretches.js','manifest.webmanifest'])assert.ok(sw.includes(f),f);
  assert.match(html,/id="ver"/);
  assert.match(html,/id="standSw"/);
  assert.match(html,/role="switch"/);
  assert.match(html,/Standing only/);
  assert.match(app,/standingOnly=!!e\.target\.checked/);
  assert.match(app,/LS\.set\('settings',settings\)/);
  assert.match(app,/textContent='v'\+V/);
  assert.match(app,/Gen\.standingOn\(settings\)/);
});
