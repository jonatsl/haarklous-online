/* Saved progress (issue #54). Without an account the game keeps your progress in this browser as before (localStorage; the
 * photos in IndexedDB). Logged in, the same values are your account's: they come from the server when you log in, on any PC or
 * browser, and are saved there by themselves – every 20 s when something changed, and when the tab is hidden or closed.
 * The first time you log in on a browser that has progress of its own, the game asks whether to move it into the account:
 * money, bottles and the bag add up, the better best score wins, badges, licences, climbing ticks, the catacomb map and the photos join.
 * If you say no, it stays in this browser and comes back when you log out (and you are not asked again for that account).
 * Photos go to the account's own album on the server (at most 60, cloud/src/progress.js). Graphics settings stay per device.
 *
 * Pure (Node-tested):
 *   KEYS, SETTINGS                 the localStorage keys that are your progress (SETTINGS: the ones that are settings)
 *   collect(store) -> {key: text}  apply(store, data, keep) writes data and removes the other KEYS except those in keep
 *   hasProgress(data) -> bool      more than a fresh start (settings do not count)
 *   merge(account, browser, rules, mode) -> data   mode 'move' (log in: add the browser's) | 'sync' (the account was saved elsewhere)
 *   hashes(data) -> {key: hash}    diff(data, hashes) -> {set, del}    describe(data) -> {money, badges}
 * GameProgress.create({account, store, camera, ask(text) -> Promise<bool>, notice(text), rules, onApplied()}) -> sync:
 *   sync.userChanged(user)   after a log-in, a successful session check, or a log-out (user null)
 *   sync.beforeLogout()      saves while the session is still valid
 *   sync.save({keepalive})   sync.status (text for the pause menu)   sync.user
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameProgress = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const SETTINGS = ['haarklous-look-sensitivity-v1', 'haarklous-music-volume-v1', 'haarklous-minimap-v1'];
  // haarklous-storgata-v1 (issue #65): the quests of the people at Kiwi Storgata and the magic powers you have learned.
  const KEYS = ['haarklous-wallet-v1', 'haarklous-records-v1', 'haarklous-badges-v1', 'haarklous-kayak-v1', 'haarklous-route-v1',
    'haarklous-klatreverket-v1', 'haarklous-catacomb-map-v1', 'haarklous-licences-v1', 'haarklous-storgata-v1', ...SETTINGS];
  const META = 'haarklous-progress-sync-v1', GUEST = 'haarklous-progress-guest-v1', DECLINED = 'haarklous-progress-declined-v1';
  const START_MONEY = 500, SAVE_EVERY = 20, KEEPALIVE_MAX = 60000;

  const J = t => {try {return JSON.parse(t);} catch {return null;}};
  const plain = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const obj = t => plain(J(t));
  const num = v => Number.isFinite(+v) ? +v : 0;
  const hash = s => {let h = 0x811c9dc5;for (let i = 0; i < s.length; i++) {h ^= s.charCodeAt(i);h = Math.imul(h, 0x01000193);}return (h >>> 0).toString(36) + ':' + s.length;};

  function collect(store) {const out = {};for (const k of KEYS) {const v = store.getItem(k);if (v !== null && v !== undefined) out[k] = String(v);}return out;}
  function apply(store, data, keep = []) {
    for (const k of KEYS) {if (data && typeof data[k] === 'string') store.setItem(k, data[k]);else if (!keep.includes(k)) store.removeItem(k);}
  }
  const pick = (data, keys) => Object.fromEntries(Object.entries(data || {}).filter(([k]) => keys.includes(k)));
  const bitsSet = t => {try {return [...atob(String(t))].some(c => c.charCodeAt(0) !== 0);} catch {return false;}};
  function hasProgress(data) {
    for (const [k, t] of Object.entries(data || {})) {
      if (SETTINGS.includes(k) || !KEYS.includes(k)) continue;
      if (k === 'haarklous-wallet-v1') {const w = obj(t);if (num(w.money) !== START_MONEY || num(w.pant) > 0 || Object.values(w.bag || {}).some(n => num(n) > 0)) return true;continue;}
      if (k === 'haarklous-catacomb-map-v1') {if (bitsSet(t)) return true;continue;}
      if (k === 'haarklous-badges-v1') {if (Object.keys(obj(t).got || {}).length) return true;continue;}
      if (k === 'haarklous-licences-v1') {const l = obj(t);if (Object.keys(plain(l.have)).length || Object.keys(plain(l.theory)).length) return true;continue;}
      if (k === 'haarklous-route-v1') {const r = obj(t);if (r.best !== null && r.best !== undefined || num(r.runs) > 0) return true;continue;}
      if (k === 'haarklous-storgata-v1') {const g = obj(t);if (['q', 'powers', 'got'].some(f => Object.keys(g[f] || {}).length)) return true;continue;}
      if (Object.keys(obj(t)).length) return true;
    }
    return false;
  }
  function describe(data) {
    const w = obj((data || {})['haarklous-wallet-v1']), b = obj((data || {})['haarklous-badges-v1']);
    return {money: (data || {})['haarklous-wallet-v1'] ? num(w.money) : START_MONEY, badges: Object.keys(b.got || {}).length};
  }

  // How two copies of one value join (texts in, text out). 'move': a browser's progress goes into an account (amounts add up);
  // 'sync': the account was saved from another PC while this one had changes too (the account's amounts, the better of the rest).
  const minEach = (a, b) => {const o = {...b, ...a};for (const k of Object.keys(b)) if (k in a) o[k] = Math.min(num(a[k]), num(b[k]));return o;};
  const maxEach = (a, b) => {const o = {...b, ...a};for (const k of Object.keys(b)) if (k in a) o[k] = Math.max(num(a[k]), num(b[k]));return o;};
  const addEach = (a, b) => {const o = {...b, ...a};for (const k of Object.keys(b)) if (k in a) o[k] = num(a[k]) + num(b[k]);return o;};
  const better = (a, b, low) => a === null || a === undefined ? b ?? null : b === null || b === undefined ? a : low ? Math.min(a, b) : Math.max(a, b);
  const RULES = {
    'haarklous-wallet-v1': (a, b, mode) => {
      if (mode !== 'move') return a;const x = obj(a), y = obj(b);
      return JSON.stringify({money: num(x.money) + num(y.money), pant: num(x.pant) + num(y.pant), bag: addEach(x.bag || {}, y.bag || {})});
    },
    'haarklous-kayak-v1': (a, b) => JSON.stringify(minEach(obj(a), obj(b))),
    'haarklous-route-v1': (a, b, mode) => {const x = obj(a), y = obj(b);return JSON.stringify({...y, ...x, best: better(x.best, y.best, true), runs: mode === 'move' ? num(x.runs) + num(y.runs) : Math.max(num(x.runs), num(y.runs))});},
    'haarklous-klatreverket-v1': (a, b) => {
      const x = obj(a), y = obj(b);
      return JSON.stringify({...y, ...x, ticks: {...(y.ticks || {}), ...(x.ticks || {})}, tries: maxEach(x.tries || {}, y.tries || {}),
        bestHang: Math.max(num(x.bestHang), num(y.bestHang)), brattkort: x.brattkort || y.brattkort || undefined});
    },
    // Licences (issue #59): a licence or a passed theory part is never lost (the earlier date stays); the most failed tries.
    'haarklous-licences-v1': (a, b) => {
      const x = obj(a), y = obj(b), join = (p, q) => {p = plain(p);q = plain(q);const o = {...q, ...p};for (const k of Object.keys(q)) if (p[k] && q[k]) o[k] = String(p[k]) < String(q[k]) ? p[k] : q[k];return o;};
      return JSON.stringify({have: join(x.have, y.have), theory: join(x.theory, y.theory), fails: maxEach(plain(x.fails), plain(y.fails))});
    },
    'haarklous-catacomb-map-v1': (a, b) => {
      let p, q;try {p = atob(a);q = atob(b);} catch {return a;}
      let out = '';for (let i = 0; i < Math.max(p.length, q.length); i++) out += String.fromCharCode((p.charCodeAt(i) || 0) | (q.charCodeAt(i) || 0));
      return btoa(out);
    }
  };
  function merge(account, browser, rules = {}, mode = 'move') {
    const out = {...(account || {})};
    for (const [k, v] of Object.entries(browser || {})) {
      if (!KEYS.includes(k)) continue;
      if (!(k in out)) {out[k] = v;continue;}
      if (SETTINGS.includes(k)) {if (mode === 'move') out[k] = v;continue;}
      const rule = rules[k] || RULES[k];
      if (rule) try {out[k] = rule(out[k], v, mode);} catch {}
    }
    return out;
  }
  const hashes = data => Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, hash(v)]));
  function diff(data, synced = {}) {
    const set = {}, del = [];
    for (const [k, v] of Object.entries(data)) if (synced[k] !== hash(v)) set[k] = v;
    for (const k of Object.keys(synced)) if (!(k in data) && KEYS.includes(k)) del.push(k);
    return {set, del};
  }

  // ---------- The account's album: photos on the server ----------
  function accountAlbum(call) {
    return {
      remote: true,
      list: async () => (await call('GET', '/api/photos')).photos.map(p => ({id: p.id, place: p.place, src: `/api/photos/${p.id}`})),
      add: async p => {
        const blob = p.blob || await (await fetch(p.data)).blob();
        return call('PUT', `/api/photos/${p.id}?place=${encodeURIComponent(p.place || '')}`, blob);
      },
      remove: id => call('DELETE', `/api/photos/${id}`)
    };
  }

  function create({account, store, camera, ask, notice = () => {}, rules = {}, onApplied = () => {}}) {
    const read = k => J(store.getItem(k)), write = (k, v) => {try {if (v === null) store.removeItem(k);else store.setItem(k, JSON.stringify(v));} catch {}};
    let meta = read(META), user = null, saving = null, status = '', queue = Promise.resolve(), stopped = false;
    async function call(method, path, body, {keepalive = false} = {}) {
      const opts = {method, credentials: 'same-origin', keepalive, headers: {}};
      if (body instanceof Blob) {opts.body = body;opts.headers['Content-Type'] = 'image/jpeg';}
      else if (body !== undefined) {opts.body = JSON.stringify(body);opts.headers['Content-Type'] = 'application/json';}
      const r = await fetch(path, opts);let j = null;try {j = await r.json();} catch {}
      if (!r.ok) {const e = new Error((j && j.error) || `The server answered ${r.status}`);e.status = r.status;e.body = j;throw e;}
      return j;
    }
    const album = accountAlbum(call);
    const setStatus = s => {status = s;};
    function applyData(data, keep) {apply(store, data, keep);onApplied();}
    const clock = () => new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

    async function save({keepalive = false} = {}) {
      if (!user || !meta || meta.user !== user.id || stopped) return;
      if (saving) return saving;
      const data = collect(store), {set, del} = diff(data, meta.h);
      if (!Object.keys(set).length && !del.length) return;
      const body = {set, del};keepalive = keepalive && JSON.stringify(body).length < KEEPALIVE_MAX;
      saving = (async () => {
        try {
          const r = await call('PUT', '/api/progress', body, {keepalive});
          for (const [k, v] of Object.entries(set)) meta.h[k] = hash(v);for (const k of del) delete meta.h[k];
          meta.at = r.at;write(META, meta);setStatus(`Progress saved to your account at ${clock()}.`);
        } catch (e) {
          if (e.status === 401) {stopped = true;setStatus('Your login ran out – log in again to keep saving to your account.');}
          else setStatus(`Could not save to your account (${e.message}) – trying again soon.`);
        } finally {saving = null;}
      })();
      return saving;
    }

    // A browser's own progress meets the account (first log-in here, or after another account used this browser).
    async function join(u) {
      const server = await call('GET', '/api/progress'), local = collect(store);
      let photos = [];try {photos = await camera.local.all();} catch {}
      const browserHas = hasProgress(local) || photos.length > 0, declined = read(DECLINED) || [];
      let move = false;
      if (browserHas && !declined.includes(u.id)) {
        const d = describe(local), have = [d.money !== START_MONEY && `${d.money} kr`, d.badges && `${d.badges} badge${d.badges === 1 ? '' : 's'}`, photos.length && `${photos.length} photo${photos.length === 1 ? '' : 's'}`].filter(Boolean);
        move = await ask(`This browser has progress of its own${have.length ? ` (${have.join(', ')})` : ''}. Move it into your account “${u.name}”? ` +
          'Money, bottles and the bag add up, the better best scores win, and badges, climbing ticks, the catacomb map and photos join the account’s. ' +
          'If you keep it here, it comes back when you log out.');
      }
      // One synchronous block, so a tab closed in the middle can never leave the browser's copy marked as the account's.
      if (move) {
        write(GUEST, {data: pick(local, SETTINGS)});
        meta = {user: u.id, at: server.at, h: {}};write(META, meta);
        applyData(merge(server.data, local, rules, 'move'));
      } else {
        if (browserHas && !declined.includes(u.id)) write(DECLINED, [...declined, u.id].slice(-20));
        write(GUEST, {data: local});
        meta = {user: u.id, at: server.at, h: hashes(server.data)};write(META, meta);
        applyData({...pick(local, SETTINGS), ...server.data});
      }
      user = u;stopped = false;await save();
      await camera.useAlbum(album).catch(() => {});
      if (move && photos.length) await movePhotos(photos);
      setStatus(move ? 'This browser’s progress is now in your account and saves by itself.' : 'Your progress is saved to your account by itself.');
    }
    async function movePhotos(photos) {
      let moved = 0, full = false;
      for (const p of photos.sort((a, b) => a.id - b.id)) {
        try {await album.add(p);moved++;await camera.local.remove(p.id);}
        catch (e) {if (e.status === 409) {full = true;break;}}
      }
      await camera.useAlbum(album).catch(() => {});
      if (moved || full) notice(`${moved} photo${moved === 1 ? '' : 's'} moved into your account${full ? ` – the album is full (${album.limit || 60}); the rest stay in this browser` : ''}.`, 6);
    }
    // The browser already holds this account's progress (a reload while logged in): load newer saves made elsewhere.
    async function resume(u) {
      const server = await call('GET', '/api/progress'), local = collect(store);user = u;stopped = false;
      if (server.at > (meta.at || 0)) {
        const {set, del} = diff(local, meta.h), changed = Object.keys(set).length || del.length;
        const data = changed ? merge(server.data, pick(local, Object.keys(set)), rules, 'sync') : server.data;
        meta = {user: u.id, at: server.at, h: hashes(server.data)};write(META, meta);
        applyData({...pick(local, SETTINGS.filter(k => !(k in server.data))), ...data});
      }
      await save();await camera.useAlbum(album).catch(() => {});
      if (!status) setStatus('Your progress is saved to your account by itself.');
    }
    // Logged out: the browser's own progress comes back (or a fresh start with this browser's settings, if it was moved).
    function leave() {
      const g = read(GUEST);
      applyData(g && g.data ? g.data : pick(collect(store), SETTINGS));
      write(GUEST, null);write(META, null);meta = null;user = null;stopped = false;
      camera.useAlbum(null).catch(() => {});setStatus('');
    }
    function step(u) {
      if (!u) {if (meta) leave();return Promise.resolve();}
      if (meta && meta.user !== u.id) leave();
      return (meta ? resume(u) : join(u)).catch(e => {setStatus(`Could not load your progress (${e.message}).`);});
    }
    const sync = {
      userChanged: u => (queue = queue.then(() => step(u && u.id ? u : null))),
      beforeLogout: () => (queue = queue.then(() => save())),
      save, album,
      get user() {return user;}, get status() {return status;}, get linked() {return !!meta;}
    };
    if (typeof window !== 'undefined') {
      setInterval(() => {save();}, SAVE_EVERY * 1000);
      document.addEventListener('visibilitychange', () => {if (document.visibilityState === 'hidden') save({keepalive: true});});
      window.addEventListener('pagehide', () => save({keepalive: true}));
    }
    return sync;
  }
  return {KEYS, SETTINGS, START_MONEY, collect, apply, hasProgress, describe, merge, hashes, diff, hash, create, RULES};
});
