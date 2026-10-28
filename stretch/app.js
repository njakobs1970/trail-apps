const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search);
const SPEED=Number(params.get('speed'))||1; // test hook: ?speed=50 runs 50x faster
const LS={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
let settings=LS.get('settings',{minutes:15,bias:'balanced',shortcut:'Log Stretch',autoLog:true});
let routine=null, run=null, wakeLock=null, actx=null;

function fmt(s){s=Math.max(0,Math.ceil(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
function show(id){document.querySelectorAll('section').forEach(x=>x.hidden=x.id!==id)}

// ---------- Audio ----------
function beep(freq=880,dur=0.15){try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const o=actx.createOscillator(),g=actx.createGain();o.frequency.value=freq;o.connect(g);g.connect(actx.destination);g.gain.setValueAtTime(0.3,actx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,actx.currentTime+dur);o.start();o.stop(actx.currentTime+dur)}catch(e){} window.__beeps=(window.__beeps||0)+1}
// ---------- Wake lock ----------
async function lockScreen(){try{if('wakeLock' in navigator){wakeLock=await navigator.wakeLock.request('screen');window.__wake='on'}else window.__wake='unsupported'}catch(e){window.__wake='error:'+e.name}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&run&&!run.paused)lockScreen()});

// ---------- Plan ----------
function newRoutine(){routine=Gen.generate(STRETCHES,{targetSec:settings.minutes*60,bias:settings.bias});renderPlan()}
function renderPlan(){
  $('#planTotal').textContent=fmt(Gen.totalSec(routine.steps));
  $('#planCount').textContent=routine.items.length;
  $('#planList').innerHTML=routine.items.map(s=>`<li><span class=ic>${s.icon}</span><div><b>${s.name}</b><small>${s.sides?'L + R · ':''}${s.hold}s${s.sides?' each':''} · ${s.area.join(', ')}</small></div></li>`).join('');
}
// ---------- Player ----------
function start(){
  beep(660,0.05); // unlock audio inside the user gesture
  lockScreen();
  run={i:0,stepEnd:0,paused:false,remainingAtPause:0,startedAt:Date.now()};
  enterStep(0);show('player');tick();
}
function enterStep(i){
  run.i=i;const st=routine.steps[i];
  run.stepEnd=performance.now()+st.secs*1000/SPEED;
  const ex=st.ex||st.next;
  $('#pPhase').textContent=st.type==='hold'?(st.side?st.side+' side':'Hold'):st.label;
  $('#pPhase').className=st.type;
  $('#pIcon').textContent=ex.icon;$('#pName').textContent=ex.name;
  $('#pCue').textContent=ex.cue;
  $('#pStep').textContent=`Step ${i+1}/${routine.steps.length}`;
  const nxt=routine.steps.slice(i+1).find(s=>s.type==='hold');
  $('#pNext').textContent=nxt?`Next: ${nxt.ex.name}${nxt.side?' ('+nxt.side+')':''}`:'Last one!';
  beep(st.type==='hold'?880:520,st.type==='hold'?0.3:0.15);
}
let lastCount=null;
function tick(){
  if(!run)return;
  if(!run.paused){
    const rem=(run.stepEnd-performance.now())*SPEED/1000;
    $('#pTime').textContent=fmt(rem);
    const st=routine.steps[run.i];
    $('#pBar').style.width=(100*(1-rem/st.secs))+'%';
    const elapsedTotal=routine.steps.slice(0,run.i).reduce((a,s)=>a+s.secs,0)+(st.secs-rem);
    $('#pTotal').textContent=fmt(Gen.totalSec(routine.steps)-elapsedTotal)+' left';
    const c=Math.ceil(rem); if(c<=3&&c>0&&c!==lastCount&&st.type==='hold'){beep(440,0.08)} lastCount=c;
    if(rem<=0){ if(run.i+1<routine.steps.length)enterStep(run.i+1); else return finish(); }
  }
  run.raf=setTimeout(tick,SPEED>1?20:200);
}
function togglePause(){if(!run)return;if(run.paused){run.stepEnd=performance.now()+run.remainingAtPause;run.paused=false;$('#pauseBtn').textContent='Pause'}else{run.remainingAtPause=run.stepEnd-performance.now();run.paused=true;$('#pauseBtn').textContent='Resume'}}
function skip(){if(run.i+1<routine.steps.length)enterStep(run.i+1);else finish()}
function stop(save){clearTimeout(run&&run.raf);if(save)finish(true);else{run=null;release();show('home')}}
function release(){try{wakeLock&&wakeLock.release()}catch{}wakeLock=null}

function shortcutURL(minutes){return 'shortcuts://run-shortcut?name='+encodeURIComponent(settings.shortcut)+'&input=text&text='+encodeURIComponent(String(minutes))}
function finish(early){
  clearTimeout(run.raf);release();beep(988,0.5);
  const secs=early?Math.round((Date.now()-run.startedAt)/1000*SPEED):Gen.totalSec(routine.steps);
  const minutes=Math.max(1,Math.round(secs/60));
  const hist=LS.get('history',[]);hist.unshift({date:new Date().toISOString(),secs,minutes,stretches:routine.items.map(s=>s.name),bias:settings.bias,complete:!early});LS.set('history',hist.slice(0,200));
  run=null;
  const url=shortcutURL(minutes);
  $('#doneMsg').textContent=`${minutes} min of stretching. Nice work.`;
  $('#logBtn').href=url; show('done'); renderHistory();
  if(settings.autoLog&&!early){window.__lastShortcutUrl=url;fire(url)}
}
function fire(url){window.__shortcutCalls=(window.__shortcutCalls||[]).concat(url);try{location.href=url}catch(e){}}

function renderHistory(){
  const h=LS.get('history',[]);
  $('#histList').innerHTML=h.length?h.map(x=>`<li><b>${new Date(x.date).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}</b> — ${x.minutes} min${x.complete?'':' (stopped early)'}<small>${x.stretches.join(' · ')}</small></li>`).join(''):'<li>No sessions yet.</li>';
  const week=h.filter(x=>Date.now()-new Date(x.date)<7*864e5).reduce((a,x)=>a+x.minutes,0);
  $('#histWeek').textContent=week+' min in the last 7 days';
}
// ---------- Wiring ----------
function bindSettings(){
  $('#minutes').value=settings.minutes;$('#bias').value=settings.bias;$('#scName').value=settings.shortcut;$('#autoLog').checked=settings.autoLog;
  const save=()=>{settings={minutes:Number($('#minutes').value),bias:$('#bias').value,shortcut:$('#scName').value.trim()||'Log Stretch',autoLog:$('#autoLog').checked};LS.set('settings',settings)};
  ['#minutes','#bias'].forEach(s=>$(s).addEventListener('change',()=>{save();newRoutine()}));
  ['#scName','#autoLog'].forEach(s=>$(s).addEventListener('change',save));
}
$('#regen').onclick=newRoutine;$('#startBtn').onclick=start;$('#pauseBtn').onclick=togglePause;$('#skipBtn').onclick=skip;
$('#stopBtn').onclick=()=>{if(confirm('End session now and save what you did?'))stop(true)};
$('#homeBtn').onclick=()=>{newRoutine();show('home')};
$('#histBtn').onclick=()=>{renderHistory();show('history')};$('#backBtn').onclick=()=>show('home');
$('#clearHist').onclick=()=>{if(confirm('Delete all history?')){LS.set('history',[]);renderHistory()}};
$('#exportHist').onclick=()=>{const b=new Blob([JSON.stringify(LS.get('history',[]),null,1)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='stretch-history.json';a.click()};
$('#testSc').onclick=()=>fire(shortcutURL(1));
bindSettings();newRoutine();show('home');
if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js');
