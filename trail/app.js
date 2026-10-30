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
 *   seg = {mode:'snap'|'free', pts:[[lat,lng,ele|null]], fallback?, imported?, cues?:[{i,t}]}
 *   cues: BRouter junction hints, i = index into seg.pts, t = VoiceHint code (TL, KR, C …).
 *   Cues come from OSM junctions (updJoins); legs saved with an older cue version are recomputed on load.
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
const KEY = { cues: "tp-cues", tab: "tp-tab", route: "tp-route", collapsed: "tp-ui", grade: "tp-grade", panelH: "tp-ph", layer: "tp-layer", pace: "tp-pace", onboarded: "tp-onboarded" };

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
async function route(a, b, quiet) {
  const url = `${BROUTER}?lonlats=${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}&profile=${BROUTER_PROFILE}&alternativeidx=0&format=geojson&turnInstructionMode=9`;
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ROUTE_TIMEOUT_MS);
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) throw new Error(await r.text());
    const f = (await r.json()).features[0], c = f.geometry.coordinates;
    return { pts: c.map(x => [x[1], x[0], x.length > 2 ? x[2] : null]), fallback: false, cues: parseHints(f.properties?.voicehints, c.length) };
  } catch (e) {
    console.warn("BRouter failed", e); if (!quiet) toast("No trail route found – used a straight line");
    return { pts: densify([a.lat, a.lng], [b.lat, b.lng]), fallback: true, cues: [] };
  }
}

/* 4b. Cue sheet: turn cues at junctions only ---------------------------------
 * Snap legs: BRouter voicehints (turnInstructionMode=9). BRouter emits a hint only where the
 * way network branches, so bends along a single path never produce one. Hint = [ptIndex, cmd, exit, distToNext, angle, …].
 * Freehand / imported legs have no junction data: they get no cues (Start/Finish still added).
 * Leg joins get a cue only when the route really turns there (>= JOIN_TURN_DEG). */
const VH = { 1: "C", 2: "TL", 3: "TSLL", 4: "TSHL", 5: "TR", 6: "TSLR", 7: "TSHR", 8: "KL", 9: "KR", 10: "TU", 11: "TU", 13: "RNDB", 14: "RNDB", 15: "TU", 17: "KL", 18: "KR" };
const CUE = {
  C: { txt: "Straight on", ab: "S", sym: "Straight", ic: "c-straight" },
  TL: { txt: "Turn left", ab: "L", sym: "Left", ic: "c-left" }, TR: { txt: "Turn right", ab: "R", sym: "Right", ic: "c-right" },
  TSLL: { txt: "Bear left", ab: "BL", sym: "Slight Left", ic: "c-sleft" }, TSLR: { txt: "Bear right", ab: "BR", sym: "Slight Right", ic: "c-sright" },
  TSHL: { txt: "Sharp left", ab: "SHL", sym: "Sharp Left", ic: "c-shleft" }, TSHR: { txt: "Sharp right", ab: "SHR", sym: "Sharp Right", ic: "c-shright" },
  KL: { txt: "Keep left", ab: "KL", sym: "Left Fork", ic: "c-kleft" }, KR: { txt: "Keep right", ab: "KR", sym: "Right Fork", ic: "c-kright" },
  TU: { txt: "Turn around", ab: "U", sym: "U-Turn", ic: "c-uturn" }, RNDB: { txt: "Roundabout", ab: "RB", sym: "Straight", ic: "c-straight" },
  START: { txt: "Start", ab: "Start", sym: "Flag, Green", ic: "c-start" }, END: { txt: "Finish", ab: "Finish", sym: "Flag, Red", ic: "c-end" },
};
const FLIP = { TL: "TR", TR: "TL", TSLL: "TSLR", TSLR: "TSLL", TSHL: "TSHR", TSHR: "TSHL", KL: "KR", KR: "KL", C: "C", TU: "TU", RNDB: "RNDB" };
const CUE_DEDUP_M = 25, JOIN_TURN_DEG = 150, JOIN_ARM_M = 30;
let cuesOn = store.get(KEY.cues) !== "off";
/** Strict junction test on one raw BRouter voicehint [idx, cmd, exit, distNext, angle, geometry].
 *  geometry = " inPrio(outAngle)outPrio (altAngle)altPrio …": every other way leaving that node, with the
 *  profile's priority class (2–6 path, 8–10 track, 12–14 service, 16 steps, 18+ roads). Negative angle = left.
 *  Returns a cue code, or null when the route just follows the obvious path. */
