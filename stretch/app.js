const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search);
const SPEED=Number(params.get('speed'))||1; // test hook: ?speed=50 runs 50x faster
const LS={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
let settings=LS.get('settings',{minutes:15,focus:'trail',type:'develop',today:'rest',shortcut:'Log Stretch',autoLog:false});
if(!settings.hv2){settings.autoLog=false;settings.hv2=1;LS.set('settings',settings)} // auto-open caused stalls when the Shortcut wasn't installed
const SHORTCUT_INSTALL_URL='https://www.icloud.com/shortcuts/1bb052f8ee714b4c8485bb57f35a4260'; // iCloud link for the ready-made "Log Stretch" Shortcut
settings.focus=Gen.normFocus(settings.focus||settings.bias||'trail');delete settings.bias;settings.type=settings.type||'develop';settings.rest=settings.rest||30;settings.today=settings.today||'rest';
// Load + migrate Develop state safely: back up the untouched v1 object once, then add new fields only (nothing deleted).
let dev=(()=>{const raw=LS.get('dev',null);if(raw&&(raw.v||1)<2&&!localStorage.getItem('dev_backup_v1'))localStorage.setItem('dev_backup_v1',JSON.stringify(raw));
  const d=Dev.migrate(raw);if(!d.hist.length){const byName=Object.fromEntries(STRETCHES.map(s=>[s.name,s]));
    for(const h of LS.get('history',[]).slice(0,20).reverse()){if(Date.now()-new Date(h.date)>14*864e5)continue;const items=(h.stretches||[]).map(n=>byName[n]).filter(s=>s&&s.kind!=='warmup'&&s.kind!=='breath').map(s=>({id:s.id,role:s.kind==='loaded'?'L':s.kind==='endrange'?'E':'S',pattern:s.pattern||null}));
      if(items.length)d.hist.push({d:Dev.dayKey(new Date(h.date).getTime()),t:h.type||'develop',items})}}
  return d})();const saveDev=()=>LS.set('dev',dev);saveDev();
if(!settings.v12){if(settings.type==='develop')settings.type='plan';settings.v12=1;LS.set('settings',settings)}
let regen=0;
const TYPES={plan:"Today's plan",develop:'Develop',light:'Light',prerun:'Pre-run warm-up',topup:'Top-up',relax:'Relax',random:'Random'};
const TODAY={prerun:['Pre-run','prerun','Dynamic warm-up only (5–8 min). No long static holds or PNF before running.'],postrun:['Post-run','plan','Muscles are warm: Develop (20–25 min) or a Top-up (8–10 min).'],longrun:['Long run done','plan','After a long run: an easy flexibility flow (for range and relaxation; stretching does not speed recovery). Tomorrow becomes a Light day.'],rest:['Rest day','plan','Rest day: follow the weekly plan.']};
let routine=null, run=null, wakeLock=null, actx=null;

function fmt(s){s=Math.max(0,Math.ceil(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
const DEPTH={home:0,tests:1,history:1,player:2,done:3};let curScreen=null;
function show(id){const prev=curScreen;curScreen=id;document.querySelectorAll('section').forEach(x=>{if(x.id===id){x.hidden=false;x.scrollTop=0;x.classList.remove('push','pop','fade');void x.offsetWidth;if(prev)x.classList.add(prev===id?'fade':(DEPTH[id]>DEPTH[prev]?'push':DEPTH[id]<DEPTH[prev]?'pop':'fade'))}else x.hidden=true});
  document.body.classList.toggle('playing',id==='player'||id==='done');document.body.classList.toggle('onhome',id==='home');document.querySelectorAll('#tabbar button').forEach(b=>b.setAttribute('aria-selected',b.dataset.s===id))}

// ---------- Audio ----------
function beep(freq=880,dur=0.15){try{const actx=ctx();if(actx.state==='suspended')actx.resume();const o=actx.createOscillator(),g=actx.createGain();o.frequency.value=freq;o.connect(g);g.connect(actx.destination);g.gain.setValueAtTime(0.3,actx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,actx.currentTime+dur);o.start();o.stop(actx.currentTime+dur)}catch(e){} window.__beeps=(window.__beeps||0)+1}
function ctx(){if(!actx){try{actx=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}return actx}
let clipBuf=null,clipBytes=null;
fetch('ten-seconds.mp3').then(r=>r.arrayBuffer()).then(ab=>{clipBytes=ab;decodeClip()}).catch(()=>{});
function decodeClip(){const c=ctx();if(!c||!clipBytes||clipBuf)return;try{const p=c.decodeAudioData(clipBytes.slice(0),b=>{clipBuf=b},()=>{});p&&p.catch&&p.catch(()=>{})}catch(e){}}
function primeSpeech(){try{if(!('speechSynthesis' in window))return;speechSynthesis.resume();if(!window.__speechPrimed){const u=new SpeechSynthesisUtterance(' ');u.volume=0.01;u.lang='en-NZ';window.__keepU=u;speechSynthesis.speak(u);window.__speechPrimed=1}}catch(e){}}
function unlockAudio(){const c=ctx();try{if(c){if(c.state!=='running')c.resume();const b=c.createBuffer(1,1,22050),src=c.createBufferSource();src.buffer=b;src.connect(c.destination);src.start(0)}}catch(e){}decodeClip();primeSpeech()}
['pointerdown','touchend','click'].forEach(t=>document.addEventListener(t,unlockAudio,{passive:true,capture:true}));
// ---------- Speech ----------
let voice=null;function pickVoice(){try{const v=speechSynthesis.getVoices();voice=v.find(x=>/en[-_]NZ/i.test(x.lang))||v.find(x=>/en[-_](AU|GB)/i.test(x.lang))||v.find(x=>/^en/i.test(x.lang))||null}catch(e){}}
if('speechSynthesis' in window){pickVoice();speechSynthesis.addEventListener&&speechSynthesis.addEventListener('voiceschanged',pickVoice)}
function speak(t){try{if(!('speechSynthesis' in window))return false;speechSynthesis.resume();const u=new SpeechSynthesisUtterance(t);u.lang=voice?voice.lang:'en-NZ';if(voice)u.voice=voice;u.rate=1;u.volume=1;window.__keepU=u;
  if(speechSynthesis.speaking||speechSynthesis.pending){speechSynthesis.cancel();setTimeout(()=>{speechSynthesis.resume();speechSynthesis.speak(u)},120)}else speechSynthesis.speak(u);return true}catch(e){return false}}
function say(t){const c=ctx();if(c&&c.state==='suspended')try{c.resume()}catch(e){}
  if(t==='Ten seconds to go'&&clipBuf&&c&&c.state==='running'){try{const s=c.createBufferSource(),g=c.createGain();g.gain.value=1;s.buffer=clipBuf;s.connect(g);g.connect(c.destination);s.start(0);window.__spoken=(window.__spoken||[]).concat('clip:'+t);return}catch(e){}}
  window.__spoken=(window.__spoken||[]).concat('tts:'+t);speak(t)}
const isRest=st=>st.type==='transition'||st.type==='switch'||(st.phase==='Rest');
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
${s.demoNote?`<p class="muted">${esc(s.demoNote)}</p>`:''}<p><b>Easier:</b> ${esc(s.easier)}<br><b>Harder:</b> ${esc(s.harder)}</p>${s.perSide?`<p class="side">↔ <b>Per side:</b> ${esc(s.perSide)}</p>`:''}</div>`;
}
// ---------- Plan ----------
function newRoutine(){const t=settings.type;
  if(['plan','develop','light','topup','prerun'].includes(t))routine=Dev.build(t,dev,STRETCHES,{avail:Gen.availOf(settings),rest:settings.rest||30,maxSec:settings.cap?settings.cap*60:0,seed:regen,longHolds:!!settings.longHolds,plan:{today:settings.today,lastLong:settings.lastLong,maintenance:!!settings.maintenance}});
  else routine=Gen.generate(STRETCHES,{targetSec:(settings.cap||(t==='relax'?15:settings.minutes))*60,focus:t==='relax'?'sleep':settings.focus,avail:Gen.availOf(settings),rest:settings.rest||30});
  routine.type=routine.type||t;routine.label=(routine.plan?routine.plan.label:TYPES[t])+(t==='random'?' · '+Gen.FOCUSES[routine.focus]:t==='relax'?' · sleep & relaxation':'');renderPlan()}
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
  const isDev=['plan','develop','light','topup'].includes(settings.type);$('#devBox').hidden=!isDev;$('#focusBox').hidden=settings.type!=='random';
  document.querySelectorAll('#todayChips button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===settings.today));
  document.querySelectorAll('#typeChips button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===settings.type));
  $('#guide').textContent=TODAY[settings.today][2]+' Do Develop after runs or 6+ hours apart from one.';
  $('#testDue').hidden=!Dev.testDue(dev);
  if(!isDev)return;
  const ws=Dev.weekSecs(dev);
  $('#areaPick').innerHTML=Object.entries(Dev.AREAS).map(([k,a])=>`<label class="chk"><input type=checkbox data-a="${k}" ${dev.areas.includes(k)?'checked':''}> ${a.name}${a.secondary?' <small style="display:inline">(secondary)</small>':''}${dev.maint.includes(k)?' <small style="display:inline">· maintenance</small>':''}</label>`).join('');
  const RR=Dev.R,tg=RR.weeklyTargetMinPerArea*60,fl=RR.weeklyFloorMinPerArea*60;
  $('#weekBars').innerHTML=dev.areas.concat(dev.maint).map(a=>{const v=ws[a]||0;return `<div class="wk"><span>${Dev.AREAS[a].name}</span><span>${Math.round(v/60)}/${RR.weeklyFloorMinPerArea}–${RR.weeklyTargetMinPerArea} min · ${Dev.weekDays(dev,a)}/${RR.minDaysPerWeekPerArea} days</span><div class="bar"><div style="width:${Math.min(100,v/tg*100)}%"></div><i style="left:${fl/tg*100}%"></i></div></div>`}).join('');
  $('#maintSw').checked=!!settings.maintenance;$('#longSw').checked=!!settings.longHolds;
  const loads=[...new Set(routine.items.filter(i=>i.kind==='loaded'&&!i.bw).map(i=>i.id))];
  $('#loads').innerHTML=loads.map(id=>`<label>${STRETCHES.find(x=>x.id===id).name} load <input type=number min=0 step=0.5 data-load="${id}" value="${dev.loads[id]||0}" style="width:5em"> kg</label>`).join('');
  $('#devNote').textContent=`${routine.plan?routine.plan.label+' · ':''}Week ${routine.week}${routine.deload?' · DELOAD week (volume cut ~40%)':''}${routine.areasToday&&routine.areasToday.length?' · PNF today: '+routine.areasToday.map(a=>Dev.AREAS[a].name).join(', '):''}`;
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
  unlockAudio();beep(660,0.05); // unlock audio inside the user gesture
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
  $('#pPhase').className=st.type;run.spoke10=false;run.beeped={};
  const rest=isRest(st)&&st.type!=='rate';$('#player').classList.toggle('rest',rest);$('#pRest').hidden=!rest;
  if(rest){const nx=st.next||st.ex;$('#pRest').querySelector('b').textContent=st.type==='switch'?'Rest · Switch sides':'Rest';$('#pRestNext').textContent=st.type==='switch'?'Next up: '+nx.name+' (Right)':'Next up: '+nx.name}
  if(st.type==='rate'){$('#rateQ').textContent=st.rate.kind==='loaded'?`How hard was “${st.block}”? 0 = easy, 10 = max effort`:`How uncomfortable was “${st.block}”? 0 = nothing, 10 = worst`;$('#pain').checked=false;$('#rateMsg').textContent=''}
  $('#pName').textContent=ex.icon+' '+ex.name;
  if($('#pDemo').dataset.id!==ex.id){$('#pDemo').innerHTML=demoSVG(ex);$('#pDemo').dataset.id=ex.id;$('#pDesc').innerHTML=fullDesc(ex);$('#pCue').textContent=ex.cue}
  $('#pStep').textContent=`Step ${i+1}/${routine.steps.length}`;
  const nxt=routine.steps.slice(i+1).find(s=>s.type==='hold'&&(s.ex!==st.ex||s.side!==st.side));
  $('#pNext').textContent=nxt?`Next up: ${nxt.ex.name}${nxt.side?' ('+nxt.side+')':''}`:'Last one';
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
    $('#pBar').style.strokeDashoffset=(100*Math.max(0,rem/st.secs)).toFixed(2);
    const elapsedTotal=routine.steps.slice(0,run.i).reduce((a,s)=>a+s.secs,0)+(st.secs-rem);
    $('#pTotal').textContent=fmt(Gen.totalSec(routine.steps)-elapsedTotal)+' left';
    const c=Math.ceil(rem);const rest=isRest(st);
    if(!rest&&st.secs>=15&&rem<=10.05&&rem>3&&!run.spoke10){run.spoke10=true;say('Ten seconds to go')}
    if(c<=3&&c>0&&!run.beeped[c]&&st.secs>5){run.beeped[c]=1;beep(c===1?1046:880,0.12);window.__beepLog=(window.__beepLog||[]).concat((rest?'R':'A')+c);const t=$('#pTime');t.classList.remove('last3');void t.offsetWidth;t.classList.add('last3')} lastCount=c;
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
  creditStep();clearTimeout(run.raf);if(['develop','light','topup'].includes(routine.type)){Dev.record(dev,routine)}saveDev();release();beep(988,0.5);
  const secs=early?Math.round((Date.now()-run.startedAt)/1000*SPEED):Gen.totalSec(routine.steps);
  const minutes=Math.max(1,Math.round(secs/60));
  const hist=LS.get('history',[]);hist.unshift({date:new Date().toISOString(),secs,minutes,stretches:routine.items.map(s=>s.name),focus:routine.focus,type:routine.type,focusName:routine.label,complete:!early});LS.set('history',hist.slice(0,200));
  run=null;
  const url=shortcutURL(minutes);
  $('#doneMsg').textContent=`${minutes} min · ${routine.label}`;
  $('#logBtn').href=url; $('#logBtn').onclick=()=>{const h=LS.get('history',[]);if(h[0]){h[0].logged=true;LS.set('history',h)}setTimeout(()=>{$('#logState').textContent='Sent to Apple Health ✓';renderHistory()},400)};
  $('#logState').textContent='Saved to History.';
  const ready=!!settings.healthReady;$('#logBtn').hidden=!ready;$('#healthSetup').hidden=ready;
  $('#installSc').hidden=!SHORTCUT_INSTALL_URL;if(SHORTCUT_INSTALL_URL)$('#installSc').href=SHORTCUT_INSTALL_URL;
  show('done'); renderHistory();
  if(settings.autoLog&&settings.healthReady&&!early){window.__lastShortcutUrl=url;fire(url)}
}
function healthReady(){settings.healthReady=true;LS.set('settings',settings);$('#healthSetup').hidden=true;$('#logBtn').hidden=false}
function fire(url){window.__shortcutCalls=(window.__shortcutCalls||[]).concat(url);try{location.href=url}catch(e){}}

function renderHistory(){
  const h=LS.get('history',[]);
  $('#histList').innerHTML=h.length?h.map(x=>`<li><b>${new Date(x.date).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}</b> — ${x.minutes} min${x.focusName?' · '+x.focusName:''}${x.complete?'':' (stopped early)'}${x.logged?' · ❤️ Health':''}<small>${x.stretches.join(' · ')}</small></li>`).join(''):'<li>No sessions yet.</li>';
  const week=h.filter(x=>Date.now()-new Date(x.date)<7*864e5).reduce((a,x)=>a+x.minutes,0);
  $('#histWeek').textContent=week+' min in the last 7 days';
}
// ---------- Wiring ----------
function bindSettings(){
  $('#rest').value=settings.rest||30;$('#rest').onchange=()=>{settings.rest=Number($('#rest').value);save();newRoutine()};$('#scName').value=settings.shortcut;$('#autoLog').checked=settings.autoLog;
  const save=()=>{settings={...settings,shortcut:$('#scName').value.trim()||'Log Stretch',autoLog:$('#autoLog').checked};LS.set('settings',settings)};
  $('#scReady').onclick=()=>{healthReady();$('#logBtn').click()};$('#scSkip').onclick=()=>show('home');
  const capLbl=()=>{const el=$('#cap'),v=Number(el.value);$('#capLbl').textContent=v>=45?'Full session':'Up to '+v+' min';el.style.setProperty('--p',((v-5)/40*100)+'%')};
  $('#cap').value=settings.cap||45;capLbl();
  $('#cap').addEventListener('input',capLbl);
  $('#cap').addEventListener('change',()=>{const v=Number($('#cap').value);settings.cap=v>=45?0:v;LS.set('settings',settings);newRoutine()});
  $('#focusChips').innerHTML=Object.entries(Gen.FOCUSES).map(([k,v])=>`<button type=button data-f="${k}">${v}</button>`).join('');
  $('#focusChips').onclick=e=>{const b=e.target.closest('button');if(!b)return;settings.focus=b.dataset.f;save();newRoutine()};
  $('#todayChips').innerHTML=Object.entries(TODAY).map(([k,v])=>`<button type=button data-t="${k}">${v[0]}</button>`).join('');
  $('#typeChips').innerHTML=Object.entries(TYPES).map(([k,v])=>`<button type=button data-t="${k}">${v}</button>`).join('');
  $('#todayChips').onclick=e=>{const b=e.target.closest('button');if(!b)return;settings.today=b.dataset.t;settings.type=TODAY[b.dataset.t][1];if(b.dataset.t==='longrun')settings.lastLong=Dev.dayKey(Date.now());save();newRoutine()};
  $('#typeChips').onclick=e=>{const b=e.target.closest('button');if(!b)return;settings.type=b.dataset.t;save();newRoutine()};
  $('#areaPick').onchange=e=>{const a=e.target.dataset.a;if(!a)return;let ar=dev.areas.filter(x=>x!==a);if(e.target.checked)ar.push(a);
    if(ar.length<3||ar.length>4){e.target.checked=!e.target.checked;$('#areaMsg').textContent='Pick 3–4 priority areas.';return}$('#areaMsg').textContent='';dev.areas=ar;dev.maint=dev.maint.filter(x=>x!==a);dev.rotate=0;saveDev();newRoutine()};
  document.querySelectorAll('.noEquip').forEach(c=>c.onchange=()=>{settings.noEquip=c.checked;save();newRoutine()});
  $('#ownList').onchange=e=>{const k=e.target.dataset.own;if(!k)return;const o=new Set(settings.owned||Gen.OWNABLE);e.target.checked?o.add(k):o.delete(k);settings.owned=[...o];save();newRoutine()};
  $('#loads').onchange=e=>{const id=e.target.dataset.load;if(!id)return;dev.loads[id]=Math.max(0,Number(e.target.value)||0);saveDev();newRoutine()};
  ['#scName','#autoLog'].forEach(s=>$(s).addEventListener('change',save));
}
$('#regen').onclick=()=>{regen++;newRoutine()};$('#maintSw').onchange=e=>{settings.maintenance=e.target.checked;LS.set('settings',settings);newRoutine()};$('#longSw').onchange=e=>{settings.longHolds=e.target.checked;LS.set('settings',settings);newRoutine()};$('#startBtn').onclick=start;$('#pauseBtn').onclick=togglePause;$('#skipBtn').onclick=skip;$('#backBtnP').onclick=prev;
$('#rateBtns').innerHTML=[...Array(11).keys()].map(n=>`<button type=button data-n=${n}>${n}</button>`).join('');$('#rateBtns').onclick=e=>{const b=e.target.closest('button');if(b&&run&&run.waiting){run.waiting=false;rate(+b.dataset.n)}};
$('#stopBtn').onclick=()=>{if(confirm('End session now and save what you did?'))stop(true)};
$('#homeBtn').onclick=()=>{newRoutine();show('home')};
$('#histBtn').onclick=()=>{renderHistory();show('history')};$('#tabHome').onclick=()=>{if(curScreen!=='home'){newRoutine();show('home')}};$('#backBtn').onclick=()=>show('home');
$('#clearHist').onclick=()=>{if(confirm('Delete all history?')){LS.set('history',[]);renderHistory()}};
function exportData(){return {app:'stretch15',exported:new Date().toISOString(),settings,history:LS.get('history',[]),dev}}
$('#exportHist').onclick=()=>{const b=new Blob([JSON.stringify(exportData(),null,1)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='stretch-backup.json';a.click()};
function importData(o){if(Array.isArray(o))o={history:o};if(o.history)LS.set('history',o.history);if(o.dev){dev=Dev.migrate({...o.dev});saveDev()}if(o.settings){settings={...settings,...o.settings};LS.set('settings',settings)}bindSettings();newRoutine();renderHistory();renderTests()}
$('#importHist').onclick=()=>$('#importFile').click();
$('#importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{importData(JSON.parse(await f.text()));$('#histWeek').textContent='Backup imported.'}catch(err){alert('Could not read that file: '+err.message)}};
// ---------- Progress tests ----------
const TEST_HOWTO={
 ktw:'Knee-to-wall: barefoot, big toe a measured distance from a wall. Drive the knee to touch the wall with the heel down and the knee over the 2nd toe. Move the foot back until you just can’t touch. Record toe-to-wall distance in cm.',
 sar:'Sit-and-reach: sit with legs straight and soles against a box or step. Reach both hands forward slowly and hold 2 s. Record cm past your toes (negative if short). Best of 2.',
 aslr:'Active straight-leg raise: lie on your back, legs straight. Lift one leg as high as you can with no help, knee straight, other leg flat. Measure the angle from the floor (a phone level app on the shin works).',
 thomas:'Thomas test: sit on the very end of a bed, roll back hugging one knee, let the other leg hang relaxed. Measure how many cm the back of the hanging thigh (just above the knee) sits above the bed surface: 0 = flat, negative = below.',
 hiprot:'Seated hip rotation: sit tall on a table edge, knees bent 90°, thighs level. Keep the thigh still and swing the lower leg out (internal rotation) or in (external rotation). Measure the shin angle from vertical with a phone level app on the shin.',
 straddle:'Straddle width: sit against a wall, legs straight, slide them apart as wide as is comfortable with knees and toes up. Measure heel to heel in cm.',
 shoulder:'Lying shoulder flexion: lie on your back with knees bent and lower back flat. Raise both straight arms overhead. Pass if the arms reach the floor without the ribs or back lifting.'};
function renderEvidence(){const E=Dev.E;$('#evVer').textContent=`Evidence v${E.version} · reviewed ${E.reviewed}`;$('#evList').innerHTML=E.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.cite)}</a><small>${esc(s.used)}</small></li>`).join('')}
function renderTests(){
  const T=Dev.TESTS;
  $('#testForm').innerHTML=Object.entries(T).filter(([k,t])=>!t.legacy).map(([k,t])=>t.unit==='pass'?`<label>${t.name} <select data-k="${k}"><option value="">—</option><option value="1">Pass</option><option value="0">Fail</option></select></label>`:`<label>${t.name} <input type=number step=0.5 data-k="${k}" style="width:5em"> ${t.unit}${t.target!=null?` <small style="display:inline">(target ${t.lower?'≤ ':''}${t.target})</small>`:''}</label>`).join('');
  $('#testHow').innerHTML=Object.values(TEST_HOWTO).map(x=>`<li>${esc(x)}</li>`).join('');
  const tl=dev.tests;$('#testNotes').innerHTML=(dev.notes||[]).map(x=>`<li>${esc(x)}</li>`).join('')||'<li>No tests yet.</li>';
  $('#testDueMsg').textContent=(Dev.testDue(dev)?`A progress test is due (every ${Dev.R.retestDays} days).`:'Next test due '+Dev.nextTestDate(dev).toLocaleDateString())+' Same time of day, after the same 3-min warm-up; best of 3 tries. Skip any test that hurts.';
  $('#charts').innerHTML=Object.entries(T).map(([k,t])=>{const pts=tl.map((x,i)=>[i,x[k]]).filter(p=>p[1]!=null&&p[1]!=='');if(!pts.length)return '';
    const vs=pts.map(p=>+p[1]),mn=Math.min(...vs,t.unit==='pass'?0:t.target)-1,mx=Math.max(...vs,t.unit==='pass'?1:t.target)+1,X=i=>10+i*(180/Math.max(1,tl.length-1)),Y=v=>55-(v-mn)/(mx-mn)*45;
    return `<div class="chart"><small>${t.name}: ${pts.map(p=>t.unit==='pass'?(+p[1]?'pass':'fail'):p[1]+t.unit).join(' → ')}</small><svg viewBox="0 0 200 60">${t.unit!=='pass'?`<line x1=0 x2=200 y1="${Y(t.target)}" y2="${Y(t.target)}" class=tgt />`:''}<polyline points="${pts.map(p=>X(p[0])+','+Y(+p[1])).join(' ')}"/>${pts.map(p=>`<circle cx="${X(p[0])}" cy="${Y(+p[1])}" r=3 />`).join('')}</svg></div>`}).join('');
}
$('#saveTest').onclick=()=>{const r={date:new Date().toISOString()};document.querySelectorAll('#testForm [data-k]').forEach(el=>{if(el.value!=='')r[el.dataset.k]=Dev.TESTS[el.dataset.k].unit==='pass'?el.value==='1':Number(el.value)});
  if(Object.keys(r).length<2)return alert('Enter at least one result.');dev.tests.push(r);Dev.analyzeTests(dev);saveDev();renderTests();newRoutine()};
$('#testsBtn').onclick=()=>{renderTests();show('tests')};$('#testDue').onclick=()=>{renderTests();show('tests')};$('#testsBack').onclick=()=>{newRoutine();show('home')};
$('#testSc').onclick=()=>fire(shortcutURL(1));
bindSettings();newRoutine();renderEvidence();show('home');
if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js');

// ---------- Haptic-like feedback ----------
document.addEventListener('pointerdown',e=>{const b=e.target.closest('button,.btn,summary,.switch');if(!b)return;b.classList.add('tap');try{navigator.vibrate&&navigator.vibrate(8)}catch{}},{passive:true});
['pointerup','pointercancel','pointerleave'].forEach(t=>document.addEventListener(t,()=>document.querySelectorAll('.tap').forEach(x=>x.classList.remove('tap')),{passive:true}));
