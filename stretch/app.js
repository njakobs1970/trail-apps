const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search);
const SPEED=Number(params.get('speed'))||1; // test hook: ?speed=50 runs 50x faster
const LS={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
let settings=LS.get('settings',{minutes:15,focus:'trail',type:'develop',today:'rest',shortcut:'Log Stretch',autoLog:true});
settings.focus=Gen.normFocus(settings.focus||settings.bias||'trail');delete settings.bias;settings.type=settings.type||'develop';settings.rest=settings.rest||30;settings.today=settings.today||'rest';
let dev=LS.get('dev',null)||Dev.fresh();const saveDev=()=>LS.set('dev',dev);
const TYPES={prerun:'Pre-run warm-up',develop:'Develop',topup:'Top-up',relax:'Relax',random:'Random'};
const TODAY={prerun:['Pre-run','prerun','Dynamic warm-up only (5–8 min). No long static holds or PNF before running.'],postrun:['Post-run','develop','Muscles are warm: Develop (20–25 min) or a Top-up (8–10 min).'],longrun:['Long run done','relax','After a long run, keep it gentle: Relax.'],rest:['Rest day','develop','Rest day: a full Develop session.']};
let routine=null, run=null, wakeLock=null, actx=null;

function fmt(s){s=Math.max(0,Math.ceil(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
function show(id){document.querySelectorAll('section').forEach(x=>x.hidden=x.id!==id)}

// ---------- Audio ----------
function beep(freq=880,dur=0.15){try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const o=actx.createOscillator(),g=actx.createGain();o.frequency.value=freq;o.connect(g);g.connect(actx.destination);g.gain.setValueAtTime(0.3,actx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,actx.currentTime+dur);o.start();o.stop(actx.currentTime+dur)}catch(e){} window.__beeps=(window.__beeps||0)+1}
// ---------- Wake lock ----------
async function lockScreen(){try{if('wakeLock' in navigator){wakeLock=await navigator.wakeLock.request('screen');window.__wake='on'}else window.__wake='unsupported'}catch(e){window.__wake='error:'+e.name}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&run&&!run.paused)lockScreen()});


// ---------- Demo (original looping stick-figure animation, SVG + SMIL, no video) ----------
function poseParse(str){const p=str.trim().split(/\s+/).map(q=>q.split(',').map(Number));if(!p[11])p[11]=[(p[1][0]+p[2][0])/2,(p[1][1]+p[2][1])/2];return p}
function demoSVG(s,cls='demo'){
  const A=poseParse(s.pose[0]),B=poseParse(s.pose[1]);
  const anim=(attr,a,b)=>a===b?'':`<animate attributeName="${attr}" dur="5s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.35;.65;.95;1" keySplines=".45 0 .55 1;0 0 1 1;.45 0 .55 1;0 0 1 1" values="${a};${b};${b};${a};${a}"/>`;
  const pl=(idx,c)=>{const a=idx.map(i=>A[i].join(',')).join(' '),b=idx.map(i=>B[i].join(',')).join(' ');return `<polyline class="${c}" points="${a}">${anim('points',a,b)}</polyline>`};
  const sp=P=>`M${P[1]} Q${P[11]} ${P[2]}`;
  const prop=s.prop||'';let props='';
  if(prop.startsWith('wall:')){const x=+prop.slice(5);props=`<line class="prop" x1="${x}" y1="20" x2="${x}" y2="110"/>`}
  if(prop.startsWith('door:')){const x=+prop.slice(5);props=`<rect class="prop" x="${x}" y="2" width="5" height="108"/>`}
  if(prop==='step')props=`<rect class="prop" x="60" y="96" width="62" height="14"/>`;
  const ground=prop==='top'?'':`<line class="ground" x1="10" y1="111" x2="190" y2="111"/>`;
  return `<svg class="${cls}" viewBox="0 0 200 120" role="img" aria-label="Animated demo: ${s.name}">${ground}${props}
${pl([2,5,6],'far')}${pl([1,9,10],'far')}
<path class="body" d="${sp(A)}">${anim('d',sp(A),sp(B))}</path>
${pl([2,3,4],'near')}${pl([1,7,8],'near')}
<circle class="head" r="8" cx="${A[0][0]}" cy="${A[0][1]}">${anim('cx',A[0][0],B[0][0])}${anim('cy',A[0][1],B[0][1])}</circle></svg>`;
}
function esc(t){return String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function fullDesc(s){
  return `<div class="desc"><p><b>Setup:</b> ${esc(s.setup)}</p><ol>${s.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>
<p><b>Feel it:</b> ${esc(s.feel)}</p><p><b>Avoid:</b> ${esc(s.mistakes)}</p>
<p><b>Easier:</b> ${esc(s.easier)}<br><b>Harder:</b> ${esc(s.harder)}</p>${s.perSide?`<p class="side">↔ <b>Per side:</b> ${esc(s.perSide)}</p>`:''}</div>`;
}
// ---------- Plan ----------
function newRoutine(){const t=settings.type;
  if(['develop','topup','prerun'].includes(t))routine=Dev.build(t,dev,STRETCHES,{avail:Gen.availOf(settings),rest:settings.rest||30});
  else routine=Gen.generate(STRETCHES,{targetSec:(t==='relax'?15:settings.minutes)*60,focus:t==='relax'?'sleep':settings.focus,avail:Gen.availOf(settings),rest:settings.rest||30});
  routine.type=t;routine.label=TYPES[t]+(t==='random'?' · '+Gen.FOCUSES[routine.focus]:t==='relax'?' · sleep & relaxation':'');renderPlan()}
function renderEquip(){
  const need=new Set();routine.items.forEach(i=>Gen.equipFor(i,i.bw?0:i.kg).forEach(e=>need.add(e)));
  const kgs=routine.items.filter(i=>i.kind==='loaded'&&!i.bw&&i.kg>0).map(i=>`${i.kg} kg`);
  const list=[...need].map(e=>Gen.EQUIP[e]+(e==='weight'&&kgs.length?' ('+[...new Set(kgs)].join(', ')+')':'')+(Gen.FREE.includes(e)?' <small style="display:inline">(always available)</small>':''));
  const sw=routine.items.filter(i=>i.swappedFrom).map(i=>`${esc(i.swappedFrom)} → ${esc(i.name)}`);
  $('#equipList').innerHTML=need.size?'<b>Equipment needed:</b> '+list.join(' · '):'<b>No equipment needed</b>';
  $('#equipSwaps').innerHTML=sw.length?'No-equipment swaps: '+sw.join('; '):'';
  document.querySelectorAll('.noEquip').forEach(c=>c.checked=!!settings.noEquip);
  $('#ownList').innerHTML=Gen.OWNABLE.map(k=>`<label class="chk"><input type=checkbox data-own="${k}" ${(settings.owned||Gen.OWNABLE).includes(k)?'checked':''}> ${Gen.EQUIP[k]}</label>`).join('');
}
function renderDev(){
  const isDev=['develop','topup'].includes(settings.type);$('#devBox').hidden=!isDev;$('#focusBox').hidden=settings.type!=='random';$('#lenBox').hidden=settings.type!=='random';
  document.querySelectorAll('#todayChips button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===settings.today));
  document.querySelectorAll('#typeChips button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===settings.type));
  $('#guide').textContent=TODAY[settings.today][2]+' Do Develop after runs or 6+ hours apart from one.';
  $('#testDue').hidden=!Dev.testDue(dev);
  if(!isDev)return;
  const ws=Dev.weekSecs(dev);
  $('#areaPick').innerHTML=Object.entries(Dev.AREAS).map(([k,a])=>`<label class="chk"><input type=checkbox data-a="${k}" ${dev.areas.includes(k)?'checked':''}> ${a.name}${a.secondary?' <small style="display:inline">(secondary)</small>':''}${dev.maint.includes(k)?' <small style="display:inline">· maintenance</small>':''}</label>`).join('');
  $('#weekBars').innerHTML=dev.areas.concat(dev.maint).map(a=>{const v=ws[a]||0;return `<div class="wk"><span>${Dev.AREAS[a].name}</span><span>${Math.round(v/60)}/${10}–15 min</span><div class="bar"><div style="width:${Math.min(100,v/9)}%"></div><i style="left:${600/9}%"></i></div></div>`}).join('');
  const loads=[...new Set(routine.items.filter(i=>i.kind==='loaded'&&!i.bw).map(i=>i.id))];
  $('#loads').innerHTML=loads.map(id=>`<label>${STRETCHES.find(x=>x.id===id).name} load <input type=number min=0 step=0.5 data-load="${id}" value="${dev.loads[id]||0}" style="width:5em"> kg</label>`).join('');
  $('#devNote').textContent=`Week ${routine.week}${routine.deload?' · DELOAD week (volume cut ~40%)':''}${routine.areasToday&&routine.areasToday.length?' · PNF today: '+routine.areasToday.map(a=>Dev.AREAS[a].name).join(', '):''}`;
}
function renderPlan(){
  $('#planTotal').textContent=fmt(Gen.totalSec(routine.steps));
  $('#planCount').textContent=routine.items.length;
  $('#planFocus').textContent=routine.label;renderDev();renderEquip();
  document.querySelectorAll('#focusChips button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.f===settings.focus));
  let lastB='';$('#planList').innerHTML=routine.items.map((s,i)=>`${s.block&&s.block!==lastB?`<li class="blk">${esc(lastB=s.block)}</li>`:''}<li><details><summary><span class=ic>${s.icon}</span><div><b>${i+1}. ${esc(s.name)}</b><small>${s.planNote?esc(s.planNote):`${s.sides?'L + R · ':''}${s.hold}s${s.sides?' each':''} · ${s.area.join(', ')}`}</small><span class="sum">${esc(s.cue)}</span></div></summary>${demoSVG(s,'demo small')}${fullDesc(s)}</details></li>`).join('');
}
// ---------- Player ----------
function start(){
  beep(660,0.05); // unlock audio inside the user gesture
  lockScreen();
  run={i:0,stepEnd:0,paused:false,remainingAtPause:0,startedAt:Date.now()};
  enterStep(0);show('player');tick();
}
function creditStep(){const st=routine.steps[run.i];if(!st||st.type!=='hold'&&st.type!=='contract'&&st.type!=='relax')return;
  const rem=run.paused?run.remainingAtPause*SPEED/1000:(run.stepEnd-performance.now())*SPEED/1000;if(st.ex.kind==='breath')return;Dev.credit(dev,st.area||Dev.areaOf(st.ex),Math.min(st.secs,st.secs-Math.max(0,rem)));saveDev()}
function enterStep(i){
  if(run.i!==i||run.started)creditStep();run.started=true;
  run.i=i;const st=routine.steps[i];$('#rateBox').hidden=st.type!=='rate';run.waiting=st.type==='rate';$('#pTime').hidden=$('#pBarWrap').hidden=run.waiting;
  run.stepEnd=performance.now()+st.secs*1000/SPEED;
  const ex=st.ex||st.next;
  $('#pPhase').textContent=st.type==='rate'?'Rate this block':(st.phase?(st.side?st.side+' · ':'')+st.phase:st.type==='hold'?(st.side?st.side+' side':'Hold'):st.label);
  $('#pPhase').className=st.type;
  if(st.type==='rate'){$('#rateQ').textContent=`How uncomfortable was “${st.block}”? 0 = nothing, 10 = worst`;$('#pain').checked=false;$('#rateMsg').textContent=''}
  $('#pName').textContent=ex.icon+' '+ex.name;
  if($('#pDemo').dataset.id!==ex.id){$('#pDemo').innerHTML=demoSVG(ex);$('#pDemo').dataset.id=ex.id;$('#pDesc').innerHTML=fullDesc(ex);$('#pCue').textContent=ex.cue}
  $('#pStep').textContent=`Step ${i+1}/${routine.steps.length}`;
  const nxt=routine.steps.slice(i+1).find(s=>s.type==='hold'&&(s.ex!==st.ex||s.side!==st.side));
  $('#pNext').textContent=nxt?`Next up: ${nxt.ex.name}${nxt.side?' ('+nxt.side+')':''}`:'Last one!';
  $('#backBtnP').disabled=i===0;
  beep(st.type==='hold'?880:st.type==='contract'?740:520,st.type==='hold'?0.3:0.15);
  if(st.kg>0&&st.type!=='rate')$('#pName').textContent=ex.icon+' '+ex.name+' · '+st.kg+' kg';
}
let lastCount=null;
function tick(){
  if(!run)return;
  if(!run.paused&&!run.waiting){
    const rem=(run.stepEnd-performance.now())*SPEED/1000;
    $('#pTime').textContent=fmt(rem);
    const st=routine.steps[run.i];
    $('#pBar').style.width=(100*(1-rem/st.secs))+'%';
    const elapsedTotal=routine.steps.slice(0,run.i).reduce((a,s)=>a+s.secs,0)+(st.secs-rem);
    $('#pTotal').textContent=fmt(Gen.totalSec(routine.steps)-elapsedTotal)+' left';
    const c=Math.ceil(rem); if(c<=3&&c>0&&c!==lastCount&&st.type==='hold'&&st.secs>5){beep(440,0.08)} lastCount=c;
    if(rem<=0){ if(run.i+1<routine.steps.length)enterStep(run.i+1); else return finish(); }
  }
  run.raf=setTimeout(tick,SPEED>1?20:200);
}
function togglePause(){if(!run)return;const svg=$('#pDemo svg');if(run.paused){svg&&svg.unpauseAnimations&&svg.unpauseAnimations();run.stepEnd=performance.now()+run.remainingAtPause;run.paused=false;$('#pauseBtn').textContent='Pause'}else{run.remainingAtPause=run.stepEnd-performance.now();run.paused=true;svg&&svg.pauseAnimations&&svg.pauseAnimations();$('#pauseBtn').textContent='Resume'}}
function prev(){if(!run)return;const i=Math.max(0,run.i-1);if(run.paused)togglePause();enterStep(i)}
function skip(){if(run.paused)togglePause();if(run.waiting)return rate(5);if(run.i+1<routine.steps.length)enterStep(run.i+1);else finish()}
function stop(save){clearTimeout(run&&run.raf);if(save)finish(true);else{run=null;release();show('home')}}
function release(){try{wakeLock&&wakeLock.release()}catch{}wakeLock=null}

function shortcutURL(minutes){return 'shortcuts://run-shortcut?name='+encodeURIComponent(settings.shortcut)+'&input=text&text='+encodeURIComponent(String(minutes))}
function rate(n){const st=routine.steps[run.i];const msg=Dev.applyRating(dev,st.rate,n,$('#pain').checked);saveDev();window.__lastRating=msg;$('#rateMsg').textContent='Next time: '+msg;
  setTimeout(()=>{if(run&&run.i===routine.steps.indexOf(st)){if(run.i+1<routine.steps.length)enterStep(run.i+1);else finish()}},SPEED>1?50:900)}
function finish(early){
  creditStep();clearTimeout(run.raf);if(routine.type==='develop'&&!early){Dev.nextRotation(dev,routine.areasToday.length||3)}saveDev();release();beep(988,0.5);
  const secs=early?Math.round((Date.now()-run.startedAt)/1000*SPEED):Gen.totalSec(routine.steps);
  const minutes=Math.max(1,Math.round(secs/60));
  const hist=LS.get('history',[]);hist.unshift({date:new Date().toISOString(),secs,minutes,stretches:routine.items.map(s=>s.name),focus:routine.focus,type:routine.type,focusName:routine.label,complete:!early});LS.set('history',hist.slice(0,200));
  run=null;
  const url=shortcutURL(minutes);
  $('#doneMsg').textContent=`${minutes} min · ${routine.label}. Nice work.`;
  $('#logBtn').href=url; show('done'); renderHistory();
  if(settings.autoLog&&!early){window.__lastShortcutUrl=url;fire(url)}
}
function fire(url){window.__shortcutCalls=(window.__shortcutCalls||[]).concat(url);try{location.href=url}catch(e){}}

function renderHistory(){
  const h=LS.get('history',[]);
  $('#histList').innerHTML=h.length?h.map(x=>`<li><b>${new Date(x.date).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}</b> — ${x.minutes} min${x.focusName?' · '+x.focusName:''}${x.complete?'':' (stopped early)'}<small>${x.stretches.join(' · ')}</small></li>`).join(''):'<li>No sessions yet.</li>';
  const week=h.filter(x=>Date.now()-new Date(x.date)<7*864e5).reduce((a,x)=>a+x.minutes,0);
  $('#histWeek').textContent=week+' min in the last 7 days';
}
// ---------- Wiring ----------
function bindSettings(){
  $('#minutes').value=settings.minutes;$('#rest').value=settings.rest||30;$('#rest').onchange=()=>{settings.rest=Number($('#rest').value);save();newRoutine()};$('#scName').value=settings.shortcut;$('#autoLog').checked=settings.autoLog;
  const save=()=>{settings={...settings,minutes:Number($('#minutes').value),shortcut:$('#scName').value.trim()||'Log Stretch',autoLog:$('#autoLog').checked};LS.set('settings',settings)};
  $('#minutes').addEventListener('change',()=>{save();newRoutine()});
  $('#focusChips').innerHTML=Object.entries(Gen.FOCUSES).map(([k,v])=>`<button type=button data-f="${k}">${v}</button>`).join('');
  $('#focusChips').onclick=e=>{const b=e.target.closest('button');if(!b)return;settings.focus=b.dataset.f;save();newRoutine()};
  $('#todayChips').innerHTML=Object.entries(TODAY).map(([k,v])=>`<button type=button data-t="${k}">${v[0]}</button>`).join('');
  $('#typeChips').innerHTML=Object.entries(TYPES).map(([k,v])=>`<button type=button data-t="${k}">${v}</button>`).join('');
  $('#todayChips').onclick=e=>{const b=e.target.closest('button');if(!b)return;settings.today=b.dataset.t;settings.type=TODAY[b.dataset.t][1];save();newRoutine()};
  $('#typeChips').onclick=e=>{const b=e.target.closest('button');if(!b)return;settings.type=b.dataset.t;save();newRoutine()};
  $('#areaPick').onchange=e=>{const a=e.target.dataset.a;if(!a)return;let ar=dev.areas.filter(x=>x!==a);if(e.target.checked)ar.push(a);
    if(ar.length<3||ar.length>4){e.target.checked=!e.target.checked;$('#areaMsg').textContent='Pick 3–4 priority areas.';return}$('#areaMsg').textContent='';dev.areas=ar;dev.maint=dev.maint.filter(x=>x!==a);dev.rotate=0;saveDev();newRoutine()};
  document.querySelectorAll('.noEquip').forEach(c=>c.onchange=()=>{settings.noEquip=c.checked;save();newRoutine()});
  $('#ownList').onchange=e=>{const k=e.target.dataset.own;if(!k)return;const o=new Set(settings.owned||Gen.OWNABLE);e.target.checked?o.add(k):o.delete(k);settings.owned=[...o];save();newRoutine()};
  $('#loads').onchange=e=>{const id=e.target.dataset.load;if(!id)return;dev.loads[id]=Math.max(0,Number(e.target.value)||0);saveDev();newRoutine()};
  ['#scName','#autoLog'].forEach(s=>$(s).addEventListener('change',save));
}
$('#regen').onclick=newRoutine;$('#startBtn').onclick=start;$('#pauseBtn').onclick=togglePause;$('#skipBtn').onclick=skip;$('#backBtnP').onclick=prev;
$('#rateBtns').innerHTML=[...Array(11).keys()].map(n=>`<button type=button data-n=${n}>${n}</button>`).join('');$('#rateBtns').onclick=e=>{const b=e.target.closest('button');if(b&&run&&run.waiting){run.waiting=false;rate(+b.dataset.n)}};
$('#stopBtn').onclick=()=>{if(confirm('End session now and save what you did?'))stop(true)};
$('#homeBtn').onclick=()=>{newRoutine();show('home')};
$('#histBtn').onclick=()=>{renderHistory();show('history')};$('#backBtn').onclick=()=>show('home');
$('#clearHist').onclick=()=>{if(confirm('Delete all history?')){LS.set('history',[]);renderHistory()}};
function exportData(){return {app:'stretch15',exported:new Date().toISOString(),settings,history:LS.get('history',[]),dev}}
$('#exportHist').onclick=()=>{const b=new Blob([JSON.stringify(exportData(),null,1)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='stretch-backup.json';a.click()};
function importData(o){if(Array.isArray(o))o={history:o};if(o.history)LS.set('history',o.history);if(o.dev){dev={...Dev.fresh(),...o.dev};saveDev()}if(o.settings){settings={...settings,...o.settings};LS.set('settings',settings)}bindSettings();newRoutine();renderHistory();renderTests()}
$('#importHist').onclick=()=>$('#importFile').click();
$('#importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{importData(JSON.parse(await f.text()));$('#histWeek').textContent='Backup imported.'}catch(err){alert('Could not read that file: '+err.message)}};
// ---------- Progress tests ----------
const TEST_HOWTO={
 ktw:'Knee-to-wall: barefoot, big toe a measured distance from a wall. Drive the knee to touch the wall with the heel down and the knee over the 2nd toe. Move the foot back until you just can’t touch. Record toe-to-wall distance in cm.',
 sar:'Sit-and-reach: sit with legs straight and soles against a box or step. Reach both hands forward slowly and hold 2 s. Record cm past your toes (negative if short). Best of 2.',
 aslr:'Active straight-leg raise: lie on your back, legs straight. Lift one leg as high as you can with no help, knee straight, other leg flat. Measure the angle from the floor (a phone level app on the shin works).',
 thomas:'Thomas test: sit on the very end of a bed, roll back hugging both knees, then let one leg hang. Pass if the back of that thigh rests flat (or below the bed) with the knee bent about 80–90°.',
 shoulder:'Lying shoulder flexion: lie on your back with knees bent and lower back flat. Raise both straight arms overhead. Pass if the arms reach the floor without the ribs or back lifting.'};
function renderTests(){
  const T=Dev.TESTS;
  $('#testForm').innerHTML=Object.entries(T).map(([k,t])=>t.unit==='pass'?`<label>${t.name} <select data-k="${k}"><option value="">—</option><option value="1">Pass</option><option value="0">Fail</option></select></label>`:`<label>${t.name} <input type=number step=0.5 data-k="${k}" style="width:5em"> ${t.unit} <small style="display:inline">(target ${t.target})</small></label>`).join('');
  $('#testHow').innerHTML=Object.values(TEST_HOWTO).map(x=>`<li>${esc(x)}</li>`).join('');
  const tl=dev.tests;$('#testNotes').innerHTML=(dev.notes||[]).map(x=>`<li>${esc(x)}</li>`).join('')||'<li>No tests yet.</li>';
  $('#testDueMsg').textContent=Dev.testDue(dev)?'A progress test is due (every 3 weeks).':'Next test due '+new Date(new Date(tl[tl.length-1].date).getTime()+21*864e5).toLocaleDateString();
  $('#charts').innerHTML=Object.entries(T).map(([k,t])=>{const pts=tl.map((x,i)=>[i,x[k]]).filter(p=>p[1]!=null&&p[1]!=='');if(!pts.length)return '';
    const vs=pts.map(p=>+p[1]),mn=Math.min(...vs,t.unit==='pass'?0:t.target)-1,mx=Math.max(...vs,t.unit==='pass'?1:t.target)+1,X=i=>10+i*(180/Math.max(1,tl.length-1)),Y=v=>55-(v-mn)/(mx-mn)*45;
    return `<div class="chart"><small>${t.name}: ${pts.map(p=>t.unit==='pass'?(+p[1]?'pass':'fail'):p[1]+t.unit).join(' → ')}</small><svg viewBox="0 0 200 60">${t.unit!=='pass'?`<line x1=0 x2=200 y1="${Y(t.target)}" y2="${Y(t.target)}" class=tgt />`:''}<polyline points="${pts.map(p=>X(p[0])+','+Y(+p[1])).join(' ')}"/>${pts.map(p=>`<circle cx="${X(p[0])}" cy="${Y(+p[1])}" r=3 />`).join('')}</svg></div>`}).join('');
}
$('#saveTest').onclick=()=>{const r={date:new Date().toISOString()};document.querySelectorAll('#testForm [data-k]').forEach(el=>{if(el.value!=='')r[el.dataset.k]=Dev.TESTS[el.dataset.k].unit==='pass'?el.value==='1':Number(el.value)});
  if(Object.keys(r).length<2)return alert('Enter at least one result.');dev.tests.push(r);Dev.analyzeTests(dev);saveDev();renderTests();newRoutine()};
$('#testsBtn').onclick=()=>{renderTests();show('tests')};$('#testDue').onclick=()=>{renderTests();show('tests')};$('#testsBack').onclick=()=>{newRoutine();show('home')};
$('#testSc').onclick=()=>fire(shortcutURL(1));
bindSettings();newRoutine();show('home');
if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js');
