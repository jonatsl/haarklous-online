// How rough are the streets? (issue #112) Samples real streets in every map patch and drives a car along them.
//   node tools/road-roughness.cjs            -> a table: before (the raw height grids) and now (road-surface.js)
//   require('./tools/road-roughness.cjs')    -> {load, STREETS, measure, ride, pick} for tests/roads.test.cjs
// Numbers per street (1 m steps along the centre line, 10 m in from the ends):
//   rms2 / max2  second difference of the height (mm): how much the slope changes from one metre to the next (bumps)
//   step         largest height change over 10 cm (mm): a real step
//   cross        cross-fall across the lane width (%, RMS) and how much it changes per metre (wobble, %)
//   ride40/60    a car (the game's Vehicle.settle, 4.2 m long, wheels 1.2 m apart) at 40 / 60 km/h in the right lane:
//                vertical acceleration (m/s², RMS and max), frames in the air (%), roll rate (deg/s, RMS)
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

const STREETS = [
  {name: 'Vogts gate', where: 'square'},
  {name: 'Sandakerveien', where: 'square'},
  {name: 'Trondheimsveien', where: 'gamle-oslo'},
  {name: 'Thorvald Meyers gate', where: 'gamle-oslo'},
  {name: 'Agathe Grøndahls gate', where: 'square'},// a small Torshov side street
  {name: 'Hegermanns gate', where: 'square'},
  {name: 'Grønlandsleiret', where: 'gamle-oslo'},
  {name: 'Ulvenveien', where: 'okern'},
  {name: 'Sinsenveien', where: 'loren'},
  {name: 'Treschows gate', where: 'myrens'},
  {name: 'Økernveien', where: 'gamle-oslo'},
];

