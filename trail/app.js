/* Trail Planner – app logic (plain script, no build step, no framework).
 *
 *  1. Config & constants        6. Map rendering (route, markers, grade)
 *  2. DOM helpers, storage       7. Stats & elevation profile chart
 *  3. Geo maths                  8. Scrub along the trail
 *  4. Network: elevation, route  9. Waypoints
 *  5. Route editing & drawing   10. GPX export / import
 *                               11. UI chrome (modes, panels, layers, keys)
 *                               12. Persistence & boot
 *
 * Route model: anchors[i] = {lat,lng}; segs[i] joins anchors[i] -> anchors[i+1]
 *   seg = {mode:'snap'|'free', pts:[[lat,lng,ele|null]], fallback?, imported?}
 * State (anchors, segs, wpts, mode, pending, map ...) is deliberately top-level so the
 * headless tests can inspect it; window.TP exposes the pure helpers.
 */
"use strict";

/* 1. Config & constants ----------------------------------------------------- */
const HOME = [-41.1050, 174.8400];                 // Titahi Bay, Porirua
const HOME_ZOOM = 14;
const BROUTER = "https://brouter.de/brouter", BROUTER_PROFILE = "hiking-mountain";
const OPEN_METEO = "https://api.open-meteo.com/v1/elevation", OPEN_ELEVATION = "https://api.open-elevation.com/api/v1/lookup";
const ROUTE_TIMEOUT_MS = 20000, FETCH_TIMEOUT_MS = 15000, FETCH_TRIES = 3, BACKOFF_MS = 600;
const ELE_BATCH = 100, ELE_BATCH_PAUSE_MS = 150;
const FALLBACK_STEP_M = 25;        // straight-line fallback point spacing
const FREEHAND_MIN_STEP_M = 8;     // keep a freehand point every >= 8 m
const FREEHAND_FILL_M = 30;        // ...and fill gaps to <= 30 m
const CLIMB_HYSTERESIS_M = 3;      // ascent/descent noise filter
const GRADE_WINDOW_M = 80, GRADE_MIN_RUN_M = 20;
const WPT_ON_ROUTE_M = 200;        // waypoints closer than this get a tick on the profile
const GPX_TOL_M = 2, GPX_MAX_PTS = 3000;
const NAISMITH_CLIMB_M_PER_H = 600, NAISMITH_BASE_KMH = 5;
const PANEL_MIN_PX = 230, PANEL_MAX_FRAC = .75;
const DESKTOP_MIN_W = 900;
const KEY = { route: "tp-route", collapsed: "tp-ui", grade: "tp-grade", panelH: "tp-ph", layer: "tp-layer", pace: "tp-pace", onboarded: "tp-onboarded" };

