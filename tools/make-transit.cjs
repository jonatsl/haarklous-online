/* Make transit-data.js (issue #111): the real Ruter tram, bus and metro lines that run through the game world.
 *
 *   node tools/make-transit.cjs
 *
 * Reads assets/osm/transit-osm.json.gz (tools/fetch-transit.py: OpenStreetMap route relations, ODbL) and the world's walkable
 * rectangles (surroundings.js walkRects over the old square and the district patches). For every line it keeps one route
 * relation per direction (the one with most of its length in the world), joins its ways into one driving line, moves a bus
 * into the right-hand lane of a two-way road, rounds the corners, cuts the line to the world (from where it first enters to
 * where it last leaves) and puts each real stop on it (the stop position, or the platform, projected onto the line).
 * Stops with the same name close together are one stop place; each side of the street gets its own pole (the platform).
 * Metro stations: the station node, the platforms and the entrances (railway=subway_entrance) near it.
 * Headways: the relation's interval tags where OSM has them (trams 10 / evening 20 / Sunday 15, metro 15), else the table
 * BUS_HEADWAY below (Ruter's usual daytime frequency, rounded).
 * Output: transit-data.js (window.TRANSIT, also module.exports), local metres (x east, s south of Haarklous plass 17A).
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
global.window = global;
require(path.join(ROOT, 'surroundings-data.js'));window.District = require(path.join(ROOT, 'district.js'));
for (const f of ['gamle-oslo', 'myrens', 'loren', 'okern']) require(path.join(ROOT, `${f}-data.js`));
require(path.join(ROOT, 'surroundings.js'));
const D = window.SURROUNDINGS, DIST = window.DISTRICTS.map(d => window.District.decode(d));
const RECTS = window.Surroundings.walkRects(D.terrain.half, window.Surroundings.PLAY_HALF, DIST);
const osm = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'assets/osm/transit-osm.json.gz'))).toString());
const LAT0 = D.origin.lat, LON0 = D.origin.lon, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const loc = p => [(p.lon - LON0) * KX, (LAT0 - p.lat) * 111320];
const inWorld = (x, s, m = 0) => RECTS.some(r => x >= r.x0 - m && x <= r.x1 + m && s >= r.s0 - m && s <= r.s1 + m);
const nodes = new Map(), ways = new Map(), routes = [], masters = [];
for (const e of osm.elements) {
  if (e.type === 'node') nodes.set(e.id, e);
  else if (e.type === 'way') ways.set(e.id, {...(ways.get(e.id) || {}), ...e, tags: {...((ways.get(e.id) || {}).tags || {}), ...(e.tags || {})}});
  else if (e.tags && e.tags.type === 'route') routes.push(e);
  else if (e.tags && e.tags.type === 'route_master') masters.push(e);
}
// Ruter's usual daytime frequency in minutes (rounded; evenings double, early mornings and weekends a little less often).
const BUS_HEADWAY = {20: 6, 21: 6, 23: 8, 24: 10, 25: 6, 26: 10, 28: 10, 30: 8, 31: 5, 34: 10, 37: 8, 54: 10, 56: 20, '56B': 30, 58: 10, 60: 10, 66: 15, 67: 15, 68: 15,
  70: 10, 71: 15, 74: 10, 76: 10, '78A': 20, '78B': 20, 81: 15, 83: 15, 85: 20, 89: 30};
const ARTIC = new Set(['20', '21', '23', '25', '28', '30', '31', '37']);// lines Ruter runs with articulated (18 m) buses
const keepLine = t => {
  if (t.route === 'tram' || t.route === 'subway') return !!t.ref && t.network === 'Ruter';
  if (t.route !== 'bus' || !t.ref || !/^ruter$/i.test(t.network || '')) return false;
  return /^\d{2}[AB]?$/.test(t.ref) || /^\d{1,2}N$/.test(t.ref);
};
const r1 = v => Math.round(v * 10) / 10;
function dist(a, b) {return Math.hypot(a[0] - b[0], a[1] - b[1]);}
// Join a relation's ways into one line of points, each point with the tags of the way it came from.
function joinWays(rel) {
  const ws = rel.members.filter(m => m.type === 'way' && !/platform/.test(m.role) && m.geometry && m.geometry.length > 1);
  const pts = [], tags = [];
  let gaps = 0;
  for (let i = 0; i < ws.length; i++) {
    let g = ws[i].geometry.map(loc);
    const wt = (ways.get(ws[i].ref) || {}).tags || {};
    if (i === 0 && ws.length > 1) {
      const n = ws[1].geometry.map(loc), e0 = g[0], e1 = g[g.length - 1];
      const d0 = Math.min(dist(e0, n[0]), dist(e0, n[n.length - 1])), d1 = Math.min(dist(e1, n[0]), dist(e1, n[n.length - 1]));
      if (d0 < d1) g = g.reverse();
    } else if (pts.length) {
      const end = pts[pts.length - 1];if (dist(end, g[g.length - 1]) < dist(end, g[0])) g = g.reverse();
      if (dist(end, g[0]) > 30) gaps++;
      if (dist(end, g[0]) < .5) g = g.slice(1);
    }
    for (const p of g) {pts.push(p);tags.push(wt);}
  }
  return {pts, tags, gaps};
}
function cumulative(pts) {const c = [0];for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]));return c;}
// Resample a line every `step` metres, carrying a per-point value along.
function resample(pts, vals, step) {
  const c = cumulative(pts), L = c[c.length - 1], out = [], ov = [];
  let j = 0;
  for (let d = 0; d <= L + 1e-6; d += step) {
    while (j < pts.length - 2 && c[j + 1] < d) j++;
    const seg = c[j + 1] - c[j] || 1, t = Math.max(0, Math.min(1, (d - c[j]) / seg));
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);ov.push(vals[t < .5 ? j : j + 1]);
  }
  return {pts: out, vals: ov};
}
// Where on the line (metres from its start) a point projects, searching from `from` onwards (stops come in order).
function project(pts, c, p, from = 0) {
  // The first place along the line (from `from` on) that comes within 30 m of p, refined over the next 150 m: a line that
  // passes the same stop twice (a loop) gets each pass's stop in its own order.
  let best = null, bd = Infinity, until = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    if (c[i + 1] < from - 5) continue;
    if (c[i] > until) break;
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], ds = b[1] - a[1], L2 = dx * dx + ds * ds || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * ds) / L2)), q = [a[0] + dx * t, a[1] + ds * t], d = dist(p, q);
    if (d < bd - 1e-9) {bd = d;best = {d: c[i] + t * Math.sqrt(L2), off: d, side: Math.sign(dx * (p[1] - a[1]) - ds * (p[0] - a[0]))};}
    if (bd < 30 && until === Infinity) until = c[i] + 150;
  }
  return best;
}
const centroid = g => {const p = g.map(loc);return [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];};
// The right-hand lane's offset from a road's centre line (metres to the right of the direction of travel).
function laneOffset(mode, t, role) {
  if (mode !== 'bus' || !t.highway) return 0;
  const lanes = +t.lanes || 0, oneway = t.oneway === 'yes' || t.oneway === '-1' || t.junction === 'roundabout' || t.highway === 'motorway';
  if (oneway) return lanes >= 2 ? 1.6 : 0;
  if (t.highway === 'service' || t.highway === 'busway' && !lanes) return 1.5;
  return lanes >= 4 ? 4.8 : 1.7;
}
function smooth(pts, k) {
  if (k <= 0) return pts;
  return pts.map((p, i) => {
    if (i < k || i >= pts.length - k) return p;
    let x = 0, s = 0;for (let j = -k; j <= k; j++) {x += pts[i + j][0];s += pts[i + j][1];}
    return [x / (2 * k + 1), s / (2 * k + 1)];
  });
}
function simplify(pts, tol) {// Douglas–Peucker
  const keep = new Uint8Array(pts.length);keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();let idx = -1, md = tol;
    const A = pts[a], B = pts[b], dx = B[0] - A[0], ds = B[1] - A[1], L = Math.hypot(dx, ds) || 1;
    for (let i = a + 1; i < b; i++) {const d = Math.abs((pts[i][0] - A[0]) * ds - (pts[i][1] - A[1]) * dx) / L;if (d > md) {md = d;idx = i;}}
    if (idx > 0) {keep[idx] = 1;stack.push([a, idx], [idx, b]);}
  }
  return pts.filter((_, i) => keep[i]);
}
const nameOf = m => {const n = m.type === 'node' ? nodes.get(m.ref) : ways.get(m.ref);return (n && n.tags && (n.tags.name || n.tags['name:no'])) || null;};
// One route relation -> its driving line, stops and the full list of stop names.
function build(rel) {
  const t = rel.tags, mode = t.route === 'subway' ? 'metro' : t.route;
  const {pts: raw, tags, gaps} = joinWays(rel);if (raw.length < 2) return null;
  const off = tags.map(w => laneOffset(mode, w));
  const tun = tags.map(w => w.tunnel === 'yes' || w.tunnel === 'building_passage' && mode === 'metro' || (mode === 'metro' && w.layer && +w.layer < 0 && w.bridge !== 'yes') ? 1 : 0);
  const rs = resample(raw, raw.map((_, i) => i), 2);
  let P = rs.pts;
  // Lane offsets, eased over ±10 m where they change.
  const o = rs.vals.map(i => off[i]), oS = o.map((_, i) => {let a = 0, n = 0;for (let j = Math.max(0, i - 5); j <= Math.min(o.length - 1, i + 5); j++) {a += o[j];n++;}return a / n;});
  P = P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], ds = b[1] - a[1], L = Math.hypot(dx, ds) || 1;
    return [p[0] - ds / L * oS[i], p[1] + dx / L * oS[i]];// right of travel in (x east, s south) is (-ds, dx)
  });
  P = smooth(smooth(P, mode === 'bus' ? 3 : 2), mode === 'bus' ? 2 : 1);
  const tunAt = rs.vals.map(i => tun[i]);
  const c = cumulative(P), Ltot = c[c.length - 1];
  // Stops: stop positions (role stop*), else platforms, in the relation's order; each with its platform if there is one.
  const ms = rel.members.filter(m => m.type !== 'relation');
  const list = [];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];if (!/^(stop|platform)/.test(m.role)) continue;
    const name = nameOf(m) || (m.type === 'node' && nodes.get(m.ref) && nodes.get(m.ref).tags && nodes.get(m.ref).tags.name);
    const at = m.type === 'node' ? loc(m) : m.geometry ? centroid(m.geometry) : null;if (!at) continue;
    const last = list[list.length - 1];
    if (/^stop/.test(m.role)) {if (last && last.platform && !last.stop && (last.name === name || !name)) {last.stop = at;continue;}list.push({name, stop: at});}
    else {if (last && !last.platform && (last.name === name || !name || !last.name)) {last.platform = at;if (!last.name) last.name = name;continue;}list.push({name, platform: at});}
  }
  const all = list.filter(s => s.name);
  // Project in order.
  let from = 0;
  for (const s of all) {
    const q = project(P, c, s.stop || s.platform, from);
    if (q && q.off < 40) {s.d = q.d;from = q.d;if (s.platform) {const pq = project(P, c, s.platform, Math.max(0, q.d - 60));s.side = pq ? pq.side : 1;s.poff = pq ? pq.off : 3;}}
  }
  // Clip to the world: from where the line first comes inside to where it last leaves.
  const inside = P.map(p => inWorld(p[0], p[1], 20));
  const i0 = inside.indexOf(true), i1 = inside.lastIndexOf(true);if (i0 < 0 || c[i1] - c[i0] < 400) return null;
  const d0 = Math.max(0, c[i0] - 30), d1 = Math.min(Ltot, c[i1] + 30);
  const k0 = c.findIndex(v => v >= d0), k1 = c.findIndex(v => v >= d1 - 1e-6);
  const Pc = P.slice(k0, k1 + 1), tc = tunAt.slice(k0, k1 + 1), base = c[k0];
  const stops = all.filter(s => s.d !== undefined && s.d > d0 + (d0 > 0 ? 15 : -1) && s.d < d1 - (d1 < Ltot ? 5 : -1)).map(s => ({...s, d: s.d - base, inw: inWorld(...(s.platform || s.stop), 5)}));
  const tunnels = [];{let st = -1;for (let i = 0; i <= tc.length; i++) {const on = i < tc.length && tc[i];if (on && st < 0) st = i;if (!on && st >= 0) {tunnels.push([st * 2, (i - 1) * 2]);st = -1;}}}
  const firstIn = all.indexOf(stops[0]) >= 0 ? all.findIndex(s => s.name === (stops[0] || {}).name) : -1;
  return {rel, mode, ref: t.ref, to: t.to || (all[all.length - 1] || {}).name, from: t.from || (all[0] || {}).name, path: Pc, len: c[k1] - c[k0], inLen: c[i1] - c[i0], stops, names: all.map(s => s.name), tunnels, gaps, startsIn: inside[0] && i0 === 0, endsIn: inside[inside.length - 1]};
}
const built = routes.filter(r => keepLine(r.tags)).map(build).filter(Boolean);
// Pick one relation per direction for each line: the longest in the world, then the one running most the other way.
const lines = [], byLine = new Map();
for (const b of built) {const k = b.mode + ':' + b.ref;if (!byLine.has(k)) byLine.set(k, []);byLine.get(k).push(b);}
for (const [k, bs] of byLine) {
  bs.sort((a, b) => b.inLen - a.inLen || b.stops.length - a.stops.length);
  const A = bs[0];
  const score = b => {// how well b runs the other way along A's stops
    const an = A.stops.map(s => s.name), bn = b.stops.map(s => s.name);let common = 0;for (const n of bn) if (an.includes(n)) common++;
    const ia = bn.filter(n => an.includes(n)).map(n => an.indexOf(n));let rev = 0;for (let i = 1; i < ia.length; i++) if (ia[i] < ia[i - 1]) rev++;
    return common ? rev / Math.max(1, ia.length - 1) * 2 + common / Math.max(1, an.length) + b.inLen / A.inLen * .3 : 0;
  };
  const B = bs.slice(1).filter(b => b.to !== A.to && b.stops.filter(s => s.inw).length >= 2).sort((x, y) => score(y) - score(x))[0];
  const dirs = [A, ...(B && score(B) > .8 ? [B] : [])];
  if (A.stops.filter(s => s.inw).length < 2) continue;
  const t = A.rel.tags, master = null;
  const colour = (t.colour || (master && master.tags.colour) || (A.mode === 'bus' ? '#e60000' : '#0073db')).toLowerCase();
  const night = /N$/.test(A.ref);
  const hw = A.mode === 'bus' ? (night ? {day: 0, night: 30} : {day: BUS_HEADWAY[A.ref] || 15}) : {day: +t.interval || (A.mode === 'metro' ? 15 : 10), evening: t['interval:evening'] && t['interval:evening'] !== '-' ? +t['interval:evening'] : null, sunday: +t['interval:sunday'] || null};
  lines.push({mode: A.mode, ref: A.ref, colour, night, artic: A.mode === 'bus' && ARTIC.has(A.ref), hw, dirs});
}
lines.sort((a, b) => ['metro', 'tram', 'bus'].indexOf(a.mode) - ['metro', 'tram', 'bus'].indexOf(b.mode) || parseInt(a.ref) - parseInt(b.ref) || a.ref.localeCompare(b.ref));
// Stop places: the same name within 250 m (metro within 400 m); the poles are each direction's platform.
const places = [];
const placeFor = (name, at, mode) => {
  let p = places.find(q => q.name === name && dist(q.at, at) < (mode === 'metro' || q.metro ? 400 : 250));
  if (!p) {p = {name, at: [...at], pts: [], metro: mode === 'metro'};places.push(p);}
  p.pts.push(at);p.at = [p.pts.reduce((a, q) => a + q[0], 0) / p.pts.length, p.pts.reduce((a, q) => a + q[1], 0) / p.pts.length];
  if (mode === 'metro') p.metro = true;
  return p;
};
const poles = [];
for (const L of lines) for (const d of L.dirs) for (const s of d.stops) {
  if (!s.inw) continue;
  const p = placeFor(s.name, s.platform || s.stop, L.mode);s.place = p;
  if (L.mode === 'metro') continue;
  // The pole: on the platform (or 3 m to the right of the line when OSM has no platform), 0.6 m back from its edge.
  const c = cumulative(d.path), q = (() => {let i = 0;while (i < c.length - 2 && c[i + 1] < s.d) i++;return i;})();
  const a = d.path[q], b = d.path[q + 1], L2 = dist(a, b) || 1, dir = [(b[0] - a[0]) / L2, (b[1] - a[1]) / L2], t = (s.d - c[q]) / L2;
  const on = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], side = s.platform && s.side ? s.side : 1, out = Math.max(2.4, Math.min(6, s.platform ? s.poff + .8 : 3.2));
  const at = [on[0] - dir[1] * out * side, on[1] + dir[0] * out * side], heading = Math.atan2(dir[0], dir[1]);
  // one pole for a tram and a bus stop at the same spot (it shows both)
  let pole = poles.find(q => q.place === p && dist(q.at, at) < 6);
  if (!pole) {pole = {place: p, at, heading, side, mode: L.mode, serves: []};poles.push(pole);} else if (L.mode === 'tram') pole.mode = 'tram';
  s.pole = pole;
}
// Metro stations: OSM's station node, platforms and entrances.
const stationNodes = osm.elements.filter(e => e.type === 'node' && e.tags && e.tags.railway === 'station' && e.tags.station === 'subway');
const entrances = osm.elements.filter(e => e.type === 'node' && e.tags && e.tags.railway === 'subway_entrance').map(e => ({at: loc(e), name: e.tags.name || ''}));
const platformWays = osm.elements.filter(e => e.type === 'way' && e.tags && e.tags.railway === 'platform' && e.geometry);
const stations = [];
for (const p of places.filter(q => q.metro)) {
  const sn = stationNodes.filter(n => dist(loc(n), p.at) < 400).sort((a, b) => dist(loc(a), p.at) - dist(loc(b), p.at))[0];
  const at = sn ? loc(sn) : p.at;
  const ent = entrances.filter(e => dist(e.at, at) < 260).sort((a, b) => dist(a.at, at) - dist(b.at, at));
  const plats = platformWays.filter(w => dist(centroid(w.geometry.filter(Boolean)), at) < 200).map(w => ({ring: w.geometry.filter(Boolean).map(loc).map(q => [r1(q[0]), r1(q[1])]), layer: +(w.tags.layer || 0), tunnel: w.tags.tunnel || w.tags.location || ''}));
  stations.push({place: p, name: p.name, at, entrances: ent.map(e => [r1(e.at[0]), r1(e.at[1])]), platforms: plats});
}
// ---------- Output ----------
const names = [], nameIx = n => {let i = names.indexOf(n);if (i < 0) {i = names.length;names.push(n);}return i;};
const enc = pts => {const out = [];let px = 0, ps = 0;for (const p of pts) {const x = Math.round(p[0] * 10), s = Math.round(p[1] * 10);out.push(x - px, s - ps);px = x;ps = s;}return out;};
const placeIx = new Map(places.map((p, i) => [p, i]));
const out = {
  note: 'Generated by tools/make-transit.cjs from OpenStreetMap route relations (ODbL, (c) OpenStreetMap contributors), ' + (osm.note || '').replace(/^.*fetched /, 'fetched ').replace(/\).*/, ''),
  names,
  places: places.map(p => [nameIx(p.name), r1(p.at[0]), r1(p.at[1]), p.metro ? 1 : 0]),
  poles: poles.map(q => [placeIx.get(q.place), r1(q.at[0]), r1(q.at[1]), Math.round(q.heading * 1000) / 1000, q.mode === 'tram' ? 1 : 0]),
  stations: stations.map(s => ({place: placeIx.get(s.place), at: [r1(s.at[0]), r1(s.at[1])], entrances: s.entrances, platforms: s.platforms})),
  lines: lines.map(L => ({mode: L.mode, ref: L.ref, colour: L.colour, artic: L.artic || undefined, night: L.night || undefined, hw: L.hw,
    dirs: L.dirs.map(d => {
      const simp = simplify(d.path, .12), c = cumulative(simp);
      return {to: nameIx(d.to), from: nameIx(d.from), path: enc(simp), len: r1(c[c.length - 1]),
        stops: d.stops.map(s => [placeIx.get(s.place), r1(d.d === undefined ? s.d : s.d), s.pole ? poles.indexOf(s.pole) : -1]),
        names: d.names.map(nameIx), tunnels: d.tunnels.length ? d.tunnels.map(t => t.map(r1)) : undefined, edge: [d.startsIn ? 0 : 1, d.endsIn ? 0 : 1]};
    })}))
};
// The stops' distances were measured on the unsimplified 2 m line; re-measure on the simplified one (it is a little shorter).
for (const [li, L] of lines.entries()) for (const [di, d] of L.dirs.entries()) {
  const simp = simplify(d.path, .12), c = cumulative(simp), o = out.lines[li].dirs[di];
  let from = 0;o.stops = d.stops.map(s => {const q = project(simp, c, s.stop || s.platform, Math.max(0, from - 20));from = q.d;return [s.place ? placeIx.get(s.place) : -1, r1(q.d), s.pole ? poles.indexOf(s.pole) : -1, nameIx(s.name)];}).filter((s, i, a) => i === 0 || s[1] - a[i - 1][1] > 8);// one stop listed twice
  if (o.tunnels) {const full = cumulative(d.path), k = c[c.length - 1] / full[full.length - 1];o.tunnels = o.tunnels.map(t => t.map(v => r1(v * k)));}
}
// A direction with fewer than two stops in the world after all is left out (and a line with none).
for (const L of out.lines) L.dirs = L.dirs.filter(d => d.stops.filter(s => s[0] >= 0).length >= 2);
out.lines = out.lines.filter(L => L.dirs.length);
const TT = require(path.join(ROOT, 'transit-timetable.js'));
out.phases = TT.choosePhases(TT.decode(out).lines);
const js = `/* Generated by tools/make-transit.cjs (issue #111). Ruter's tram, bus and metro lines in the game world, from OpenStreetMap route
 * relations (ODbL, (c) OpenStreetMap contributors). Local metres (x east, s south of Haarklous plass 17A); paths delta-coded in dm. */
(function (root) {const data = ${JSON.stringify(out)};if (typeof module === 'object' && module.exports) module.exports = data;else root.TRANSIT = data;})(typeof window === 'undefined' ? globalThis : window);
`;
fs.writeFileSync(path.join(ROOT, 'transit-data.js'), js);
console.log(`transit-data.js ${Math.round(js.length / 1024)} KB: ${lines.length} lines (${lines.filter(l => l.mode === 'tram').length} tram, ${lines.filter(l => l.mode === 'metro').length} metro, ${lines.filter(l => l.mode === 'bus').length} bus), ${places.length} stop places, ${poles.length} poles, ${stations.length} metro stations`);
for (const L of lines) console.log(`  ${L.mode} ${L.ref}: ${L.dirs.map(d => `→ ${d.to} (${Math.round(d.len)} m, ${d.stops.length} stops${d.gaps ? `, ${d.gaps} gaps` : ''}${d.tunnels.length ? `, ${d.tunnels.length} tunnels` : ''})`).join('  ')}`);
for (const s of stations) console.log(`  station ${s.name}: ${s.entrances.length} entrances, ${s.platforms.length} platforms`);