let cached = null;
function load() {
  if (cached) return cached;
  global.window = globalThis;
  require(path.join(ROOT, 'surroundings-data.js'));
  for (const f of ['gamle-oslo-data.js', 'myrens-data.js', 'loren-data.js', 'okern-data.js']) require(path.join(ROOT, f));
  const District = require(path.join(ROOT, 'district.js')), RS = require(path.join(ROOT, 'road-surface.js')), CT = require(path.join(ROOT, 'city-textures.js'));
  const D = window.SURROUNDINGS, districts = window.DISTRICTS.map(d => District.decode(d));
  const b = Buffer.from(D.terrain.dm, 'base64'), raw = new Int16Array(b.buffer, b.byteOffset, b.length / 2), h = new Float32Array(raw.length);for (let i = 0; i < raw.length; i++) h[i] = raw[i] / 10;
  const W = RS.world({square: {h, n: D.terrain.n, half: D.terrain.half, step: D.terrain.step, roads: D.roads}, districts, DZ: District});
  const t0 = Date.now();
  const surface = RS.create({...W, slabsAt: (x, s) => ['lokka', 'toyen', 'gronland', 'kampen', 'bjorvika'].includes(CT.zoneAt(x, s))});
  cached = {D, districts, District, RS, W, surface, natural: W.natural, ms: Date.now() - t0};
  return cached;
}
const patchOf = (L, x, s) => {if (Math.abs(x) <= 800 && Math.abs(s) <= 800) return 'square';const d = L.districts.find(q => L.District.covers(q, x, s));return d ? d.name : null;};
// The longest chain of that name in that patch.
function pick(L, name, where) {
  let best = null;
  for (const c of L.surface.chains) {
    if (c.n !== name) continue;const m = Math.floor(c.p.length / 4) * 2;if (patchOf(L, c.p[m], c.p[m + 1]) !== where) continue;
    if (!best || c.L > best.L) best = c;
  }
  return best;
}
// A point along the chain at arc length t, offset y to its right; and the direction there.
function along(c, t) {
  const n = c.p.length / 2;let k = 0;while (k < n - 2 && c.cum[k + 1] < t) k++;
  const ax = c.p[k * 2], as = c.p[k * 2 + 1], dx = c.p[k * 2 + 2] - ax, ds = c.p[k * 2 + 3] - as, l = Math.hypot(dx, ds), f = (t - c.cum[k]) / l;
  return {x: ax + dx * f, s: as + ds * f, fx: dx / l, fs: ds / l};
}
function measure(height, c, {lead = 10, maxLen = 600} = {}) {
  const t0 = lead, t1 = Math.min(c.L - lead, lead + maxLen), hs = [], cf = [];let step = 0;
  const yw = Math.max(.6, c.hw - .5);
  for (let t = t0; t <= t1; t += 1) {
    const p = along(c, t);hs.push(height(p.x, p.s));
    // right of the direction (x east, s south): (-fs, fx)
    const hl = height(p.x + p.fs * yw, p.s - p.fx * yw), hr = height(p.x - p.fs * yw, p.s + p.fx * yw);cf.push((hl - hr) / (2 * yw) * 100);
    for (let k = 0; k < 10 && t + (k + 1) * .1 <= t1; k++) {const a = along(c, t + k * .1), b = along(c, t + (k + 1) * .1);step = Math.max(step, Math.abs(height(b.x, b.s) - height(a.x, a.s)));}
  }
  let s2 = 0, m2 = 0;for (let i = 1; i + 1 < hs.length; i++) {const d = hs[i + 1] - 2 * hs[i] + hs[i - 1];s2 += d * d;m2 = Math.max(m2, Math.abs(d));}
  let sc = 0, sw = 0;for (let i = 0; i < cf.length; i++) {sc += cf[i] * cf[i];if (i) sw += (cf[i] - cf[i - 1]) ** 2;}
  return {len: t1 - t0, rms2: Math.sqrt(s2 / Math.max(1, hs.length - 2)) * 1000, max2: m2 * 1000, step: step * 1000, cross: Math.sqrt(sc / cf.length), wobble: Math.sqrt(sw / Math.max(1, cf.length - 1)), rise: hs[hs.length - 1] - hs[0]};
}
// The right lane as its own polyline (each vertex moved along the corner's mean normal), so the car's path has no jumps.
function lanePath(c, lane) {
  const n = c.p.length / 2, p = [], dir = k => {const dx = c.p[k * 2 + 2] - c.p[k * 2], ds = c.p[k * 2 + 3] - c.p[k * 2 + 1], l = Math.hypot(dx, ds);return [dx / l, ds / l];};
  for (let k = 0; k < n; k++) {
    const a = dir(Math.max(0, k - 1)), b = dir(Math.min(n - 2, k)), m = [a[0] + b[0], a[1] + b[1]], l = Math.hypot(...m) || 1, cosh = Math.max(.5, (m[0] * b[0] + m[1] * b[1]) / l);
    p.push(c.p[k * 2] - m[1] / l * lane / cosh, c.p[k * 2 + 1] + m[0] / l * lane / cosh);
  }
  const cum = [0];for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(p[k * 2] - p[k * 2 - 2], p[k * 2 + 1] - p[k * 2 - 1]));
  return {p, cum, L: cum[n - 1]};
}
// The game's Vehicle.settle (game-vehicles.js, flies = true) for a car driving the right lane at `kmh`.
function ride(height, c, kmh, {lead = 10, maxLen = 600} = {}) {
  const v = kmh / 3.6, dt = 1 / 60, L = 4.2 * .4, W = .6, G = 9.81, path = lanePath(c, c.hw / 2);
  const t0 = lead, t1 = Math.min(path.L - lead, lead + maxLen);
  let y, vy = 0, prev, airT = 0, air = 0, frames = 0, ys = [], rolls = [];
  for (let t = t0; t <= t1; t += v * dt) {
    const p = along(path, t), cx = p.x, cs = p.s, rx = -p.fs, rs = p.fx;
    const hf = height(cx + p.fx * L, cs + p.fs * L), hb = height(cx - p.fx * L, cs - p.fs * L), hl = height(cx - rx * W, cs - rs * W), hr = height(cx + rx * W, cs + rs * W);
    const g0 = (hf + hb) / 2;rolls.push(Math.atan2(hl - hr, 2 * W));
    if (y === undefined) {y = g0;prev = g0;ys.push(y);continue;}
    const gv = Math.max(-25, Math.min(25, (g0 - prev) / dt)), free = y + vy * dt - .5 * G * dt * dt;
    if (free > g0) {y = free;vy -= G * dt;airT += dt;if (airT > .06 && y - g0 > .03) air++;} else {y = g0;vy = gv;airT = 0;}
    prev = g0;ys.push(y);frames++;
  }
  let sa = 0, ma = 0;for (let i = 1; i + 1 < ys.length; i++) {const a = (ys[i + 1] - 2 * ys[i] + ys[i - 1]) / (dt * dt);sa += a * a;ma = Math.max(ma, Math.abs(a));}
  let sr = 0;for (let i = 1; i < rolls.length; i++) sr += ((rolls[i] - rolls[i - 1]) / dt * 180 / Math.PI) ** 2;
  return {acc: Math.sqrt(sa / Math.max(1, ys.length - 2)), accMax: ma, air: air / Math.max(1, frames) * 100, roll: Math.sqrt(sr / Math.max(1, rolls.length - 1))};
}
function table() {
  const L = load(), rows = [];
  for (const st of STREETS) {
    const c = pick(L, st.name, st.where);if (!c) {rows.push(`${st.name} (${st.where}): not found`);continue;}
    for (const [label, h] of [['before', L.natural], ['now', L.surface.height]]) {
      const m = measure(h, c), r4 = ride(h, c, 40), r6 = ride(h, c, 60);
      rows.push([`${st.name.padEnd(22)} ${st.where.padEnd(10)} ${c.k.padEnd(11)} ${String(Math.round(m.len)).padStart(4)} m ${label.padEnd(6)}`,
        `rms2 ${m.rms2.toFixed(1).padStart(5)} max2 ${m.max2.toFixed(0).padStart(4)} step ${m.step.toFixed(0).padStart(3)} | cross ${m.cross.toFixed(2).padStart(5)} % wobble ${m.wobble.toFixed(2).padStart(5)} |`,
        `40: acc ${r4.acc.toFixed(2).padStart(5)} max ${r4.accMax.toFixed(1).padStart(5)} air ${r4.air.toFixed(1).padStart(4)} % roll ${r4.roll.toFixed(1).padStart(5)} | 60: acc ${r6.acc.toFixed(2).padStart(5)} max ${r6.accMax.toFixed(1).padStart(5)} air ${r6.air.toFixed(1).padStart(4)} % roll ${r6.roll.toFixed(1).padStart(5)}`].join(' '));
    }
  }
  return rows;
}
if (require.main === module) {const L = load();console.log(`road surface: ${L.surface.stats.chains} streets, built in ${L.ms} ms`);for (const r of table()) console.log(r);}
module.exports = {load, STREETS, measure, ride, pick, along};