// Gradient bands: [upper bound %, colour, legend label]. First band = steep descent.
const GB = [[-10, "#3b82f6", "Descent ≥10%"], [3, "#34c759", "< 3%"], [6, "#ffcc00", "3–6%"], [10, "#ff9500", "6–10%"], [15, "#ff3b30", "10–15%"], [Infinity, "#8e1b1b", "≥ 15%"]];
const WTYPES = {
  drink: { icon: "i-drink", label: "Drink stop", sym: "Drinking Water", color: "#0a84ff", name: "Drink" },
  food: { icon: "i-food", label: "Food", sym: "Restaurant", color: "#ff9f0a", name: "Food" },
  viewpoint: { icon: "i-view", label: "Viewpoint", sym: "Scenic Area", color: "#af52de", name: "Viewpoint" },
  toilet: { icon: "i-wc", label: "Toilet", sym: "Restroom", color: "#30b0c7", name: "Toilet" },
  other: { icon: "i-flag", label: "Waypoint", sym: "Flag, Blue", color: "#ff375f", name: "Other" },
};
const SEG_STYLE = { snap: "#0a7cff", fallback: "#ff3b30", free: "#ff9500", imported: "#8e44ad" };
const BASEMAPS = {
  topo: { name: "Topographic", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", max: 17, attr: "© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)" },
  osm: { name: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", max: 19, attr: "© OpenStreetMap contributors" },
  voyager: { name: "Light (CARTO)", url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", max: 20, attr: "© OpenStreetMap contributors © CARTO", sub: "abcd" },
  sat: { name: "Satellite (Esri)", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", max: 19, attr: "Imagery © Esri, Maxar, Earthstar Geographics" },
};
const MODE_HINT = {
  snap: "Click the map to add points. Each leg follows real trails.",
  free: "Drag on the map to draw. Zoom with the wheel, pinch or + / −.",
  wpt: "Click the map to drop a waypoint, then name it below.",
};

/* 2. DOM helpers, storage ---------------------------------------------------- */
const $ = id => document.getElementById(id);
const isDesktop = () => innerWidth >= DESKTOP_MIN_W;
const esc = s => String(s).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
const icon = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v } catch (e) { return d } },
  set(k, v) { try { localStorage.setItem(k, v) } catch (e) { /* private mode / quota: ignore */ } },
};
function toast(text, ms = 3000) {
  const m = $("msg"); m.textContent = text; m.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => m.classList.remove("show"), ms);
}
let pending = 0;
function setBusy(d) {
  pending += d;
  $("busy").textContent = pending > 0 ? "Fetching route & elevation…" : "";
  if (!pending) updEleWarn();
}
const cssCache = new Map();
const css = name => { if (!cssCache.has(name)) cssCache.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()); return cssCache.get(name) };
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { cssCache.clear(); drawProfile(SC.prof) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 3. Geo maths --------------------------------------------------------------- */
const EARTH_R = 6371008.8, RAD = Math.PI / 180;
function hav(a, b) {
  const dl = (b[0] - a[0]) * RAD, dg = (b[1] - a[1]) * RAD;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dg / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}
function densify(a, b, step = FALLBACK_STEP_M) {
  const n = Math.max(1, Math.ceil(hav(a, b) / step)), o = [];
  for (let i = 0; i <= n; i++) o.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, null]);
  return o;
}
const okNum = v => typeof v === "number" && isFinite(v) && v > -500 && v < 9000;
/** Cumulative ascent per point + total descent, with hysteresis so DEM noise isn't counted. */
function climbSeries(pts, th = CLIMB_HYSTERESIS_M) {
  let up = 0, dn = 0, ref = null;
  const ups = pts.map(p => {
    if (p[2] != null) { if (ref == null) ref = p[2]; else { const d = p[2] - ref; if (d >= th) { up += d; ref = p[2] } else if (d <= -th) { dn -= d; ref = p[2] } } }
    return up;
  });
  return { up: ups, total: up, dn };
}
function climb(pts, th) { const c = climbSeries(pts, th); return [c.total, c.dn] }
const cumClimb = (pts, th) => climbSeries(pts, th).up;
/** Smoothed grade (%) of segment i-1 -> i over a ~GRADE_WINDOW_M window; null without elevation. */
function gradeArr(pts, cum, win = GRADE_WINDOW_M) {
  const n = pts.length, o = new Array(n).fill(null); let l = 0, r = 0;
  for (let i = 1; i < n; i++) {
    const c = (cum[i - 1] + cum[i]) / 2;
    while (l < i - 1 && cum[l + 1] <= c - win / 2) l++;
    if (r < i) r = i; while (r < n - 1 && cum[r + 1] <= c + win / 2) r++;
    let a = l, b = r; while (a < b && pts[a][2] == null) a++; while (b > a && pts[b][2] == null) b--;
    if (pts[i][2] == null && pts[i - 1][2] == null) continue;
    const dd = cum[b] - cum[a];
    if (dd >= GRADE_MIN_RUN_M && pts[a][2] != null && pts[b][2] != null) o[i] = (pts[b][2] - pts[a][2]) / dd * 100;
  }
  if (n > 1) o[0] = o[1];
  return o;
}
function gBand(g) { if (g == null) return -1; if (g <= -10) return 0; for (let k = 1; k < GB.length; k++) if (g < GB[k][0]) return k; return GB.length - 1 }
function gCol(g, a = 1) {
  const k = gBand(g); if (k < 0) return `rgba(142,142,147,${(a * .7).toFixed(2)})`;
  const h = GB[k][1]; if (a === 1) return h;
  return `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
}
/** Douglas-Peucker simplification in local metres. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const k = Math.cos(pts[0][0] * RAD) * EARTH_R * RAD, m = EARTH_R * RAD;
  const P = pts.map(p => [p[1] * k, p[0] * m]), keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = P[a], [bx, by] = P[b], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / L2));
      const d = Math.hypot(P[i][0] - ax - t * dx, P[i][1] - ay - t * dy); if (d > md) { md = d; mi = i }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]) }
  }
  return pts.filter((_, i) => keep[i]);
}
/** Linear fill of elevation gaps between known values (export last resort). */
function interpEle(pts) {
  let last = -1;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i][2] == null) continue;
    if (last >= 0 && i - last > 1) for (let k = last + 1; k < i; k++) pts[k][2] = pts[last][2] + (pts[i][2] - pts[last][2]) * (k - last) / (i - last);
    last = i;
  }
}
/** Naismith: distance at flat pace plus climb time (1 h / 600 m at 5 km/h, scaled to pace). */
function naismith(distM, upM, kmh) { return distM / 1000 / kmh + upM / NAISMITH_CLIMB_M_PER_H * (NAISMITH_BASE_KMH / kmh) }
const fmtKm = m => (m / 1000).toFixed(2) + " km";
const fmtDur = h => { if (!isFinite(h) || h <= 0) return "–"; const t = Math.round(h * 60); return t < 60 ? `${t} min` : `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, "0")}` };
const fmtGrade = g => g == null ? "–" : (g > 0 ? "+" : "") + g.toFixed(1) + "%";

/* 4. Network: elevation & routing --------------------------------------------- */
/** fetch JSON with timeout, retrying network errors / 408 / 429 / 5xx with exponential backoff. */
async function getJSON(url, opt, tries = FETCH_TRIES) {
  for (let k = 0; k < tries; k++) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      const r = await fetch(url, { ...opt, signal: ctl.signal }); clearTimeout(t);
      if (r.ok) return await r.json();
      if (r.status < 429 && r.status !== 408) return null;      // permanent client error
    } catch (e) { /* network error / timeout: retry */ }
    if (k < tries - 1) await sleep(BACKOFF_MS * 2 ** k + Math.random() * 300);
  }
  return null;
}
const eleCache = new Map();        // "lat,lng" at 5 dp (~1 m) -> metres; only real values are cached
const eleKey = p => p[0].toFixed(5) + "," + p[1].toFixed(5);
let eleWarn = 0;
/** Fill p[2] in place for points lacking elevation. Returns how many are still missing. */
async function fillEle(pts) {
  const need = [];
  for (const p of pts) {
    if (p[2] != null && okNum(p[2])) continue;
    const c = eleCache.get(eleKey(p)); if (c != null) p[2] = c; else need.push(p);
  }
  for (let i = 0; i < need.length; i += ELE_BATCH) {
    const ch = need.slice(i, i + ELE_BATCH); let ele = null;
    let j = await getJSON(`${OPEN_METEO}?latitude=${ch.map(p => p[0].toFixed(6)).join(",")}&longitude=${ch.map(p => p[1].toFixed(6)).join(",")}`);
    if (j && Array.isArray(j.elevation)) ele = j.elevation;
    if (!ele || !ele.some(okNum)) {
      j = await getJSON(OPEN_ELEVATION, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locations: ch.map(p => ({ latitude: p[0], longitude: p[1] })) }) });
      if (j && Array.isArray(j.results)) ele = j.results.map(x => x.elevation);
    }
    ch.forEach((p, k) => { const v = ele && okNum(ele[k]) ? ele[k] : null; p[2] = v; if (v != null) eleCache.set(eleKey(p), v) });
    if (need.length > ELE_BATCH) await sleep(ELE_BATCH_PAUSE_MS);
  }
  updEleWarn();
  return pts.filter(p => p[2] == null).length;
}
async function route(a, b) {
  const url = `${BROUTER}?lonlats=${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}&profile=${BROUTER_PROFILE}&alternativeidx=0&format=geojson`;
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ROUTE_TIMEOUT_MS);
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) throw new Error(await r.text());
    const c = (await r.json()).features[0].geometry.coordinates;
    return { pts: c.map(x => [x[1], x[0], x.length > 2 ? x[2] : null]), fallback: false };
  } catch (e) {
    console.warn("BRouter failed", e); toast("No trail route found – used a straight line");
    return { pts: densify([a.lat, a.lng], [b.lat, b.lng]), fallback: true };
  }
}

/* 5. Route editing & drawing --------------------------------------------------- */
const map = L.map("map", { zoomControl: false, zoomSnap: .5, wheelPxPerZoomLevel: 90 }).setView(HOME, HOME_ZOOM);
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
map.on("locationfound", e => map.setView(e.latlng, 15));
map.on("locationerror", () => toast("Location unavailable (needs HTTPS and permission)"));

let mode = "snap", anchors = [], segs = [], markers = [];
const routeLayer = L.layerGroup().addTo(map);

function allPts() { const o = []; segs.forEach(s => o.push(...s.pts)); return o }
/** Whole route as one point list, without the duplicated joins between segments. */
function trackPts() { const o = []; segs.forEach(s => s.pts.forEach((p, k) => { if (k === 0 && o.length) return; o.push(p) })); return o }

async function buildSeg(i) {
  const s = segs[i], a = anchors[i], b = anchors[i + 1]; setBusy(1);
  try {
    if (s.mode === "snap") { const r = await route(a, b); if (segs[i] !== s) return; s.pts = r.pts; s.fallback = r.fallback }
    else {
      const pv = i > 0 && segs[i - 1].pts.length ? segs[i - 1].pts.at(-1) : null;
      s.pts[0] = pv ? [pv[0], pv[1], null] : [a.lat, a.lng, null]; s.pts[s.pts.length - 1] = [b.lat, b.lng, null];
    }
    await fillEle(s.pts);
  } finally { setBusy(-1) }
  if (segs[i] === s) render();
}
function addAnchor(ll) { anchors.push({ lat: ll.lat, lng: ll.lng }); addMarker(anchors.length - 1); updHint() }
function addMarker(i) {
  const m = L.marker(anchors[i], { draggable: mode === "snap", icon: anchorIcon("mid"), keyboard: false, riseOnHover: true }).addTo(map);
  m.on("dragend", () => {
    const idx = markers.indexOf(m), ll = m.getLatLng(); anchors[idx] = { lat: ll.lat, lng: ll.lng };
    if (idx > 0) buildSeg(idx - 1); if (idx < segs.length) buildSeg(idx); save();
  });
  markers.push(m); updAnchorIcons();
}
function undo() {
  if (!anchors.length) return;
  anchors.pop(); map.removeLayer(markers.pop());
  if (segs.length >= anchors.length && segs.length) segs.pop();
  render(); save(); updHint();
}
function clearRoute() {
  if (anchors.length && !confirm("Clear the whole route?")) return;
  anchors = []; segs = []; markers.forEach(m => map.removeLayer(m)); markers = [];
  if (wpts.length && confirm("Also delete the " + wpts.length + " waypoint(s)?")) while (wpts.length) delWpt(0);
  render(); save(); updHint();
}
map.on("click", e => {
  if (mode === "wpt") { addWpt(e.latlng); return }
  if (mode !== "snap") return;
  addAnchor(e.latlng);
  if (anchors.length > 1) { segs.push({ mode: "snap", pts: [] }); buildSeg(segs.length - 1) }
  save();
});
// Freehand drawing with pointer events (mouse, pen and touch).
let drawing = null, drawLine = null; const mc = map.getContainer();
mc.addEventListener("pointerdown", e => {
  if (mode !== "free" || e.target.closest(".leaflet-control")) return;
  e.preventDefault(); e.stopPropagation(); mc.setPointerCapture(e.pointerId);
  const ll = map.mouseEventToLatLng(e); drawing = [];
  if (anchors.length) { const pv = segs.length && segs.at(-1).pts.length ? segs.at(-1).pts.at(-1) : [anchors.at(-1).lat, anchors.at(-1).lng]; drawing.push([pv[0], pv[1], null]) }
  drawing.push([ll.lat, ll.lng, null]);
  drawLine = L.polyline(drawing, { color: SEG_STYLE.free, weight: 4, dashArray: "1 8", lineCap: "round" }).addTo(map);
}, true);
mc.addEventListener("pointermove", e => {
  if (!drawing) return; const ll = map.mouseEventToLatLng(e), p = [ll.lat, ll.lng, null];
  if (hav(drawing.at(-1), p) >= FREEHAND_MIN_STEP_M) { drawing.push(p); drawLine.setLatLngs(drawing) }
});
function endDraw() {
  if (!drawing) return; const pts = drawing; drawing = null; map.removeLayer(drawLine);
  if (!anchors.length) addAnchor({ lat: pts[0][0], lng: pts[0][1] });
  if (pts.length < 2 || hav(pts[0], pts.at(-1)) < 5 && pts.length < 3) { save(); render(); return }
  const d = [pts[0]]; for (let i = 1; i < pts.length; i++) d.push(...densify(pts[i - 1], pts[i], FREEHAND_FILL_M).slice(1));
  const end = pts.at(-1); addAnchor({ lat: end[0], lng: end[1] });
  segs.push({ mode: "free", pts: d }); buildSeg(segs.length - 1); save();
}
mc.addEventListener("pointerup", endDraw); mc.addEventListener("pointercancel", endDraw);

/* 6. Map rendering ----------------------------------------------------------- */
function anchorIcon(role) {
  const s = role === "mid" ? 12 : 22;
  return L.divIcon({ className: "", html: `<div class="mk mk-${role}"></div>`, iconSize: [s, s], iconAnchor: [s / 2, s / 2] });
}
/** Show each anchor where its routed leg actually starts/ends (the trail), not where the user clicked. */
function snapMarkers() {
  segs.forEach((s, i) => {
    if (!s.pts.length || drawing) return;
    if (i === 0 && markers[0] && !markers[0].dragging?._draggable?._moving) markers[0].setLatLng(s.pts[0].slice(0, 2));
    const m = markers[i + 1]; if (m) m.setLatLng(s.pts.at(-1).slice(0, 2));
  });
}
function updAnchorIcons() {
  markers.forEach((m, i) => {
    const role = i === 0 ? "start" : i === markers.length - 1 ? "end" : "mid";
    if (m._role !== role) { m._role = role; m.setIcon(anchorIcon(role)); m.setZIndexOffset(role === "mid" ? 0 : 500) }
  });
}
const segColor = s => s.imported ? SEG_STYLE.imported : s.mode === "free" ? SEG_STYLE.free : s.fallback ? SEG_STYLE.fallback : SEG_STYLE.snap;
let gOn = store.get(KEY.grade) !== "off", gLay = [];
/** Base route: white casing + coloured fill per segment (dotted for freehand). */
function drawRouteLines() {
  routeLayer.clearLayers();
  const opt = { lineCap: "round", lineJoin: "round", interactive: false };
  segs.forEach(s => {
    const ll = s.pts.map(p => [p[0], p[1]]); if (ll.length < 2) return;
    L.polyline(ll, { ...opt, color: "#fff", weight: 9, opacity: .95 }).addTo(routeLayer);
    L.polyline(ll, { ...opt, color: segColor(s), weight: 5, opacity: 1, dashArray: s.mode === "free" && !s.imported ? "1 9" : null }).addTo(routeLayer);
  });
}
/** Grade overlay: one polyline per run of equal grade band, on top of the base fill. */
function gradeLines() {
  gLay.forEach(l => map.removeLayer(l)); gLay = [];
  if (!gOn || !SC.pts.length) return;
  const P = SC.pts, G = SC.gr; let st = 0;
  for (let i = 1; i <= P.length; i++) {
    if (i === P.length || gBand(G[i]) !== gBand(G[st + 1])) {
      if (i - 1 > st) gLay.push(L.polyline(P.slice(st, i).map(p => [p[0], p[1]]), { color: gCol(G[st + 1]), weight: 5, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map));
      st = i - 1;
    }
  }
}
function setGrade(on) {
  gOn = on; const b = $("gTog"); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
  store.set(KEY.grade, on ? "" : "off"); gradeLines(); drawProfile(SC.prof); updLegend();
}

/* 7. Stats & elevation profile chart ------------------------------------------- */
let pace = +store.get(KEY.pace, NAISMITH_BASE_KMH) || NAISMITH_BASE_KMH;
function render() {
  drawRouteLines(); snapMarkers(); updAnchorIcons();
  const pts = trackPts(); let dist = 0; const prof = [];
  pts.forEach((p, i) => { if (i) dist += hav(pts[i - 1], p); prof.push([dist, p[2]]) });
  const cs = climbSeries(pts);
  Object.assign(SC, { pts, cum: prof.map(q => q[0]), up: cs.up, prof, D: dist }); SC.gr = gradeArr(pts, SC.cum);
  gradeLines(); scrubHit();
  let lo = Infinity, hi = -Infinity; for (const p of pts) if (p[2] != null) { if (p[2] < lo) lo = p[2]; if (p[2] > hi) hi = p[2] }
  $("dist").innerHTML = `${(dist / 1000).toFixed(2)} <small>km</small>`;
  $("asc").innerHTML = `↑${Math.round(cs.total)} <small>m</small>`;
  $("desc").innerHTML = `↓${Math.round(cs.dn)} <small>m</small>`;
  $("eMin").innerHTML = isFinite(lo) ? `${Math.round(lo)} <small>m</small>` : "–";
  $("eMax").innerHTML = isFinite(hi) ? `${Math.round(hi)} <small>m</small>` : "–";
  $("eTime").textContent = dist > 0 ? fmtDur(naismith(dist, cs.total, pace)) : "–";
  $("exp").disabled = pts.length < 2; $("undo").disabled = !anchors.length;
  drawProfile(prof);
}
let renderQueued = false;
const renderSoon = () => { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render() }) };
addEventListener("resize", () => { measureSheet(); renderSoon() });

function niceStep(r) { const p = 10 ** Math.floor(Math.log10(r || 1)), f = r / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p }
function roundRect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath() }
const chartFont = (s, w = 500) => `${w} ${s}px ${css("--font") || "system-ui"}`;
/** Draw the profile (dist, ele) on #profile; geometry kept in SC.geo for hit-testing. */
function drawProfile(prof) {
  SC.prof = prof; SC.geo = null;
  const c = $("profile"), r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  if (!r.width || !r.height) return;
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); const W = r.width, H = r.height; x.clearRect(0, 0, W, H);
  const v = prof.filter(p => p[1] != null);
  const noRoute = prof.length < 2; $("pEmpty").hidden = !noRoute; $("panel").classList.toggle("empty", noRoute);
  if (v.length < 2) {
    if (!noRoute) { x.fillStyle = css("--c-label"); x.font = chartFont(13); x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("Waiting for elevation data…", W / 2, H / 2) }
    return;
  }
  const D = prof.at(-1)[0] || 1;
  let lo = Infinity, hi = -Infinity; for (const p of v) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1] }
  if (hi - lo < 20) hi = lo + 20;
  const big = H >= 140, L0 = big ? 50 : 40, R0 = big ? 14 : 8, T = big ? 12 : 6, BY = H - (big ? 26 : 18);
  const ys = niceStep((hi - lo) / Math.max(2, Math.floor((BY - T) / (big ? 42 : 34))));
  lo = Math.floor(lo / ys) * ys; hi = Math.ceil(hi / ys) * ys; if (hi - lo < ys) hi = lo + ys;
  const X = d => L0 + d / D * (W - L0 - R0), Y = e => BY - (e - lo) / (hi - lo) * (BY - T);
  // grid + axis labels
  x.lineWidth = 1; x.font = chartFont(big ? 11 : 10); x.fillStyle = css("--c-label"); x.textBaseline = "middle"; x.textAlign = "right";
  x.strokeStyle = css("--c-grid");
  for (let e = lo; e <= hi + .01; e += ys) { const y = Math.round(Y(e)) + .5; x.beginPath(); x.moveTo(L0, y); x.lineTo(W - R0, y); x.stroke(); x.fillText(Math.round(e) + " m", L0 - 8, Math.max(T + 5, y)) }
  const xs = niceStep(D / 1000 / Math.max(2, Math.floor((W - L0) / (big ? 90 : 64)))) * 1000; x.textBaseline = "alphabetic"; x.textAlign = "left";
  for (let d = 0; d <= D + .01; d += xs) {
    const xx = Math.round(X(d)) + .5; if (d > 0) { x.beginPath(); x.moveTo(xx, T); x.lineTo(xx, BY); x.stroke() }
    const lbl = (d / 1000).toFixed(xs < 1000 ? 1 : 0) + " km", w = x.measureText(lbl).width;
    x.fillText(lbl, Math.max(L0 - 4, Math.min(xx - w / 2, W - R0 - w)), H - (big ? 8 : 4));
  }
  x.strokeStyle = css("--c-axis"); x.beginPath(); x.moveTo(L0, Math.round(BY) + .5); x.lineTo(W - R0, Math.round(BY) + .5); x.stroke();
  // continuous runs with elevation; gaps are shaded
  const runs = []; let run = []; prof.forEach(p => { if (p[1] == null) { if (run.length) runs.push(run); run = [] } else run.push(p) }); if (run.length) runs.push(run);
  x.fillStyle = css("--c-gap");
  for (let i = 1; i < runs.length; i++) { const a = X(runs[i - 1].at(-1)[0]), b = X(runs[i][0][0]); x.fillRect(a, T, b - a, BY - T) }
  const G = SC.prof === prof && SC.gr && SC.gr.length === prof.length ? SC.gr : null, accent = css("--accent") || "#0071e3";
  let fillG, lineG;
  if (G && gOn) {   // horizontal gradient with a colour stop per point: smooth, anti-aliased band transitions
    fillG = x.createLinearGradient(L0, 0, W - R0, 0); lineG = x.createLinearGradient(L0, 0, W - R0, 0);
    // one stop pair per band change: crisp, anti-aliased edges instead of long smears over sparse points
    const tOf = d => Math.max(0, Math.min(1, d / D)), BLEND = .002;
    let band = null, col = null;
    for (let i = 1; i < prof.length; i++) {
      const b = gBand(G[i]); if (b === band) continue;
      const t = tOf(prof[i - 1][0]);
      if (col) { fillG.addColorStop(Math.max(0, t - BLEND), gCol(col, .58)); lineG.addColorStop(Math.max(0, t - BLEND), gCol(col)) }
      band = b; col = G[i];
      fillG.addColorStop(t, gCol(col, .58)); lineG.addColorStop(t, gCol(col));
    }
  } else { fillG = x.createLinearGradient(0, T, 0, BY); fillG.addColorStop(0, accent + "59"); fillG.addColorStop(1, accent + "08"); lineG = accent }
  for (const rv of runs) {
    x.beginPath(); x.moveTo(X(rv[0][0]), BY); rv.forEach(p => x.lineTo(X(p[0]), Y(p[1]))); x.lineTo(X(rv.at(-1)[0]), BY); x.closePath();
    x.fillStyle = fillG; x.fill()
    x.beginPath(); rv.forEach((p, i) => i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1])));
    x.lineJoin = "round"; x.lineCap = "round"; x.strokeStyle = lineG; x.lineWidth = 2; x.stroke();
  }
  SC.geo = { L0, R0, BY, T, W, H, D, X, Y, big };
  scrubDecor(x);
}
function updLegend() {
  $("legend").innerHTML = GB.map(b => `<span><i style="background:${b[1]}"></i>${b[2]}</span>`).join("") + `<span><i style="background:${gCol(null)}"></i>No data</span>`;
  $("legend").classList.toggle("off", !gOn);
}

/* 8. Scrub along the trail ------------------------------------------------------ */
// SC.pos = metres from start (null = no marker)
const SC = { pts: [], cum: [], up: [], gr: [], prof: [], D: 0, pos: null, geo: null, mk: null, hit: null };
function scrubIdx(d) { const c = SC.cum; let lo = 0, hi = c.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m } return lo }
function eleAt(i, t) {
  const P = SC.pts, j = Math.min(i + 1, P.length - 1), a = P[i][2], b = P[j][2];
  if (a != null && b != null) return a + (b - a) * t;
  if (a != null && t < .5) return a; if (b != null && t >= .5) return b;
  let l = i; while (l >= 0 && P[l][2] == null) l--; let r = i + 1; while (r < P.length && P[r][2] == null) r++;
  if (l >= 0 && r < P.length) { const d = SC.cum[i] + (SC.cum[j] - SC.cum[i]) * t; return P[l][2] + (P[r][2] - P[l][2]) * (d - SC.cum[l]) / ((SC.cum[r] - SC.cum[l]) || 1) }
  return null;
}
function scrubState(d) {
  const P = SC.pts; if (P.length < 2 || d == null) return null;
  d = Math.max(0, Math.min(SC.D, d));
  const i = scrubIdx(d), j = Math.min(i + 1, P.length - 1), seg = SC.cum[j] - SC.cum[i], t = seg > 0 ? (d - SC.cum[i]) / seg : 0;
  const ll = [P[i][0] + (P[j][0] - P[i][0]) * t, P[i][1] + (P[j][1] - P[i][1]) * t];
  const g = SC.gr[i + 1] ?? SC.gr[i];
  return { d, ll, ele: eleAt(i, t), interp: P[i][2] == null || P[j][2] == null, up: SC.up[i] || 0, left: SC.D - d, i, grade: g ?? null };
}
function setScrub(d) { SC.pos = d; scrubUpdate() }
const canHover = matchMedia("(hover:hover) and (pointer:fine)").matches;
function scrubUpdate() {
  const s = scrubState(SC.pos), row = $("scrubRow");
  if (!s) {
    if (SC.mk) { map.removeLayer(SC.mk); SC.mk = null } SC.pos = null;
    row.innerHTML = SC.pts.length < 2 ? "" : `<span class="mut">${canHover ? "Move along the profile or hover the route to explore" : "Drag along the profile or tap the route"}</span>`;
    drawProfile(SC.prof); return;
  }
  if (!SC.mk) SC.mk = L.marker(s.ll, { interactive: false, keyboard: false, zIndexOffset: 2000, icon: L.divIcon({ className: "", html: '<div class="scrubDot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
  else SC.mk.setLatLng(s.ll);
  const ele = s.ele == null ? "– m (no data)" : Math.round(s.ele) + " m" + (s.interp ? "*" : "");
  row.innerHTML =
    `<span class="rv lead"><b id="scD">${fmtKm(s.d)}</b><small>from start</small></span>` +
    `<span class="rv" id="scL">${fmtKm(s.left)}<small> to go</small></span>` +
    `<span class="rv"><b id="scE">${ele}</b>${s.interp && s.ele != null ? "<small>est.</small>" : ""}</span>` +
    `<span class="rv"><i class="gdot" style="background:${gCol(s.grade)}"></i><b id="scG">${fmtGrade(s.grade)}</b></span>` +
    `<span class="rv" id="scU">↑${Math.round(s.up)} m<small> so far</small></span>` +
    `<button id="scX" class="icon-btn" aria-label="Hide marker">${icon("i-close")}</button>`;
  $("scX").onclick = () => setScrub(null);
  drawProfile(SC.prof);
}
function wptDist(w) {
  const P = SC.pts; if (P.length < 2) return null; let bi = 0, bd = Infinity;
  for (let i = 0; i < P.length; i++) { const d = hav(P[i], [w.lat, w.lng]); if (d < bd) { bd = d; bi = i } }
  return bd <= WPT_ON_ROUTE_M ? SC.cum[bi] : null;
}
/** Waypoint ticks, scrub cursor and tooltip bubble drawn over the chart. */
function scrubDecor(x) {
  const g = SC.geo; if (!g) return;
  wpts.forEach(w => {
    const d = wptDist(w); if (d == null) return; const X = Math.round(g.X(d)) + .5, col = wType(w.type).color;
    x.strokeStyle = col; x.globalAlpha = .6; x.setLineDash([2, 3]); x.lineWidth = 1; x.beginPath(); x.moveTo(X, g.T); x.lineTo(X, g.BY); x.stroke(); x.setLineDash([]); x.globalAlpha = 1;
    x.fillStyle = col; x.strokeStyle = "#fff"; x.lineWidth = 2; x.beginPath(); x.arc(X, g.BY, 5, 0, 7); x.fill(); x.stroke();
  });
  const s = scrubState(SC.pos); if (!s) return;
  const X = Math.round(g.X(s.d)) + .5;
  x.strokeStyle = css("--c-cursor"); x.lineWidth = 1; x.beginPath(); x.moveTo(X, g.T); x.lineTo(X, g.BY); x.stroke();
  if (s.ele != null) {
    const y = g.Y(s.ele); x.fillStyle = "#fff"; x.beginPath(); x.arc(X, y, 6, 0, 7); x.fill();
    x.fillStyle = css("--accent"); x.beginPath(); x.arc(X, y, 4, 0, 7); x.fill();
  }
  const txt = `${(s.d / 1000).toFixed(2)} km · ${s.ele == null ? "no data" : Math.round(s.ele) + " m"} · ${fmtGrade(s.grade)}`;
  x.font = chartFont(g.big ? 12 : 11, 600); const bw = x.measureText(txt).width + 18, bh = g.big ? 24 : 20;
  let bx = X + 10; if (bx + bw > g.W - 2) bx = X - 10 - bw;
  x.fillStyle = css("--c-bubble"); roundRect(x, bx, g.T, bw, bh, bh / 2); x.fill();
  x.fillStyle = css("--c-bubble-ink"); x.textAlign = "left"; x.textBaseline = "middle"; x.fillText(txt, bx + 9, g.T + bh / 2 + .5);
}
(() => {   // chart pointer / touch / keyboard scrubbing
  const c = $("profile"); let id = null;
  const at = e => { const g = SC.geo; if (!g || SC.pts.length < 2) return; const r = c.getBoundingClientRect(); setScrub((e.clientX - r.left - g.L0) / (g.W - g.L0 - g.R0) * g.D) };
  c.addEventListener("pointerdown", e => { if (SC.pts.length < 2) return; e.preventDefault(); id = e.pointerId; try { c.setPointerCapture(id) } catch (_) { } at(e) });
  c.addEventListener("pointermove", e => { if (id === e.pointerId) { e.preventDefault(); at(e) } else if (canHover && e.pointerType === "mouse" && id == null && SC.pts.length > 1) at(e) });
  const up = e => { if (id === e.pointerId) id = null }; c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
  // iOS Safari: stop page scroll / rubber-band while a finger is on the chart
  c.addEventListener("touchstart", e => { if (SC.pts.length >= 2) e.preventDefault() }, { passive: false });
  c.addEventListener("touchmove", e => e.preventDefault(), { passive: false });
  L.DomEvent.disableClickPropagation($("ui")); L.DomEvent.disableScrollPropagation($("ui"));
})();
function stepScrub(dir, big) { if (SC.pts.length < 2) return; setScrub((SC.pos ?? (dir > 0 ? 0 : SC.D)) + (SC.pos == null ? 0 : dir * (big ? 500 : 50))) }
function nearestDist(ll) {
  const P = SC.pts; let bi = 0, bd = Infinity; const k = Math.cos(ll.lat * RAD);
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i][1] * k, ay = P[i][0], dx = P[i + 1][1] * k - ax, dy = P[i + 1][0] - ay, L2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, L2 ? ((ll.lng * k - ax) * dx + (ll.lat - ay) * dy) / L2 : 0));
    const d = (ll.lng * k - ax - t * dx) ** 2 + (ll.lat - ay - t * dy) ** 2; if (d < bd) { bd = d; bi = i + t }
  }
  const i = Math.floor(bi); return SC.cum[i] + (SC.cum[Math.min(i + 1, P.length - 1)] - SC.cum[i]) * (bi - i);
}
/** Wide invisible line over the route: hover (desktop) / tap (phone) sets the scrub point.
 *  Clicks still bubble to the map, so Snap/Waypoint taps behave exactly as before. */
function scrubHit() {
  if (SC.hit) { map.removeLayer(SC.hit); SC.hit = null }
  if (SC.pts.length < 2) { scrubUpdate(); return }
  SC.hit = L.polyline(SC.pts.map(p => [p[0], p[1]]), { weight: 22, opacity: 0, color: "#000", className: "scrubHit" }).addTo(map);
  SC.hit.on("mousemove click", e => { if (mode !== "free") setScrub(nearestDist(e.latlng)) });
  scrubUpdate();
}

/* 9. Waypoints --------------------------------------------------------------- */
let wpts = [], wmarkers = [];
const wType = t => WTYPES[t] || WTYPES.other;
const wIcon = t => L.divIcon({ className: "", html: `<div class="wicon" style="background:${wType(t).color}">${icon(wType(t).icon)}</div>`, iconSize: [30, 30], iconAnchor: [15, 36], tooltipAnchor: [0, -34] });
function wMarker(w) {
  const m = L.marker([w.lat, w.lng], { icon: wIcon(w.type), draggable: true, zIndexOffset: 1000, keyboard: false }).addTo(map);
  m.bindTooltip(() => esc(w.name), { direction: "top" });
  m.on("click", () => openWpts(true));
  m.on("dragend", async () => { const ll = m.getLatLng(); w.lat = ll.lat; w.lng = ll.lng; const p = [w.lat, w.lng, null]; await fillEle([p]); w.ele = p[2]; updEleWarn(); save(); renderW() });
  return m;
}
async function addWpt(ll, type = "drink", name) {
  const w = { lat: ll.lat, lng: ll.lng, ele: null, type, name: name || WTYPES[type].label };
  wpts.push(w); wmarkers.push(wMarker(w)); openWpts(true); save(); updHint();
  const p = [w.lat, w.lng, null]; await fillEle([p]); w.ele = p[2]; updEleWarn(); save(); renderW(); return w;
}
function delWpt(i) { map.removeLayer(wmarkers[i]); wpts.splice(i, 1); wmarkers.splice(i, 1); renderW(); save() }
function openWpts(open) { $("wpts").classList.toggle("open", open); $("wList").setAttribute("aria-expanded", open); renderW() }
function renderW() {
  if (SC.geo || SC.prof.length) drawProfile(SC.prof);
  const el = $("wpts"); $("wCount").textContent = wpts.length;
  el.innerHTML = `<h4>Waypoints <button class="icon-btn" id="wClose" aria-label="Close waypoint list">${icon("i-close")}</button></h4><div class="wrows">` +
    (wpts.length ? "" : `<div class="wempty">No waypoints yet. Choose <b>Waypoint</b>, then click the map.</div>`) +
    wpts.map((w, i) => `<div class="wrow" data-i="${i}">` +
      `<span class="wdot" style="background:${wType(w.type).color}">${icon(wType(w.type).icon)}</span>` +
      `<select aria-label="Waypoint type">${Object.entries(WTYPES).map(([k, v]) => `<option value="${k}"${k === w.type ? " selected" : ""}>${v.name}</option>`).join("")}</select>` +
      `<input value="${esc(w.name)}" maxlength="40" aria-label="Waypoint name">` +
      `<small>${w.ele != null ? Math.round(w.ele) + " m" : ""}</small>` +
      `<button class="icon-btn wgo" aria-label="Zoom to waypoint">${icon("i-target")}</button>` +
      `<button class="icon-btn wdel" aria-label="Delete waypoint">${icon("i-trash")}</button></div>`).join("") + `</div>`;
  $("wClose").onclick = () => openWpts(false);
  el.querySelectorAll(".wrow[data-i]").forEach(r => {
    const i = +r.dataset.i, w = wpts[i];
    r.querySelector("select").onchange = e => { const old = wType(w.type).label; w.type = e.target.value; if (w.name === old || !w.name) w.name = wType(w.type).label; wmarkers[i].setIcon(wIcon(w.type)); save(); renderW() };
    r.querySelector("input").onchange = e => { w.name = e.target.value.trim() || wType(w.type).label; save() };
    r.querySelector(".wgo").onclick = () => map.setView([w.lat, w.lng], Math.max(map.getZoom(), 15));
    r.querySelector(".wdel").onclick = () => delWpt(i);
  });
}

/* 10. GPX export / import ----------------------------------------------------- */
function makeGpx(name, pts, wps = wpts) {
  let tol = GPX_TOL_M, out = simplify(pts, tol); while (out.length > GPX_MAX_PTS) { tol *= 1.5; out = simplify(pts, tol) }
  const n = esc(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trail Planner" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>${n}</name><time>${new Date().toISOString().replace(/\.\d+Z/, "Z")}</time></metadata>
${wps.map(w => `  <wpt lat="${(+w.lat).toFixed(6)}" lon="${(+w.lng).toFixed(6)}">${w.ele != null ? `<ele>${(+w.ele).toFixed(1)}</ele>` : ""}<name>${esc(w.name || wType(w.type).label)}</name><sym>${esc(wType(w.type).sym)}</sym><type>${w.type}</type></wpt>\n`).join("")}  <trk><name>${n}</name><type>trail_running</type><trkseg>
${out.map(p => `    <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${p[2] != null ? `<ele>${(+p[2]).toFixed(1)}</ele>` : ""}</trkpt>`).join("\n")}
  </trkseg></trk>
</gpx>
`;
}
async function exportGpx() {
  const pts = trackPts(); if (pts.length < 2) return toast("Draw a route first"); if (pending) return toast("Still loading route & elevation…");
  if (await backfillAll()) {
    interpEle(trackPts()); const n = trackPts().filter(p => p[2] == null).length; render();
    if (n && !confirm(`Elevation service unavailable: ${n} of ${trackPts().length} track points have no elevation. Your watch/app will show no climb for those.\n\nExport anyway (points without data get no <ele>)?`)) return;
  }
  const name = (prompt("Route name", importName || "Titahi Bay trail run") || "").trim(); if (!name) return;
  const gpx = makeGpx(name, trackPts()), fn = name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") + ".gpx";
  const file = new File([gpx], fn, { type: "application/gpx+xml" });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return } catch (e) { if (e.name === "AbortError") return }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = fn; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 2000);
  toast("Saved " + fn);
}
function parseGpx(text) {
  const d = new DOMParser().parseFromString(text, "application/xml");
  if (d.getElementsByTagName("parsererror").length) throw new Error("Not valid XML");
  const q = (el, t) => Array.from(el.getElementsByTagNameNS("*", t));
  const pt = e => { const ee = q(e, "ele")[0], v = ee ? parseFloat(ee.textContent) : NaN; return [parseFloat(e.getAttribute("lat")), parseFloat(e.getAttribute("lon")), okNum(v) ? v : null] };
  let pts = q(d, "trkpt").map(pt); if (!pts.length) pts = q(d, "rtept").map(pt); pts = pts.filter(p => isFinite(p[0]) && isFinite(p[1]));
  const nm = q(d, "trk")[0] || q(d, "rte")[0] || q(d, "metadata")[0];
  const name = nm && q(nm, "name")[0] ? q(nm, "name")[0].textContent.trim() : "";
  const SYM = { "drinking water": "drink", restaurant: "food", "scenic area": "viewpoint", restroom: "toilet" };
  const w = q(d, "wpt").map(e => {
    const p = pt(e), n = q(e, "name")[0], sy = q(e, "sym")[0], ty = q(e, "type")[0];
    const t = ty && WTYPES[ty.textContent.trim()] ? ty.textContent.trim() : (sy && SYM[sy.textContent.trim().toLowerCase()]) || "other";
    return { lat: p[0], lng: p[1], ele: p[2], type: t, name: (n && n.textContent.trim()) || WTYPES[t].label };
  }).filter(x => isFinite(x.lat));
  return { pts, wpts: w, name };
}
let importName = "";
async function importGpx(text) {
  const g = parseGpx(text); if (g.pts.length < 2 && !g.wpts.length) return toast("No track, route or waypoints found in that GPX");
  if ((anchors.length || wpts.length) && !confirm("Replace the current route and waypoints with the imported GPX?")) return;
  anchors = []; segs = []; markers.forEach(m => map.removeLayer(m)); markers = []; while (wpts.length) delWpt(0);
  let fresh = [];
  if (g.pts.length >= 2) {
    const pts = g.pts.filter((p, i) => !i || hav(g.pts[i - 1], p) > .5);
    addAnchor({ lat: pts[0][0], lng: pts[0][1] }); addAnchor({ lat: pts.at(-1)[0], lng: pts.at(-1)[1] });
    segs.push({ mode: "free", imported: true, pts }); fresh = pts;
  }
  g.wpts.forEach(w => { wpts.push(w); wmarkers.push(wMarker(w)) }); renderW();
  fitTo([...fresh.map(p => [p[0], p[1]]), ...g.wpts.map(w => [w.lat, w.lng])]);
  importName = g.name; const had = fresh.filter(p => p[2] != null).length; render(); save(); updHint();
  toast(`Imported ${fresh.length} points${g.wpts.length ? `, ${g.wpts.length} waypoints` : ""}. Elevation ${had === fresh.length ? "from file" : had ? "partly from file, fetching the rest…" : "fetching…"}`, 4000);
  const miss = await backfillAll(); if (miss) toast(`Elevation unavailable for ${miss} points – use the warning to retry`, 6000);
}
async function backfillAll() {
  setBusy(1);
  try { await fillEle(allPts()); for (const w of wpts) if (w.ele == null) { const p = [w.lat, w.lng, null]; await fillEle([p]); w.ele = p[2] } }
  finally { setBusy(-1) }
  save(); render(); renderW(); return eleWarn;
}
function updEleWarn() {
  const n = allPts().filter(p => p[2] == null).length + wpts.filter(w => w.ele == null).length; eleWarn = n;
  const b = $("eleWarn");
  b.style.display = n && !pending ? "inline-block" : "none";
  b.innerHTML = `${icon("i-warn")} No elevation for ${n} pt${n > 1 ? "s" : ""} – retry`;
}

