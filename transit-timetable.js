/* Trams, buses and the metro on a timetable (issue #111) – the pure part (Node-tested in tests/transit.test.cjs).
 *
 * Every vehicle's place is a function of the clock alone (mp.net.serverNow() online, Date.now() offline), like the jump flight
 * in game-skydive.js, so everybody in a lobby sees the same tram at the same place and the server keeps nothing.
 *
 * TransitTimetable.decode(TRANSIT) -> {lines, places, poles, stations, names}
 *   line {i, mode 'tram'|'bus'|'metro', ref, colour, artic, night, hw {day, evening, sunday, night}, dirs}
 *   dir {line, i, to, from (names), n samples every STEP = 2 m: X, S (local x, s), TA / TD (seconds from departure: arrival at /
 *     leaving each sample), V (m/s), stops [{place, pole, k (sample), d, name}], names (all real stops, also outside the world),
 *     tunnel (Uint8Array per sample), start (first sample used), end (last), pre (s waiting at a first stop that is a terminus),
 *     post (s at a last stop that is a terminus), phase (s), run (seconds from departure to gone)}
 * profile(dir, mode) fills TA / TD / V: accelerate, cruise (slower in curves), brake, DWELL s at every stop with the doors open.
 * osloOffset(ms) (CET / CEST, EU rule), serviceDay(ms) -> {day, dow, midnight (UTC ms of 00:00 Oslo that date)}; a service day
 *   runs from 04:00 to 04:00.
 * periods(line, dow) -> [[from min, to min, headway min]] (minutes after the service day's midnight; > 1440 is after midnight).
 * departures(dir, day) -> UTC ms of every departure from the line's start that day (phase + k × headway inside each period).
 * at(dir, tau) -> {d, k, v, doors 0..1, dwelling, stop (index into dir.stops it is at or next comes to), gone}
 * runsAt(dir, ms) -> [{dep, tau, key}]  the runs on the line now (key = 'line.dir.dep seconds', the same on every computer)
 * nextArrivals(dir, stopIndex, ms, count) -> [UTC ms]  the next arrivals at that stop (a vehicle standing there counts).
 * choosePhases(lines) staggers the lines that share a stop so two vehicles seldom stand at the same pole at once
 *   (the generator stores the result; pass it on decode as data.phases).
 * pointAt(dir, d) -> {x, s, hx, hs}  (heading unit vector) anywhere on the line (extrapolated past its ends).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TransitTimetable = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const STEP = 2, DWELL = 20, PRE = 90, POST = 40, DOOR = 1.6;
  // Speeds in m/s: tram 45 km/h, bus 45 km/h, metro 70 km/h; accelerations m/s²; lat = the sideways pull allowed in a curve.
  const MODE = {
    tram: {vmax: 12.5, acc: 1.0, dec: 1.1, lat: 0.9, len: 33.3},
    bus: {vmax: 12.5, acc: 1.1, dec: 1.2, lat: 1.2, len: 12},
    metro: {vmax: 19.5, acc: 1.0, dec: 1.0, lat: 0.8, len: 108.5}
  };
  // ---------- Data ----------
  function decodePath(code) {
    const pts = [];let x = 0, s = 0;
    for (let i = 0; i < code.length; i += 2) {x += code[i];s += code[i + 1];pts.push([x / 10, s / 10]);}
    return pts;
  }
  function decode(data) {
    const names = data.names, phases = data.phases || {};
    const places = data.places.map(([n, x, s, metro], i) => ({i, name: names[n], x, s, metro: !!metro, poles: [], lines: []}));
    const poles = data.poles.map(([p, x, s, h, tram], i) => ({i, place: places[p], x, s, heading: h, tram: !!tram, serves: []}));
    poles.forEach(q => q.place.poles.push(q));
    const lines = data.lines.map((L, li) => {
      const line = {i: li, mode: L.mode, ref: L.ref, colour: L.colour, artic: !!L.artic, night: !!L.night, hw: L.hw, dirs: []};
      line.dirs = L.dirs.map((D, di) => {
        const pts = decodePath(D.path), cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const L0 = cum[cum.length - 1], n = Math.max(2, Math.floor(L0 / STEP) + 1);
        const X = new Float32Array(n), S = new Float32Array(n);
        for (let k = 0, j = 0; k < n; k++) {
          const d = k * STEP;while (j < pts.length - 2 && cum[j + 1] < d) j++;
          const seg = cum[j + 1] - cum[j] || 1, t = Math.max(0, Math.min(1, (d - cum[j]) / seg));
          X[k] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t;S[k] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t;
        }
        const tunnel = new Uint8Array(n);for (const [a, b] of D.tunnels || []) for (let k = Math.max(0, Math.round(a / STEP)); k <= Math.min(n - 1, Math.round(b / STEP)); k++) tunnel[k] = 1;
        const stops = [];
        for (const [p, d, pole, nm] of D.stops) {
          const k = Math.max(1, Math.min(n - 2, Math.round(d / STEP)));
          if (stops.length && k - stops[stops.length - 1].k < 3) continue;// two stop entries for one stop
          stops.push({place: p >= 0 ? places[p] : null, pole: pole >= 0 ? poles[pole] : null, k, d: k * STEP, name: p >= 0 ? places[p].name : names[nm]});
        }
        const dir = {line, i: di, key: li + '.' + di, to: names[D.to], from: names[D.from], n, X, S, stops, names: D.names.map(k => names[k]), tunnel, edge: D.edge || [1, 1], phase: phases[li + '.' + di] || 0};
        profile(dir, L.mode);
        for (const st of stops) {if (st.pole && !st.pole.serves.includes(dir)) st.pole.serves.push(dir);if (st.place && !st.place.lines.includes(line)) st.place.lines.push(line);}
        return dir;
      });
      return line;
    });
    const stations = (data.stations || []).map(st => ({...st, place: places[st.place], name: places[st.place].name}));
    return {lines, places, poles, stations, names, dirs: lines.flatMap(l => l.dirs)};
  }
  // ---------- The ride along one line ----------
  function curveCap(X, S, k, lat, vmax) {
    const a = Math.max(0, k - 4), b = Math.min(X.length - 1, k + 4);if (b - a < 4) return vmax;
    const ax = X[a], as = S[a], bx = X[k], bs = S[k], cx = X[b], cs = S[b];
    const A = Math.hypot(bx - ax, bs - as), B = Math.hypot(cx - bx, cs - bs), C = Math.hypot(cx - ax, cs - as);
    const area2 = Math.abs((bx - ax) * (cs - as) - (bs - as) * (cx - ax));
    if (area2 < 1e-6) return vmax;
    const R = A * B * C / (2 * area2);
    return Math.min(vmax, Math.sqrt(lat * R));
  }
  function profile(dir, mode) {
    const M = MODE[mode], n = dir.n, V = new Float32Array(n), cap = new Float32Array(n), TA = new Float32Array(n), TD = new Float32Array(n);
    const isStop = new Uint8Array(n);for (const st of dir.stops) isStop[st.k] = 1;
    // A line that begins (ends) inside the world begins (ends) at its first (last) stop, which is the terminus.
    const startsAtStop = !dir.edge[0] && dir.stops.length, endsAtStop = !dir.edge[1] && dir.stops.length;
    dir.start = startsAtStop ? dir.stops[0].k : 0;dir.end = endsAtStop ? dir.stops[dir.stops.length - 1].k : n - 1;
    for (let k = 0; k < n; k++) cap[k] = isStop[k] ? 0 : curveCap(dir.X, dir.S, k, M.lat, M.vmax);
    cap[dir.start] = startsAtStop ? 0 : cap[dir.start];cap[dir.end] = endsAtStop ? 0 : cap[dir.end];
    V[dir.start] = cap[dir.start];
    for (let k = dir.start + 1; k <= dir.end; k++) V[k] = Math.min(cap[k], Math.sqrt(V[k - 1] * V[k - 1] + 2 * M.acc * STEP));
    for (let k = dir.end - 1; k >= dir.start; k--) V[k] = Math.min(V[k], Math.sqrt(V[k + 1] * V[k + 1] + 2 * M.dec * STEP));
    let t = 0;
    for (let k = 0; k < n; k++) {
      if (k < dir.start) {TA[k] = TD[k] = 0;continue;}
      TA[k] = t;TD[k] = t + (isStop[k] && k !== dir.end && k !== dir.start ? DWELL : 0);
      if (k < dir.end) t = TD[k] + STEP / Math.max(.25, (V[k] + V[k + 1]) / 2);
    }
    for (let k = dir.end + 1; k < n; k++) TA[k] = TD[k] = t;
    dir.TA = TA;dir.TD = TD;dir.V = V;dir.isStop = isStop;
    dir.pre = startsAtStop ? PRE : 0;dir.post = endsAtStop ? POST : 0;
    dir.run = TA[dir.end] + dir.post;
    dir.stopTimes = dir.stops.map(st => TA[st.k]);
  }
  // Where the vehicle is tau seconds after it left the start (tau < 0: still waiting at a terminus).
  function at(dir, tau) {
    const {TA, TD, V, n} = dir;
    if (tau < 0) {
      if (tau < -dir.pre) return null;
      const open = Math.max(0, Math.min(1, (tau + dir.pre - 20) / DOOR, (-tau - 3) / DOOR));
      return {d: dir.start * STEP, k: dir.start, v: 0, doors: open, dwelling: true, stop: 0, gone: false};
    }
    if (tau >= dir.run) return null;
    if (tau >= TA[dir.end]) {// at the last stop (a terminus inside the world): doors open, then out of service
      const w = tau - TA[dir.end], open = Math.max(0, Math.min(1, (w - 1) / DOOR, (dir.post - 4 - w) / DOOR));
      return {d: dir.end * STEP, k: dir.end, v: 0, doors: dir.post ? open : 0, dwelling: !!dir.post, stop: dir.stops.length - 1, gone: !dir.post};
    }
    let lo = dir.start, hi = dir.end;
    while (hi - lo > 1) {const m = (lo + hi) >> 1;if (TA[m] <= tau) lo = m;else hi = m;}
    const k = lo, stop = nextStop(dir, k);
    if (tau < TD[k]) {
      const w = tau - TA[k], dw = TD[k] - TA[k], open = Math.max(0, Math.min(1, (w - 1) / DOOR, (dw - 2 - w) / DOOR));
      return {d: k * STEP, k, v: 0, doors: open, dwelling: true, stop, gone: false};
    }
    const u = tau - TD[k], T = TA[k + 1] - TD[k], v0 = V[k], v1 = V[k + 1];
    const a = T > 1e-6 ? (v1 - v0) / T : 0, d = Math.min(STEP, v0 * u + .5 * a * u * u);
    return {d: k * STEP + d, k, v: v0 + a * u, doors: 0, dwelling: false, stop, gone: false};
  }
  function nextStop(dir, k) {
    const s = dir.stops;let lo = 0, hi = s.length;
    while (lo < hi) {const m = (lo + hi) >> 1;if (s[m].k < k) lo = m + 1;else hi = m;}
    return lo;// the stop at sample k or the next one after it (s.length = none left)
  }
  function pointAt(dir, d) {
    const {X, S, n} = dir;let k = Math.floor(d / STEP);
    const k0 = Math.max(0, Math.min(n - 2, k)), t = d / STEP - k0;
    const hx0 = X[k0 + 1] - X[k0], hs0 = S[k0 + 1] - S[k0], L = Math.hypot(hx0, hs0) || 1;
    return {x: X[k0] + hx0 * t, s: S[k0] + hs0 * t, hx: hx0 / L, hs: hs0 / L};
  }
  // ---------- Clock and timetable ----------
  function lastSunday(year, month) {const d = new Date(Date.UTC(year, month + 1, 0));return Date.UTC(year, month, d.getUTCDate() - d.getUTCDay(), 1);}
  function osloOffset(ms) {
    const y = new Date(ms).getUTCFullYear();
    return ms >= lastSunday(y, 2) && ms < lastSunday(y, 9) ? 7200000 : 3600000;
  }
  function serviceDay(ms) {
    const local = ms + osloOffset(ms), day = Math.floor((local - 4 * 3600000) / 86400000);
    return {day, dow: ((day % 7) + 7 + 4) % 7, midnight: day * 86400000 - osloOffset(day * 86400000 + 12 * 3600000)};// 1 Jan 1970 was a Thursday
  }
  // Headway periods of a service day. dow 0 = Sunday. Evening and early runs are multiples of the day headway, so a line's
  // departures stay on one grid and the staggering between lines holds all day.
  function periods(line, dow) {
    const h = line.hw, base = h.day;
    if (line.night) return (dow === 5 || dow === 6) ? [[1500, 1740, h.night || 30]] : [];
    if (line.mode === 'metro') {
      if (dow === 0) return [[420, 540, base * 2], [540, 1380, base], [1380, 1470, base * 2]];
      if (dow === 6) return [[360, 480, base * 2], [480, 1380, base], [1380, 1500, base * 2]];
      return [[320, 360, base * 2], [360, 1380, base], [1380, 1485, base * 2]];
    }
    if (line.mode === 'tram') {
      const eve = h.evening || base * 2, sun = h.sunday || base * 1.5;
      if (dow === 0) return [[420, 600, eve], [600, 1140, sun], [1140, 1470, eve]];
      if (dow === 6) return [[360, 540, eve], [540, 1140, base], [1140, 1480, eve]];
      return [[330, 390, eve], [390, 1140, base], [1140, 1480, eve]];
    }
    if (!base) return [];
    const late = base * 3;
    if (dow === 0) return [[480, 660, base * 2], [660, 1140, base], [1140, 1320, base * 2], [1320, 1485, late]];
    if (dow === 6) return [[390, 540, base * 2], [540, 1140, base], [1140, 1320, base * 2], [1320, 1485, late]];
    return [[330, 390, base * 2], [390, 1140, base], [1140, 1320, base * 2], [1320, 1485, late]];
  }
  const depCache = new Map();
  function departures(dir, day) {
    const key = dir.key + ':' + day;let out = depCache.get(key);if (out) return out;
    if (depCache.size > 600) depCache.clear();
    const dow = ((day % 7) + 7 + 4) % 7, mid = day * 86400000 - osloOffset(day * 86400000 + 12 * 3600000), ph = dir.phase / 60;
    out = [];
    for (const [a, b, H] of periods(dir.line, dow)) {
      for (let m = Math.ceil((a - ph) / H) * H + ph; m < b - 1e-9; m += H) out.push(Math.round(mid + m * 60000));
    }
    out.sort((x, y) => x - y);
    depCache.set(key, out = out.filter((v, i) => i === 0 || v !== out[i - 1]));
    return out;
  }
  function runsAt(dir, ms) {
    const sd = serviceDay(ms).day, res = [], lo = ms - dir.run * 1000, hi = ms + dir.pre * 1000;
    for (let day = sd - 1; day <= sd; day++) for (const dep of departures(dir, day)) if (dep > lo && dep <= hi) res.push({dep, tau: (ms - dep) / 1000, key: dir.key + '.' + Math.round(dep / 1000)});
    return res;
  }
  function nextArrivals(dir, si, ms, count = 4) {
    const off = dir.stopTimes[si] * 1000, sd = serviceDay(ms).day, out = [];
    const dwell = dir.TD[dir.stops[si].k] - dir.TA[dir.stops[si].k];
    for (let day = sd - 1; day <= sd + 2 && out.length < count; day++) for (const dep of departures(dir, day)) {
      const t = dep + off;if (t + dwell * 1000 >= ms && out.length < count && !out.includes(t)) out.push(t);
    }
    return out.sort((a, b) => a - b).slice(0, count);
  }
  // ---------- Staggering lines that share a stop ----------
  function choosePhases(lines) {
    const out = {}, placed = [];// [{pole, t (s from phase 0), H (s)}]
    const dirs = lines.flatMap(l => l.dirs.map(d => ({l, d}))).sort((a, b) => (a.l.hw.day || 99) - (b.l.hw.day || 99) || a.d.key.localeCompare(b.d.key));
    for (const {l, d} of dirs) {
      const H = (l.hw.day || l.hw.night || 30) * 60, cands = [];
      const own = d.stops.map((st, i) => ({pole: st.pole ? st.pole.i : (st.place && l.mode === 'metro' ? 'm' + st.place.i + ':' + Math.round(d.X[st.k] / 6) + ':' + Math.round(d.S[st.k] / 6) : null), t: d.stopTimes[i]})).filter(o => o.pole !== null);
      const near = placed.filter(p => own.some(o => o.pole === p.pole));
      let best = 0, score = Infinity;
      for (let ph = 0; ph < H; ph += 15) {
        let sc = 0;
        for (const o of own) for (const p of near) {
          if (p.pole !== o.pole) continue;
          const g = gcd(H, p.H), diff = ((((o.t + ph) - p.t) % g) + g) % g, sep = Math.min(diff, g - diff);
          if (sep < DWELL + 25) sc += (DWELL + 25 - sep);
        }
        if (sc < score - 1e-9) {score = sc;best = ph;}
      }
      out[d.key] = best;for (const o of own) placed.push({pole: o.pole, t: o.t + best, H});
    }
    return out;
  }
  function gcd(a, b) {a = Math.round(a);b = Math.round(b);while (b) [a, b] = [b, a % b];return a || 1;}
  return {STEP, DWELL, MODE, decode, decodePath, profile, at, nextStop, pointAt, osloOffset, serviceDay, periods, departures, runsAt, nextArrivals, choosePhases};
});