const angCode = d => { const a = Math.abs(d); return a < 20 ? "C" : a < 45 ? (d < 0 ? "TSLL" : "TSLR") : a <= 120 ? (d < 0 ? "TL" : "TR") : (d < 0 ? "TSHL" : "TSHR") };
/** Fallback (Overpass down): any BRouter hint listing at least one other way is a junction. */
function hintJunction(h) {
  const m = String(h[5] || "").trim().match(/^(-?\d+)\((-?\d+)\)(-?\d+)(.*)$/); if (!m || !/\(/.test(m[4])) return null;
  return angCode(+m[2]);
}
function classifyHint(h) {
  if (h[1] === 13 || h[1] === 14) return "RNDB";
  const m = String(h[5] || "").trim().match(/^(-?\d+)\((-?\d+)\)(-?\d+)(.*)$/); if (!m) return null;
  const inP = +m[1], out = +m[2], outP = +m[3], A = Math.abs(out);
  const alts = [...m[4].matchAll(/\((-?\d+)\)(-?\d+)/g)].map(x => ({ a: +x[1], p: +x[2] }));
  // a side way counts only if it is a road, or a trail/track not much minor to the ones we are on (no driveways, spurs)
  const sig = alts.filter(x => x.p > 0 && Math.abs(x.a) < 165 && (x.p >= 16 || x.p >= Math.min(inP, outP) - 4) && !(x.p >= 12 && x.p <= 14 && Math.max(inP, outP) >= 16));
  if (!sig.length) return null;                                   // not a real intersection (≥3 significant ways)
  if (A >= 45) {                                                  // real turn, but only if another way is an equally obvious choice
    if (!sig.some(x => Math.abs(x.a) <= A + 30)) return null;
    return A >= 135 ? (out < 0 ? "TSHL" : "TSHR") : out < 0 ? "TL" : "TR";
  }
  // going roughly straight: cue only when a significant way crosses (both sides), e.g. a road or a track over a path
  const cross = w => Math.abs(w.a) >= 45 && (w.p >= 16 || (w.p >= 8 && w.p > inP));
  return sig.some(x => cross(x) && x.a < 0) && sig.some(x => cross(x) && x.a > 0) ? "C" : null;
}
const CUE_VER = 4;     // bump to recompute cues stored by older versions
function parseHints(vh, n) {
  if (!Array.isArray(vh)) return [];
  return vh.map(h => ({ i: +h[0], t: hintJunction(h) })).filter(c => c.t && c.i > 0 && c.i < n - 1);
}
/** Junction at a join between two snapped legs: BRouter gives no hint at a via point, so route a short
 *  probe from ~60 m before to ~60 m after the join and keep a hint that lands on it. Cached per join. */
const joinCache = new Map();
async function joinCue(prev, s) {
  const P = prev.pts, Q = s.pts, J = Q[0]; if (P.length < 2 || Q.length < 2) return null;
  let a = P.length - 1, d = 0; while (a > 0 && d < 60) { d += hav(P[a - 1], P[a]); a-- }
  let b = 0; d = 0; while (b < Q.length - 1 && d < 60) { d += hav(Q[b], Q[b + 1]); b++ }
  const k = [P[a], J, Q[b]].map(eleKey).join("|"); if (joinCache.has(k)) return joinCache.get(k);
  const r = await route({ lat: P[a][0], lng: P[a][1] }, { lat: Q[b][0], lng: Q[b][1] }, true);
  const c = r.fallback ? null : r.cues.find(c => hav(r.pts[c.i], J) < 15);
  const t = c ? c.t : null; if (!r.fallback) joinCache.set(k, t); return t;
}
/* Junctions from OpenStreetMap (Overpass): BRouter's output points are OSM nodes, so at each route
 * point we look up every highway way through that node. Any way leaving that is not the route's own
 * in/out edge (and not service=driveway, not a duplicate bearing) makes it a junction -> one cue,
 * with the direction from the route's turn angle. Bends without another way never match. */
const OVERPASS = ["https://overpass-api.de/api/interpreter"], OSM_API = "https://api.openstreetmap.org/api/0.6/map.json";
const TILE = .01, osmTiles = new Map(), osmNodes = new Map();   // tile -> Promise<bool>; "lat,lng"(5dp) -> [{lat,lng,adj:[[lat,lng,kind]]}]
const NOT_WAY = /^(proposed|construction|platform|bus_stop|elevator|corridor|abandoned|razed|raceway|rest_area|services)$/;
const wayKind = t => /^(path|footway|steps|bridleway|cycleway|pedestrian)$/.test(t.highway) ? "path" : t.highway === "track" ? "track" : "road";
function osmTile(k) {
  if (osmTiles.has(k)) return osmTiles.get(k);
  const [y, x] = k.split(",").map(Number), bb = [y * TILE, x * TILE, (y + 1) * TILE, (x + 1) * TILE].map(v => v.toFixed(4)).join(",");
  const q = `[out:json][timeout:25];way["highway"](${bb});out body geom;`;
  const pr = (async () => {
    const srcs = [...OVERPASS.map(u => () => getJSON(u, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 1)),
      // fallback: the main OSM API map call (CORS-enabled), converted to the same {tags, geometry} shape
      async () => {
        const j = await getJSON(`${OSM_API}?bbox=${[x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE].map(v => v.toFixed(4)).join(",")}`, { headers: { Accept: "application/json" } }, 2);
        if (!j || !Array.isArray(j.elements)) return null;
        const N = new Map(); j.elements.forEach(e => { if (e.type === "node") N.set(e.id, e) });
        return { elements: j.elements.filter(e => e.type === "way" && e.tags && e.tags.highway).map(e => { const ns = e.nodes.filter(id => N.has(id)); return { id: e.id, tags: e.tags, nodes: ns, geometry: ns.map(id => ({ lat: N.get(id).lat, lon: N.get(id).lon })) } }) };
      }];
    for (const get of srcs) {
      const j = await get();
      if (!j || !Array.isArray(j.elements)) continue;
      for (const w of j.elements) {
        const t = w.tags || {}, g = w.geometry; if (!g || g.length < 2 || NOT_WAY.test(t.highway) || t.service === "driveway" || t.area === "yes" || t.access === "private" && t.highway === "service") continue;
        const kd = wayKind(t);
        g.forEach((n, i) => {
          const key = n.lat.toFixed(5) + "," + n.lon.toFixed(5); let L = osmNodes.get(key); if (!L) osmNodes.set(key, L = []);
          const id = w.nodes ? w.nodes[i] : key;           // OSM node id: only ways that really share the node count
          let nd = L.find(z => z.id === id); if (!nd) L.push(nd = { id, lat: n.lat, lng: n.lon, adj: [] });
          for (const m of [g[i - 1], g[i + 1]]) if (m && !nd.adj.some(a => Math.abs(a[0] - m.lat) < 2e-6 && Math.abs(a[1] - m.lon) < 2e-6)) nd.adj.push([m.lat, m.lon, kd, w.id]);
        });
      }
      return true;
    }
    osmTiles.delete(k); return false;                      // retry on a later scan
  })();
  osmTiles.set(k, pr); return pr;
}
function osmNodeAt(p) {
  let best = null, bd = Infinity;
  for (const dy of [-1e-5, 0, 1e-5]) for (const dx of [-1e-5, 0, 1e-5]) {
    const L = osmNodes.get((p[0] + dy).toFixed(5) + "," + (p[1] + dx).toFixed(5)); if (!L) continue;
    for (const z of L) { const d = hav([z.lat, z.lng], p); if (d < 1.5 && (!best || d < bd || d === bd && z.adj.length > best.adj.length)) { best = z; bd = d } }
  }
  return best;
}
/** Point at route distance d (m), interpolated along the route geometry. */
function ptAtDist(P, cum, d) {
  if (d <= 0) return P[0]; if (d >= cum[cum.length - 1]) return P[P.length - 1];
  let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m }
  const f = cum[hi] > cum[lo] ? (d - cum[lo]) / (cum[hi] - cum[lo]) : 0;
  return [P[lo][0] + (P[hi][0] - P[lo][0]) * f, P[lo][1] + (P[hi][1] - P[lo][1]) * f];
}
/** Signed angle normalised to (-180, 180], + = right. */
const angDiff = (a, b) => { let d = ((a - b) % 360 + 360) % 360; return d > 180 ? d - 360 : d };
/** Incoming / outgoing route bearings at P[i], measured along the route ~15-30 m before/after the node
 *  (falls back to the nearest distinct point when the route is shorter there). */
