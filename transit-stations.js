/* Metro stations (issue #111): the plan of each station (pure, Node-tested) and its meshes.
 *
 * TransitStations.spec(station, stops, {ground(x, s) -> y, platformLayer}) -> {name, c [x, s], a (axis unit), n (right of it),
 *   tracks [v], type 'island' | 'side', underground, platform (floor height), rail, entrance [x, s] | null, ...}
 *   stops = [{x, s, hx, hs, tunnel}] where the trains of each direction stop (local metres); v = metres to the right of the axis.
 * TransitStations.layout(spec, ground, built(x, s) -> bool, {fix: {E, d}, avoid(x, s)}) -> {floors, obstacles, cuts, boxes, signs, kiosk, inside(x, s, y), deep(x, s, y), spots}
 *   all in local metres: floors {points [[x, s]], y | slope {o: [x, s], dir: [x, s], g} | height: 'threshold'}, obstacles
 *   {points, minY, maxY}, cuts = polygons where the ground is not drawn or walked (the entrance), boxes {u0, u1, v0, v1, y0, y1,
 *   colour, kind} in the station frame for the meshes (or {pts, ...} in local metres for the entrance stair and corridor).
 *
 * An underground station: an entrance pavilion at the real entrance (OpenStreetMap's railway=subway_entrance nearest the
 * platforms; the station node where OSM has none), a stair down to a corridor at concourse level (5.2 m above the platform),
 * the corridor to a mezzanine bridge across the hall, and a stair from the mezzanine down to each platform. The hall is 120 m
 * long (a 6-car MX3000 train is 108.5 m); the tracks run on in tunnels at both ends.
 * An open station (Sinsen, Hasle, Økern): platforms beside the tracks at their real place, with ramps at the ends.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TransitStations = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const HALL = 120, PLAT = 112, PLAT_H = 1.1, CLEAR = 1.62, MEZZ = 5.2, CEIL = 7.6, GRADE = .56, STAIR_W = 2.6, CORR_W = 3.2, SIDE_W = 4.2;
  function spec(st, stops, {ground, layer = -1, built = null}) {
    const n0 = stops.length || 1;
    const c = [stops.reduce((a, q) => a + q.x, 0) / n0, stops.reduce((a, q) => a + q.s, 0) / n0];
    // The axis: the mean heading (both directions folded onto one sense).
    let ax = 0, as = 0;for (const q of stops) {const sg = q.hx * stops[0].hx + q.hs * stops[0].hs >= 0 ? 1 : -1;ax += q.hx * sg;as += q.hs * sg;}
    const L = Math.hypot(ax, as) || 1;ax /= L;as /= L;
    const n = [-as, ax];
    const vs = stops.map(q => (q.x - c[0]) * n[0] + (q.s - c[1]) * n[1]).sort((a, b) => a - b), tracks = [];
    for (const v of vs) if (!tracks.length || v - tracks[tracks.length - 1] > 1.5) tracks.push(v);
    if (tracks.length === 1) tracks.splice(0, 1, tracks[0] - 2.1, tracks[0] + 2.1);
    const platV = (st.platforms || []).map(p => {const m = p.ring.reduce((a, q) => [a[0] + q[0] / p.ring.length, a[1] + q[1] / p.ring.length], [0, 0]);return (m[0] - c[0]) * n[0] + (m[1] - c[1]) * n[1];});
    const t0 = tracks[0], t1 = tracks[tracks.length - 1];
    let type = platV.some(v => v > t0 + .5 && v < t1 - .5) ? 'island' : platV.length ? 'side' : (t1 - t0 > 7 ? 'island' : 'side');
    if (type === 'island' && t1 - t0 > 16) type = 'side';
    if (type === 'island' && t1 - t0 < 2 * CLEAR + 4) {const m = (t0 + t1) / 2;tracks[0] = m - CLEAR - 2.5;tracks[tracks.length - 1] = m + CLEAR + 2.5;}
    // Underground when the track at the stop is in a tunnel, unless it comes out in the open beside the platforms (Ensjø: a
    // station in a cutting, partly covered): then it is an open station.
    const underground = stops.filter(q => q.tunnel).length * 2 >= stops.length && !stops.some(q => q.openNear);
    const g = ground(c[0], c[1]);
    const depth = Math.max(9, Math.min(20, 6 + 4 * Math.abs(layer)));
    // Under the lower of the ground over the platforms and at the entrance (Carl Berner's entrance is 20 m below the station node).
    const ent = (st.entrances || []).length ? pickEntrance({entrances: st.entrances, c}, built) : null, gE = ent ? ground(ent[0], ent[1]) : g;
    let rail;
    if (underground) rail = Math.min(g, gE) - depth - PLAT_H;
    else {let sum = 0, k = 0;for (let u = -50; u <= 50; u += 10) for (const v of tracks) {sum += ground(c[0] + ax * u + n[0] * v, c[1] + as * u + n[1] * v);k++;}rail = sum / k;}
    // A track between the outer two (Tøyen: lines 1–4 westbound stop on a third track) gets a side platform of its own (issue #143).
    const mid = type === 'side' ? tracks.slice(1, -1) : [];
    return {name: st.name, c, a: [ax, as], n, tracks: [tracks[0], tracks[tracks.length - 1]], mid, type, underground, rail, platform: rail + PLAT_H, ground: g, depth,
      entrances: st.entrances || [], station: st.at, entrance: ent};
  }
  const P = (sp, u, v) => [sp.c[0] + sp.a[0] * u + sp.n[0] * v, sp.c[1] + sp.a[1] * u + sp.n[1] * v];
  const rect = (sp, u0, u1, v0, v1) => [P(sp, u0, v0), P(sp, u1, v0), P(sp, u1, v1), P(sp, u0, v1)];
  // A wall along a line in the station frame as a thin obstacle (local points).
  const trackList = sp => [sp.tracks[0], ...(sp.mid || []), sp.tracks[1]];
  function platforms(sp) {
    const [t0, t1] = sp.tracks;
    if (sp.type === 'island') return [{v0: t0 + CLEAR, v1: t1 - CLEAR}];
    const out = [{v0: t0 - CLEAR - SIDE_W, v1: t0 - CLEAR}, {v0: t1 + CLEAR, v1: t1 + CLEAR + SIDE_W}], all = trackList(sp), room = 2 * CLEAR + SIDE_W + 1;
    // a middle track: its platform on the side with room for one (between it and the next track)
    for (let i = 1; i + 1 < all.length; i++) {
      const m = all[i];
      if (m - all[i - 1] >= room) out.push({v0: m - CLEAR - SIDE_W, v1: m - CLEAR});
      else if (all[i + 1] - m >= room) out.push({v0: m + CLEAR, v1: m + CLEAR + SIDE_W});
    }
    return out;
  }
  // opts.fix {E, d}: the entrance and the stair's direction are given (the game lays a planned station out again on its own
  // ground: same hole, the pavilion at the street's real height, issue #143). opts.avoid(x, s): ground the game cannot cut a hole
  // in (the old square's own terrain); an entrance placed by the game (no OSM entrance) keeps its pavilion out of it.
  function layout(sp, ground, built = () => false, opts = {}) {
    const floors = [], obstacles = [], cuts = [], boxes = [], signs = [], spots = [];
    const pls = platforms(sp), [t0, t1] = sp.tracks, y = sp.platform;
    const hv0 = Math.min(t0 - CLEAR - .4, ...pls.map(p => p.v0)) - .3, hv1 = Math.max(t1 + CLEAR + .4, ...pls.map(p => p.v1)) + .3;
    const wall = (pts, minY, maxY, kind = 'station') => obstacles.push({points: pts, minY, maxY, kind});
    const lineWall = (u0, v0, u1, v1, minY, maxY, t = .25) => {
      const du = u1 - u0, dv = v1 - v0, L = Math.hypot(du, dv) || 1, nu = -dv / L * t, nv = du / L * t;
      wall([P(sp, u0 - nu, v0 - nv), P(sp, u1 - nu, v1 - nv), P(sp, u1 + nu, v1 + nv), P(sp, u0 + nu, v0 + nv)], minY, maxY);
    };
    for (const p of pls) {
      floors.push({points: rect(sp, -PLAT / 2, PLAT / 2, p.v0, p.v1), y, name: `${sp.name} platform`});
      boxes.push({u0: -PLAT / 2, u1: PLAT / 2, v0: p.v0, v1: p.v1, y0: sp.rail - .3, y1: y, colour: 0x8d9093, kind: 'platform'});
      // yellow edge lines
      for (const v of [p.v0, p.v1]) if (trackList(sp).some(t => Math.abs(v - t) < CLEAR + .1)) boxes.push({u0: -PLAT / 2, u1: PLAT / 2, v0: v - (v === p.v0 ? 0 : .35), v1: v + (v === p.v0 ? .35 : 0), y0: y, y1: y + .006, colour: 0xf2c200, kind: 'edge'});
      spots.push({u: 0, v: (p.v0 + p.v1) / 2, y});
    }
    if (!sp.underground) return openLayout(sp, ground, {floors, obstacles, cuts, boxes, signs, spots, pls});
    // ---- The hall ----
    const ceil = y + CEIL;
    boxes.push({u0: -HALL / 2, u1: HALL / 2, v0: hv0, v1: hv1, y0: sp.rail - .35, y1: ceil, colour: 0xd9dcde, kind: 'hall'});
    for (const v of trackList(sp)) boxes.push({u0: -HALL / 2, u1: HALL / 2, v0: v - 1.3, v1: v + 1.3, y0: sp.rail - .35, y1: sp.rail - .15, colour: 0x2a2b2c, kind: 'bed'}, {u0: -HALL / 2, u1: HALL / 2, v0: v - .75, v1: v - .68, y0: sp.rail - .15, y1: sp.rail, colour: 0x9a9fa4, kind: 'rail'}, {u0: -HALL / 2, u1: HALL / 2, v0: v + .68, v1: v + .75, y0: sp.rail - .15, y1: sp.rail, colour: 0x9a9fa4, kind: 'rail'});
    // The walls (the hall's long sides; the ends are open into the tunnels but nobody can walk there: the platform ends).
    for (const p of pls) {
      for (const u of [-PLAT / 2, PLAT / 2]) lineWall(u, p.v0, u, p.v1, y - .2, y + 2.4, .08);// the platform ends (a railing)
    }
    // ---- The mezzanine, its stairs to the platforms and the corridor to the entrance ----
    const ent = sp.entrance !== undefined ? sp.entrance : sp.entrances.length ? pickEntrance({entrances: sp.entrances, c: sp.c}, built) : null;
    const uv0 = q => [(q[0] - sp.c[0]) * sp.a[0] + (q[1] - sp.c[1]) * sp.a[1], (q[0] - sp.c[0]) * sp.n[0] + (q[1] - sp.c[1]) * sp.n[1]];
    const eu = ent ? (ent[0] - sp.c[0]) * sp.a[0] + (ent[1] - sp.c[1]) * sp.a[1] : 0, ev = ent ? (ent[0] - sp.c[0]) * sp.n[0] + (ent[1] - sp.c[1]) * sp.n[1] : hv1 + 30;
    const m0 = Math.max(-PLAT / 2 + 14, Math.min(PLAT / 2 - 14, eu - 5)), m1 = m0 + 10, my = y + MEZZ;
    floors.push({points: rect(sp, m0, m1, hv0, hv1), y: my, name: `${sp.name} mezzanine`});
    boxes.push({u0: m0, u1: m1, v0: hv0, v1: hv1, y0: my - .45, y1: my, colour: 0xb7bbbf, kind: 'slab'});
    // the stairs: from the mezzanine's lower-u edge down to each platform
    const stairs = pls.map(p => ({vc: (p.v0 + p.v1) / 2, v0: (p.v0 + p.v1) / 2 - Math.min(STAIR_W, p.v1 - p.v0 - .9) / 2, v1: (p.v0 + p.v1) / 2 + Math.min(STAIR_W, p.v1 - p.v0 - .9) / 2}));
    const run = MEZZ / GRADE;
    for (const s of stairs) {
      floors.push({points: rect(sp, m0 - run, m0, s.v0, s.v1), slope: {o: P(sp, m0, 0), dir: [-sp.a[0], -sp.a[1]], g: GRADE, y: my}, name: `${sp.name} stair to the platform`});
      boxes.push({u0: m0 - run, u1: m0, v0: s.v0, v1: s.v1, y0: y, y1: my, colour: 0xa9adb1, kind: 'stair', run, top: my, u: 'down-'});
      // the stair's side walls (glass balustrades) where it stands on the platform
      for (const v of [s.v0, s.v1]) lineWall(m0 - run, v, m0, v, y - .1, my + 1.1, .05);
    }
    // railings round the mezzanine (gaps for the stairs and the corridor)
    const cuts0 = stairs.map(s => [s.v0, s.v1]).sort((a, b) => a[0] - b[0]);
    {let v = hv0;for (const [a, b] of cuts0) {if (a - v > .1) lineWall(m0, v, m0, a, my - .1, my + 1.1, .05);v = b;}if (hv1 - v > .1) lineWall(m0, v, m0, hv1, my - .1, my + 1.1, .05);}
    lineWall(m1, hv0, m1, hv1, my - .1, my + 1.1, .05);
    const cu = (m0 + m1) / 2;
    // ---- From the entrance down to the concourse level and along to the mezzanine ----
    // OSM has no entrance for Ensjø and Løren: theirs is put 6 m beside the hall, level with the mezzanine (on the station
    // node's side), and said so in the decisions log.
    const sn = sp.station ? uv0(sp.station) : [0, 1];
    const uv = q => [(q[0] - sp.c[0]) * sp.a[0] + (q[1] - sp.c[1]) * sp.a[1], (q[0] - sp.c[0]) * sp.n[0] + (q[1] - sp.c[1]) * sp.n[1]];
    const inHall = q => {const [u, v] = uv(q);return Math.abs(u) < HALL / 2 + 3 && v > hv0 - 3 && v < hv1 + 3;};
    const LAND = 1.6, K = 6.4, hw = STAIR_W / 2 + .1;// the landing; the pavilion reaches to where the stair is 2.7 m deep
    // The stair runs along a local axis (x or s), so the pavilion and the hole in the ground are simple: the one that keeps out
    // of the hall and leaves the shortest way to the mezzanine.
    const avoid = opts.avoid || (() => false);
    function stairFrom(E, only) {
      const gE = ground(E[0], E[1]), top = gE + .06, len = Math.max(3, (top - my) / GRADE), tB = LAND + len;let best = null;
      for (const d of only ? [only] : [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const at = (t, w = 0) => [E[0] + d[0] * t - d[1] * w, E[1] + d[1] * t + d[0] * w];
        let hits = 0;for (let t = K; t <= tB + 3.6; t += 1) for (const w of [-hw, hw]) if (inHall(at(t, w))) hits++;
        // the pavilion must not stand in a building (the stair may run on under one), nor on ground that cannot be cut
        let walls = 0;for (let t = -1; t <= K + 1; t += 1) for (const w of [-hw - .6, 0, hw + .6]) {if (built(...at(t, w))) walls++;if (avoid(...at(t, w))) walls += 20;}
        // and the door must open onto the street, not onto a wall (Grønland's faced a building 1 m away)
        for (let t = -4; t <= -1.5; t += .5) for (const w of [-hw, 0, hw]) if (built(...at(t, w))) walls += 3;
        // a building's walls reach about 3 m under the street: the stair may go under one only once it is deep enough for your head
        for (let t = K + 1; t <= Math.min(tB, LAND + 8.5 / GRADE); t += 1) for (const w of [-hw, hw]) if (built(...at(t, w))) walls += 1;
        const F = at(tB + 1.8), [fu, fv] = uv(F), sd = Math.abs(fu) <= HALL / 2 + 3 ? (fv >= (hv0 + hv1) / 2 ? 1 : -1) : (ev >= 0 ? 1 : -1);
        const vA = sd > 0 ? hv1 + 4 : hv0 - 4;
        // A corridor that turns back under the stair: its floor's edge (at concourse level) would cross the stair's last metres,
        // an invisible wall on the way up (Løren, issue #143). The first leg goes across (in v) unless it is short.
        const back = (() => {const way = [F, P(sp, fu, vA), P(sp, cu, vA)];for (let i = 0; i + 1 < way.length; i++) {const dx = way[i + 1][0] - way[i][0], ds = way[i + 1][1] - way[i][1], Lw = Math.hypot(dx, ds);if (Lw > .5) return (dx * d[0] + ds * d[1]) / Lw < -.05;}return false;})();
        const score = hits * 1000 + walls * 60 + (back ? 150 : 0) + Math.abs(fv - vA) + Math.abs(fu - cu) + 4;
        if (!best || score < best.score - 1e-9) best = {d, score, hits, F, fu, sd, vA, E, gE, top, len, tB};
      }
      return best;
    }
    let best;
    if (opts.fix) best = stairFrom(opts.fix.E, opts.fix.d);
    else {
      // No OSM entrance: beside the hall at the mezzanine, on the station node's side unless that ground cannot be cut.
      let side = sn[1] >= 0;if (!ent && avoid(...P(sp, cu, side ? hv1 + 6 : hv0 - 6)) && !avoid(...P(sp, cu, side ? hv0 - 6 : hv1 + 6))) side = !side;
      best = stairFrom(ent || P(sp, cu, side ? hv1 + 6 : hv0 - 6));
      // An OSM entrance at a building's wall (Grønland's is in the front of a block): the pavilion moves out onto the street a few
      // metres (20 points a metre, a wall point costs 60).
      if (ent && best.score - (best.hits * 1000) > 60) for (const r of [2, 4, 6, 8]) for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const alt = stairFrom([ent[0] + o[0] * r, ent[1] + o[1] * r]);alt.score += 20 * r;if (alt.score < best.score) best = alt;
      }
      // A real entrance right over the platforms: its pavilion stands at the edge of the hall instead, a few metres away.
      if (best.hits) {const [u, v] = uv(best.E), alt = stairFrom(P(sp, u, v >= (hv0 + hv1) / 2 ? hv1 + 4 : hv0 - 4));if (alt.score < best.score) best = alt;}
    }
    const {E, gE, top, len, tB} = best;
    const dir = best.d, side = best.sd, wallV = side > 0 ? hv1 : hv0;
    const at = (t, w) => [E[0] + dir[0] * t - dir[1] * w, E[1] + dir[1] * t + dir[0] * w];
    // The long walls, with the corridor's opening at the mezzanine on its side.
    for (const sg of [-1, 1]) {
      const v = sg > 0 ? hv1 : hv0;
      if (sg !== side) {lineWall(-HALL / 2, v, HALL / 2, v, sp.rail - 1, ceil + 1);continue;}
      lineWall(-HALL / 2, v, cu - CORR_W / 2, v, sp.rail - 1, ceil + 1);lineWall(cu + CORR_W / 2, v, HALL / 2, v, sp.rail - 1, ceil + 1);lineWall(cu - CORR_W / 2, v, cu + CORR_W / 2, v, sp.rail - 1, my - .3);
    }
    floors.push({points: [at(0, -hw), at(.8, -hw), at(.8, hw), at(0, hw)], height: 'threshold', y: top, o: E, dir, name: `${sp.name} entrance`});
    floors.push({points: [at(.8, -hw), at(LAND, -hw), at(LAND, hw), at(.8, hw)], y: top, name: `${sp.name} entrance landing`});
    floors.push({points: [at(LAND, -hw), at(tB, -hw), at(tB, hw), at(LAND, hw)], slope: {o: at(LAND, 0), dir, g: GRADE, y: top}, name: `${sp.name} stair down`});
    floors.push({points: [at(tB, -hw - .4), at(tB + 3.6, -hw - .4), at(tB + 3.6, hw + .4), at(tB, hw + .4)], y: my, name: `${sp.name} stair foot`});
    cuts.push([at(0, -hw - .3), at(K, -hw - .3), at(K, hw + .3), at(0, hw + .3)]);// from the door line, where the threshold floor begins
    // The pavilion's walls. Below ground the floors' own edges keep you on the stair and in the corridor (nobody walks off a floor).
    for (const w of [-hw - .15, hw + .15]) obstacles.push({points: thin(at(0, w), at(Math.min(tB, K + 1), w), .15), minY: top - 1, maxY: top + 3, kind: 'station'});
    // the pavilion's back wall stands over the stair (from above the stair's head room) so the stair runs on under it
    obstacles.push({points: thin(at(K, -hw - .3), at(K, hw + .3), .15), minY: top - GRADE * (K - LAND) + 2.3, maxY: top + 3.4, kind: 'station'});
    boxes.push({pts: [at(0, -hw), at(tB, -hw), at(tB, hw), at(0, hw)], kind: 'entrance-stair', top, land: LAND, len, my, dir, E, hw, K, tB});
    // The corridor: from the stair's foot across (in v) to 4 m outside the hall wall, along the wall to the mezzanine, in.
    const F = best.F, way = [F, P(sp, best.fu, best.vA), P(sp, cu, best.vA), P(sp, cu, wallV - side * .4)].filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > .5);
    // A corridor that has to go back the way the stair came: first out of the foot sideways, then back beside the stair, so its floor
    // never lies under the stair's last metres (there its edge was an invisible wall, issue #143).
    if (way.length > 1) {
      const dx = way[1][0] - F[0], ds = way[1][1] - F[1], Lw = Math.hypot(dx, ds) || 1;
      if ((dx * dir[0] + ds * dir[1]) / Lw < -.05) way.splice(1, 0, at(tB + 1.8, (dx * -dir[1] + ds * dir[0] >= 0 ? 1 : -1) * (hw + .4 + CORR_W / 2 + .3)));
    }
    const exit = way.length > 1 ? (() => {const dx = way[1][0] - F[0], ds = way[1][1] - F[1], Lw = Math.hypot(dx, ds) || 1;return [dx / Lw, ds / Lw];})() : dir;
    boxes[boxes.length - 1].exit = exit;// the stair foot is open toward the corridor
    const legs = [];for (let i = 0; i + 1 < way.length; i++) legs.push(corridor(way[i], way[i + 1], my, CORR_W, i ? 1.2 : 0));// the first leg starts in the stair foot, clear of the stair
    const corr = {inside: (x, s, yy) => legs.some(l => l.inside(x, s, yy)), a: legs[0].a, b: legs[legs.length - 1].b, legs};
    legs[0].boxes[0].open = true;
    for (const l of legs) {floors.push(...l.floors.map(f => ({...f, name: `${sp.name} corridor`})));boxes.push(...l.boxes);}
    signs.push({kind: 'name', u: 0, v: hv0 + .02, y: y + 2.9, face: 1}, {kind: 'name', u: 0, v: hv1 - .02, y: y + 2.9, face: -1});
    for (const p of pls) for (const u of [-30, 30]) signs.push({kind: 'board', u, v: (p.v0 + p.v1) / 2, y: y + 2.75, face: 0, pl: p});
    // The sign mast (issue #143): beside the door on the side away from buildings, a tall pole with the T and the name.
    const mastW = [hw + 1.05, -hw - 1.05].sort((p, q) => (built(...at(-.4, p)) ? 1 : 0) - (built(...at(-.4, q)) ? 1 : 0))[0];
    const mast = {p: at(-.4, mastW), h: 7.2};
    obstacles.push({points: thin(at(-.55, mastW), at(-.25, mastW), .15), minY: top - 1, maxY: top + mast.h, kind: 'station'});
    const kiosk = {E, dir, hw, K, top, ground: gE, tB, land: LAND, mast};
    const inside = (x, s, yy) => {
      const du = (x - sp.c[0]) * sp.a[0] + (s - sp.c[1]) * sp.a[1], dv = (x - sp.c[0]) * sp.n[0] + (s - sp.c[1]) * sp.n[1];
      if (Math.abs(du) < HALL / 2 + 2 && dv > hv0 - 1 && dv < hv1 + 1 && yy < ceil + 1 && yy > sp.rail - 2) return true;
      // (the stair once the eye is under the street: in the pavilion you still see the street round you)
      return corr.inside(x, s, yy) || stairInside(E, dir, hw, tB + 3.6, x, s) && yy < top - .9 && yy > my - 1;
    };
    return {floors, obstacles, cuts, boxes, signs, spots, kiosk, inside, hall: {hv0, hv1, ceil, m0, m1, my}, stairs, pls, corridor: corr};
  }
  function stairInside(E, dir, hw, len, x, s) {
    const t = (x - E[0]) * dir[0] + (s - E[1]) * dir[1], w = -(x - E[0]) * dir[1] + (s - E[1]) * dir[0];
    return t > 0 && t < len && Math.abs(w) < hw + .3;
  }
  function thin(a, b, t) {
    const dx = b[0] - a[0], ds = b[1] - a[1], L = Math.hypot(dx, ds) || 1, nx = -ds / L * t, ns = dx / L * t;
    return [[a[0] - nx, a[1] - ns], [b[0] - nx, b[1] - ns], [b[0] + nx, b[1] + ns], [a[0] + nx, a[1] + ns]];
  }
  // A level corridor from A to B (local), width w: floor, side walls, the boxes to draw.
  function corridor(A, B, y, w, back = 1.2) {
    const dx = B[0] - A[0], ds = B[1] - A[1], L = Math.hypot(dx, ds) || 1, ux = dx / L, us = ds / L, nx = -us * w / 2, ns = ux * w / 2;
    const a0 = [A[0] - ux * back, A[1] - us * back], b0 = [B[0] + ux * .6, B[1] + us * .6];
    const floor = [[a0[0] - nx, a0[1] - ns], [b0[0] - nx, b0[1] - ns], [b0[0] + nx, b0[1] + ns], [a0[0] + nx, a0[1] + ns]];
    const walls = [];// the floor's edges are the walls (a person cannot walk off a floor), so the corridor can meet the stair foot at any angle
    const inside = (x, s, yy) => {const t = (x - a0[0]) * ux + (s - a0[1]) * us, q = -(x - a0[0]) * us + (s - a0[1]) * ux;return t > -.5 && t < L + 2.3 && Math.abs(q) < w / 2 + .4 && yy > y - 1 && yy < y + 3.2;};
    return {floors: [{points: floor, y}], walls, boxes: [{pts: floor, kind: 'corridor', y, h: 2.9}], inside, a: a0, b: b0, from: A, to: B};
  }
  // The entrance nearest the platforms, or the station node. With built(x, s): the nearest one that is not inside a building of the
  // map (Jernbanetorget's nearest is in the 6 m entrance building on the square, so a pavilion there was hidden in it, issue #143).
  function pickEntrance(sp, built) {
    const ents = sp.entrances.length ? sp.entrances : sp.station ? [sp.station] : [];
    if (!ents.length) return null;
    const by = ents.slice().sort((p, q) => Math.hypot(p[0] - sp.c[0], p[1] - sp.c[1]) - Math.hypot(q[0] - sp.c[0], q[1] - sp.c[1]));
    return (built && by.find(e => !built(e[0], e[1]))) || by[0];
  }
  // Open stations: the platforms on the ground beside the tracks; a ramp from the street at each end.
  function openLayout(sp, ground, o) {
    const y = sp.platform;
    o.floors.length = 0;
    for (const p of o.pls) {
      o.floors.push({points: rect(sp, -PLAT / 2, PLAT / 2, p.v0, p.v1), y, raised: true, name: `${sp.name} platform`});
      for (const sg of [-1, 1]) {
        const u0 = sg * PLAT / 2, u1 = sg * (PLAT / 2 + 7), gEnd = ground(...P(sp, u1, (p.v0 + p.v1) / 2));
        o.floors.push({points: rect(sp, Math.min(u0, u1), Math.max(u0, u1), p.v0, p.v1), ramp: {u0, u1, y0: y, y1: gEnd}, name: `${sp.name} platform ramp`});
        o.boxes.push({u0: Math.min(u0, u1), u1: Math.max(u0, u1), v0: p.v0, v1: p.v1, y0: Math.min(y, gEnd) - .6, y1: y, colour: 0x8d9093, kind: 'ramp', ramp: {u0, u1, y0: y, y1: gEnd}});
      }
      o.boxes.push({u0: -16, u1: 16, v0: p.v0 + .5, v1: p.v1 - .5, y0: y, y1: y + 3.0, colour: 0x3b4045, kind: 'canopy'});
      o.signs.push({kind: 'board', u: 8, v: (p.v0 + p.v1) / 2, y: y + 2.5, face: 0, pl: p}, {kind: 'name', u: -8, v: (p.v0 + p.v1) / 2, y: y + 2.5, face: 0, pl: p});
    }
    const inside = () => false;
    return {...o, kiosk: null, inside, hall: null, open: true};
  }
  return {HALL, PLAT, PLAT_H, MEZZ, GRADE, spec, layout, platforms, trackList, P, rect, corridor};
});
