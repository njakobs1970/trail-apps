// v24: PNF phase banner
importScripts('version.js');
const C='stretch'+self.VERSION+'-v'+self.VERSION;
const A=['./','index.html','style.css','app.js','version.js','generator.js','stretches.js','develop.js','evidence.js','library.js','testguide.js','evidence.json','manifest.webmanifest','icon.svg','icon-180.png','icon-192.png','icon-512.png','ten-seconds.mp3'];
const FRESH=/(\/|index\.html|app\.js|style\.css|version\.js|sw\.js)$/;
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A.map(u=>new Request(u,{cache:'reload'})))));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const q=e.request;if(q.method!=='GET'||new URL(q.url).origin!==location.origin)return;const u=new URL(q.url);
  if(q.mode==='navigate'||FRESH.test(u.pathname)){
    e.respondWith(fetch(q,{cache:'no-store'}).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(q.mode==='navigate'?'index.html':q,c))}return r}).catch(()=>caches.match(q.mode==='navigate'?'index.html':q,{ignoreSearch:true}).then(r=>r||caches.match('./'))));return}
  e.respondWith(caches.match(q,{ignoreSearch:true}).then(r=>r||fetch(q)))});