/* 11. UI chrome: modes, panels, layers, onboarding, keyboard ------------------- */
function setMode(m) {
  mode = m;
  for (const [id, k] of [["mSnap", "snap"], ["mFree", "free"], ["mWpt", "wpt"]]) { $(id).classList.toggle("on", m === k); $(id).setAttribute("aria-pressed", m === k) }
  document.body.classList.toggle("drawing", m === "free"); document.body.classList.toggle("wptmode", m === "wpt");
  markers.forEach(k => k.dragging && (m === "free" ? k.dragging.disable() : k.dragging.enable()));
  if (m === "free") map.dragging.disable(); else map.dragging.enable();
  $("modeHint").textContent = MODE_HINT[m];
  if (!isDesktop()) { if (m === "free") toast("Freehand: drag to draw. Pinch to zoom."); if (m === "wpt") toast("Waypoint: tap the map to drop one") }
  updHint();
}
/** Profile collapse (persisted as tp-ui = "col"). */
function setPanel(col) {
  document.body.classList.toggle("pcol", col);
  $("pTog").setAttribute("aria-expanded", !col); $("pTog").setAttribute("aria-label", col ? "Expand profile" : "Collapse profile");
  store.set(KEY.collapsed, col ? "col" : "");
  measureSheet(); render();
  setTimeout(() => { measureSheet(); render() }, 260);     // after the height transition
}
/** Desktop resize handle (panel height persisted as tp-ph, in px). */
(() => {
  const h = $("pHandle"), root = document.documentElement, panel = $("panel"); let sy = null, sh = 0;
  const setH = px => { px = Math.round(Math.max(PANEL_MIN_PX, Math.min(innerHeight * PANEL_MAX_FRAC, px))); root.style.setProperty("--ph-desk", px + "px"); return px };
  const v = +store.get(KEY.panelH, 0); if (v) setH(v);
  h.addEventListener("pointerdown", e => { e.preventDefault(); sy = e.clientY; sh = panel.offsetHeight; panel.classList.add("dragging"); h.setPointerCapture(e.pointerId) });
  h.addEventListener("pointermove", e => { if (sy == null) return; setH(sh + sy - e.clientY); drawProfile(SC.prof) });
  const end = () => { if (sy == null) return; sy = null; panel.classList.remove("dragging"); store.set(KEY.panelH, setH(panel.offsetHeight)); render() };
  h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end);
  h.addEventListener("keydown", e => { if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return; e.preventDefault(); store.set(KEY.panelH, setH(panel.offsetHeight + (e.key === "ArrowUp" ? 20 : -20))); render() });
})();
/** Phone: measure the bottom sheet so toasts, map controls and fitBounds avoid it. */
function measureSheet() {
  const h = isDesktop() ? 0 : $("ui").getBoundingClientRect().height;
  document.documentElement.style.setProperty("--sheet-h", Math.round(h) + "px");
}
if (window.ResizeObserver) new ResizeObserver(measureSheet).observe($("ui"));
/** fitBounds that keeps the route clear of the floating panels. */
function fitTo(latlngs, maxZoom = 17) {
  if (!latlngs.length) return; const b = L.latLngBounds(latlngs);
  if (isDesktop()) {
    const side = $("side").getBoundingClientRect(), panel = $("panel").getBoundingClientRect();
    map.fitBounds(b, { paddingTopLeft: [side.right + 30, 40], paddingBottomRight: [80, innerHeight - panel.top + 30], maxZoom });
  } else {
    map.fitBounds(b, { paddingTopLeft: [24, 70], paddingBottomRight: [64, $("ui").getBoundingClientRect().height + 24], maxZoom });
  }
}
// basemaps (all keyless)
let baseLayer = null;
const SWATCH = { topo: "linear-gradient(135deg,#e8e4c9,#c8d8a8 50%,#a9c7e0)", osm: "linear-gradient(135deg,#f2efe9,#d5e8c4 50%,#aad3df)", voyager: "linear-gradient(135deg,#fafaf8,#e8eef3 50%,#d4e4f0)", sat: "linear-gradient(135deg,#2f4a2a,#556b3a 50%,#24425e)" };
function setBase(key) {
  if (!BASEMAPS[key]) key = "topo"; const def = BASEMAPS[key];
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(def.url, { maxZoom: 19, maxNativeZoom: def.max, attribution: def.attr, subdomains: def.sub || "abc", keepBuffer: 3, detectRetina: false }).addTo(map);
  store.set(KEY.layer, key); renderLayers(key);
}
function renderLayers(cur) {
  const p = $("layersPop");
  p.innerHTML = Object.entries(BASEMAPS).map(([k, v]) => `<button role="menuitemradio" aria-checked="${k === cur}" data-k="${k}"><span class="sw" style="background:${SWATCH[k]}"></span>${v.name}<svg class="ic chk" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button>`).join("");
  p.querySelectorAll("button").forEach(b => b.onclick = () => { setBase(b.dataset.k); toggleLayers(false) });
}
function toggleLayers(open) { const p = $("layersPop"); open = open ?? p.hidden; p.hidden = !open; $("layersBtn").setAttribute("aria-expanded", open) }
// first-run / empty-state hint
function updHint() {
  const empty = !anchors.length && !wpts.length;
  if (!empty) store.set(KEY.onboarded, "1");
  $("hint").hidden = !(empty && mode !== "wpt");
  const verb = isDesktop() ? "Click" : "Tap";
  $("hintText").textContent = mode === "free" ? "Drag on the map to draw" : `${verb} the map to start your route`;
}
// keyboard shortcuts (ignored while typing in a field)
addEventListener("keydown", e => {
  if (/^(input|select|textarea)$/i.test(e.target.tagName || "")) return;
  if ($("help").open) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return }
  if (mod || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const act = {
    s: () => setMode("snap"), f: () => setMode("free"), w: () => setMode("wpt"), e: exportGpx, i: () => $("impFile").click(),
    g: () => setGrade(!gOn), p: () => setPanel(!document.body.classList.contains("pcol")), l: () => map.locate({ enableHighAccuracy: true }),
    "+": () => map.zoomIn(), "=": () => map.zoomIn(), "-": () => map.zoomOut(), "?": () => $("help").showModal(),
    ArrowRight: SC.pts.length > 1 ? () => stepScrub(1, e.shiftKey) : null, ArrowLeft: SC.pts.length > 1 ? () => stepScrub(-1, e.shiftKey) : null,
    Escape: () => { toggleLayers(false); if (SC.pos != null) setScrub(null); else if ($("wpts").classList.contains("open")) openWpts(false) },
  }[k];
  if (!act) return;
  e.preventDefault(); act();
});
// wiring
$("mSnap").onclick = () => setMode("snap"); $("mFree").onclick = () => setMode("free"); $("mWpt").onclick = () => setMode("wpt");
$("undo").onclick = undo; $("clear").onclick = clearRoute; $("exp").onclick = exportGpx;
$("wList").onclick = () => openWpts(!$("wpts").classList.contains("open"));
$("imp").onclick = () => $("impFile").click();
$("impFile").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { await importGpx(await f.text()) } catch (err) { toast("Could not read GPX: " + err.message, 5000) } };
$("eleWarn").onclick = async () => { const n = await backfillAll(); toast(n ? `Still no elevation for ${n} points (service unavailable?)` : "Elevation filled ✓") };
$("gTog").onclick = () => setGrade(!gOn);
$("pTog").onclick = () => setPanel(!document.body.classList.contains("pcol"));
$("loc").onclick = () => map.locate({ enableHighAccuracy: true });
$("zIn").onclick = () => map.zoomIn(); $("zOut").onclick = () => map.zoomOut();
$("layersBtn").onclick = e => { e.stopPropagation(); toggleLayers() };
$("helpBtn").onclick = () => $("help").showModal();
$("pace").value = String(pace); if (!$("pace").value) { pace = NAISMITH_BASE_KMH; $("pace").value = "5" }
$("pace").onchange = e => { pace = +e.target.value; store.set(KEY.pace, pace); render() };
document.addEventListener("click", e => { if (!e.target.closest("#mapCtl")) toggleLayers(false) });
L.DomEvent.disableClickPropagation($("mapCtl")); L.DomEvent.disableScrollPropagation($("mapCtl"));

