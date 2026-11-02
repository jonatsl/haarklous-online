/* District patches of the world (issue #38: Gamle Oslo, Ensjø and the way there from Torshov). Each patch comes from
 * tools/make-district.py as window.DISTRICTS[i] and adds ground, buildings, streets, parks and trees outside the old
 * ±800 m world of surroundings-data.js (which stays unchanged). Pure functions, also used by the Node tests.
 * District.decode(raw) -> {name, x0, s0, x1, s1, step, nx, ns, h (Float32Array, metres relative to the stair door),
 *   play {x0, s0, x1, s1}, seaRel, buildings [{id, ring [[x, s]], h, style, hip [[x, s] x4] | null}],
 *   roads [{k, w, n, p (flat)}], areas [{k, o (flat)}], sea [flat], trees [{x, s}], chimneys, landmarks, places, stations, route}
 *   Building rings may be changed (e.g. notched) before Surroundings.create builds them.
 * District.height(d, x, s) -> metres relative to the stair door (bilinear, clamped to the grid); District.covers(d, x, s).
 * Local frame: metres east (x) and south (s) of Haarklous plass 17A, as surroundings-data.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.District = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const STYLES = ['brick', 'plaster', 'shed', 'modern', 'industrial'];
  const bytes = b64 => {const bin = atob(b64), out = new Uint8Array(bin.length);for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);return out;};
  const words = (b64, Type) => {const b = bytes(b64);return new Type(b.buffer, 0, b.length / Type.BYTES_PER_ELEMENT);};
  function decode(raw) {
    const g = raw.grid, nx = g.nx, ns = g.ns, h = new Float32Array(nx * ns), code = bytes(g.code);
    // Rows of delta-coded decimetres: a signed byte step, or -128 followed by an int16 value.
    let k = 0;
    for (let j = 0; j < ns; j++) {
      let v = 0;
      for (let i = 0; i < nx; i++) {
        const b = code[k] > 127 ? code[k] - 256 : code[k];
        if (b === -128) {v = (code[k + 1] | code[k + 2] << 8) << 16 >> 16;k += 3;} else {v += b;k++;}
        h[j * nx + i] = v / 10;
      }
    }
    const d = {name: raw.name, raw, x0: g.x0, s0: g.s0, x1: g.x0 + (nx - 1) * g.step, s1: g.s0 + (ns - 1) * g.step, step: g.step, nx, ns, h,
      play: raw.play, seaRel: raw.seaRel, chimneys: raw.chimneys || [], landmarks: raw.landmarks || [], places: raw.places || [], stations: raw.stations || [], route: raw.route || null,
      sea: raw.sea || [], buildings: [], roads: [], areas: [], trees: []};
    // Building tiles: [n, flags (style | 8 = hip roof), height dm, (hip corners), ring] in decimetres from the tile corner.
    const T = raw.tiles;
    T.b.forEach((b64, t) => {
      if (!b64) return;
      const a = words(b64, Int16Array), ids = T.ids && T.ids[t] ? words(T.ids[t], Uint32Array) : null;
      const ox = g.x0 + (t % T.nx) * raw.tile, os = g.s0 + Math.floor(t / T.nx) * raw.tile, pt = i => [ox + a[i] / 10, os + a[i + 1] / 10];
      for (let i = 0, n = 0; i < a.length; n++) {
        const count = a[i], flags = a[i + 1], height = a[i + 2] / 10;i += 3;
        let hip = null;if (flags & 8) {hip = [pt(i), pt(i + 2), pt(i + 4), pt(i + 6)];i += 8;}
        const ring = [];for (let c = 0; c < count; c++, i += 2) ring.push(pt(i));
        const id = ids ? ids[n] : 0;
        d.buildings.push({id: ids ? (id % 2 ? 'r' : 'w') + Math.floor(id / 2) : null, ring, h: height, style: STYLES[flags & 7], hip, tile: t});
      }
    });
    const [ox, os] = raw.o16;
    {
      const a = words(raw.roads, Uint16Array);
      for (let i = 0; i < a.length;) {
        const kind = raw.roadKinds[a[i]], name = a[i + 1] ? raw.names[a[i + 1] - 1] : null, n = a[i + 2], p = new Array(n * 2);i += 3;
        for (let c = 0; c < n; c++, i += 2) {p[c * 2] = ox + a[i] / 10;p[c * 2 + 1] = os + a[i + 1] / 10;}
        d.roads.push({k: kind, w: kind === 'tram' ? 2.6 : kind === 'rail' ? 3.6 : raw.roadWidth[kind], n: name, p});
      }
    }
    {
      const a = words(raw.areas, Uint16Array);
      for (let i = 0; i < a.length;) {
        const kind = raw.areaKinds[a[i]], n = a[i + 1], o = new Array(n * 2);i += 2;
        for (let c = 0; c < n; c++, i += 2) {o[c * 2] = ox + a[i] / 10;o[c * 2 + 1] = os + a[i + 1] / 10;}
        d.areas.push({k: kind, o});
      }
    }
    {const a = words(raw.trees, Uint16Array);for (let i = 0; i < a.length; i += 2) d.trees.push({x: ox + a[i] / 10, s: os + a[i + 1] / 10});}
    return d;
  }
  const covers = (d, x, s) => x >= d.x0 && x <= d.x1 && s >= d.s0 && s <= d.s1;
  function height(d, x, s) {
    const fi = Math.min(d.nx - 1.001, Math.max(0, (x - d.x0) / d.step)), fj = Math.min(d.ns - 1.001, Math.max(0, (s - d.s0) / d.step)), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, n = d.nx, h = d.h;
    return h[j * n + i] * (1 - u) * (1 - v) + h[j * n + i + 1] * u * (1 - v) + h[(j + 1) * n + i] * (1 - u) * v + h[(j + 1) * n + i + 1] * u * v;
  }
  // Lower the ground grid inside a polygon (plus margin metres) to at most `rel` (metres relative to the stair door), before
  // Surroundings.create builds it: for a building whose own floor lies below the terrain model's surface there.
  function flatten(d, polygon, rel, margin = 4) {
    const inside = (x, s) => {let r = false;for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {const a = polygon[i], b = polygon[j];if ((a[1] > s) !== (b[1] > s) && x < (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;};
    const near = (x, s) => polygon.some((a, i) => {const b = polygon[(i + 1) % polygon.length], dx = b[0] - a[0], ds = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (s - a[1]) * ds) / (dx * dx + ds * ds || 1)));return Math.hypot(x - a[0] - t * dx, s - a[1] - t * ds) <= margin;});
    let n = 0;
    for (let j = 0; j < d.ns; j++) for (let i = 0; i < d.nx; i++) {const x = d.x0 + i * d.step, s = d.s0 + j * d.step, k = j * d.nx + i;if (d.h[k] > rel && (inside(x, s) || near(x, s))) {d.h[k] = rel;n++;}}
    return n;
  }
  return {decode, height, covers, flatten, STYLES};
});