function routeArms(P, cum, i, arm = 20) {
  const ds = cum[i], D = cum[cum.length - 1], J = [P[i][0], P[i][1]];
  const back = ptAtDist(P, cum, Math.max(0, ds - arm)), fwd = ptAtDist(P, cum, Math.min(D, ds + arm));
  if (hav(back, J) < 3 || hav(fwd, J) < 3) return null;
  // first distinct neighbours (>= 1 m away) give the route's own edges at the node
  let a = i - 1; while (a > 0 && hav(P[a], J) < 1) a--; let b = i + 1; while (b < P.length - 1 && hav(P[b], J) < 1) b++;
  return { bIn: bearing(back, J), bOut: bearing(J, fwd), eBack: bearing(J, P[a]), eOut: bearing(J, P[b]) };
}
/** Junction cue at P[i], or null. */
function junctionAt(P, cum, i) {
  const n = osmNodeAt(P[i]); if (!n || n.adj.length < 3) return null;     // a node on just one way through: never a junction
  const R = routeArms(P, cum, i); if (!R) return null;
  const br = []; let wIn = null, wOut = null;
  for (const a of n.adj) {
    const b = bearing(P[i], a);
    if (Math.abs(angDiff(b, R.eBack)) < 15) { wIn = a[3]; continue }    // the route's own edges
    if (Math.abs(angDiff(b, R.eOut)) < 15) { wOut = a[3]; continue }
    if (br.some(x => Math.abs(angDiff(x.b, b)) < 8)) continue;
    br.push({ b, rel: angDiff(b, R.bIn), kind: a[2] });
  }
  if (!br.length) return null;
  const turn = angDiff(R.bOut, R.bIn);
  let t = angCode(turn);
  // Route stays on the same OSM way through the node: that way is the obvious continuation, so a bend
  // in it is not a turn. Only call a turn when a side branch is nearer to straight ahead than the route.
  if (t !== "C" && wIn != null && wIn === wOut && !br.some(z => Math.abs(z.rel) < Math.abs(turn))) t = "C";
  let x = "";
  if (t === "C" || t === "TSLL" || t === "TSLR") {        // following the main way past a side way: say what branches off
    const kind = br.some(z => z.kind === "road") ? "road" : br.some(z => z.kind === "track") ? "track" : "path";
    const L = br.some(z => z.rel < -20 && z.rel > -160), Rt = br.some(z => z.rel > 20 && z.rel < 160);
    x = L && Rt ? `${kind} crossing` : L ? `${kind} left` : Rt ? `${kind} right` : "";
  }
  return { t, x };
}
let jScan = 0;
async function updJoins() {
  const my = ++jScan, P = trackPts(); if (P.length < 3) return;
  const tiles = new Set(); P.forEach(p => tiles.add(Math.floor(p[0] / TILE) + "," + Math.floor(p[1] / TILE)));
  const ok = (await Promise.all([...tiles].map(osmTile))).every(Boolean);
  if (my !== jScan || !ok) return;                        // superseded, or Overpass down: keep BRouter-hint cues
  let d = 0; const cum = P.map((p, k) => k ? d += hav(P[k - 1], p) : 0);
  let base = 0;
  segs.forEach((s, j) => {
    const n = s.pts.length; if (!n) return;
    if (s.mode === "snap" && !s.fallback && !s.imported) {
      const c = [];
      for (let k = j ? 0 : 1; k < n - 1; k++) { const g = base + k; if (g <= 0 || g >= P.length - 1) continue; const r = junctionAt(P, cum, g); if (r) c.push({ i: k, ...r }) }
      s.cues = c; s.cv = CUE_VER; delete s.jc; delete s.jk;
    }
    base += n - 1;
  });
  render(); save();
}
/** Cues of a leg travelled backwards: mirror indices, swap left/right. */
const reverseCues = (cues, n) => (cues || []).map(c => ({ i: n - 1 - c.i, t: FLIP[c.t] || c.t, x: c.x && c.x.replace(/left|right/, m => m === "left" ? "right" : "left") })).reverse();
function bearing(a, b) { const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD), x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD); return Math.atan2(y, x) / RAD }
/** Signed turn angle (deg, + = right) at P[i], measured over ~JOIN_ARM_M arms so GPS jitter is ignored. */
function turnAt(P, cum, i, arm = JOIN_ARM_M) {
  let a = i, b = i; while (a > 0 && cum[i] - cum[a] < arm) a--; while (b < P.length - 1 && cum[b] - cum[i] < arm) b++;
  if (a === i || b === i) return 0; let d = bearing(P[i], P[b]) - bearing(P[a], P[i]); d = ((d + 540) % 360) - 180; return d;
}
const turnCode = d => { const a = Math.abs(d); return a > 150 ? "TU" : a > 120 ? (d > 0 ? "TSHR" : "TSHL") : d > 0 ? "TR" : "TL" };
/** Merge per-leg cues into one list along trackPts(): {d, ll, ele, t, txt}. */
function buildCues(P = SC.pts, cum = SC.cum) {
  if (P.length < 2) return [];
  const raw = [{ g: 0, t: "START", pr: 3 }]; let base = 0;
  segs.forEach((s, j) => {
    const n = s.pts.length; if (!n) return;
    (s.cues || []).forEach(c => { if ((c.i > 0 || j > 0) && c.i < n - 1) raw.push({ g: base + c.i, t: c.t, x: c.x, pr: c.t === "C" ? 1 : /^TSL/.test(c.t) ? 1.5 : 2 }) });
    if (j > 0 && s.jc && base > 0) raw.push({ g: base, t: s.jc, pr: s.jc === "C" ? 1 : 2, join: true });
    base += n - 1;
    // out-and-back turnaround at a leg join (no junction needed)
    if (j < segs.length - 1 && base > 0 && base < P.length - 1) { const d = turnAt(P, cum, base); if (Math.abs(d) >= JOIN_TURN_DEG) raw.push({ g: base, t: "TU", pr: 2.5, join: true }) }
  });
  raw.push({ g: P.length - 1, t: "END", pr: 3 });
  raw.forEach(c => { c.g = Math.max(0, Math.min(P.length - 1, c.g)); c.d = cum[c.g] });
  raw.sort((a, b) => a.d - b.d || b.pr - a.pr);
  const out = [];
  for (const c of raw) {
    const last = out.at(-1);
    if (last && c.d - last.d < CUE_DEDUP_M) { if (c.pr > last.pr && last.t !== "START") out[out.length - 1] = c; continue }
    out.push(c);
  }
  const fin = raw.at(-1); if (out.at(-1) !== fin) { if (out.length > 1 && fin.d - out.at(-1).d < CUE_DEDUP_M) out.pop(); out.push(fin) }
  return out.map((c, k) => ({ d: c.d, ll: [P[c.g][0], P[c.g][1]], ele: P[c.g][2], t: c.t, txt: CUE[c.t].txt + (c.x ? ` (${c.x})` : ""), next: k < out.length - 1 ? null : 0 }))
    .map((c, k, a) => ({ ...c, next: k < a.length - 1 ? a[k + 1].d - c.d : 0 }));
}
/** Old saved snap legs have no cues: re-ask BRouter once and map its hints onto the stored points. */
async function rebuildCues() { await updJoins() }   // old saved cues (cv < CUE_VER) are recomputed from OSM

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
    if (s.mode === "snap") { const r = await route(a, b); if (segs[i] !== s) return; s.pts = r.pts; s.fallback = r.fallback; s.cues = r.cues; s.cv = CUE_VER }
    else {
      const pv = i > 0 && segs[i - 1].pts.length ? segs[i - 1].pts.at(-1) : null;
      s.pts[0] = pv ? [pv[0], pv[1], null] : [a.lat, a.lng, null]; s.pts[s.pts.length - 1] = [b.lat, b.lng, null];
    }
    await fillEle(s.pts);
  } finally { setBusy(-1) }
  if (segs[i] === s) { render(); save(); if (!pending) updJoins() }
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
/** Out-and-back: append the route reversed so it returns to the start along the same path. */
function returnPath() {
  if (anchors.length < 2 || segs.length !== anchors.length - 1 || segs.some(s => !s.pts.length)) return toast("Finish drawing the route first");
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]; anchors.push({ ...anchors[i] }); addMarker(anchors.length - 1);
    segs.push({ mode: s.mode, pts: s.pts.map(p => [...p]).reverse(), ...(s.fallback ? { fallback: true } : {}), ...(s.imported ? { imported: true } : {}), ...(Array.isArray(s.cues) ? { cues: reverseCues(s.cues, s.pts.length), cv: s.cv } : {}) });
  }
  render(); save(); updHint(); updJoins(); toast("Return leg added – Undo removes it a point at a time");
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
  segs.push({ mode: "free", pts: d, cues: [] }); buildSeg(segs.length - 1); save();
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
  Object.assign(SC, { cues: [], pts, cum: prof.map(q => q[0]), up: cs.up, prof, D: dist }); SC.gr = gradeArr(pts, SC.cum);
  gradeLines(); scrubHit();
  let lo = Infinity, hi = -Infinity; for (const p of pts) if (p[2] != null) { if (p[2] < lo) lo = p[2]; if (p[2] > hi) hi = p[2] }
  $("dist").innerHTML = `${(dist / 1000).toFixed(2)} <small>km</small>`;
  $("asc").innerHTML = `↑${Math.round(cs.total)} <small>m</small>`;
  $("desc").innerHTML = `↓${Math.round(cs.dn)} <small>m</small>`;
  $("eMin").innerHTML = isFinite(lo) ? `${Math.round(lo)} <small>m</small>` : "–";
  $("eMax").innerHTML = isFinite(hi) ? `${Math.round(hi)} <small>m</small>` : "–";
  $("eTime").textContent = dist > 0 ? fmtDur(naismith(dist, cs.total, pace)) : "–";
  $("exp").disabled = pts.length < 2; $("undo").disabled = !anchors.length; $("ret").disabled = anchors.length < 2; $("saveBtn").disabled = $("saveBtn2").disabled = !anchors.length && !wpts.length;
  drawProfile(prof); renderCues(); if (on3d) upd3d();
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
    if (SC.mk) { map.removeLayer(SC.mk); SC.mk = null } SC.pos = null; if (on3d) upd3d();
    row.innerHTML = SC.pts.length < 2 ? "" : `<span class="mut">${canHover ? "Move along the profile or hover the route to explore" : "Drag along the profile or tap the route"}</span>`;
    drawProfile(SC.prof); return;
  }
  if (!SC.mk) SC.mk = L.marker(s.ll, { interactive: false, keyboard: false, zIndexOffset: 2000, icon: L.divIcon({ className: "", html: '<div class="scrubDot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
  else SC.mk.setLatLng(s.ll);
  if (on3d) upd3d();
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

/* 8b. Cue sheet tab ----------------------------------------------------------- */
let tab = store.get(KEY.tab) === "cues" ? "cues" : "ele";
const CUE_SVG = {
  "c-straight": '<path d="M12 20V4M7 9l5-5 5 5"/>', "c-left": '<path d="M16 20v-7a3 3 0 0 0-3-3H5M9 6l-4 4 4 4"/>', "c-right": '<path d="M8 20v-7a3 3 0 0 1 3-3h8M15 6l4 4-4 4"/>',
  "c-sleft": '<path d="M14 20v-6L7 7M7 12V7h5"/>', "c-sright": '<path d="M10 20v-6l7-7M17 12V7h-5"/>',
  "c-shleft": '<path d="M16 20V8L6 18M6 12v6h6"/>', "c-shright": '<path d="M8 20V8l10 10M18 12v6h-6"/>',
  "c-kleft": '<path d="M12 20v-6L7 7M7 12V7h5M12 14l5-7"/>', "c-kright": '<path d="M12 20v-6l5-7M17 12V7h-5M12 14 7 7"/>',
  "c-uturn": '<path d="M8 20V9a4 4 0 0 1 8 0v4M12 10l4 4 4-4"/>', "c-start": '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>', "c-end": '<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>',
};
const cueIcon = t => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${CUE_SVG[CUE[t].ic]}</svg>`;
function setTab(t) {
  tab = t; store.set(KEY.tab, t);
  for (const [id, k] of [["tEle", "ele"], ["tCue", "cues"]]) { $(id).classList.toggle("on", t === k); $(id).setAttribute("aria-selected", t === k) }
  $("panel").classList.toggle("cuetab", t === "cues");
  if (document.body.classList.contains("pcol")) setPanel(false);
  measureSheet(); renderSoon();
}
function renderCues() {
  SC.cues = buildCues(); const el = $("cues"); if (!el) return;
  if (tab !== "cues") return;
  const turns = SC.cues.filter(c => c.t !== "START" && c.t !== "END").length;
  el.innerHTML = `<div class="cue-top"><span>${SC.pts.length < 2 ? "No route yet" : turns ? `${turns} junction${turns > 1 ? "s" : ""}` : "No junction turns"}${segs.some(s => s.mode === "free" || s.imported) ? `<small> · freehand/imported legs have no junction cues</small>` : ""}</span>` +
    `<label class="tgl"><input type="checkbox" id="cueGpx"${cuesOn ? " checked" : ""}><span>Include in GPX</span></label></div>` +
    `<ol class="cue-list">${SC.pts.length < 2 ? "" : SC.cues.map((c, k) => `<li><button class="cue cue-${c.t}" data-k="${k}">` +
      `<span class="cue-ic">${cueIcon(c.t)}</span><span class="cue-t">${c.txt}</span>` +
      `<span class="cue-d">${(c.d / 1000).toFixed(2)} km</span><span class="cue-e">${c.ele != null ? Math.round(c.ele) + " m" : "–"}</span>` +
      `<span class="cue-n">${c.next ? "→ " + (c.next < 1000 ? Math.round(c.next) + " m" : (c.next / 1000).toFixed(2) + " km") : ""}</span></button></li>`).join("")}</ol>`;
  $("cueGpx").onchange = e => { cuesOn = e.target.checked; store.set(KEY.cues, cuesOn ? "" : "off") };
  el.querySelectorAll(".cue").forEach(b => b.onclick = () => { const c = SC.cues[+b.dataset.k]; setScrub(c.d); map.panTo(c.ll) });
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
      `<input value="${esc(w.name)}" maxlength="40" placeholder="Name this waypoint" aria-label="Waypoint name">` +
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
function makeGpx(name, pts, wps = wpts, cues = []) {
  let tol = GPX_TOL_M, out = simplify(pts, tol); while (out.length > GPX_MAX_PTS) { tol *= 1.5; out = simplify(pts, tol) }
  const n = esc(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trail Planner" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>${n}</name><time>${new Date().toISOString().replace(/\.\d+Z/, "Z")}</time></metadata>
${cues.map(c => `  <wpt lat="${c.ll[0].toFixed(6)}" lon="${c.ll[1].toFixed(6)}">${c.ele != null ? `<ele>${(+c.ele).toFixed(1)}</ele>` : ""}<name>${esc(c.t === "START" || c.t === "END" ? CUE[c.t].txt : CUE[c.t].ab + " " + (c.d / 1000).toFixed(1) + "km")}</name><desc>${esc(`${c.txt} at ${(c.d / 1000).toFixed(2)} km${c.ele != null ? `, ${Math.round(c.ele)} m` : ""}${c.next ? ` – next cue in ${(c.next / 1000).toFixed(2)} km` : ""}`)}</desc><sym>${esc(CUE[c.t].sym)}</sym><type>cue</type></wpt>\n`).join("")}${wps.map(w => `  <wpt lat="${(+w.lat).toFixed(6)}" lon="${(+w.lng).toFixed(6)}">${w.ele != null ? `<ele>${(+w.ele).toFixed(1)}</ele>` : ""}<name>${esc(w.name || wType(w.type).label)}</name><sym>${esc(wType(w.type).sym)}</sym><type>${w.type}</type></wpt>\n`).join("")}  <trk><name>${n}</name><type>trail_running</type><trkseg>
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
  render(); const gpx = makeGpx(name, trackPts(), wpts, cuesOn ? SC.cues : []), fn = name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") + ".gpx";
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
  const w = q(d, "wpt").filter(e => { const ty = q(e, "type")[0]; return !(ty && ty.textContent.trim() === "cue") }).map(e => {
    const p = pt(e), n = q(e, "name")[0], sy = q(e, "sym")[0], ty = q(e, "type")[0];
    const t = ty && WTYPES[ty.textContent.trim()] ? ty.textContent.trim() : (sy && SYM[sy.textContent.trim().toLowerCase()]) || "other";
    return { lat: p[0], lng: p[1], ele: p[2], type: t, name: (n && n.textContent.trim()) || WTYPES[t].label };
  }).filter(x => isFinite(x.lat));
  return { pts, wpts: w, name };
}
let importName = "";
async function importGpx(text) {
  const g = parseGpx(text); if (g.pts.length < 2 && !g.wpts.length) return toast("No track, route or waypoints found in that GPX");
  libSave();                                               // the current route stays in Saved routes
  anchors = []; segs = []; markers.forEach(m => map.removeLayer(m)); markers = []; while (wpts.length) delWpt(0);
  curId = null; curFolder = null; curSrc = "imported"; curName = (g.name || "").trim() || "Imported route";
  let fresh = [];
  if (g.pts.length >= 2) {
    const pts = g.pts.filter((p, i) => !i || hav(g.pts[i - 1], p) > .5);
    addAnchor({ lat: pts[0][0], lng: pts[0][1] }); addAnchor({ lat: pts.at(-1)[0], lng: pts.at(-1)[1] });
    segs.push({ mode: "free", imported: true, pts, cues: [] }); fresh = pts;
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
  if (m3 && m3.getSource("base")) { const bt = baseTiles(key); m3.getSource("base").setTiles(bt.tiles) }
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
  if (/^(input|select|textarea)$/i.test(e.target.tagName || "") && !((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s")) return;
  if ($("saveDlg").open) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") e.preventDefault(); return }
  if ($("help").open) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); if (!$("saveDlg").open) saveDialog(); return }
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return }
  if (!mod && !e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); openLib(); return }
  if (!mod && e.key.toLowerCase() === "r") { e.preventDefault(); returnPath(); return }
  if (mod || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const act = {
    s: () => setMode("snap"), f: () => setMode("free"), w: () => setMode("wpt"), e: exportGpx, i: () => $("impFile").click(),
    g: () => setGrade(!gOn), c: () => setTab(tab === "cues" ? "ele" : "cues"), p: () => setPanel(!document.body.classList.contains("pcol")), l: () => map.locate({ enableHighAccuracy: true }),
    "3": () => set3d(!on3d), "+": () => on3d ? m3.zoomIn() : map.zoomIn(), "=": () => on3d ? m3.zoomIn() : map.zoomIn(), "-": () => on3d ? m3.zoomOut() : map.zoomOut(), "?": () => $("help").showModal(),
    ArrowRight: SC.pts.length > 1 ? () => stepScrub(1, e.shiftKey) : null, ArrowLeft: SC.pts.length > 1 ? () => stepScrub(-1, e.shiftKey) : null,
    Escape: () => { toggleLayers(false); if (document.body.classList.contains("libopen")) return openLib(false); if (SC.pos != null) setScrub(null); else if ($("wpts").classList.contains("open")) openWpts(false) },
  }[k];
  if (!act) return;
  e.preventDefault(); act();
});

/* 11b. 3D terrain view (view-only) -------------------------------------------------
 * MapLibre GL is loaded from the CDN on first use. Terrain: AWS Terrarium DEM tiles. Base: the current
 * Leaflet basemap as a raster source. Leaflet stays the editor and is never moved, so 2D comes back as it was. */
const ML_VER = "4.7.1", ML_CDN = `https://unpkg.com/maplibre-gl@${ML_VER}/dist/`;
let m3 = null, on3d = false, m3Wmk = [];
const hasGL = () => { try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"))) } catch (e) { return false } };
function loadML() {
  if (window.maplibregl) return Promise.resolve();
  if (loadML.p) return loadML.p;
  return loadML.p = new Promise((ok, no) => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = ML_CDN + "maplibre-gl.css"; document.head.appendChild(l);
    const sc = document.createElement("script"); sc.src = ML_CDN + "maplibre-gl.js"; sc.onload = ok; sc.onerror = () => { loadML.p = null; no(new Error("MapLibre failed to load")) }; document.head.appendChild(sc);
  });
}
function baseTiles(key) {
  const d = BASEMAPS[key] || BASEMAPS.topo, sub = (d.sub || "abc").split("");
  const u = d.url.replace("{r}", ""); return { tiles: u.includes("{s}") ? sub.map(x => u.replace("{s}", x)) : [u], maxzoom: d.max, attribution: d.attr };
}
function route3dData() {
  const P = SC.pts, G = SC.gr, f = [];
  if (P.length > 1) {
    if (gOn) { let st = 0; for (let i = 1; i <= P.length; i++) if (i === P.length || gBand(G[i]) !== gBand(G[st + 1])) { if (i - 1 > st) f.push({ type: "Feature", properties: { c: gCol(G[st + 1]) }, geometry: { type: "LineString", coordinates: P.slice(st, i).map(p => [p[1], p[0]]) } }); st = i - 1 } }
    else segs.forEach(s => { if (s.pts.length > 1) f.push({ type: "Feature", properties: { c: segColor(s) }, geometry: { type: "LineString", coordinates: s.pts.map(p => [p[1], p[0]]) } }) });
  }
  return { type: "FeatureCollection", features: f };
}
function upd3d() {
  if (!m3 || !m3.isStyleLoaded() || !m3.getSource("route")) return;
  m3.getSource("route").setData(route3dData());
  const s = SC.pos != null ? scrubState(SC.pos) : null;
  m3.getSource("scrub").setData({ type: "FeatureCollection", features: s ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [s.ll[1], s.ll[0]] } }] : [] });
  m3Wmk.forEach(m => m.remove()); m3Wmk = wpts.map(w => { const e = document.createElement("div"); e.className = "w3d"; e.title = w.name || wType(w.type).label; const t = wType(w.type); e.style.background = t.color || ""; e.innerHTML = icon(t.icon || "i-flag"); return new maplibregl.Marker({ element: e, anchor: "bottom" }).setLngLat([w.lng, w.lat]).addTo(m3) });
}
function fit3d() {
  const P = SC.pts.length > 1 ? SC.pts : null, pitch = isDesktop() ? 60 : 50;
  const c = map.getCenter();
  if (!P) return m3.jumpTo({ center: [c.lng, c.lat], zoom: Math.max(1, map.getZoom() - 1), pitch, bearing: 0 });
  let a = 90, b = -90, x = 180, y = -180; for (const p of P) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); x = Math.min(x, p[1]); y = Math.max(y, p[1]) }
  const ui = $("ui").getBoundingClientRect(), dk = isDesktop();
  m3.fitBounds([[x, a], [y, b]], { pitch, bearing: m3.getBearing(), duration: 0, maxZoom: 16, padding: dk ? { top: 60, bottom: 260, left: 380, right: 70 } : { top: 60, bottom: Math.min(ui.height, innerHeight * .5) + 20, left: 30, right: 60 } });
}
async function set3d(on) {
  if (on === on3d) return;
  if (on) {
    if (!hasGL()) return toast("3D needs WebGL, which isn't available in this browser");
    $("b3d").classList.add("busy3d");
    try { await loadML() } catch (e) { $("b3d").classList.remove("busy3d"); return toast("Couldn't load the 3D map – check your connection") }
    $("b3d").classList.remove("busy3d");
    set3d.v = { c: map.getCenter(), z: map.getZoom() };
    const el = $("map3d"); el.hidden = false; on3d = true; document.body.classList.add("v3d"); $("b3d").setAttribute("aria-pressed", "true");
    if (!m3) {
      const bt = baseTiles(store.get(KEY.layer, "topo"));
      m3 = new maplibregl.Map({
        container: el, attributionControl: { compact: true }, maxPitch: isDesktop() ? 80 : 60, pitch: 60, center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom() - 1,
        style: { version: 8, sources: {
          base: { type: "raster", tiles: bt.tiles, tileSize: 256, maxzoom: bt.maxzoom, attribution: bt.attribution },
          dem: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 15, encoding: "terrarium", attribution: "Terrain: Mapzen / AWS Terrain Tiles" },
          route: { type: "geojson", data: { type: "FeatureCollection", features: [] } }, scrub: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
          layers: [{ id: "base", type: "raster", source: "base" },
            { id: "hills", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": .25, "hillshade-shadow-color": "rgba(0,0,0,.35)" } },
            { id: "route-case", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 8 } },
            { id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "c"], "line-width": 4.5 } },
            { id: "scrub", type: "circle", source: "scrub", paint: { "circle-radius": 7, "circle-color": "#0071e3", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } }],
          terrain: { source: "dem", exaggeration: 1.4 }, sky: {} },
      });
      m3.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: false }), "bottom-right");
      m3.on("load", () => { upd3d(); fit3d() });
    } else { m3.resize(); upd3d(); fit3d() }
  } else {
    on3d = false; $("map3d").hidden = true; document.body.classList.remove("v3d"); $("b3d").setAttribute("aria-pressed", "false");
    map.invalidateSize({ pan: false }); if (set3d.v) map.setView(set3d.v.c, set3d.v.z, { animate: false });   // 2D view exactly as left
  }
}
$("b3d").onclick = () => set3d(!on3d);
// wiring
$("mSnap").onclick = () => setMode("snap"); $("mFree").onclick = () => setMode("free"); $("mWpt").onclick = () => setMode("wpt");
$("undo").onclick = undo; $("ret").onclick = returnPath; $("clear").onclick = clearRoute; $("exp").onclick = exportGpx;
$("wList").onclick = () => openWpts(!$("wpts").classList.contains("open"));
$("imp").onclick = () => $("impFile").click();
$("impFile").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { await importGpx(await f.text()) } catch (err) { toast("Could not read GPX: " + err.message, 5000) } };
$("eleWarn").onclick = async () => { const n = await backfillAll(); toast(n ? `Still no elevation for ${n} points (service unavailable?)` : "Elevation filled ✓") };
$("gTog").onclick = () => setGrade(!gOn);
$("tEle").onclick = () => setTab("ele"); $("tCue").onclick = () => setTab("cues");
$("pTog").onclick = () => setPanel(!document.body.classList.contains("pcol"));
$("loc").onclick = () => map.locate({ enableHighAccuracy: true });
$("zIn").onclick = () => on3d ? m3.zoomIn() : map.zoomIn(); $("zOut").onclick = () => on3d ? m3.zoomOut() : map.zoomOut();
$("layersBtn").onclick = e => { e.stopPropagation(); toggleLayers() };
$("helpBtn").onclick = () => $("help").showModal();
$("pace").value = String(pace); if (!$("pace").value) { pace = NAISMITH_BASE_KMH; $("pace").value = "5" }
$("pace").onchange = e => { pace = +e.target.value; store.set(KEY.pace, pace); render() };
document.addEventListener("click", e => { if (!e.target.closest("#mapCtl")) toggleLayers(false) });
L.DomEvent.disableClickPropagation($("mapCtl")); L.DomEvent.disableScrollPropagation($("mapCtl"));

