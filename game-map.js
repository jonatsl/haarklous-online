/* Map overlay (touchpad / M): the neighbourhood from OpenStreetMap with street names, your apartment, the
 * hostage-rescue start, the disc golf holes and the petanque court, and you (arrow). Vehicles are not shown.
 * Left stick / drag pans, right stick / wheel zooms, ○ / M / Esc closes.
 * Waypoint (issue #41): ✕ / Space sets it at the cross in the middle of the map, a click sets it where you click; ✕ or a click
 * on it again, □ / E or Delete removes it. Out of the map a purple pin stays on it (at the screen edge with an arrow when it is
 * off screen) until you are within 7 m.
 * Minimap (issue #42, optional, pause menu): round, in the bottom-left corner like GTA IV, turns with the camera, zooms out
 * with speed and height. The map data is drawn once into 200 m tiles (at most two new tiles a frame) and the tiles are reused.
 * GameMap.create({data, toLocal, toWorld, root, poi}) -> {open, toggle(player), draw(player), pan(dx, dy), zoom(f), markCentre(),
 *   clearWaypoint(), waypoint {x, s} | null, minimap (on/off, saved), guide(state)}
 *   player: {x, z, headingLocal, others: [{x, z, headingLocal, color, name}]} (world x/z; headingLocal 0 = north, clockwise)
 *   guide({dt, camera, x, z, you: {x, z}, heading, view, alt, others, ground(x, z), show}) once a frame while you play: x/z = the
 *   minimap's centre, heading = your arrow, view = the camera's heading (the minimap's "up"); returns 'reached' when you got
 *   within 7 m of the waypoint (it is then removed).
 * Pure helpers (Node-tested): edgePoint, screenSpot, toRim, distanceText, minimapRange.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameMap = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const REACH = 7, WP = '#a83dff', TILE = 200, PPM = 1.6, PAD = 1, MAX_TILES = 64;
  // A point on the rectangle `margin` inside a w × h screen, from the centre in direction (dx, dy) (y down). No direction = down.
  function edgePoint(dx, dy, w, h, margin) {
    const L = Math.hypot(dx, dy);if (L < 1e-9) {dx = 0;dy = 1;} else {dx /= L;dy /= L;}
    const hx = Math.max(1, w / 2 - margin), hy = Math.max(1, h / 2 - margin), t = Math.min(Math.abs(dx) > 1e-9 ? hx / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hy / Math.abs(dy) : Infinity);
    return {x: w / 2 + dx * t, y: h / 2 + dy * t, angle: Math.atan2(dy, dx)};
  }
  // Where the waypoint pin goes: v = the point in camera space (-z is ahead), ndc = its projection. In front and inside the
  // margins: on the point. Otherwise on the screen edge toward it; behind you counts as "down" (left or right by its side).
  function screenSpot(v, ndc, w, h, margin) {
    if (v.z < -.05) {
      const x = (ndc.x + 1) / 2 * w, y = (1 - ndc.y) / 2 * h;
      if (x >= margin && x <= w - margin && y >= margin && y <= h - margin) return {x, y, edge: false};
      return {...edgePoint(x - w / 2, y - h / 2, w, h, margin), edge: true};
    }
    return {...edgePoint(v.x, Math.abs(v.z) + Math.max(0, -v.y), w, h, margin), edge: true};
  }
  // An offset on the minimap pulled in to radius r (blips that are out of range sit on the rim).
  function toRim(u, v, r) {const L = Math.hypot(u, v);return L > r ? {u: u / L * r, v: v / L * r, out: true} : {u, v, out: false};}
  const distanceText = m => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  // Metres from the minimap's centre to its rim: 90 m on foot, more with speed (m/s) and height above the ground (m).
  const minimapRange = (speed, alt) => Math.min(300, 90 + 4.5 * Math.max(0, speed) + .5 * Math.max(0, alt || 0));

  function create({data, toLocal, toWorld, root, poi}) {
    const el = document.createElement('div');el.id = 'mapOverlay';el.hidden = true;
    el.innerHTML = '<canvas></canvas><div class="map-legend"><b>Map</b><span><i class="lg home"></i>Your apartment (Haarklous plass 17A)</span><span><i class="lg case"></i>Hostage rescue</span><span><i class="lg disc"></i>Disc golf</span><span><i class="lg petanque"></i>Petanque</span><span><i class="lg you"></i>You</span><span><i class="lg others"></i>Other players in your lobby</span><span><i class="lg wp"></i>Your waypoint</span><small>Left stick / drag: pan · Right stick / wheel: zoom</small><small>✕ / click: set or remove a waypoint · □ / Delete: remove it · ○ / M: close</small><small class="attr">© OpenStreetMap contributors</small></div>';
    root.append(el);
    const canvas = el.querySelector('canvas'), ctx = canvas.getContext('2d');
    const map = {open: false, cx: 0, cs: 0, scale: 2.2, waypoint: null};
    const pairs = flat => {const out = [];for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);return out;};
    const order = ['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'service', 'track', 'living_street', 'unclassified', 'residential', 'tertiary', 'secondary', 'primary', 'trunk_link', 'trunk', 'tram'];
    const PATHS = ['footway', 'path', 'steps', 'cycleway', 'track', 'pedestrian'];
    // The waypoint's pin (tip at u, v), on the big map and the minimap.
    function pin(g, u, v, r) {
      g.beginPath();g.moveTo(u, v);g.bezierCurveTo(u - r * 1.1, v - r * 1.3, u - r, v - r * 2.4, u, v - r * 2.4);g.bezierCurveTo(u + r, v - r * 2.4, u + r * 1.1, v - r * 1.3, u, v);g.closePath();
      g.fillStyle = WP;g.fill();g.strokeStyle = '#fff';g.lineWidth = Math.max(1.5, r * .22);g.stroke();g.fillStyle = '#fff';g.beginPath();g.arc(u, v - r * 1.55, r * .38, 0, 7);g.fill();
    }
    // Every area, road and building with its bounding box (made once), so a frame only draws what is in view.
    let feats = null;
    function features() {
      const box = (item, flat, grow) => {let x0 = Infinity, x1 = -Infinity, s0 = Infinity, s1 = -Infinity;for (let i = 0; i < flat.length; i += 2) {x0 = Math.min(x0, flat[i]);x1 = Math.max(x1, flat[i]);s0 = Math.min(s0, flat[i + 1]);s1 = Math.max(s1, flat[i + 1]);}return {item, x0: x0 - grow, x1: x1 + grow, s0: s0 - grow, s1: s1 + grow};};
      // Street names: one label per named street, at its longest segment.
      const named = new Map();for (const r of data.roads) if (r.n && !['footway', 'path', 'steps', 'cycleway'].includes(r.k)) {const p = pairs(r.p);for (let i = 1; i < p.length; i++) {const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);if (!named.has(r.n) || named.get(r.n).L < L) named.set(r.n, {L, a: p[i - 1], b: p[i]});}}
      return {areas: data.areas.map(a => box(a, a.o, 0)), roads: data.roads.slice().sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)).map(r => box(r, r.p, r.w || 2)), buildings: data.buildings.map(b => box(b, b.r.o, 0)), named};
    }
    // The streets and buildings are drawn into `base` and only drawn again when the view moves.
    const base = document.createElement('canvas'), bctx = base.getContext('2d');let baseKey = '';
    function drawBase(w, h, k, P) {
      if (!feats) feats = features();
      const g = bctx, vx0 = map.cx - w / 2 / k, vx1 = map.cx + w / 2 / k, vs0 = map.cs - h / 2 / k, vs1 = map.cs + h / 2 / k;
      const seen = f => f.x1 >= vx0 && f.x0 <= vx1 && f.s1 >= vs0 && f.s0 <= vs1;
      g.fillStyle = '#e8e4d8';g.fillRect(0, 0, w, h);
      const poly = (flat, fill, stroke) => {g.beginPath();pairs(flat).forEach(([x, s], i) => {const [u, v] = P(x, s);i ? g.lineTo(u, v) : g.moveTo(u, v);});g.closePath();if (fill) {g.fillStyle = fill;g.fill();}if (stroke) {g.strokeStyle = stroke;g.lineWidth = 1;g.stroke();}};
      for (const f of feats.areas) if (seen(f)) poly(f.item.o, {grass: '#b9d39b', wood: '#9cbf83', playground: '#e8d9a8', pitch: '#a8cf8f', parking: '#d6d3cc', yard: '#ddd6c4', flowerbed: '#c9d6a0', water: '#a8c8e0'}[f.item.k] || '#ddd');
      for (const f of feats.roads) {
        if (!seen(f)) continue;const r = f.item, path = PATHS.includes(r.k);
        g.strokeStyle = path ? '#c9a77b' : r.k === 'tram' ? '#888' : '#ffffff';g.lineWidth = Math.max(1, (path ? 1.4 : r.w) * k * .9);g.setLineDash(path ? [4 * devicePixelRatio, 3 * devicePixelRatio] : []);
        g.lineCap = 'round';g.beginPath();pairs(r.p).forEach(([x, s], i) => {const [u, v] = P(x, s);i ? g.lineTo(u, v) : g.moveTo(u, v);});g.stroke();
        if (!path && r.k !== 'tram') {g.strokeStyle = '#bfb9ad';g.lineWidth = 1;g.stroke();}
      }
      g.setLineDash([]);
      for (const f of feats.buildings) if (seen(f)) poly(f.item.r.o, f.item.s === 'brick' ? '#c9a08a' : '#c8c2b8', '#a8826e');
      poly(data.ownLocal, '#e0703c', '#7a2e10');
      g.font = `${12 * devicePixelRatio}px system-ui, sans-serif`;g.fillStyle = '#4a4a4a';g.textAlign = 'center';
      for (const [name, s] of feats.named) {const [u1, v1] = P(...s.a), [u2, v2] = P(...s.b);if (Math.max(u1, u2) < 0 || Math.min(u1, u2) > w || Math.max(v1, v2) < 0 || Math.min(v1, v2) > h || Math.hypot(u2 - u1, v2 - v1) < g.measureText(name).width * .6) continue;let ang = Math.atan2(v2 - v1, u2 - u1);if (ang > Math.PI / 2) ang -= Math.PI;if (ang < -Math.PI / 2) ang += Math.PI;g.save();g.translate((u1 + u2) / 2, (v1 + v2) / 2);g.rotate(ang);g.fillText(name, 0, -3 * devicePixelRatio);g.restore();}
    }
    let lastPlayer = null;
    function draw(player) {
      if (!map.open) return;
      lastPlayer = player || lastPlayer;
      const w = Math.round(el.clientWidth * devicePixelRatio), h = Math.round(el.clientHeight * devicePixelRatio), k = map.scale * devicePixelRatio;
      if (canvas.width !== w || canvas.height !== h) {canvas.width = w;canvas.height = h;}
      const P = (x, s) => [w / 2 + (x - map.cx) * k, h / 2 + (s - map.cs) * k];
      const key = [w, h, map.cx, map.cs, map.scale].join();if (key !== baseKey) {if (base.width !== w || base.height !== h) {base.width = w;base.height = h;}drawBase(w, h, k, P);baseKey = key;}
      ctx.drawImage(base, 0, 0);ctx.textAlign = 'center';
      // Points of interest.
      const icon = (x, s, color, label, glyph) => {const [u, v] = P(x, s), r = 11 * devicePixelRatio;ctx.fillStyle = color;ctx.beginPath();ctx.arc(u, v, r, 0, 7);ctx.fill();ctx.strokeStyle = '#fff';ctx.lineWidth = 2 * devicePixelRatio;ctx.stroke();ctx.fillStyle = '#fff';ctx.font = `bold ${12 * devicePixelRatio}px system-ui`;ctx.textBaseline = 'middle';ctx.fillText(glyph, u, v + .5);ctx.textBaseline = 'alphabetic';if (label) {ctx.fillStyle = '#222';ctx.font = `bold ${12 * devicePixelRatio}px system-ui`;ctx.fillText(label, u, v - r - 5 * devicePixelRatio);}};
      for (const p of poi()) icon(p.x, p.s, p.color, p.label, p.glyph);
      // The waypoint: a dashed line from you, the pin and how far it is.
      if (map.waypoint) {
        const [u, v] = P(map.waypoint.x, map.waypoint.s), d = devicePixelRatio;
        if (lastPlayer) {const l = toLocal(lastPlayer.x, lastPlayer.z), [pu, pv] = P(l.x, l.s);ctx.strokeStyle = WP;ctx.globalAlpha = .7;ctx.lineWidth = 2.5 * d;ctx.setLineDash([7 * d, 6 * d]);ctx.beginPath();ctx.moveTo(pu, pv);ctx.lineTo(u, v);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha = 1;}
        pin(ctx, u, v, 9 * d);
        if (lastPlayer) {const wp = toWorld(map.waypoint.x, map.waypoint.s), t = distanceText(Math.hypot(wp.x - lastPlayer.x, wp.z - lastPlayer.z));ctx.font = `bold ${12 * d}px system-ui`;ctx.textAlign = 'center';ctx.lineWidth = 3 * d;ctx.strokeStyle = '#fff';ctx.strokeText(t, u, v - 26 * d);ctx.fillStyle = '#4a148c';ctx.fillText(t, u, v - 26 * d);}
      }
      // Arrows: the other players in your lobby (their slot colour and name, issue #24), then you on top.
      const arrow = (x, z, a, color, size) => {const l = toLocal(x, z), [u, v] = P(l.x, l.s), r = size * devicePixelRatio;ctx.save();ctx.translate(u, v);ctx.rotate(a);ctx.fillStyle = color;ctx.beginPath();ctx.moveTo(0, -r * 1.4);ctx.lineTo(r, r);ctx.lineTo(0, r * .45);ctx.lineTo(-r, r);ctx.closePath();ctx.fill();ctx.strokeStyle = '#fff';ctx.lineWidth = 2;ctx.stroke();ctx.restore();return [u, v];};
      for (const o of (player && player.others) || []) {
        const [u, v] = arrow(o.x, o.z, o.headingLocal, o.color, 8);
        if (o.name) {ctx.font = `bold ${12 * devicePixelRatio}px system-ui`;ctx.textAlign = 'center';ctx.lineWidth = 3 * devicePixelRatio;ctx.strokeStyle = '#fff';ctx.strokeText(o.name, u, v - 16 * devicePixelRatio);ctx.fillStyle = '#222';ctx.fillText(o.name, u, v - 16 * devicePixelRatio);}
      }
      if (player) arrow(player.x, player.z, player.headingLocal, '#1565c0', 9);
      // The cross in the middle, where ✕ puts the waypoint.
      {const d = devicePixelRatio, c = 9 * d;ctx.strokeStyle = '#4a148c';ctx.globalAlpha = .75;ctx.lineWidth = 2 * d;ctx.beginPath();ctx.moveTo(w / 2 - c, h / 2);ctx.lineTo(w / 2 - 3 * d, h / 2);ctx.moveTo(w / 2 + 3 * d, h / 2);ctx.lineTo(w / 2 + c, h / 2);ctx.moveTo(w / 2, h / 2 - c);ctx.lineTo(w / 2, h / 2 - 3 * d);ctx.moveTo(w / 2, h / 2 + 3 * d);ctx.lineTo(w / 2, h / 2 + c);ctx.stroke();ctx.globalAlpha = 1;}
      // North arrow and scale bar.
      ctx.fillStyle = '#222';ctx.font = `bold ${14 * devicePixelRatio}px system-ui`;ctx.fillText('N ↑', w - 40 * devicePixelRatio, 30 * devicePixelRatio);
      const bar = 100 * k;ctx.fillRect(20 * devicePixelRatio, h - 30 * devicePixelRatio, bar, 4 * devicePixelRatio);ctx.fillText('100 m', 20 * devicePixelRatio + bar / 2, h - 38 * devicePixelRatio);
    }
    // The mouse needs its pointer on the map (drag, wheel, a click for the waypoint); the game gets the pointer back when it closes.
    let relock = null;
    map.toggle = player => {
      map.open = !map.open;el.hidden = !map.open;
      if (map.open && document.pointerLockElement) {relock = document.pointerLockElement;document.exitPointerLock();}
      else if (!map.open && relock) {const r = relock;relock = null;try {const p = r.requestPointerLock();if (p && p.catch) p.catch(() => {});} catch {}}
      if (map.open && player) {const l = toLocal(player.x, player.z);map.cx = l.x;map.cs = l.s;}draw(player);
    };
    map.pan = (dx, ds) => {map.cx += dx / map.scale;map.cs += ds / map.scale;};
    map.zoom = f => {map.scale = Math.max(.5, Math.min(12, map.scale * f));};
    map.draw = draw;
    // Set the waypoint at a map point, or remove it when that point is on it (within 16 screen pixels).
    function markAt(x, s) {const wp = map.waypoint;map.waypoint = wp && Math.hypot(wp.x - x, wp.s - s) * map.scale < 16 ? null : {x, s};draw();}
    map.markCentre = () => markAt(map.cx, map.cs);
    map.clearWaypoint = () => {map.waypoint = null;draw();};
    let drag = null;
    canvas.addEventListener('pointerdown', e => {drag = {x: e.clientX, y: e.clientY, moved: 0};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove', e => {if (!drag) return;map.pan(-(e.clientX - drag.x), -(e.clientY - drag.y));drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);drag.x = e.clientX;drag.y = e.clientY;});
    canvas.addEventListener('pointerup', e => {
      if (drag && drag.moved < 6 && e.button === 0) {const b = canvas.getBoundingClientRect();markAt(map.cx + (e.clientX - b.left - b.width / 2) / map.scale, map.cs + (e.clientY - b.top - b.height / 2) / map.scale);}
      drag = null;
    });
    canvas.addEventListener('wheel', e => {e.preventDefault();map.zoom(Math.exp(-e.deltaY * .0015));}, {passive: false});
    document.addEventListener('keydown', e => {if (map.open && (e.code === 'Delete' || e.code === 'Backspace')) map.clearWaypoint();});

    // ---------- Minimap (issue #42) ----------
    const mini = document.createElement('canvas');mini.id = 'minimap';mini.hidden = true;mini.setAttribute('aria-hidden', 'true');root.append(mini);
    const mg = mini.getContext('2d');
    let miniOn = false;try {miniOn = localStorage.getItem('haarklous-minimap-v1') === 'on';} catch {}
    Object.defineProperty(map, 'minimap', {get: () => miniOn, set: on => {miniOn = !!on;try {localStorage.setItem('haarklous-minimap-v1', miniOn ? 'on' : 'off');} catch {}if (!miniOn) {mini.hidden = true;root.classList.remove('has-minimap');}}});
    // Which roads, areas and buildings touch each tile (built the first time the minimap is drawn).
    let index = null;const tiles = new Map();let budget = 0;
    function buildIndex() {
      if (!feats) feats = features();
      index = new Map();
      const add = (layer, f) => {
        for (let i = Math.floor((f.x0 - PAD) / TILE); i <= Math.floor((f.x1 + PAD) / TILE); i++) for (let j = Math.floor((f.s0 - PAD) / TILE); j <= Math.floor((f.s1 + PAD) / TILE); j++) {
          const key = i + ',' + j;let t = index.get(key);if (!t) index.set(key, t = {a: [], r: [], b: []});t[layer].push(f.item);
        }
      };
      feats.areas.forEach(f => add('a', f));feats.roads.forEach(f => add('r', f));feats.buildings.forEach(f => add('b', f));
      const own = data.ownLocal, xs = own.filter((_, i) => i % 2 === 0), ss = own.filter((_, i) => i % 2 === 1);
      add('b', {item: {own: true, r: {o: own}}, x0: Math.min(...xs), x1: Math.max(...xs), s0: Math.min(...ss), s1: Math.max(...ss)});
    }
    // GTA IV-like colours: dark ground, grey roads (the big ones lighter), dim buildings.
    const AREA = {grass: '#25362a', wood: '#213224', playground: '#2f3329', pitch: '#28392b', parking: '#2a2e31', yard: '#272b2e', flowerbed: '#28362a', water: '#1d3449'};
    const ROAD = k => ['primary', 'secondary', 'trunk', 'trunk_link', 'tertiary'].includes(k) ? '#c9ced3' : PATHS.includes(k) ? '#555c62' : k === 'tram' ? '#4a5056' : '#99a0a6';
    function tile(i, j) {
      const key = i + ',' + j;let c = tiles.get(key);
      if (c) {tiles.delete(key);tiles.set(key, c);return c;}// most recently used last
      if (budget <= 0) return null;budget--;
      c = document.createElement('canvas');c.width = c.height = Math.round((TILE + 2 * PAD) * PPM);const g = c.getContext('2d'), t = index.get(key);
      g.fillStyle = '#1c2023';g.fillRect(0, 0, c.width, c.height);
      g.setTransform(PPM, 0, 0, PPM, -(i * TILE - PAD) * PPM, -(j * TILE - PAD) * PPM);g.lineCap = g.lineJoin = 'round';
      const path = flat => {g.beginPath();for (let n = 0; n < flat.length; n += 2) n ? g.lineTo(flat[n], flat[n + 1]) : g.moveTo(flat[n], flat[n + 1]);};
      if (t) {
        for (const a of t.a) {path(a.o);g.closePath();g.fillStyle = AREA[a.k] || '#24282b';g.fill();}
        for (const r of t.r) {path(r.p);g.strokeStyle = ROAD(r.k);g.lineWidth = PATHS.includes(r.k) || r.k === 'tram' ? 1.2 : Math.max(2.5, (r.w || 4) * .9);g.stroke();}
        for (const b of t.b) {path(b.r.o);g.closePath();g.fillStyle = b.own ? '#8a4a2a' : '#363b40';g.fill();}
      }
      tiles.set(key, c);if (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
      return c;
    }
    let range = 90, speed = 0, last = null;
    function drawMini({x, z, heading, view, others}) {
      const d = devicePixelRatio || 1, W = Math.round(mini.clientWidth * d);if (!W) return;
      if (mini.width !== W) mini.width = mini.height = W;
      if (!index) buildIndex();budget = 2;
      const R = W / 2, inner = R - 5 * d, k = inner / range, l = toLocal(x, z), cv = Math.cos(-view), sv = Math.sin(-view);
      const at = (px, ps) => {const dx = (px - l.x) * k, ds = (ps - l.s) * k;return [dx * cv - ds * sv, dx * sv + ds * cv];};// map point -> offset from the centre
      mg.setTransform(1, 0, 0, 1, 0, 0);mg.clearRect(0, 0, W, W);
      mg.save();mg.beginPath();mg.arc(R, R, inner, 0, 7);mg.clip();mg.fillStyle = '#1c2023';mg.fillRect(0, 0, W, W);
      mg.translate(R, R);mg.rotate(-view);mg.scale(k, k);mg.translate(-l.x, -l.s);
      const reach = range * Math.SQRT2;
      for (let i = Math.floor((l.x - reach) / TILE); i <= Math.floor((l.x + reach) / TILE); i++) for (let j = Math.floor((l.s - reach) / TILE); j <= Math.floor((l.s + reach) / TILE); j++) {
        const t = tile(i, j);if (t) mg.drawImage(t, i * TILE - PAD, j * TILE - PAD, TILE + 2 * PAD, TILE + 2 * PAD);
      }
      mg.setTransform(1, 0, 0, 1, 0, 0);
      // Places (only those in range), other players (on the rim when out of range), the waypoint (always), you in the middle.
      mg.textAlign = 'center';mg.textBaseline = 'middle';
      for (const p of poi()) {
        const [u, v] = at(p.x, p.s);if (Math.hypot(u, v) > inner - 4 * d) continue;
        const r = (p.label ? 6.5 : 3) * d;mg.fillStyle = p.color;mg.beginPath();mg.arc(R + u, R + v, r, 0, 7);mg.fill();mg.strokeStyle = '#fff';mg.lineWidth = 1.2 * d;mg.stroke();
        if (p.label) {mg.fillStyle = '#fff';mg.font = `bold ${8 * d}px system-ui`;mg.fillText(p.glyph, R + u, R + v + .5 * d);}
      }
      const arrow = (u, v, a, color, size) => {const r = size * d;mg.save();mg.translate(R + u, R + v);mg.rotate(a);mg.fillStyle = color;mg.beginPath();mg.moveTo(0, -r * 1.4);mg.lineTo(r, r);mg.lineTo(0, r * .45);mg.lineTo(-r, r);mg.closePath();mg.fill();mg.strokeStyle = '#000a';mg.lineWidth = 1.2 * d;mg.stroke();mg.restore();};
      for (const o of others || []) {const l2 = toLocal(o.x, o.z), [u, v] = at(l2.x, l2.s), q = toRim(u, v, inner - 7 * d);if (q.out) {mg.fillStyle = o.color;mg.beginPath();mg.arc(R + q.u, R + q.v, 4 * d, 0, 7);mg.fill();mg.strokeStyle = '#fff';mg.lineWidth = 1.2 * d;mg.stroke();} else arrow(q.u, q.v, o.headingLocal - view, o.color, 5);}
      if (map.waypoint) {const [u, v] = at(map.waypoint.x, map.waypoint.s), q = toRim(u, v, inner - 9 * d);pin(mg, R + q.u, R + q.v + 4 * d, 5 * d);}
      arrow(0, 0, heading - view, '#f4f4f4', 6);
      mg.restore();
      // The rim and north on it.
      mg.beginPath();mg.arc(R, R, inner + 2.5 * d, 0, 7);mg.strokeStyle = '#0b0d0f';mg.lineWidth = 5 * d;mg.stroke();
      mg.beginPath();mg.arc(R, R, R - .75 * d, 0, 7);mg.strokeStyle = '#ffffff40';mg.lineWidth = 1.5 * d;mg.stroke();
      const nx = R - Math.sin(view) * (inner - 2 * d), ny = R - Math.cos(view) * (inner - 2 * d);
      mg.fillStyle = '#0b0d0f';mg.beginPath();mg.arc(nx, ny, 8 * d, 0, 7);mg.fill();mg.fillStyle = '#fff';mg.font = `bold ${10 * d}px system-ui`;mg.fillText('N', nx, ny + .5 * d);
    }

    // ---------- The waypoint pin on screen (issue #41) ----------
    const ptr = document.createElement('div');ptr.id = 'waypoint';ptr.hidden = true;ptr.setAttribute('aria-hidden', 'true');
    ptr.innerHTML = `<i class="wp-arrow"></i><svg class="wp-pin" viewBox="0 0 24 32"><path d="M12 31C12 31 2 18.5 2 11a10 10 0 0 1 20 0c0 7.5-10 20-10 20z" fill="${WP}" stroke="#fff" stroke-width="2"/><circle cx="12" cy="11" r="3.8" fill="#fff"/></svg><b></b>`;root.append(ptr);
    const ptrText = ptr.querySelector('b'), ptrArrow = ptr.querySelector('.wp-arrow');let v3 = null, ndc = null;
    function drawPointer(camera, you, ground) {
      const wp = toWorld(map.waypoint.x, map.waypoint.s), w = root.clientWidth, h = root.clientHeight;
      if (!v3) {v3 = camera.position.clone();ndc = camera.position.clone();}// THREE.Vector3s without needing THREE here
      v3.set(wp.x, ground(wp.x, wp.z) + 1.8, wp.z);ndc.copy(v3).project(camera);v3.applyMatrix4(camera.matrixWorldInverse);
      const spot = screenSpot(v3, ndc, w, h, 52);
      ptr.hidden = false;ptr.classList.toggle('edge', spot.edge);ptr.style.transform = `translate(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px)`;
      if (spot.edge) ptrArrow.style.transform = `rotate(${spot.angle.toFixed(3)}rad) translate(17px, -7px)`;
      ptrText.textContent = distanceText(Math.hypot(wp.x - you.x, wp.z - you.z));
    }
    map.guide = ({dt, camera, x, z, you, heading, view, alt, others, ground, show}) => {
      let reached = false;
      if (map.waypoint && you) {const wp = toWorld(map.waypoint.x, map.waypoint.s);if (Math.hypot(wp.x - you.x, wp.z - you.z) <= REACH) {map.waypoint = null;reached = true;}}
      // Zoom out with speed (smoothed; a jump of more than 150 m/s is a teleport, not speed).
      if (last && dt > 0) {const v = Math.hypot(x - last.x, z - last.z) / dt;if (v < 150) speed += (v - speed) * Math.min(1, dt * 2);}last = {x, z};
      range += (minimapRange(speed, alt) - range) * Math.min(1, (dt || 0) * 1.5);
      const miniShown = miniOn && show;mini.hidden = !miniShown;root.classList.toggle('has-minimap', miniShown);
      if (miniShown) drawMini({x, z, heading, view, others});
      if (map.waypoint && show && camera) drawPointer(camera, you, ground);else ptr.hidden = true;
      return reached ? 'reached' : null;
    };
    return map;
  }
  return {create, edgePoint, screenSpot, toRim, distanceText, minimapRange, REACH};
});