/* 12. Persistence & boot ------------------------------------------------------ */
// Storage format is unchanged from earlier versions: tp-route = {anchors, segs, wpts}.
function save() { store.set(KEY.route, JSON.stringify({ anchors, segs, wpts })) }
function load() {
  let s = null; try { s = JSON.parse(store.get(KEY.route) || "null") } catch (e) { console.warn("Saved route unreadable", e) }
  if (!s || typeof s !== "object") return;
  if (Array.isArray(s.wpts)) s.wpts.forEach(w => { if (!w || !isFinite(w.lat) || !isFinite(w.lng)) return; if (!WTYPES[w.type]) w.type = "other"; wpts.push(w); wmarkers.push(wMarker(w)) });
  if (Array.isArray(s.anchors) && s.anchors.length) {
    s.anchors.forEach(a => addAnchor(a));
    segs = Array.isArray(s.segs) ? s.segs.filter(x => x && Array.isArray(x.pts)) : [];
    const pts = trackPts(); fitTo([...(pts.length > 1 ? pts : anchors.map(a => [a.lat, a.lng])).map(p => [p[0] ?? p.lat, p[1] ?? p.lng]), ...wpts.map(w => [w.lat, w.lng])], 16);
  }
}
setBase(store.get(KEY.layer, "topo"));
if (store.get(KEY.collapsed) === "col") { document.body.classList.add("pcol"); $("pTog").setAttribute("aria-expanded", "false") }
if (!gOn) { $("gTog").classList.remove("on"); $("gTog").setAttribute("aria-pressed", "false") }
measureSheet(); map.invalidateSize();
load(); updLegend(); render(); renderW(); updHint();
if (eleWarn || allPts().some(p => p[2] == null)) backfillAll();

window.TP = { setGrade, gradeArr, gBand, setScrub, scrubState, SC, nearestDist, importGpx, parseGpx, backfillAll, interpEle, addWpt, makeGpx, simplify, climb, route, fillEle, naismith }; // for tests