/* 12. Persistence & boot ------------------------------------------------------ */
// Storage format is unchanged from earlier versions: tp-route = {anchors, segs, wpts}.
function save() { const d = { anchors, segs, wpts }; store.set(KEY.route, JSON.stringify(d)); libSaveSoon() }
function load(s) {
  if (s === undefined) try { s = JSON.parse(store.get(KEY.route) || "null") } catch (e) { console.warn("Saved route unreadable", e) }
  if (!s || typeof s !== "object") return;
  if (Array.isArray(s.wpts)) s.wpts.forEach(w => { if (!w || !isFinite(w.lat) || !isFinite(w.lng)) return; if (!WTYPES[w.type]) w.type = "other"; wpts.push(w); wmarkers.push(wMarker(w)) });
  if (Array.isArray(s.anchors) && s.anchors.length) {
    s.anchors.forEach(a => addAnchor(a));
    segs = Array.isArray(s.segs) ? s.segs.filter(x => x && Array.isArray(x.pts)) : [];
    while (segs.length > anchors.length - 1) segs.pop();
    while (segs.length < anchors.length - 1) segs.push({ mode: "snap", pts: [] });
    segs.forEach((g, i) => { if (!g.pts.length) buildSeg(i) });   // legs saved before routing finished
    const pts = trackPts(); fitTo([...(pts.length > 1 ? pts : anchors.map(a => [a.lat, a.lng])).map(p => [p[0] ?? p.lat, p[1] ?? p.lng]), ...wpts.map(w => [w.lat, w.lng])], 16);
  }
}

