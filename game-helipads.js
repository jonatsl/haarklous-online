/* More helicopters around the map (issue #126): ten helipads in parks and on big lawns all over the city, each with an H125
 * on it. Pure planning (also used by the Node tests); the game builds the helicopters and the painted pads.
 *
 * GameHelipads.TARGETS                                  [{x, s, area}] roughly where each pad goes (a park or a big lawn)
 * GameHelipads.plan({targets, areas, water, clear, ok}) -> [{x, s, area}] the pads, the same on every computer
 *   areas  [{k, o (flat x, s, …)}]   the map's areas; a pad stands on grass or a pitch, PAD_EDGE metres in from its edge
 *   water  [flat polygon]            rivers, ponds and the sea
 *   clear  [{x, s, r}]               circles to keep free (other vehicles, the minigolf lanes, …)
 *   ok(x, s)                         the game's own check (no building, tree or lamp post under the rotor, flat enough)
 *   From each target it searches outwards in rings (STEP m apart, out to REACH m) and takes the first place that passes.
 * GameHelipads.padTexture(document)                     the painted pad (a white H in a yellow ring on dark green)
 * Local frame: metres east (x) and south (s) of Haarklous plass 17A.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameHelipads = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // One in each part of town, away from the helicopter by Haarklous plass (the area name is for the map and the tests).
  const TARGETS = [
    {x: 484, s: -344, area: 'Torshov north'},
    {x: -1061, s: 127, area: 'Sagene'},
    {x: 1407, s: 7, area: 'Refstad'},
    {x: 1983, s: -390, area: 'Økern north'},
    {x: 1888, s: 1596, area: 'Ulven'},
    {x: -671, s: 1514, area: 'Sofienberg'},
    {x: -372, s: 2085, area: 'Tøyen'},
    {x: 368, s: 2984, area: 'Jordal'},
    {x: 1315, s: 3115, area: 'Etterstad'},
    {x: -728, s: 3567, area: 'Gamlebyen'}
  ];
  const PAD_EDGE = 8, STEP = 4, REACH = 160, GROUND = ['grass', 'pitch'];
  function inPoly(x, s, o) {
    let inside = false;
    for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
      const xi = o[i], si = o[i + 1], xj = o[j], sj = o[j + 1];
      if ((si > s) !== (sj > s) && x < (xj - xi) * (s - si) / (sj - si) + xi) inside = !inside;
    }
    return inside;
  }
  function edgeDist(x, s, o) {
    let best = Infinity;
    for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
      const ax = o[j], as = o[j + 1], dx = o[i] - ax, ds = o[i + 1] - as, L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / L));
      best = Math.min(best, Math.hypot(x - ax - dx * t, s - as - ds * t));
    }
    return best;
  }
  const bbox = o => {let x0 = Infinity, s0 = Infinity, x1 = -Infinity, s1 = -Infinity;for (let i = 0; i < o.length; i += 2) {x0 = Math.min(x0, o[i]);x1 = Math.max(x1, o[i]);s0 = Math.min(s0, o[i + 1]);s1 = Math.max(s1, o[i + 1]);}return {x0, s0, x1, s1};};
  function plan({targets = TARGETS, areas = [], water = [], clear = [], ok = () => true} = {}) {
    const ground = areas.filter(a => GROUND.includes(a.k)).map(a => ({o: a.o, b: bbox(a.o)})), wet = water.map(o => ({o, b: bbox(o)}));
    const within = (x, s, list) => list.filter(p => x >= p.b.x0 && x <= p.b.x1 && s >= p.b.s0 && s <= p.b.s1 && inPoly(x, s, p.o));
    const taken = clear.slice(), out = [];
    const fits = (x, s) => {
      if (taken.some(c => Math.hypot(c.x - x, c.s - s) < c.r)) return false;
      if (!within(x, s, ground).some(p => edgeDist(x, s, p.o) >= PAD_EDGE)) return false;
      if (within(x, s, wet).length || wet.some(p => x >= p.b.x0 - PAD_EDGE && x <= p.b.x1 + PAD_EDGE && s >= p.b.s0 - PAD_EDGE && s <= p.b.s1 + PAD_EDGE && edgeDist(x, s, p.o) < PAD_EDGE)) return false;
      return ok(x, s);
    };
    for (const t of targets) {
      let found = fits(t.x, t.s) ? {x: t.x, s: t.s} : null;
      for (let r = STEP; !found && r <= REACH; r += STEP) {
        const n = Math.max(8, Math.round(2 * Math.PI * r / STEP));
        for (let k = 0; k < n && !found; k++) {const a = k / n * 2 * Math.PI, x = t.x + Math.sin(a) * r, s = t.s - Math.cos(a) * r;if (fits(x, s)) found = {x, s};}
      }
      if (!found) continue;
      out.push({x: Math.round(found.x * 10) / 10, s: Math.round(found.s * 10) / 10, area: t.area});taken.push({x: found.x, s: found.s, r: 30});
    }
    return out;
  }
  // A 256 px square: a yellow ring and a white H on a dark green-grey pad (drawn round, the corners are cut by alphaTest).
  function padTexture(doc) {
    const c = doc.createElement('canvas');c.width = c.height = 256;const g = c.getContext('2d');
    g.fillStyle = '#3c4a3f';g.beginPath();g.arc(128, 128, 126, 0, Math.PI * 2);g.fill();
    g.strokeStyle = '#f2c230';g.lineWidth = 12;g.beginPath();g.arc(128, 128, 104, 0, Math.PI * 2);g.stroke();
    g.fillStyle = '#f4f4f0';g.fillRect(78, 66, 26, 124);g.fillRect(152, 66, 26, 124);g.fillRect(104, 116, 48, 24);
    return c;
  }
  return {TARGETS, PAD_EDGE, REACH, plan, padTexture, inPoly};
});
