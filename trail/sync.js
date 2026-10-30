/* Trail Planner – optional Supabase sync for Saved routes (offline-first).
 * localStorage stays the source the app reads; this file only merges it with the user's rows in Supabase.
 * Off (and its UI hidden) unless config.js sets SUPABASE_URL and SUPABASE_ANON_KEY. */
(() => {
  const URL_ = (window.SUPABASE_URL || "").trim(), KEY_ = (window.SUPABASE_ANON_KEY || "").trim();
  const SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
  const REDIRECT = location.hostname === "njakobs1970.github.io" ? "https://njakobs1970.github.io/trail-apps/trail/" : location.origin + location.pathname;
  const $ = id => document.getElementById(id), FLAG = "tp-sync";
  const toast = (t, ms) => window.toast && window.toast(t, ms);

  /* rows <-> library items --------------------------------------------------- */
  const toItem = (r, kind) => ({ id: r.id, kind, updated: Date.parse(r.updated_at) || 0, deleted: !!r.deleted,
    meta: r.deleted ? null : kind === "route" ? (r.data && r.data.meta) : r.data, data: kind === "route" && !r.deleted ? r.data && r.data.route : undefined });
  const toRow = it => it.kind === "route"
    ? { id: it.id, data: it.deleted ? null : { meta: it.meta, route: it.data }, folder_id: it.deleted ? null : (it.meta && it.meta.folder) || null, updated_at: new Date(it.updated).toISOString(), deleted: !!it.deleted }
    : { id: it.id, data: it.deleted ? null : it.meta, updated_at: new Date(it.updated).toISOString(), deleted: !!it.deleted };

  /** One full sync against any client with the supabase-js query shape (real or mocked). */
  async function syncWith(client) {
    const cols = "id,data,updated_at,deleted";
    const [r, f] = await Promise.all([client.from("routes").select(cols + ",folder_id"), client.from("folders").select(cols)]);
    if (r.error || f.error) throw (r.error || f.error);
    const remote = [...(f.data || []).map(x => toItem(x, "folder")), ...(r.data || []).map(x => toItem(x, "route"))];
    const { toLocal, toRemote } = TPLib.merge(TPLib.items(), remote);
    const good = toLocal.filter(x => x.deleted || (x.kind === "folder" ? x.meta : x.data && x.meta));
    if (good.length) TPLib.apply(good, true);
    const up = k => toRemote.filter(x => x.kind === k).map(toRow);
    for (const [t, rows] of [["folders", up("folder")], ["routes", up("route")]]) if (rows.length) { const res = await client.from(t).upsert(rows, { onConflict: "id" }); if (res.error) throw res.error }
    return { pulled: good.length, pushed: toRemote.length };
  }

  /* status ------------------------------------------------------------------- */
  let state = "", lastOk = 0;
  function status(s, detail) {
    state = s; const el = $("syncSt"); if (!el) return;
    el.className = "sync-st " + ({ synced: "ok", syncing: "busy", offline: "off", error: "err" }[s] || "");
    el.textContent = s ? { synced: "Synced", syncing: "Syncing…", offline: "Offline", error: "Sync error" }[s] : "";
    el.title = detail || (lastOk ? "Last synced " + new Date(lastOk).toLocaleTimeString() : "");
    const a = $("acctSync"); if (a) a.textContent = el.textContent + (lastOk ? " · last " + new Date(lastOk).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  }

  const API = { syncWith, toItem, toRow, changed() { }, enabled: !!(URL_ && KEY_) };
  window.TPSync = API;
  if (!API.enabled) return;                                    // no config: sync UI stays hidden, app works as before

  $("acctRow").hidden = false; $("libFoot").textContent = "Saved on this device · sign in to sync across devices";
  let sb = null, user = null, busy = false, again = false, t = 0, chan = null;
  function loadSdk() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return loadSdk.p || (loadSdk.p = new Promise((ok, no) => { const s = document.createElement("script"); s.src = SDK; s.onload = ok; s.onerror = () => { loadSdk.p = null; no(new Error("Couldn't load sign-in (offline?)")) }; document.head.appendChild(s) }));
  }
  async function client() {
    if (sb) return sb; await loadSdk();
    sb = window.supabase.createClient(URL_, KEY_, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } });
    sb.auth.onAuthStateChange((ev, ses) => {
      const u = ses && ses.user;
      if (u && (!user || user.id !== u.id)) { user = u; localStorage.setItem(FLAG, "1"); ui(); sync(); subscribe(); if (ev === "SIGNED_IN" && /access_token|code=/.test(location.href)) { history.replaceState(null, "", location.pathname); toast("Signed in as " + u.email) } }
      else if (!u && user) { user = null; localStorage.removeItem(FLAG); if (chan) { sb.removeChannel(chan); chan = null } ui(); status("") }
    });
    return sb;
  }
  async function sync() {
    if (!user) return; if (busy) { again = true; return }
    if (!navigator.onLine) return status("offline");
    busy = true; status("syncing");
    try { await syncWith(sb); lastOk = Date.now(); status("synced") }
    catch (e) { console.warn("sync failed", e); status(navigator.onLine ? "error" : "offline", e.message || String(e)) }
    busy = false; if (again) { again = false; sync() }
  }
  API.changed = () => { if (!user) return; clearTimeout(t); t = setTimeout(sync, 1500) };   // debounced push
  API.sync = sync;
  function subscribe() {
    if (chan || !sb.channel) return;
    try {
      const soon = () => { clearTimeout(t); t = setTimeout(sync, 800) };
      chan = sb.channel("tp-lib").on("postgres_changes", { event: "*", schema: "public", table: "routes" }, soon).on("postgres_changes", { event: "*", schema: "public", table: "folders" }, soon).subscribe();
    } catch (e) { chan = null }
  }
  function ui() {
    $("acctTxt").textContent = user ? user.email : "Sign in to sync";
    $("acctOut").hidden = !!user; $("acctIn").hidden = !user; if (user) $("acctMail").textContent = user.email;
    $("acctGoogle").hidden = !window.SUPABASE_GOOGLE;
  }
  $("acctBtn").onclick = async () => {
    ui(); $("acctDlg").showModal(); if (!user) setTimeout(() => $("acctEmail").focus(), 50); status(state);
    client().catch(e => toast(e.message));
  };
  $("acctCancel").onclick = $("acctDone").onclick = () => $("acctDlg").close();
  $("acctForm").onsubmit = async e => {
    e.preventDefault(); if (user) return;
    const em = $("acctEmail").value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { $("acctEmail").focus(); return toast("Enter your email address") }
    $("acctSend").disabled = true;
    try { const c = await client(); const { error } = await c.auth.signInWithOtp({ email: em, options: { emailRedirectTo: REDIRECT } }); if (error) throw error; $("acctDlg").close(); toast("Check your email for a sign-in link", 6000) }
    catch (err) { toast("Couldn't send the link: " + (err.message || err), 6000) }
    $("acctSend").disabled = false;
  };
  $("acctGoogle").onclick = async () => { try { const c = await client(); await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: REDIRECT } }) } catch (err) { toast("Google sign-in failed: " + (err.message || err)) } };
  $("acctOutBtn").onclick = async () => { if (!confirm("Sign out? Your routes stay on this device.")) return; await sb.auth.signOut(); $("acctDlg").close(); toast("Signed out") };
  $("acctNow").onclick = () => sync();
  addEventListener("focus", () => sync()); addEventListener("online", () => sync()); addEventListener("offline", () => user && status("offline"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync() });
  // load the SDK at start only if there is (or may be) a session: returning from a magic link, or signed in before
  if (localStorage.getItem(FLAG) || /access_token=|[?&]code=|error_description=/.test(location.href)) client().then(c => c.auth.getSession()).catch(e => status("offline", e.message));
  ui();
})();