/* 12b. Saved routes library ---------------------------------------------------
 * localStorage: tp-lib = [{id,name,src,created,updated,dist,asc,n,thumb}] (index, newest first)
 *               tp-r:<id> = {anchors, segs, wpts} (one key per route, so the index stays small)
 *               tp-cur = id of the route being edited. Any change auto-saves into it. */
const LIB = "tp-lib", CUR = "tp-cur", RKEY = id => "tp-r:" + id;
// tp-lib = {v:2, routes:[…], folders:[{id,name,open}]}; v1 was a bare routes array (all routes become Unfiled)
let lib = [], folders = [];
try { const j = JSON.parse(store.get(LIB) || "[]"); if (Array.isArray(j)) lib = j; else if (j && Array.isArray(j.routes)) { lib = j.routes; folders = Array.isArray(j.folders) ? j.folders : [] } } catch (e) { lib = [] }
lib.forEach(r => { if (r.folder === undefined || (r.folder && !folders.some(f => f.id === r.folder))) r.folder = null });
let curFolder = null, curId = store.get(CUR) || null, curSrc = "created", curName = "", libT = 0, libQ = "";
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const libPut = () => { try { localStorage.setItem(LIB, JSON.stringify({ v: 2, routes: lib, folders })); return true } catch (e) { toast("Storage full – delete some saved routes"); return false } };
function defName() { const d = new Date(); return "Route · " + d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) }
function routeThumb(pts) {
  if (pts.length < 2) return "";
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; const k = Math.cos(pts[0][0] * RAD);
  for (const p of pts) { const x = p[1] * k, y = -p[0]; a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y) }
  const sc = 36 / Math.max(b - a, d - c, 1e-9), ox = (44 - (b - a) * sc) / 2, oy = (44 - (d - c) * sc) / 2, st = Math.max(1, Math.floor(pts.length / 60));
  const q = []; for (let i = 0; i < pts.length; i += st) q.push(pts[i]); q.push(pts.at(-1));
  return q.map(p => ((p[1] * k - a) * sc + ox).toFixed(1) + "," + ((-p[0] - c) * sc + oy).toFixed(1)).join(" ");
}
function libSave() {
  clearTimeout(libT);
  if (!anchors.length && !wpts.length) return;                 // nothing drawn yet: don't create empty entries
  const pts = trackPts(); let dist = 0; pts.forEach((p, i) => { if (i) dist += hav(pts[i - 1], p) });
  const now = Date.now();
  let m = lib.find(r => r.id === curId);
  if (!m) { curId = newId(); m = { id: curId, name: curName || defName(), src: curSrc, created: now, folder: curFolder }; lib.unshift(m); store.set(CUR, curId) }
  Object.assign(m, { updated: now, dist, asc: Math.round(climbSeries(pts).total), n: anchors.length, w: wpts.length, thumb: routeThumb(pts) });
  try { localStorage.setItem(RKEY(m.id), JSON.stringify({ anchors, segs, wpts })) } catch (e) { toast("Storage full – delete some saved routes") }
  libPut(); renderLib(); setSaved(true);
}
function libSaveSoon() { clearTimeout(libT); setSaved(false); libT = setTimeout(libSave, 400) }
function setSaved(ok) {
  for (const id of ["saveBtn", "saveBtn2"]) { const b = $(id); if (!b) continue; b.classList.toggle("dirty", !ok); b.dataset.tip = (ok ? "Saved" : "Saving changes…") + " · Save  ⌘S" }
}
function saveDialog() {
  if (!anchors.length && !wpts.length) return toast("Draw a route first");
  libSave(); const m = lib.find(r => r.id === curId);
  const d = $("saveDlg"), f = $("saveName"); f.value = m ? m.name : (curName || defName()); $("saveCopy").hidden = !m; fillFolderSel($("saveFolder"), m ? m.folder : curFolder);
  d.showModal(); f.focus(); f.select();
}
function doSave(copy) {
  const n = $("saveName").value.trim().slice(0, 80); if (!n) { $("saveName").focus(); return }
  if (copy) { curId = null; curSrc = "created" }
  const fs = $("saveFolder").value; curFolder = fs === "__new" ? newFolder() : fs || null;
  curName = n; const m0 = lib.find(r => r.id === curId); if (m0) { m0.name = n; m0.folder = curFolder }
  libSave(); $("saveDlg").close(); toast(`Saved “${n}”${copy ? " as a copy" : ""}`);
}
function resetRoute() {
  anchors = []; segs = []; markers.forEach(m => map.removeLayer(m)); markers = []; while (wpts.length) delWpt(0); setScrub(null);
}
function openRoute(id) {
  libSave();
  const m = lib.find(r => r.id === id); if (!m) return;
  let d = null; try { d = JSON.parse(localStorage.getItem(RKEY(id)) || "null") } catch (e) { }
  if (!d) return toast("That route could not be read");
  resetRoute(); curId = id; curSrc = m.src; curName = m.name; curFolder = m.folder || null; store.set(CUR, id);
  load(d); render(); renderW(); updHint(); store.set(KEY.route, JSON.stringify({ anchors, segs, wpts }));
  if (segs.some(s => s.mode === "snap" && !s.fallback && s.cv !== CUE_VER)) rebuildCues(); else updJoins();
  if (allPts().some(p => p[2] == null)) backfillAll();
  renderLib(); if (!isDesktop()) openLib(false); toast("Opened " + m.name);
}
function newRoute() {
  libSave(); resetRoute(); curId = null; curSrc = "created"; curName = ""; curFolder = null; store.set(CUR, "");
  store.set(KEY.route, JSON.stringify({ anchors, segs, wpts })); render(); renderW(); updHint(); renderLib(); openLib(false); toast("New route – click the map to start");
}
function renameRoute(id) {
  const m = lib.find(r => r.id === id); if (!m) return;
  const n = prompt("Rename route", m.name); if (n == null || !n.trim()) return;
  m.name = n.trim().slice(0, 80); if (id === curId) curName = m.name; libPut(); renderLib();
}
function dupRoute(id) {
  libSave(); const m = lib.find(r => r.id === id); if (!m) return; const d = localStorage.getItem(RKEY(id)); if (!d) return;
  const c = { ...m, folder: m.folder, id: newId(), name: m.name + " copy", created: Date.now(), updated: Date.now() };
  try { localStorage.setItem(RKEY(c.id), d) } catch (e) { return toast("Storage full – delete some saved routes") }
  lib.splice(lib.indexOf(m), 0, c); libPut(); renderLib(); toast("Duplicated " + m.name);
}
function delRoute(id) {
  const m = lib.find(r => r.id === id); if (!m || !confirm(`Delete “${m.name}”? This can’t be undone.`)) return;
  lib = lib.filter(r => r !== m); localStorage.removeItem(RKEY(id)); libPut();
  if (id === curId) { resetRoute(); curId = null; curName = ""; curSrc = "created"; store.set(CUR, ""); store.set(KEY.route, JSON.stringify({ anchors, segs, wpts })); render(); renderW(); updHint() }
  renderLib(); toast("Deleted " + m.name);
}
const fmtDate = t => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }) };
function fillFolderSel(sel, v) {
  sel.innerHTML = `<option value="">Unfiled</option>${folders.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}<option value="__new">New folder…</option>`;
  sel.value = v && folders.some(f => f.id === v) ? v : "";
}
function newFolder() {
  const n = prompt("New folder name", ""); if (n == null || !n.trim()) return null;
  const f = { id: "f" + newId(), name: n.trim().slice(0, 60), open: true }; folders.push(f); libPut(); renderLib(); return f.id;
}
function renameFolder(id) { const f = folders.find(x => x.id === id); if (!f) return; const n = prompt("Rename folder", f.name); if (n == null || !n.trim()) return; f.name = n.trim().slice(0, 60); libPut(); renderLib() }
function delFolder(id) {
  const f = folders.find(x => x.id === id); if (!f) return; const k = lib.filter(r => r.folder === id).length;
  if (!confirm(`Delete folder “${f.name}”?${k ? ` Its ${k} route${k > 1 ? "s" : ""} will move to Unfiled.` : ""}`)) return;
  lib.forEach(r => { if (r.folder === id) r.folder = null }); if (curFolder === id) curFolder = null;
  folders = folders.filter(x => x !== f); libPut(); renderLib(); toast("Deleted folder " + f.name);
}
function moveRoute(id, fid) { const m = lib.find(r => r.id === id); if (!m) return; m.folder = fid || null; if (id === curId) curFolder = m.folder; libPut(); renderLib(); toast(`Moved to ${fid ? folders.find(f => f.id === fid).name : "Unfiled"}`) }
function moveDialog(id) {
  const m = lib.find(r => r.id === id); if (!m) return; const d = $("moveDlg");
  $("moveTitle").textContent = `Move “${m.name}”`;
  $("moveList").innerHTML = [{ id: "", name: "Unfiled" }, ...folders].map(f => `<li><button type="button" data-f="${esc(f.id)}" class="${(m.folder || "") === f.id ? "on" : ""}"><svg class="ic"><use href="#i-folder"/></svg><span>${esc(f.name)}</span>${(m.folder || "") === f.id ? '<svg class="ic ck"><use href="#i-check"/></svg>' : ""}</button></li>`).join("") +
    `<li><button type="button" data-f="__new" class="mnew"><svg class="ic"><use href="#i-plus"/></svg><span>New folder…</span></button></li>`;
  $("moveList").onclick = e => { const b = e.target.closest("[data-f]"); if (!b) return; let f = b.dataset.f; if (f === "__new") { f = newFolder(); if (!f) return } d.close(); moveRoute(id, f) };
  d.showModal();
}
function renderLib() {
  const el = $("libList"); if (!el) return;
  const q = libQ.trim().toLowerCase(), fname = id => (folders.find(f => f.id === id) || {}).name;
  $("libCount").textContent = lib.length ? `${lib.length} route${lib.length > 1 ? "s" : ""}` : "";
  const row = (r, showF) => `<li class="lrow${r.id === curId ? " cur" : ""}" data-id="${esc(r.id)}">
    <button class="lopen" data-act="open" aria-label="Open ${esc(r.name)}"><svg class="lthumb" viewBox="0 0 44 44" aria-hidden="true">${r.thumb ? `<polyline points="${r.thumb}"/>` : ""}</svg>
     <span class="lmain"><span class="lname">${esc(r.name)}</span><span class="lmeta">${(r.dist / 1000 || 0).toFixed(1)} km · ↑${r.asc || 0} m · ${fmtDate(r.updated || r.created)}${r.src === "imported" ? ' · <span class="ltag">GPX</span>' : ""}${showF && r.folder ? ` · ${esc(fname(r.folder))}` : ""}</span></span></button>
    <span class="lacts"><button class="icon-btn" data-act="mv" aria-label="Move to folder" data-tip="Move to folder"><svg class="ic"><use href="#i-folder"/></svg></button><button class="icon-btn" data-act="ren" aria-label="Rename" data-tip="Rename"><svg class="ic"><use href="#i-pencil"/></svg></button><button class="icon-btn" data-act="dup" aria-label="Duplicate" data-tip="Duplicate"><svg class="ic"><use href="#i-copy"/></svg></button><button class="icon-btn danger" data-act="del" aria-label="Delete" data-tip="Delete"><svg class="ic"><use href="#i-trash"/></svg></button></span></li>`;
  const empty = t => `<li class="lempty">${t}</li>`;
  if (q) { const rows = lib.filter(r => r.name.toLowerCase().includes(q) || (r.folder && fname(r.folder).toLowerCase().includes(q))); el.innerHTML = rows.length ? rows.map(r => row(r, true)).join("") : empty("No routes match"); return }
  if (!lib.length && !folders.length) { el.innerHTML = empty("No saved routes yet.<br>Routes you draw or import are saved here automatically."); return }
  const grp = (f, rs) => `<li class="lfold${f.open === false ? " shut" : ""}" data-fid="${esc(f.id)}"><div class="lf-h"><button class="lf-t" data-act="tog" aria-expanded="${f.open !== false}"><svg class="ic chev"><use href="#i-chevron"/></svg><svg class="ic"><use href="#i-folder"/></svg><span class="lf-n">${esc(f.name)}</span><span class="lf-c">${rs.length}</span></button>` +
    (f.id ? `<span class="lacts"><button class="icon-btn" data-act="fren" aria-label="Rename folder" data-tip="Rename folder"><svg class="ic"><use href="#i-pencil"/></svg></button><button class="icon-btn danger" data-act="fdel" aria-label="Delete folder" data-tip="Delete folder"><svg class="ic"><use href="#i-trash"/></svg></button></span>` : "") +
    `</div><ul class="lf-b">${rs.length ? rs.map(r => row(r)).join("") : empty("Empty folder – move routes here with the folder button")}</ul></li>`;
  const un = lib.filter(r => !r.folder);
  el.innerHTML = folders.map(f => grp(f, lib.filter(r => r.folder === f.id))).join("") + (folders.length ? grp({ id: "", name: "Unfiled", open: store.get("tp-unf") !== "shut" }, un) : un.map(r => row(r)).join(""));
}
function openLib(on = !document.body.classList.contains("libopen")) {
  document.body.classList.toggle("libopen", on); $("lib").setAttribute("aria-hidden", !on); $("libBtn").setAttribute("aria-expanded", on);
  if (on) { libSave(); renderLib(); if (isDesktop()) setTimeout(() => $("libQ").focus(), 220) }
}
$("libList").onclick = e => {
  const b = e.target.closest("[data-act]"); if (!b) return; const a = b.dataset.act, li = e.target.closest(".lrow"), fo = e.target.closest(".lfold");
  if (li) return ({ open: openRoute, ren: renameRoute, dup: dupRoute, del: delRoute, mv: moveDialog })[a](li.dataset.id);
  if (!fo) return; const fid = fo.dataset.fid;
  if (a === "tog") { if (fid) { const f = folders.find(x => x.id === fid); f.open = f.open === false; libPut() } else store.set("tp-unf", store.get("tp-unf") === "shut" ? "" : "shut"); renderLib() }
  else if (a === "fren") renameFolder(fid); else if (a === "fdel") delFolder(fid);
};
$("libQ").oninput = e => { libQ = e.target.value; renderLib() };
$("libNew").onclick = newRoute; $("libFolder").onclick = () => { const f = newFolder(); if (f) toast("Folder created") };
$("saveBtn").onclick = $("saveBtn2").onclick = saveDialog;
$("saveForm").onsubmit = e => { e.preventDefault(); doSave(e.submitter && e.submitter.id === "saveCopy") };
$("saveCancel").onclick = () => $("saveDlg").close(); $("libClose").onclick = () => openLib(false); $("libBtn").onclick = () => openLib();
L.DomEvent.disableClickPropagation($("lib")); L.DomEvent.disableScrollPropagation($("lib"));
// migrate: a route saved before the library existed becomes the first library entry
(() => {
  if (curId && lib.some(r => r.id === curId)) { curFolder = lib.find(r => r.id === curId).folder; curName = lib.find(r => r.id === curId).name; curSrc = lib.find(r => r.id === curId).src; return }
  curId = null; const raw = store.get(KEY.route); let d = null; try { d = JSON.parse(raw || "null") } catch (e) { }
  if (d && ((d.anchors && d.anchors.length) || (d.wpts && d.wpts.length))) { curSrc = d.segs && d.segs.some(x => x.imported) ? "imported" : "created"; curName = curSrc === "imported" ? "Imported route" : "My route"; setTimeout(libSave, 0) }
})();
setBase(store.get(KEY.layer, "topo"));
if (store.get(KEY.collapsed) === "col") { document.body.classList.add("pcol"); $("pTog").setAttribute("aria-expanded", "false") }
if (!gOn) { $("gTog").classList.remove("on"); $("gTog").setAttribute("aria-pressed", "false") }
measureSheet(); map.invalidateSize();
setTab(tab);
load(); updLegend(); render(); renderW(); updHint(); renderLib();
if (segs.some(s => s.mode === "snap" && !s.fallback && s.cv !== CUE_VER)) rebuildCues(); else updJoins();
if (eleWarn || allPts().some(p => p[2] == null)) backfillAll();

window.TP = { set3d, m3: () => m3, on3d: () => on3d, folders: () => folders, newFolder, renameFolder, delFolder, moveRoute, saveDialog, doSave, libSave, openRoute, renameRoute, delRoute, dupRoute, newRoute, openLib, lib: () => lib, junctionAt, routeArms, angDiff, osmNodes, classifyHint, updJoins, buildCues, reverseCues, parseHints, setTab, rebuildCues, setGrade, gradeArr, gBand, setScrub, scrubState, SC, nearestDist, importGpx, parseGpx, backfillAll, interpEle, addWpt, makeGpx, simplify, climb, route, fillEle, naismith }; // for tests
