/* Badges, the photo hunt (issue #58) and your best scores (issue #54).
 * Badges come from playing (finish the mission, a hole in one, win at paintball, land on the skydiving target, climb at
 * Klatreverket, kayak down Akerselva …) and from the photo hunt: find the known places and take a good photo of each –
 * the place in the picture (not at the very edge), big enough (close, or zoomed in) and nothing solid in the way.
 * Each new badge shows a short message and pays some kroner. The list (pause menu: R1 / B) shows the photo you took and a
 * hint for the places not found yet, and your best scores. Kept in localStorage 'haarklous-badges-v1' / 'haarklous-records-v1',
 * which are part of an account's saved progress (GameProgress).
 *
 * Pure (Node-tested):
 *   BADGES [{id, icon, name, how, kr, test(facts)}]   facts = {records, gym, kayak, route, lic, storgata, got}
 *   SPOTS  [{id, name, hint, kr, size, r, maxDist}]   size = the subject's height (m), r = its own radius (the sight line
 *                                                    stops r before its centre), maxDist = how close you must be; the game
 *                                                    adds at = {x, y, z} and, for a door, face = {x, z} (the way it faces)
 *   judge(spot, shot) -> {ok, why: 'far' | 'side' | 'frame' | 'small' | 'blocked', d}
 *        shot = {cam: {x, y, z}, fovY (degrees), ndc(p) -> {x, y, z} (projected, -1..1), blocked(from, to, stopShort) -> bool}
 *   record(records, kind, data) -> {best: bool}  updates records in place
 *   MERGE: how two copies of the two keys join (GameProgress.merge)
 * GameBadges.create({root, pay(kr, why), sound(name), read(key), labels}) -> badges:
 *   check(), record(kind, data), photo(shot, spots, canvas) -> text | null, open / close / toggle / scroll(dy), isOpen,
 *   reload(), count, total, records, got
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameBadges = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const KEY = 'haarklous-badges-v1', RECORDS = 'haarklous-records-v1', TARGET_R = 10, MIN_FRAC = .15, EDGE = .8;
  const LICENCE_COUNT = 8;// GameLicences.IDS (issue #59): B, A, C, maskinførerbevis, kranførerbevis, PPL(A), PPL(H), drone A1/A3
  const n = v => Number.isFinite(+v) ? +v : 0;
  const keys = o => Object.keys(o || {});

  const SPOTS = [
    {id: 'photo-oksen', name: 'Torshovoksen', hint: 'A bronze bull in a fountain on Hegermanns plass, about 550 m west of home.', size: 4.5, r: 6.5, maxDist: 40},
    {id: 'photo-hodet', name: 'HODET N.N.', hint: 'A 7 m bronze doll’s head at the north end of Torshovdalen.', size: 7, r: 3, maxDist: 60},
    {id: 'photo-deichman', name: 'Deichman Grünerløkka', hint: 'The library at Schous plass in Grünerløkka – full of books, and a librarian who hates noise.', size: 9, r: 16, maxDist: 70},
    {id: 'photo-klatreverket', name: 'Klatreverket Torshov', hint: 'The climbing centre in the old Myrens verksted workshops by Akerselva, about 1 km west.', size: 13, r: 22, maxDist: 90},
    {id: 'photo-rotunda', name: 'The Rotunda of bones', hint: 'Deep in the catacomb under Torshovdalen: a pillar of bones ringed with skulls.', size: 2.6, r: 1.2, maxDist: 14},
    {id: 'photo-muselunden', name: 'Muselunden', hint: 'The disc golf park east of Torshov: the basket of hole 1.', size: 1.6, r: .4, maxDist: 12},
    {id: 'photo-munch', name: 'MUNCH', hint: 'The leaning museum tower in Bjørvika, by the fjord.', size: 58, r: 30, maxDist: 350},
    {id: 'photo-opera', name: 'The Opera', hint: 'The white roof you can walk on, in Bjørvika.', size: 24, r: 55, maxDist: 300},
    {id: 'photo-rathkes', name: 'Rathkes gate 1', hint: 'The iron gate under the “1” on Rathkes gate in Grünerløkka.', size: 3.5, r: .6, maxDist: 20},
    {id: 'photo-home', name: 'Haarklous plass 17A', hint: 'Your own street door. Step back across the street to get it all in.', size: 7, r: 1, maxDist: 40}
  ].map(s => ({kr: 50, ...s}));

  const BADGES = [
    {id: 'mission', icon: '🎯', name: 'Hostage rescued', how: 'Finish the hostage-rescue mission (the red ring by the street door of 17A).', kr: 250, test: f => n(f.records.mission?.done) > 0},
    {id: 'ace', icon: '🥏', name: 'Hole in one', how: 'Hole a disc golf throw with the first throw.', kr: 200, test: f => n(f.records.aces) > 0},
    {id: 'muselunden', icon: '🌳', name: 'A full round at Muselunden', how: 'Play all 12 holes of Muselunden DiscGolfPark.', kr: 100,
      test: f => Object.entries(f.records.disc || {}).some(([c, r]) => /Muselunden/.test(c) && n(r.holes) >= 12)},
    {id: 'petanque', icon: '⚪', name: 'Beat Arne', how: 'Win a game of petanque against Arne in Torshovdalen.', kr: 100, test: f => n(f.records.petanque?.won) > 0},
    {id: 'paintball', icon: '🎨', name: 'Paintball winner', how: 'Win a paintball game against other players.', kr: 150, test: f => n(f.records.paintball?.won) > 0},
    {id: 'skydive', icon: '🪂', name: 'On target', how: `Land within ${TARGET_R} m of the landing target at the airstrip after a skydive.`, kr: 150,
      test: f => f.records.skydive?.best != null && f.records.skydive.best <= TARGET_R},
    {id: 'climb', icon: '🧗', name: 'Top out', how: 'Climb a route or a boulder problem at Klatreverket Torshov.', kr: 100, test: f => keys(f.gym.ticks).length > 0},
    {id: 'brattkort', icon: '🪢', name: 'Brattkort', how: 'Pass the belay test at Klatreverket.', kr: 100, test: f => !!f.gym.brattkort},
    {id: 'kayak', icon: '🛶', name: 'Down Akerselva', how: 'Paddle a kayak down Akerselva to Vaterland.', kr: 150, test: f => keys(f.kayak).length > 0},
    {id: 'pingpong', icon: '🏓', name: 'Beat Ola', how: 'Win a table tennis match against Ola at Schous plass.', kr: 100, test: f => n(f.records.pingpong?.won) > 0},
    {id: 'run', icon: '🏃', name: 'Ensjø → Rathkes gate', how: 'Finish the timed run from Ensjø T-bane to Rathkes gate.', kr: 100, test: f => f.route.best != null},
    {id: 'catacomb', icon: '💀', name: 'Into the dark', how: 'Go down into the catacomb under Torshovdalen.', kr: 50, test: f => !!f.records.marks?.catacomb},
    {id: 'moby', icon: '📖', name: 'Call me Ishmael', how: 'Open Moby-Dick at Deichman Grünerløkka.', kr: 50, test: f => !!f.records.marks?.moby},
    {id: 'fire', icon: '🔥', name: 'Keeper of the fire', how: 'Throw a log on the firepit in the park.', kr: 50, test: f => !!f.records.marks?.fire},
    {id: 'licence', icon: '🪪', name: 'Licensed', how: 'Pass a licence test: a driving licence, a machine or crane certificate, a pilot licence or the drone certificate.', kr: 100, test: f => keys(f.lic && f.lic.have).length > 0},
    {id: 'licences', icon: '🎓', name: 'Every licence', how: `Hold all ${LICENCE_COUNT} licences: classes B, A and C, the machine and crane certificates, PPL(A), PPL(H) and the drone certificate.`, kr: 300, test: f => keys(f.lic && f.lic.have).length >= LICENCE_COUNT},
    {id: 'airborne', icon: '🚁', name: 'Airborne', how: 'Fly the helicopter or the plane 50 m above the ground.', kr: 100, test: f => !!f.records.marks?.airborne},
    {id: 'hunter', icon: '📷', name: 'Photo hunter', how: 'Find and photograph every place in the photo hunt.', kr: 300, test: f => SPOTS.every(s => f.got[s.id])},
    // KIWI Storgata (issue #65): the regulars' quests and Sopp-Sigvald's four lessons.
    {id: 'storgata', icon: '🛒', name: 'Friend of Storgata', how: 'Help all five regulars outside Kiwi Storgata 33.', kr: 200,
      test: f => ['kjell', 'bente', 'tore', 'mona', 'even'].every(id => ((f.storgata || {}).q || {})[id]?.s === 'done')},
    {id: 'wizard', icon: '🍄', name: 'Mushroom apprentice', how: 'Learn all four magic powers from Sopp-Sigvald, the mushroom wizard in Storgata.', kr: 250,
      test: f => ['levitate', 'blink', 'gust', 'orb'].every(id => ((f.storgata || {}).powers || {})[id])}
  ];

  function judge(spot, shot) {
    const c = shot.cam, a = spot.at, d = Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z);
    if (d > spot.maxDist) return {ok: false, why: 'far', d};
    // A door counts from the front only (within 65° of the way it faces), not along the wall.
    if (spot.face) {const dx = c.x - a.x, dz = c.z - a.z;if ((dx * spot.face.x + dz * spot.face.z) / (Math.hypot(dx, dz) || 1) < Math.cos(65 * Math.PI / 180)) return {ok: false, why: 'side', d};}
    const p = shot.ndc(a);
    if (!(p.z > -1 && p.z < 1) || Math.abs(p.x) > EDGE || Math.abs(p.y) > EDGE) return {ok: false, why: 'frame', d};
    const frac = spot.size / (2 * Math.max(d, .1) * Math.tan(shot.fovY * Math.PI / 360));
    if (frac < MIN_FRAC) return {ok: false, why: 'small', d};
    if (shot.blocked(c, a, spot.r)) return {ok: false, why: 'blocked', d};
    return {ok: true, d, frac};
  }

  // Best scores. counts add up; best = the better one.
  function record(R, kind, x = {}) {
    const g = (k, init) => R[k] && typeof R[k] === 'object' ? R[k] : (R[k] = init);
    let best = false;
    if (kind === 'disc-hole') {if (x.strokes === 1) R.aces = n(R.aces) + 1;}
    else if (kind === 'disc-round') {
      const c = g('disc', {})[x.course] || (R.disc[x.course] = {});c.rounds = n(c.rounds) + 1;c.par = x.par;c.holes = Math.max(n(c.holes), x.holes);
      if (c.best == null || x.total < c.best) {c.best = x.total;best = true;}
    } else if (kind === 'petanque') {
      const p = g('petanque', {});if (x.won) p.won = n(p.won) + 1;else p.lost = n(p.lost) + 1;
      if (x.won && (!p.best || x.you - x.npc > p.best.you - p.best.npc)) {p.best = {you: x.you, npc: x.npc};best = true;}
    } else if (kind === 'paintball') {const p = g('paintball', {});p.played = n(p.played) + 1;if (x.won) p.won = n(p.won) + 1;}
    else if (kind === 'mission') {
      const m = g('mission', {});if (!x.success) {m.failed = n(m.failed) + 1;return {best};}
      m.done = n(m.done) + 1;if (x.time > 0 && (m.best == null || x.time < m.best)) {m.best = Math.round(x.time * 10) / 10;best = true;}
    } else if (kind === 'skydive') {
      const s = g('skydive', {});s.jumps = n(s.jumps) + 1;if (x.landing === 'soft') s.soft = n(s.soft) + 1;
      if (x.landing !== 'crash' && (s.best == null || x.dist < s.best)) {s.best = Math.round(x.dist * 10) / 10;best = true;}
    } else if (kind === 'pingpong') {const p = g('pingpong', {});if (x.won) p.won = n(p.won) + 1;else p.lost = n(p.lost) + 1;}
    else if (kind === 'mark') {g('marks', {})[x.id] = 1;}
    return {best};
  }

  const parse = t => {try {const v = JSON.parse(t);return v && typeof v === 'object' ? v : {};} catch {return {};}};
  const lower = (a, b) => a == null ? b ?? null : b == null ? a : Math.min(a, b);
  function mergeRecords(A, B, mode) {
    const a = parse(A), b = parse(B), out = {...b, ...a}, count = (x, y) => mode === 'move' ? n(x) + n(y) : Math.max(n(x), n(y));
    out.aces = count(a.aces, b.aces);
    const disc = {...(b.disc || {}), ...(a.disc || {})};
    for (const [c, y] of Object.entries(b.disc || {})) {const x = (a.disc || {})[c];if (x) disc[c] = {...y, ...x, rounds: count(x.rounds, y.rounds), holes: Math.max(n(x.holes), n(y.holes)), best: lower(x.best, y.best)};}
    out.disc = disc;
    for (const k of ['petanque', 'pingpong']) {
      const x = a[k] || {}, y = b[k] || {};out[k] = {...y, ...x, won: count(x.won, y.won), lost: count(x.lost, y.lost)};
      if (x.best || y.best) out[k].best = !x.best ? y.best : !y.best ? x.best : (x.best.you - x.best.npc >= y.best.you - y.best.npc ? x.best : y.best);
    }
    {const x = a.paintball || {}, y = b.paintball || {};out.paintball = {won: count(x.won, y.won), played: count(x.played, y.played)};}
    {const x = a.mission || {}, y = b.mission || {};out.mission = {done: count(x.done, y.done), failed: count(x.failed, y.failed), best: lower(x.best, y.best)};}
    {const x = a.skydive || {}, y = b.skydive || {};out.skydive = {jumps: count(x.jumps, y.jumps), soft: count(x.soft, y.soft), best: lower(x.best, y.best)};}
    out.marks = {...(b.marks || {}), ...(a.marks || {})};
    return JSON.stringify(out);
  }
  function mergeBadges(A, B) {
    const a = parse(A), b = parse(B), got = {...(b.got || {})};
    for (const [id, x] of Object.entries(a.got || {})) {const y = got[id];got[id] = !y ? x : {...y, ...x, at: Math.min(n(x.at) || Infinity, n(y.at) || Infinity), thumb: x.thumb || y.thumb};}
    return JSON.stringify({...b, ...a, got});
  }
  const MERGE = {[RECORDS]: mergeRecords, [KEY]: mergeBadges};

  // ---------- In the game ----------
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  function create({root, pay = () => {}, sound = () => {}, read, labels = {}}) {
    const load = (k) => {try {return parse(localStorage.getItem(k));} catch {return {};}};
    const store = (k, v) => {try {localStorage.setItem(k, JSON.stringify(v));} catch {}};
    read = read || load;
    let state = load(KEY), records = load(RECORDS);state.got = state.got || {};
    const toast = document.createElement('div');toast.id = 'badgeToast';toast.hidden = true;root.append(toast);
    const panel = document.createElement('section');panel.id = 'badges';panel.className = 'overlay';panel.hidden = true;root.append(panel);
    const queue = [];let toastT = 0;
    function showNext() {
      const b = queue.shift();if (!b) {toast.hidden = true;return;}
      toast.innerHTML = `${b.thumb ? `<img src="${b.thumb}" alt="">` : `<i>${b.icon || '🏅'}</i>`}<span><small>New badge</small><b>${esc(b.name)}</b><em>+${b.kr} kr</em></span>`;
      toast.hidden = false;toast.classList.remove('in');void toast.offsetWidth;toast.classList.add('in');clearTimeout(toastT);toastT = setTimeout(showNext, 4500);
    }
    function award(b, extra = {}) {
      if (state.got[b.id]) return false;
      state.got[b.id] = {at: Date.now(), ...extra};store(KEY, state);
      pay(b.kr, `New badge: ${b.name}`);sound('cheer');queue.push({...b, ...extra});if (toast.hidden) showNext();
      if (!panel.hidden) render();
      return true;
    }
    const facts = () => ({records, gym: read('haarklous-klatreverket-v1'), kayak: read('haarklous-kayak-v1'), route: read('haarklous-route-v1'), lic: read('haarklous-licences-v1'), storgata: read('haarklous-storgata-v1'), got: state.got});
    function check() {const f = facts();for (const b of BADGES) if (!state.got[b.id] && b.test(f)) award(b);}
    function addRecord(kind, data) {const r = record(records, kind, data);store(RECORDS, records);check();return r;}
    function thumbOf(canvas) {
      try {
        const c = document.createElement('canvas');c.width = 128;c.height = 72;const k = Math.max(128 / canvas.width, 72 / canvas.height), w = canvas.width * k, h = canvas.height * k;
        c.getContext('2d').drawImage(canvas, (128 - w) / 2, (72 - h) / 2, w, h);return c.toDataURL('image/jpeg', .6);
      } catch {return '';}
    }
    // A photo was just taken: does it count for a place in the photo hunt? Returns a message, or null far from every place.
    function photo(shot, spots, canvas) {
      const near = spots.filter(s => s.at).map(s => ({s, j: judge(s, shot)})).filter(x => x.j.d < x.s.maxDist * 1.6).sort((a, b) => a.j.d / a.s.maxDist - b.j.d / b.s.maxDist);
      const good = near.find(x => x.j.ok);
      if (good) {
        if (state.got[good.s.id]) return `Photo hunt: ${good.s.name} is already in your list.`;
        award({...good.s, icon: '📷'}, {thumb: thumbOf(canvas)});check();return null;
      }
      const x = near.find(x => !state.got[x.s.id]);if (!x) return null;
      return `Photo hunt · ${x.s.name}: ${{far: `come closer (within ${x.s.maxDist} m)`, side: 'take it from the front', frame: 'it is not in the picture – aim at it', small: 'it is too small in the picture – go closer or zoom in (L2, right stick)', blocked: 'something is in the way'}[x.j.why]}.`;
    }
    function render() {
      const R = records, f = facts(), all = [...SPOTS, ...BADGES], have = all.filter(b => state.got[b.id]).length;
      const when = id => {const g = state.got[id];return g && g.at ? new Date(g.at).toLocaleDateString() : '';};
      const spotsHtml = SPOTS.map(s => {const g = state.got[s.id];return `<li class="${g ? 'got' : ''}">${g && g.thumb ? `<img src="${g.thumb}" alt="">` : `<i>${g ? '📷' : '?'}</i>`}<b>${esc(s.name)}</b><small>${g ? `Found ${when(s.id)}` : esc(s.hint)}</small></li>`;}).join('');
      const badgesHtml = BADGES.map(b => `<li class="${state.got[b.id] ? 'got' : ''}"><i>${b.icon}</i><b>${esc(b.name)}</b><small>${esc(b.how)}${state.got[b.id] ? ` · ${when(b.id)}` : ` · ${b.kr} kr`}</small></li>`).join('');
      const rows = [];
      for (const [c, r] of Object.entries(R.disc || {})) rows.push([`Disc golf · ${c}`, `best ${r.best} throws (${r.best - r.par >= 0 ? '+' : ''}${r.best - r.par}) · ${r.rounds} round${r.rounds === 1 ? '' : 's'}`]);
      if (R.aces) rows.push(['Holes in one', String(R.aces)]);
      if (n(R.petanque?.won) + n(R.petanque?.lost)) rows.push(['Petanque against Arne', `${n(R.petanque.won)} won, ${n(R.petanque.lost)} lost${R.petanque.best ? ` · best ${R.petanque.best.you}–${R.petanque.best.npc}` : ''}`]);
      if (n(R.paintball?.played)) rows.push(['Paintball', `${n(R.paintball.won)} won of ${n(R.paintball.played)}`]);
      if (n(R.mission?.done) + n(R.mission?.failed)) rows.push(['Hostage rescue', `${n(R.mission.done)} rescued${R.mission.best != null ? ` · best time ${clock(R.mission.best)}` : ''}`]);
      if (n(R.skydive?.jumps)) rows.push(['Skydiving', `${n(R.skydive.jumps)} jumps, ${n(R.skydive.soft)} soft landings${R.skydive.best != null ? ` · closest to the target ${R.skydive.best} m` : ''}`]);
      if (n(R.pingpong?.won) + n(R.pingpong?.lost)) rows.push(['Table tennis against Ola', `${n(R.pingpong.won)} won, ${n(R.pingpong.lost)} lost`]);
      for (const [i, t] of Object.entries(f.kayak)) rows.push([`Kayak · ${(labels.kayak || [])[i] || `put-in ${+i + 1}`} → Vaterland`, clock(t)]);
      if (f.route.best != null) rows.push(['Ensjø → Rathkes gate', `${clock(f.route.best)} · ${n(f.route.runs)} runs`]);
      if (keys(f.gym.ticks).length || f.gym.bestHang) rows.push(['Klatreverket', `${keys(f.gym.ticks).length} routes and problems sent · hangboard ${n(f.gym.bestHang).toFixed(1)} s`]);
      panel.innerHTML = `<div class="panel"><span class="eyebrow">BADGES · ${have} OF ${all.length}</span><h2>Badges and best scores</h2>
        <h3>Photo hunt <small>${SPOTS.filter(s => state.got[s.id]).length} of ${SPOTS.length} · take a good photo of each place: in the picture, big enough, nothing in the way</small></h3><ul class="bd-spots">${spotsHtml}</ul>
        <h3>Badges <small>${BADGES.filter(b => state.got[b.id]).length} of ${BADGES.length}</small></h3><ul class="bd-list">${badgesHtml}</ul>
        <h3>Best scores</h3>${rows.length ? `<dl class="bd-records">${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>` : '<p class="small">Nothing yet – play a minigame, the mission or a run.</p>'}
        <p class="small">Left stick / ↑↓ scroll · ○ / Esc / R1 / B close</p><button id="badgesClose">Close</button></div>`;
      panel.querySelector('#badgesClose').onclick = () => api.close();
    }
    const api = {
      check, record: addRecord, photo, render, MERGE,
      open() {render();panel.hidden = false;panel.querySelector('.panel').scrollTop = 0;},
      close() {panel.hidden = true;},
      toggle() {if (panel.hidden) api.open();else api.close();},
      scroll(dy) {const p = panel.querySelector('.panel');if (p) p.scrollTop += dy;},
      reload() {state = load(KEY);state.got = state.got || {};records = load(RECORDS);if (!panel.hidden) render();},
      get isOpen() {return !panel.hidden;}, get records() {return records;}, get got() {return state.got;},
      get count() {return [...SPOTS, ...BADGES].filter(b => state.got[b.id]).length;}, total: SPOTS.length + BADGES.length
    };
    return api;
  }
  return {BADGES, SPOTS, judge, record, mergeRecords, mergeBadges, MERGE, TARGET_R, LICENCE_COUNT, create};
});
