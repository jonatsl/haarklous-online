/* The neighbourhood of Haarklous plass 17A for the open-world game, built from surroundings-data.js
 * (OpenStreetMap ODbL, Kartverket DTM CC BY 4.0). Terrain from real height data; buildings stand on it; trees,
 * bushes, courtyard dressing, street lamps; sky and the hills around Oslo. Ground texture: an offline map
 * painting; when online and allowed, Esri World Imagery is fetched live and painted onto the terrain.
 * Surroundings.create({T, lib, data, renderer, onStatus}) -> {
 *   near, far, setImagery(on), setSun(dir), setOvercast(0..1), attribution,
 *   heightWorld(x, z) -> y, toLocal(x, z) -> {x, s}, toWorld(x, s) -> {x, z},
 *   terrainFloor() (walk-collision floor), obstacles() (buildings, trees, lamp posts, bushes, hedges, in model coordinates),
 *   surfaceAt(x, z) -> 'grass'|'asphalt'|'gravel'|'sand'|'none', trafficDistance(x, z), greenery(x, z) -> 0..1,
 *   terrainFloors() (the old square and one floor per district patch), update(cameraWorldPosition), yLocal(x, s), geoNear, geoFar }
 * districts: decoded district patches (District.decode of window.DISTRICTS, issue #38: Gamle Oslo, Ensjø and the way there),
 *   each with its own 8 m ground grid, buildings, streets, areas, trees and sea, drawn and walkable like the old square.
 * Coordinates: model (world) metres as in the apartment model; "local" = metres east (x) and south (s) of the address.
 */
(function (root, factory) {
  root.Surroundings = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // Everything you can walk to (±PLAY_HALF) is drawn in the near pass with detailed ground; the far pass (which clips
  // anything closer than 15 m and is drawn underneath) only fills in the distance. NEAR_REACH covers the walkable area.
  // ±760 m since 29 Oct 2026 (was ±540): the real Muselunden disc golf park, 470–815 m north-east of home, is in reach.
  const PLAY_HALF = 760, NEAR_REACH = PLAY_HALF + 60, CELL = 270;
  // holes: rectangles of the local frame ({x0, s0, x1, s1}) kept free of trees and bushes (the paved paintball yard, the building site).
  function create({T, lib, data, renderer, onStatus = () => {}, holes = [], districts = []}) {
    const W = typeof window === 'undefined' ? globalThis : window, DZ = W.District;
    // Shared ground detail and facade atlas (issues #67 and #68).
    const CT = W.CityTextures, city = CT.create(T, renderer), looks = CT.looksOf(W.BUILDING_LOOKS);
    const near = new T.Group(), far = new T.Group();near.name = 'Surroundings (near)';far.name = 'Surroundings (far)';
    const ground = data.ground, theta = data.geo.theta, cT = Math.cos(theta), sT = Math.sin(theta);
    const geoFrame = parent => {const g = new T.Group();g.rotation.y = theta;g.position.set(data.geo.x, 0, data.geo.z);parent.add(g);return g;};
    const geoNear = geoFrame(near), geoFar = geoFrame(far);
    const toWorld = (x, s) => ({x: x * cT + s * sT + data.geo.x, z: -x * sT + s * cT + data.geo.z});
    const toLocal = (x, z) => {const dx = x - data.geo.x, dz = z - data.geo.z;return {x: dx * cT - dz * sT, s: dx * sT + dz * cT};};
    const pairs = flat => {const out = [];for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);return out;};
    const signedArea = ring => ring.reduce((s, p, i) => {const q = ring[(i + 1) % ring.length];return s + p[0] * q[1] - q[0] * p[1];}, 0) / 2;

    // ---------- Terrain (relative heights in decimetres, 4 m grid, local frame) ----------
    const ter = data.terrain, N = ter.n, half = ter.half, step = ter.step;
    const grid = (() => {const bin = atob(ter.dm), bytes = new Uint8Array(bin.length);for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);const raw = new Int16Array(bytes.buffer), f = new Float32Array(raw.length);for (let i = 0; i < raw.length; i++) f[i] = raw[i] / 10;return f;})();
    function relSquare(x, s) {
      const fi = Math.min(N - 1.001, Math.max(0, (x + half) / step)), fj = Math.min(N - 1.001, Math.max(0, (s + half) / step)), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
      return grid[j * N + i] * (1 - u) * (1 - v) + grid[j * N + i + 1] * u * (1 - v) + grid[(j + 1) * N + i] * (1 - u) * v + grid[(j + 1) * N + i + 1] * u * v;
    }
    // The old ±800 m grid first (district grids copy its values where they overlap), then the district patches; outside all
    // data the height of the nearest edge point.
    function relLocal(x, s) {
      if (!districts.length || (Math.abs(x) <= half && Math.abs(s) <= half)) return relSquare(x, s);
      for (const d of districts) if (DZ.covers(d, x, s)) return DZ.height(d, x, s);
      const cl = (v, a, b) => Math.max(a, Math.min(b, v));
      let best = relSquare(x, s), bd = Math.hypot(x - cl(x, -half, half), s - cl(s, -half, half));
      for (const d of districts) {const cx = cl(x, d.x0, d.x1), cs = cl(s, d.s0, d.s1), dd = Math.hypot(x - cx, s - cs);if (dd < bd) {bd = dd;best = DZ.height(d, cx, cs);}}
      return best;
    }
    const yLocal = (x, s) => ground + relLocal(x, s);
    const heightWorld = (x, z) => {const l = toLocal(x, z);return yLocal(l.x, l.s);};
    function terrainMesh(parent, extent, res, canvas, name, drop = 0, hole = 0, cut = [], detail = true) {
      const count = Math.round(2 * extent / res) + 1, pos = new Float32Array(count * count * 3), uv = new Float32Array(count * count * 2), index = [];
      for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) {
        const x = -extent + i * res, s = -extent + j * res, k = j * count + i;
        pos[k * 3] = x;pos[k * 3 + 1] = yLocal(x, s) - drop;pos[k * 3 + 2] = s;uv[k * 2] = (x + extent) / (2 * extent);uv[k * 2 + 1] = 1 - (s + extent) / (2 * extent);
      }
      // Cells inside the square `hole` (outer ring) or wholly inside a `cut` rectangle (the construction site's soil) are left out.
      const inHole = (i, j) => hole > 0 && -extent + i * res >= -hole - 1e-6 && -extent + (i + 1) * res <= hole + 1e-6 && -extent + j * res >= -hole - 1e-6 && -extent + (j + 1) * res <= hole + 1e-6;
      const inCut = (i, j) => cut.some(h => -extent + i * res >= h.x0 && -extent + (i + 1) * res <= h.x1 && -extent + j * res >= h.s0 && -extent + (j + 1) * res <= h.s1);
      for (let j = 0; j < count - 1; j++) for (let i = 0; i < count - 1; i++) {if (inHole(i, j) || inCut(i, j)) continue;const a = j * count + i, b = a + 1, c = a + count, d = c + 1;index.push(a, c, b, b, c, d);}
      const g = new T.BufferGeometry();g.setAttribute('position', new T.BufferAttribute(pos, 3));g.setAttribute('uv', new T.BufferAttribute(uv, 2));g.setIndex(index);g.computeVertexNormals();
      const tex = new T.CanvasTexture(canvas);tex.colorSpace = T.SRGBColorSpace;tex.anisotropy = 8;
      const mat = new T.MeshStandardMaterial({map: tex, color: 0xa6a6a6, roughness: .97, metalness: 0, envMapIntensity: .35});if (detail) city.ground(mat);
      const m = new T.Mesh(g, mat);m.receiveShadow = true;m.name = name;parent.add(m);return {mesh: m, tex};
    }

    // ---------- Map painting (offline ground texture) and surface classes ----------
    const colors = {grass: '#5d7a3a', wood: '#3f5a2c', playground: '#a8946a', pitch: '#4d7944', parking: '#6c6d6f', yard: '#9a958a', flowerbed: '#5e5136', water: '#4a6a80'};
    const roadOrder = ['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'service', 'track', 'living_street', 'unclassified', 'residential', 'tertiary', 'secondary', 'primary', 'trunk_link', 'trunk', 'tram'];
    const isPath = k => ['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'track'].includes(k);
    // Issue #67: pavements of the car streets (light grey, with a granite kerb line at the road edge), gravel paths a little warmer than
    // paved footways, asphalt cycleways, each grass or park area a slightly different green, and less pixel noise (the terrain shader
    // adds the detail now). Pavement widths are typical for Oslo streets (Street View, 3 Nov 2026).
    const SIDEWALK = {residential: 2.2, living_street: 1.4, unclassified: 1.8, tertiary: 2.8, tertiary_link: 2, secondary: 3, secondary_link: 2, primary: 3.2, primary_link: 2};
    const pathColour = k => ({footway: '#a9a59b', path: '#aea38e', track: '#a99c84', bridleway: '#a99c84', cycleway: '#5f6062', steps: '#a09d96', pedestrian: '#a3a099'})[k] || '#a7a296';
    // The same tone for an area in every painting (near, outer, far, and again when the aerial photo is switched off): keyed, not random.
    const jitter = (hex, amount, key) => {const c = new T.Color(hex), f = 1 + (CT.hash(key * 2 + 1) - .5) * amount, g = 1 + (CT.hash(key * 2 + 2) - .5) * amount * .6;c.r *= f;c.g *= f * g;c.b *= f;return '#' + c.getHexString();};
    function paintStreets(ctx, roads, P, k, classes) {
      const line = (r, width, colour) => {ctx.strokeStyle = colour;ctx.lineWidth = width * k;ctx.lineCap = ctx.lineJoin = 'round';ctx.beginPath();for (let i = 0; i + 1 < r.p.length; i += 2) {const [x, y] = P(r.p[i], r.p[i + 1]);i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);}ctx.stroke();};
      // Torshov, Sandaker, Myrens and Ensjø have asphalt pavements; Grünerløkka, Tøyen, Grønland, Kampen and Bjørvika granite slabs.
      const slabs = r => ['lokka', 'toyen', 'gronland', 'kampen', 'bjorvika'].includes(CT.zoneAt(r.p[0], r.p[1]));
      for (const r of roads) if (SIDEWALK[r.k]) line(r, r.w + 2 * SIDEWALK[r.k], classes ? '#020000' : slabs(r) ? '#a29f98' : '#646567');
      for (const r of roads) if (SIDEWALK[r.k]) line(r, r.w + .5, classes ? '#020000' : '#aeaba3');
    }
    function paint(size, ext, classes = false) {
      const c = document.createElement('canvas');c.width = c.height = size;const ctx = c.getContext('2d'), s = size / (2 * ext), P = (x, y) => [(x + ext) * s, (y + ext) * s];
      const col = (kind, normal) => classes ? ({grass: '#010000', asphalt: '#020000', gravel: '#030000', sand: '#040000', none: '#050000'})[kind] : normal;
      ctx.fillStyle = col('grass', '#62783f');ctx.fillRect(0, 0, size, size);
      const ring = (flat, color) => {ctx.fillStyle = color;ctx.beginPath();pairs(flat).forEach((p, i) => {const [x, y] = P(p[0], p[1]);i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);});ctx.closePath();ctx.fill();};
      data.areas.forEach((a, i) => {if (a.k === 'grass' || a.k === 'wood') ring(a.o, col('grass', jitter(colors[a.k], .16, i)));});
      data.areas.forEach((a, i) => {if (a.k !== 'grass' && a.k !== 'wood') ring(a.o, col(a.k === 'parking' ? 'asphalt' : a.k === 'playground' ? 'sand' : a.k === 'yard' ? 'gravel' : 'grass', jitter(colors[a.k] || '#888', .1, i)));});
      paintStreets(ctx, data.roads, P, s, classes);
      for (const r of data.roads.slice().sort((a, b) => roadOrder.indexOf(a.k) - roadOrder.indexOf(b.k))) {
        ctx.strokeStyle = col(isPath(r.k) && r.k !== 'cycleway' ? 'gravel' : 'asphalt', r.k === 'tram' ? '#545556' : isPath(r.k) ? pathColour(r.k) : '#57595c');ctx.lineWidth = r.w * s;ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();pairs(r.p).forEach((p, i) => {const [x, y] = P(p[0], p[1]);i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);});ctx.stroke();
      }
      const yard = data.courtyard;
      if (yard) {ctx.lineCap = 'round';ctx.strokeStyle = col('gravel', '#b4a78f');ctx.lineWidth = yard.pathWidth * s;ctx.beginPath();pairs(yard.path).forEach((p, i) => {const [x, y] = P(p[0], p[1]);i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);});ctx.stroke();if (yard.playground) ring(yard.playground.o, col('sand', '#c9b48a'));}
      if (data.petanque) {const p = data.petanque, cx = Math.cos(p.rot), sx = Math.sin(p.rot);ring([[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([a, b]) => [p.x + cx * a * (p.length / 2 + .3) - sx * b * (p.width / 2 + .3), p.s + sx * a * (p.length / 2 + .3) + cx * b * (p.width / 2 + .3)]), col('gravel', '#c2b49a'));}
      for (const h of data.discgolf || []) {const [tx, ts] = h.tee;ctx.fillStyle = col('gravel', '#59544c');ctx.beginPath();const [px, py] = P(tx, ts);ctx.arc(px, py, 1.4 * s, 0, 7);ctx.fill();}
      for (const b of data.buildings) ring(b.r.o, col('none', '#5a5652'));
      if (!classes) {const img = ctx.getImageData(0, 0, size, size), d = img.data;for (let i = 0; i < d.length; i += 4) {const n = (lib.rand() - .5) * 12;d[i] += n;d[i + 1] += n;d[i + 2] += n;}ctx.putImageData(img, 0, 0);}
      return c;
    }
    const NEAR_EXT = 300, FAR_EXT = 800;// the terrain data reaches ±800 m
    const nearPaint = paint(4096, NEAR_EXT), nearBase = document.createElement('canvas');nearBase.width = nearBase.height = 4096;nearBase.getContext('2d').drawImage(nearPaint, 0, 0);
    const farPaint = paint(2048, FAR_EXT), farBase = document.createElement('canvas');farBase.width = farBase.height = 2048;farBase.getContext('2d').drawImage(farPaint, 0, 0);
    const outerPaint = paint(2048, PLAY_HALF), outerBase = document.createElement('canvas');outerBase.width = outerBase.height = 2048;outerBase.getContext('2d').drawImage(outerPaint, 0, 0);
    const classCanvas = paint(1024, PLAY_HALF, true), classData = classCanvas.getContext('2d').getImageData(0, 0, 1024, 1024).data;
    const surfaceNames = ['grass', 'grass', 'asphalt', 'gravel', 'sand', 'none'];
    function surfaceAt(x, z) {
      const l = toLocal(x, z);
      if (Math.abs(l.x) > PLAY_HALF || Math.abs(l.s) > PLAY_HALF) {const P = patchAt(l.x, l.s);if (P) {const d = P.d, n = P.classSize, i = Math.min(n - 1, Math.floor((l.x - d.x0) / (d.x1 - d.x0) * n)), j = Math.min(n - 1, Math.floor((l.s - d.s0) / (d.s1 - d.s0) * n));return surfaceNames[P.classes[j * n + i]] || 'grass';}}
      const i = Math.floor((l.x + PLAY_HALF) / (2 * PLAY_HALF) * 1024), j = Math.floor((l.s + PLAY_HALF) / (2 * PLAY_HALF) * 1024);if (i < 0 || j < 0 || i > 1023 || j > 1023) return 'grass';return surfaceNames[classData[(j * 1024 + i) * 4]] || 'grass';}
    const nearTerrain = terrainMesh(geoNear, NEAR_EXT, 4, nearPaint, 'Terrain (near)', 0, 0, holes.filter(h => h.cutGround));
    // Walkable ground from ±300 m out to ±PLAY_HALF: same 4 m grid as the walking surface, so what you see is what you stand on.
    const outerTerrain = terrainMesh(geoNear, PLAY_HALF, 4, outerPaint, 'Terrain (outer)', 0, NEAR_EXT, holes.filter(h => h.cutGround));
    const farTerrain = terrainMesh(geoFar, FAR_EXT, 8, farPaint, 'Terrain (district)', .5, 0, [], false);
    // Beyond the mapped district: a generic Oslo townscape tile (blocks of roofs, streets, gardens and parks), repeated about every
    // 1.5 km, so the land seen from the aircraft is not one flat colour. The inner Oslofjord lies about 3 km to the south.
    const horizonCanvas = document.createElement('canvas');horizonCanvas.width = horizonCanvas.height = 512;
    {
      const c = horizonCanvas.getContext('2d');c.fillStyle = '#7f8574';c.fillRect(0, 0, 512, 512);
      const roofs = ['#8d8c88', '#9b6c57', '#6f7071', '#aeaca4', '#7b5d4e', '#848a7a', '#a39b8c'];
      for (let k = 0; k < 22; k++) {const x = lib.rand() * 512, y = lib.rand() * 512, r = 18 + lib.rand() * 45;c.fillStyle = lib.rand() < .7 ? '#5f7c4b' : '#4f6a40';c.beginPath();c.ellipse(x, y, r, r * (.5 + lib.rand() * .6), lib.rand() * 3, 0, 7);c.fill();}
      for (let gy = 0; gy < 512; gy += 26) for (let gx = 0; gx < 512; gx += 30) {
        if (lib.rand() < .16) continue;const w = 8 + lib.rand() * 16, h = 6 + lib.rand() * 14;
        c.fillStyle = roofs[Math.floor(lib.rand() * roofs.length)];c.fillRect(gx + 3 + lib.rand() * (24 - w), gy + 3 + lib.rand() * (20 - h), w, h);
        if (lib.rand() < .5) {c.fillStyle = '#6b8456';c.fillRect(gx + 2 + lib.rand() * 20, gy + 2 + lib.rand() * 16, 6, 5);}
      }
      c.strokeStyle = '#5d5f60';c.lineWidth = 2.2;for (let k = 0; k < 512; k += 30) {c.beginPath();c.moveTo(k, 0);c.lineTo(k, 512);c.stroke();}for (let k = 0; k < 512; k += 26) {c.beginPath();c.moveTo(0, k);c.lineTo(512, k);c.stroke();}
      const img = c.getImageData(0, 0, 512, 512), d = img.data;for (let i = 0; i < d.length; i += 4) {const n = (lib.rand() - .5) * 18;d[i] += n;d[i + 1] += n;d[i + 2] += n;}c.putImageData(img, 0, 0);
    }
    const horizonTex = new T.CanvasTexture(horizonCanvas);horizonTex.colorSpace = T.SRGBColorSpace;horizonTex.wrapS = horizonTex.wrapT = T.RepeatWrapping;horizonTex.repeat.set(12, 12);horizonTex.anisotropy = 8;
    // Live aerial imagery for the distance is drawn once over the whole ±9 km (not repeated like the townscape tile).
    const horizonImg = document.createElement('canvas');horizonImg.width = horizonImg.height = 2048;
    const horizonImgTex = new T.CanvasTexture(horizonImg);horizonImgTex.colorSpace = T.SRGBColorSpace;horizonImgTex.anisotropy = 8;
    const horizonMat = new T.MeshStandardMaterial({map: horizonTex, color: 0xb4b4b4, roughness: 1});
    // The flat land beyond the terrain data lies below the lowest ground in the data, so it never floats above the real ground
    // (issue #17: it used to sit at the height of one corner, 40–60 m above the low ground south-west of home). An apron
    // joins the terrain's edge to it: it starts at exactly the edge heights and eases down (or up) to that level by 3 km out.
    let lowest = Infinity;for (let i = 0; i < grid.length; i++) lowest = Math.min(lowest, grid[i]);
    for (const d of districts) for (let i = 0; i < d.h.length; i++) lowest = Math.min(lowest, Math.max(d.h[i], d.seaRel));// a pit below sea level does not count
    const BASE_Y = ground + lowest - 2, APRON = 3000;
    // Ground data covers the old square (far ground on an 8 m grid) and each district patch (16 m); the apron fills
    // everything else, starting at exactly the nearest data edge's height and easing to BASE_Y by 3 km out.
    const regions = [{x0: -FAR_EXT, s0: -FAR_EXT, x1: FAR_EXT, s1: FAR_EXT, step: 8}, ...districts.map(d => ({x0: d.x0, s0: d.s0, x1: d.x1, s1: d.s1, step: 16}))];
    function apronY(x, z) {
      const ease = t => t * t * (3 - 2 * t), cl = (v, a, b) => Math.max(a, Math.min(b, v));
      let out = Infinity, ex = x, ez = z;
      for (const r of regions) {const cx = cl(x, r.x0, r.x1), cz = cl(z, r.s0, r.s1), d = Math.hypot(x - cx, z - cz);if (d < out) {out = d;ex = cx;ez = cz;}}
      const edge = yLocal(ex, ez) - .5;// the far terrain's own height at the nearest edge point (it is drawn .5 m low)
      return out <= 1e-6 ? edge : edge + (BASE_Y - edge) * ease(Math.min(1, out / APRON));
    }
    {
      const ticksOf = (k0, k1) => {
        const set = new Set(), lo = Math.min(...regions.map(r => r[k0])), hi = Math.max(...regions.map(r => r[k1]));
        for (const r of regions) for (let v = r[k0]; v <= r[k1] + 1e-6; v += r.step) set.add(v);
        for (const d of [40, 100, 200, 400, 700, 1100, 1600, 2200, APRON]) {set.add(lo - d);set.add(hi + d);}
        return [...set].sort((a, b) => a - b);
      };
      const xt = ticksOf('x0', 'x1'), zt = ticksOf('s0', 's1'), nx = xt.length, nz = zt.length, pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), index = [];
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = xt[i], z = zt[j], k = j * nx + i;
        pos[k * 3] = x;pos[k * 3 + 1] = apronY(x, z);pos[k * 3 + 2] = z;
        uv[k * 2] = (x + 9000) / 18000;uv[k * 2 + 1] = 1 - (z + 9000) / 18000;
      }
      const inData = (i, j) => regions.some(r => xt[i] >= r.x0 - 1e-6 && xt[i + 1] <= r.x1 + 1e-6 && zt[j] >= r.s0 - 1e-6 && zt[j + 1] <= r.s1 + 1e-6);
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        if (inData(i, j)) continue;// inside the terrain data
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;index.push(a, c, b, b, c, d);
      }
      const geo = new T.BufferGeometry();geo.setAttribute('position', new T.BufferAttribute(pos, 3));geo.setAttribute('uv', new T.BufferAttribute(uv, 2));geo.setIndex(index);geo.computeVertexNormals();
      const apron = new T.Mesh(geo, horizonMat);apron.name = 'Terrain (apron)';apron.receiveShadow = true;geoFar.add(apron);
    }
    const horizon = new T.Mesh(new T.PlaneGeometry(18000, 18000), horizonMat);
    horizon.rotation.x = -Math.PI / 2;horizon.position.y = BASE_Y - .5;geoFar.add(horizon);
    const fjord = new T.Mesh(new T.PlaneGeometry(7000, 6000), new T.MeshStandardMaterial({color: 0x3e5d70, roughness: .18, metalness: .15, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}));
    fjord.rotation.x = -Math.PI / 2;fjord.position.set(-600, horizon.position.y + 2, 6200);geoFar.add(fjord);

    // ---------- Buildings ----------
    function builder() {return {pos: [], nor: [], uv: [], col: [], index: []};}
    function finish(b) {
      if (!b.pos.length) return null;
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));g.setAttribute('normal', new T.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));if (b.col.length) g.setAttribute('color', new T.Float32BufferAttribute(b.col, 3));
      if (b.cell && b.cell.length) {g.setAttribute('aCell', new T.Float32BufferAttribute(b.cell, 3));g.setAttribute('aTint', new T.Float32BufferAttribute(b.tint, 3));}g.setIndex(b.index);g.computeBoundingSphere();return g;
    }
    function quad(b, a, c, y0, y1, u0, u1, v0, v1, color) {
      const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len, base = b.pos.length / 3;
      b.pos.push(a[0], y0, a[1], c[0], y0, c[1], c[0], y1, c[1], a[0], y1, a[1]);
      for (let i = 0; i < 4; i++) b.nor.push(nx, 0, nz);
      b.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);if (color) for (let i = 0; i < 4; i++) b.col.push(color.r, color.g, color.b);
      b.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    function cap(b, ring, holes, y, color) {
      const contour = ring.map(p => new T.Vector2(p[0], p[1])), hs = (holes || []).map(h => h.map(p => new T.Vector2(p[0], p[1])));
      const tris = T.ShapeUtils.triangulateShape(contour, hs), all = contour.concat(...hs), base = b.pos.length / 3;
      for (const p of all) {b.pos.push(p.x, y, p.y);b.nor.push(0, 1, 0);b.uv.push(p.x, p.y);if (color) b.col.push(color.r, color.g, color.b);}
      for (const t of tris) b.index.push(base + t[0], base + t[2], base + t[1]);
    }
    function walls(b, ring, y0, y1, vBase, color) {
      const r = signedArea(ring) > 0 ? ring.slice().reverse() : ring;let u = 0;
      for (let i = 0; i < r.length; i++) {const a = r[i], c = r[(i + 1) % r.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);if (len < .02) continue;quad(b, a, c, y0, y1, u, u + len, y0 - vBase, y1 - vBase, color);u += len;}
    }
    function hipRoof(b, corners, eave) {
      let p = corners.map(c => new T.Vector2(c[0], c[1]));
      const centre = p.reduce((s, v) => s.add(v), new T.Vector2()).multiplyScalar(.25);
      p = p.map(v => v.clone().add(v.clone().sub(centre).normalize().multiplyScalar(.35 * Math.SQRT2)));
      let [a, bb, c, d] = p;if (a.distanceTo(bb) < bb.distanceTo(c)) [a, bb, c, d] = [bb, c, d, a];
      const width = bb.distanceTo(c), rise = width / 2 * Math.tan(27 * Math.PI / 180), axis = bb.clone().sub(a).normalize();
      const r1 = a.clone().add(d).multiplyScalar(.5).addScaledVector(axis, width / 2), r2 = bb.clone().add(c).multiplyScalar(.5).addScaledVector(axis, -width / 2), top = eave + rise;
      for (const f of [[a, bb, r2, r1], [c, d, r1, r2], [d, a, r1], [bb, c, r2]]) {
        const pts = f.map((v, i) => new T.Vector3(v.x, i < 2 ? eave : top, v.y)), n = new T.Vector3().subVectors(pts[1], pts[0]).cross(new T.Vector3().subVectors(pts[pts.length - 1], pts[0])).normalize();
        if (n.y < 0) {pts.reverse();n.negate();}
        const base = b.pos.length / 3;for (const v of pts) {b.pos.push(v.x, v.y, v.z);b.nor.push(n.x, n.y, n.z);b.uv.push(v.x, v.z);}
        b.index.push(base, base + 1, base + 2);if (pts.length === 4) b.index.push(base, base + 2, base + 3);
      }
    }
    // Facades (issue #68): every building gets a look (CityTextures.classify: its type, height, place and OSM tags) and its walls
    // are cut into plinth / ground-floor / storey / cornice bands that pick cells of one shared atlas, so a tile of buildings is
    // one mesh with one material (walls and roofs). Far away the same looks are vertex colours.
    const cityMat = city.material(), farMat = new T.MeshStandardMaterial({vertexColors: true, roughness: .9, metalness: 0});
    const cityBuilder = () => ({pos: [], nor: [], uv: [], col: [], cell: [], tint: [], index: []});
    // Give the vertices added by fn() their atlas cell, tint and building seed (and scale their UVs to cell units).
    function attrs(b, fn, cell, mode, seed, tint, us = 1, vs = 1) {
      const n0 = b.pos.length / 3;fn();const n1 = b.pos.length / 3, i = CT.CELLS[cell].i;
      for (let k = n0; k < n1; k++) {b.uv[k * 2] *= us;b.uv[k * 2 + 1] *= vs;b.cell.push(i, mode, seed);b.tint.push(tint.r, tint.g, tint.b);}
    }
    // Ground-floor shops and cafés (OSM nodes): each marks the nearest wall of the building it is in or next to (within 6 m).
    const shopGrid = new Map();
    for (let k = 0; k + 1 < looks.shops?.length; k += 2) {const x = looks.shops[k], s = looks.shops[k + 1], key = `${Math.floor(x / 50)},${Math.floor(s / 50)}`;if (!shopGrid.has(key)) shopGrid.set(key, []);shopGrid.get(key).push([x, s]);}
    const segDist = (p, a, c) => {const dx = c[0] - a[0], ds = c[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * ds) / (dx * dx + ds * ds || 1)));return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * ds);};
    const insideRing = (p, ring) => {let r = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], c = ring[j];if ((a[1] > p[1]) !== (c[1] > p[1]) && p[0] < (c[0] - a[0]) * (p[1] - a[1]) / (c[1] - a[1]) + a[0]) r = !r;}return r;};
    function shopEdges(ring) {
      let x0 = Infinity, s0 = Infinity, x1 = -Infinity, s1 = -Infinity;for (const [x, s] of ring) {x0 = Math.min(x0, x);x1 = Math.max(x1, x);s0 = Math.min(s0, s);s1 = Math.max(s1, s);}
      const marked = new Set();
      for (let i = Math.floor((x0 - 6) / 50); i <= Math.floor((x1 + 6) / 50); i++) for (let j = Math.floor((s0 - 6) / 50); j <= Math.floor((s1 + 6) / 50); j++) for (const p of shopGrid.get(`${i},${j}`) || []) {
        if (p[0] < x0 - 6 || p[0] > x1 + 6 || p[1] < s0 - 6 || p[1] > s1 + 6) continue;
        let best = -1, bd = 6;ring.forEach((a, e) => {const d = segDist(p, a, ring[(e + 1) % ring.length]);if (d < bd || (best < 0 && insideRing(p, ring) && d < 40)) {bd = d;best = e;}});
        if (best >= 0) marked.add(best);
      }
      return marked;
    }
    // Walls of one building in the atlas builder (near) and in a vertex-coloured builder (far).
    function cityWalls(b, ring, look, bottom, g0, top, tint, seed) {
      const cw = signedArea(ring) > 0, r = cw ? ring.slice().reverse() : ring, shops = shopEdges(ring), n = r.length;
      const hasShop = shops.size > 0 && look.shops !== false, L = hasShop ? CT.shopLook(look) : look, plain = CT.wallBands(L, g0, bottom, top, false), shop = hasShop ? CT.wallBands(L, g0, bottom, top, true) : plain;
      for (let i = 0; i < n; i++) {
        const a = r[i], c = r[(i + 1) % n], len = Math.hypot(c[0] - a[0], c[1] - a[1]);if (len < .02) continue;
        const e = cw ? (n - 2 - i + n) % n : i;// the same edge in the unreversed ring
        for (const band of shops.has(e) ? shop : plain) attrs(b, () => quad(b, a, c, band.y0, band.y1, 0, CT.edgeU(len, band.bay), band.v0, band.v1), band.cell, band.mode, seed, tint);
      }
    }
    const roofTile = cell => [1 / CT.CELLS[cell].w, 1 / CT.CELLS[cell].h];
    function cityRoof(b, ring, hip, top, look, seed) {
      const t = new T.Color(look.roofTint), [us, vs] = roofTile(look.roof), i0 = b.index.length;
      attrs(b, () => hip ? hipRoof(b, hip, top) : cap(b, ring, null, top), look.roof, 0, seed, t, us, vs);
      // The atlas material is single-sided: turn a flat roof's triangles to face up if the outline ran the other way.
      if (!hip && b.index.length > i0) {
        const P = k => [b.pos[k * 3], b.pos[k * 3 + 2]], [a, c, d] = [P(b.index[i0]), P(b.index[i0 + 1]), P(b.index[i0 + 2])];
        if ((c[1] - a[1]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[1] - a[1]) < 0) for (let k = i0; k < b.index.length; k += 3) {const tmp = b.index[k + 1];b.index[k + 1] = b.index[k + 2];b.index[k + 2] = tmp;}
      }
    }
    function farBuilding(f, ring, hip, look, bottom, top, tint) {
      walls(f, ring, bottom, top, 0, city.farColour(look.upper, tint));
      const rc = city.farColour(look.roof, new T.Color(look.roofTint)), n0 = f.pos.length / 3;
      if (hip) {hipRoof(f, hip, top);for (let k = n0; k < f.pos.length / 3; k++) f.col.push(rc.r, rc.g, rc.b);} else cap(f, ring, null, top, rc);
    }
    const lookCount = {}, hashSeed = n => CT.hash(n * 7919 + 17);
    const keepBrick = new Set((W.GameShops?.SHOPS || []).map(s => s.building));// the shop fills use lib.facade
    const nearCells = new Map(), farSet = cityBuilder(), cellKey = (x, s) => `${Math.floor((x + CELL / 2) / CELL)},${Math.floor((s + CELL / 2) / CELL)}`;
    const nearCell = (x, s) => {const k = cellKey(x, s);if (!nearCells.has(k)) nearCells.set(k, cityBuilder());return nearCells.get(k);};
    data.buildings.forEach((b, i) => {
      const ring = pairs(b.r.o), cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cs = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const g0 = ground + (b.g || 0), bottom = ground + (b.gm ?? b.g ?? 0) - .6, top = g0 + b.h;
      b.base = g0;b.top = top;b.bottom = bottom;
      const tags = looks.old(i) || {}, keep = b.enter !== undefined || keepBrick.has(i) ? 'brick' : null;
      const look = CT.classify({style: b.s, kind: tags.kind || (b.s === 'brick' ? 'apartments' : ''), h: b.h, x: cx, s: cs, colour: tags.colour || b.c, roofColour: tags.roofColour, roofShape: tags.roofShape,
        material: tags.material, year: tags.year, heritage: tags.heritage, architect: tags.architect, seed: i + 1, keep});
      b.look = look.cls;lookCount[look.cls] = (lookCount[look.cls] || 0) + 1;
      const tint = new T.Color(look.tint), seed = hashSeed(i + 1), hip = b.k ? pairs(b.k) : null;
      if (Math.hypot(cx, cs) < NEAR_REACH) {const set = nearCell(cx, cs);cityWalls(set, ring, look, bottom, g0, top, tint, seed);cityRoof(set, ring, hip, top, look, seed);}
      farBuilding(farSet, ring, hip, look, bottom, top, tint);
    });
    const own = data.own, ownSet = {facade: builder(), plinth: builder(), roof: builder()}, plinthTop = ground + data.plinth;
    const ownBottom = ground + Math.min(...pairs(data.ownLocal).map(p => relLocal(p[0], p[1]))) - .6;
    for (const part of own.lower) {walls(ownSet.plinth, pairs(part.o), ownBottom, plinthTop, ground);walls(ownSet.facade, pairs(part.o), plinthTop, -.16, plinthTop);}
    for (const part of own.band) walls(ownSet.facade, pairs(part.o), -.16, own.bandTop, plinthTop);
    for (const part of own.upper) {walls(ownSet.facade, pairs(part.o), own.bandTop, own.top, plinthTop);cap(ownSet.roof, pairs(part.o), part.h.map(pairs), own.top);}
    for (const r of own.roof) hipRoof(ownSet.roof, pairs(r), own.top);
    // The own building keeps its own materials (lib.facade / lib.plinth are painted from the same atlas cells as its neighbours).
    const facadeMat = lib.facade(), plinthMat = lib.plinth(), roofMat = lib.roof();roofMat.side = T.DoubleSide;
    const add = (parent, geometry, material, shadows = true) => {if (!geometry) return null;const m = new T.Mesh(geometry, material);m.castShadow = m.receiveShadow = shadows;parent.add(m);return m;};
    // Near buildings stay in 270 m tiles (not merged together) so the camera and the sun's shadow pass skip tiles out of view.
    for (const set of nearCells.values()) {const m = add(geoNear, finish(set), cityMat);if (m) {m.name = 'Buildings (tile)';m.userData.noMerge = true;}}
    {const m = add(geoFar, finish(farSet), farMat, false);if (m) m.name = 'Buildings (far)';}
    const ownGroup = new T.Group();ownGroup.name = 'Haarklous plass 17 (own building)';near.add(ownGroup);
    add(ownGroup, finish(ownSet.facade), facadeMat);add(ownGroup, finish(ownSet.plinth), plinthMat);add(ownGroup, finish(ownSet.roof), roofMat);

    // ---------- Aerial imagery painted onto the terrain textures ----------
    const KX = 111320 * Math.cos(data.origin.lat * Math.PI / 180);
    const tileUrl = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    const lonToX = (lon, z) => (lon + 180) / 360 * 2 ** z, latToY = (lat, z) => {const r = lat * Math.PI / 180;return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z;};
    const xToLon = (x, z) => x / 2 ** z * 360 - 180, yToLat = (y, z) => {const n = Math.PI - 2 * Math.PI * y / 2 ** z;return 180 / Math.PI * Math.atan(Math.sinh(n));};
    let imageryToken = 0, imageryState = 'off';
    function loadTiles(zoom, ext, token) {
      const lat = data.origin.lat, lon = data.origin.lon, dLon = ext / KX, dLat = ext / 111320;
      const x0 = Math.floor(lonToX(lon - dLon, zoom)), x1 = Math.floor(lonToX(lon + dLon, zoom)), y0 = Math.floor(latToY(lat + dLat, zoom)), y1 = Math.floor(latToY(lat - dLat, zoom));
      const c = document.createElement('canvas');c.width = (x1 - x0 + 1) * 256;c.height = (y1 - y0 + 1) * 256;const ctx = c.getContext('2d');
      const bounds = {west: (xToLon(x0, zoom) - lon) * KX, east: (xToLon(x1 + 1, zoom) - lon) * KX, north: (yToLat(y0, zoom) - lat) * 111320, south: (yToLat(y1 + 1, zoom) - lat) * 111320};
      let pending = (x1 - x0 + 1) * (y1 - y0 + 1), loaded = 0, failed = 0;
      return new Promise(resolve => {
        for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
          const img = new Image();img.crossOrigin = 'anonymous';img.referrerPolicy = 'no-referrer';
          const done = ok => {if (ok && token === imageryToken) {ctx.drawImage(img, (i - x0) * 256, (j - y0) * 256);loaded++;} else failed++;if (--pending === 0) resolve({canvas: c, bounds, loaded, failed});};
          img.onload = () => done(true);img.onerror = () => done(false);img.src = tileUrl(zoom, i, j);
        }
      });
    }
    // Draw an imagery mosaic into a terrain canvas covering [-ext, ext] in local metres.
    function drawInto(target, ext, mosaic, lift) {
      const ctx = target.getContext('2d'), k = target.width / (2 * ext), b = mosaic.bounds;
      const tmp = document.createElement('canvas');tmp.width = mosaic.canvas.width;tmp.height = mosaic.canvas.height;const t = tmp.getContext('2d');t.drawImage(mosaic.canvas, 0, 0);
      if (lift) {const img = t.getImageData(0, 0, tmp.width, tmp.height), d = img.data, lut = new Uint8ClampedArray(256);for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(i / 255, .58);for (let i = 0; i < d.length; i += 4) {d[i] = lut[d[i]];d[i + 1] = lut[d[i + 1]];d[i + 2] = lut[d[i + 2]];}t.putImageData(img, 0, 0);}
      ctx.drawImage(tmp, (b.west + ext) * k, (-b.north + ext) * k, (b.east - b.west) * k, (b.north - b.south) * k);
    }
    // Oblique photo: roofs lean onto the ground beside each building; cover those zones with the map painting.
    function maskLean(target, base, ext) {
      const size = target.width, k = size / (2 * ext), P = (x, s) => [(x + ext) * k, (s + ext) * k], lean = data.imageryLean || [0, 0];
      const mask = document.createElement('canvas');mask.width = mask.height = size;const m = mask.getContext('2d');m.fillStyle = '#000';
      const poly = pts => {m.beginPath();pts.forEach((p, i) => {const [u, v] = P(p[0], p[1]);i ? m.lineTo(u, v) : m.moveTo(u, v);});m.closePath();m.fill();};
      const sweep = (flat, h) => {const ring = pairs(flat), dx = lean[0] * h, dz = lean[1] * h;poly(ring);poly(ring.map(p => [p[0] + dx, p[1] + dz]));ring.forEach((a, i) => {const b = ring[(i + 1) % ring.length];poly([a, b, [b[0] + dx, b[1] + dz], [a[0] + dx, a[1] + dz]]);});};
      for (const b of data.buildings) {const o = b.r.o;if (Math.abs(o[0]) < ext + 60 && Math.abs(o[1]) < ext + 60) sweep(o, b.h + 1.5);}
      sweep(data.ownLocal, own.top - ground + 1.5);
      const fill = document.createElement('canvas');fill.width = fill.height = size;const f = fill.getContext('2d');f.drawImage(base, 0, 0);f.globalCompositeOperation = 'destination-in';f.filter = 'blur(2px)';f.drawImage(mask, 0, 0);
      target.getContext('2d').drawImage(fill, 0, 0);
    }
    // Deep shadows in the photo carry no ground detail: blend them toward the map painting (kept slightly shaded).
    function fillShadows(target, base) {
      const w = target.width, h = target.height, tc = target.getContext('2d'), img = tc.getImageData(0, 0, w, h), d = img.data, b = base.getContext('2d').getImageData(0, 0, w, h).data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = .3 * d[i] + .59 * d[i + 1] + .11 * d[i + 2];if (lum >= 70) continue;
        const t = Math.min(1, (70 - lum) / 45) * .85;d[i] += (b[i] * .8 - d[i]) * t;d[i + 1] += (b[i + 1] * .8 - d[i + 1]) * t;d[i + 2] += (b[i + 2] * .8 - d[i + 2]) * t;
      }
      tc.putImageData(img, 0, 0);
    }
    function restore(target, base) {const c = target.getContext('2d');c.drawImage(base, 0, 0);}
    async function setImagery(on) {
      const token = ++imageryToken;
      patchesImagery(on, token);
      if (!on) {restore(nearPaint, nearBase);restore(outerPaint, outerBase);restore(farPaint, farBase);nearTerrain.tex.needsUpdate = outerTerrain.tex.needsUpdate = farTerrain.tex.needsUpdate = true;horizonMat.map = horizonTex;horizonMat.needsUpdate = true;imageryState = 'off';city.setPhoto(false);onStatus('Map-based ground (aerial imagery off).');return;}
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {imageryState = 'offline';onStatus('Offline: map-based ground. Aerial imagery loads when online.');return;}
      imageryState = 'loading';onStatus('Loading aerial imagery…');
      const [nearTiles, outerTiles, farTiles, horizonTiles] = await Promise.all([loadTiles(18, NEAR_EXT, token), loadTiles(17, PLAY_HALF, token), loadTiles(15, FAR_EXT, token), loadTiles(12, 9000, token)]);
      if (token !== imageryToken) return;
      if (nearTiles.loaded <= nearTiles.failed) {imageryState = 'failed';onStatus('Aerial imagery could not load; map-based ground.');return;}
      drawInto(nearPaint, NEAR_EXT, nearTiles, true);fillShadows(nearPaint, nearBase);maskLean(nearPaint, nearBase, NEAR_EXT);
      if (outerTiles.loaded > outerTiles.failed) {drawInto(outerPaint, PLAY_HALF, outerTiles, true);fillShadows(outerPaint, outerBase);maskLean(outerPaint, outerBase, PLAY_HALF);}
      drawInto(farPaint, FAR_EXT, farTiles, true);fillShadows(farPaint, farBase);
      if (horizonTiles.loaded > horizonTiles.failed) {const c = horizonImg.getContext('2d');c.drawImage(horizonCanvas, 0, 0, 2048, 2048);drawInto(horizonImg, 9000, horizonTiles, true);horizonImgTex.needsUpdate = true;horizonMat.map = horizonImgTex;horizonMat.needsUpdate = true;}
      nearTerrain.tex.needsUpdate = outerTerrain.tex.needsUpdate = farTerrain.tex.needsUpdate = true;imageryState = 'on';city.setPhoto(true);onStatus('Aerial imagery: Esri World Imagery (loaded live, not stored).');
    }

    // ---------- Trees and bushes ----------
    function leafCardTexture(tones) {
      const c = document.createElement('canvas');c.width = c.height = 256;const x = c.getContext('2d');
      x.strokeStyle = 'rgba(70,55,40,.9)';x.lineWidth = 2;x.beginPath();x.moveTo(128, 250);x.lineTo(128, 60);for (let k = 0; k < 6; k++) {x.moveTo(128, 220 - k * 28);x.lineTo(128 + (k % 2 ? 60 : -60), 170 - k * 28);}x.stroke();
      for (let k = 0; k < 170; k++) {const a = lib.rand() * Math.PI * 2, r = Math.sqrt(lib.rand()) * 110, px = 128 + Math.cos(a) * r, py = 120 + Math.sin(a) * r * .9;x.fillStyle = tones[Math.floor(lib.rand() * tones.length)];x.save();x.translate(px, py);x.rotate(lib.rand() * Math.PI);x.beginPath();x.ellipse(0, 0, 7 + lib.rand() * 6, 4 + lib.rand() * 3, 0, 0, Math.PI * 2);x.fill();x.restore();}
      const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;t.anisotropy = 4;return t;
    }
    function crownGeometry(cards, lift = .55, cardScale = 1) {
      const pos = [], nor = [], uv = [], idx = [], q = new T.Quaternion(), e = new T.Euler();
      for (let k = 0; k < cards; k++) {
        const dir = new T.Vector3(lib.rand() * 2 - 1, lib.rand() * 1.6 - .5, lib.rand() * 2 - 1).normalize(), centre = dir.clone().multiplyScalar(.35 + lib.rand() * .55);centre.y += lift;
        e.set(lib.rand() * Math.PI, lib.rand() * Math.PI, lib.rand() * Math.PI);q.setFromEuler(e);const size = (.55 + lib.rand() * .35) * cardScale, base = pos.length / 3;
        for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {const p = new T.Vector3(u * size / 2, v * size / 2, 0).applyQuaternion(q).add(centre);pos.push(p.x, p.y, p.z);const n = p.clone().sub(new T.Vector3(0, lift, 0)).normalize();nor.push(n.x, n.y, n.z);uv.push((u + 1) / 2, (v + 1) / 2);}
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));g.setIndex(idx);return g;
    }
    const leafMat = tones => new T.MeshStandardMaterial({map: leafCardTexture(tones), alphaTest: .45, side: T.DoubleSide, roughness: .8, metalness: 0});
    const leafMats = [leafMat(['#3f5f2a', '#4f7232', '#5d8238', '#36522a', '#6a8c3e']), leafMat(['#46622c', '#557a35', '#3a5526', '#678a3b', '#4b6a2f'])], bushMat = leafMat(['#34502a', '#40602c', '#2e4724', '#4b6b31']), barkMat = lib.bark();
    const crownGeo = [crownGeometry(70), crownGeometry(70)], bushGeo = crownGeometry(40, .35), trunkGeo = new T.CylinderGeometry(.11, .17, 1, 8);trunkGeo.translate(0, .5, 0);
    // Far copies use a light crown (fewer, larger leaf cards): they are only seen beyond the near pass.
    const crownGeoFar = [crownGeometry(16, .55, 1.8), crownGeometry(16, .55, 1.8)];
    function plantTrees(parent, list, castShadow, geos = crownGeo, trunk = trunkGeo) {
      if (!list.length) return;
      const trunks = new T.InstancedMesh(trunk, barkMat, list.length), crowns = geos.map((g, i) => new T.InstancedMesh(g, leafMats[i], list.length));
      const counts = [0, 0], m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3();
      list.forEach((t, i) => {
        const h = t.h || 9 + ((i * 7919) % 70) / 10, crown = h * .62, trunkH = h * .42, r = h * .3, y = yLocal(t.x, t.s);
        q.setFromAxisAngle(new T.Vector3(0, 1, 0), (i * 2.399) % 6.283);
        m.compose(p.set(t.x, y, t.s), q, s.set(1 + h / 25, trunkH, 1 + h / 25));trunks.setMatrixAt(i, m);
        const k = i % 2;m.compose(p.set(t.x, y + trunkH * .95, t.s), q, s.set(r * .95, crown * .5, r * .95));crowns[k].setMatrixAt(counts[k]++, m);
      });
      crowns.forEach((c, k) => {c.count = counts[k];c.castShadow = castShadow;c.receiveShadow = true;c.instanceMatrix.needsUpdate = true;parent.add(c);});
      trunks.castShadow = castShadow;trunks.receiveShadow = true;trunks.instanceMatrix.needsUpdate = true;parent.add(trunks);
    }
    const treeCells = new Map(), allTrees = [], inHole = (x, s) => holes.some(h => x > h.x0 && x < h.x1 && s > h.s0 && s < h.s1);
    for (let i = 0; i < data.trees.length; i += 3) {
      const t = {x: data.trees[i], s: data.trees[i + 1], h: data.trees[i + 2]};if (inHole(t.x, t.s)) continue;allTrees.push(t);
      if (Math.hypot(t.x, t.s) < NEAR_REACH) {const k = cellKey(t.x, t.s);if (!treeCells.has(k)) treeCells.set(k, []);treeCells.get(k).push(t);}
    }
    const yard = data.courtyard;
    if (yard) for (let i = 0; i < yard.trees.length; i += 3) {const t = {x: yard.trees[i], s: yard.trees[i + 1], h: yard.trees[i + 2]};allTrees.push(t);const k = cellKey(t.x, t.s);if (!treeCells.has(k)) treeCells.set(k, []);treeCells.get(k).push(t);}
    for (const list of treeCells.values()) plantTrees(geoNear, list, true);plantTrees(geoFar, allTrees, false, crownGeoFar);
    const bushes = [];for (let i = 0; i < data.bushes.length; i += 3) if (!inHole(data.bushes[i], data.bushes[i + 1])) bushes.push({x: data.bushes[i], s: data.bushes[i + 1], r: data.bushes[i + 2]});
    {
      const inst = new T.InstancedMesh(bushGeo, bushMat, bushes.length), m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3();
      bushes.forEach((b, i) => {q.setFromAxisAngle(new T.Vector3(0, 1, 0), i * 1.7);m.compose(p.set(b.x, yLocal(b.x, b.s) - .1, b.s), q, s.set(b.r, b.r * .8, b.r));inst.setMatrixAt(i, m);});
      inst.castShadow = true;inst.receiveShadow = true;geoNear.add(inst);
    }
    const poleMat = lib.metal(0x3b3f42, .5), lamps = [];// street lamps (OSM highway=street_lamp); the poles are solid
    for (let i = 0; i < data.lamps.length; i += 2) {
      if (inHole(data.lamps[i], data.lamps[i + 1])) continue;
      const x = data.lamps[i], s = data.lamps[i + 1], y = yLocal(x, s);lamps.push({x, s});
      const pole = new T.Mesh(new T.CylinderGeometry(.05, .07, 5, 8), poleMat);pole.position.set(x, y + 2.5, s);pole.castShadow = true;geoNear.add(pole);
      const head = new T.Mesh(new T.CylinderGeometry(.25, .12, .25, 10), poleMat);head.position.set(x, y + 5, s);geoNear.add(head);
    }
    const hedgeObstacles = [];
    if (yard) {
      const hedgeMat = lib.leaves(0x3d5a26), wood = lib.wood(0x8a5a32, .6), red = lib.paint(0xc0392b, .4), yellow = lib.paint(0xe2b13c, .35), steelM = lib.metal(0x7d8589, .4);
      const put = (geo, mat, x, y, z, ry = 0) => {const m = new T.Mesh(geo, mat);m.position.set(x, y, z);m.rotation.y = ry;m.castShadow = m.receiveShadow = true;geoNear.add(m);return m;};
      for (const [x0, z0, x1, z1] of yard.hedges) {const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;put(new T.BoxGeometry(len, 1.0, .75), hedgeMat, cx, yLocal(cx, cz) + .5, cz, -Math.atan2(z1 - z0, x1 - x0));hedgeObstacles.push({a: [x0, z0], b: [x1, z1], w: .75});}
      if (yard.playground) {
        const ring = pairs(yard.playground.o), cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        ring.forEach((a, i) => {const b = ring[(i + 1) % ring.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);put(new T.BoxGeometry(len, .8, .6), hedgeMat, (a[0] + b[0]) / 2, yLocal((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) + .4, (a[1] + b[1]) / 2, -Math.atan2(b[1] - a[1], b[0] - a[0]));});
        const g = new T.Group();g.position.set(cx, yLocal(cx, cz), cz);g.rotation.y = Math.atan2(-yard.axis[1], yard.axis[0]);geoNear.add(g);
        const part = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {const m = new T.Mesh(geo, mat);m.position.set(x, y, z);m.rotation.set(rx, ry, rz);m.castShadow = m.receiveShadow = true;g.add(m);return m;};
        for (const [x, z] of [[-1.6, -.6], [-.6, -.6], [-1.6, .4], [-.6, .4]]) part(new T.BoxGeometry(.1, 2.2, .1), wood, x, 1.1, z);
        part(new T.BoxGeometry(1.1, .08, 1.1), wood, -1.1, 1.2, -.1);part(new T.ConeGeometry(.75, .7, 4), red, -1.1, 2.55, -.1, 0, Math.PI / 4);part(new T.BoxGeometry(.55, .05, 2.3), yellow, -1.1, .65, 1.45, -.5);
        for (const x of [1.0, 3.0]) {part(new T.CylinderGeometry(.05, .05, 2.3, 8), steelM, x, 1.1, -1.2, 0, 0, .18);part(new T.CylinderGeometry(.05, .05, 2.3, 8), steelM, x, 1.1, .2, 0, 0, -.18);}
        part(new T.CylinderGeometry(.05, .05, 2.2, 8), steelM, 2.0, 2.2, -.5, 0, 0, Math.PI / 2);
        for (const x of [1.6, 2.4]) {part(new T.BoxGeometry(.45, .04, .18), lib.paint(0x2b2b2b, .6), x, .45, -.5);part(new T.CylinderGeometry(.008, .008, 1.7, 4), steelM, x, 1.32, -.5);}
        for (const [w, d, x, z] of [[2.4, .15, 0, 2.4], [2.4, .15, 0, 4.6], [.15, 2.3, -1.2, 3.5], [.15, 2.3, 1.2, 3.5]]) part(new T.BoxGeometry(w, .3, d), wood, x, .15, z);
      }
      for (const [x, z, r] of yard.benches) {
        const b = new T.Group();b.position.set(x, yLocal(x, z), z);b.rotation.y = -r;geoNear.add(b);
        for (const dz of [-.18, 0, .18]) {const s = new T.Mesh(new T.BoxGeometry(1.6, .04, .12), wood);s.position.set(0, .45, dz);s.castShadow = true;b.add(s);}
        const back = new T.Mesh(new T.BoxGeometry(1.6, .35, .04), wood);back.position.set(0, .75, .3);back.rotation.x = -.15;b.add(back);
        for (const dx of [-.7, .7]) {const leg = new T.Mesh(new T.BoxGeometry(.06, .45, .5), steelM);leg.position.set(dx, .22, .05);b.add(leg);}
      }
    }
    lib.mergeStatic(geoNear, o => o.isInstancedMesh || o.name.startsWith('Terrain'));

    // ---------- District patches (issue #38: Gamle Oslo, Ensjø and the way there from Torshov) ----------
    // Each patch has ground tiles on its 8 m grid (near pass, with its own map painting or aerial photo) and a 16 m far ground,
    // buildings in 400 m tiles (near: Torshov's brick facades plus windows on plaster, glass bands on tall buildings and ribbed
    // metal on halls; far: one vertex-coloured mesh per 800 m), the mapped trees (near tiles; light far crowns within 1.1 km
    // of the camera) and the sea. Everything is in tiles that the camera and the shadow pass can skip.
    // District trees are light (the user's wish for the parks there): 26 leaf cards a crown near (Torshov's have 70), 16 far,
    // and a five-sided open trunk.
    const PATCH_TILE = 400, FAR_TREE_REACH = 1100, lightCrowns = [crownGeometry(26, .55, 1.35), crownGeometry(26, .55, 1.35)], lightTrunk = new T.CylinderGeometry(.11, .17, 1, 5, 1, true);lightTrunk.translate(0, .5, 0);
    const patchColors = {...colors, cemetery: '#56703a', rail: '#7a7266', sand: '#b3a07a', rock: '#8a8780', paved: '#9a968e'};
    const patchClass = {parking: 'asphalt', paved: 'asphalt', playground: 'sand', sand: 'sand', yard: 'gravel', rail: 'gravel', rock: 'gravel'};
    const patchRoadOrder = [...roadOrder, 'bridleway', 'primary_link', 'secondary_link', 'tertiary_link', 'motorway_link', 'motorway', 'rail'];
    function paintPatch(d, size, classes = false) {
      const c = document.createElement('canvas');c.width = c.height = size;const ctx = c.getContext('2d'), kx = size / (d.x1 - d.x0), ks = size / (d.s1 - d.s0), P = (x, s) => [(x - d.x0) * kx, (s - d.s0) * ks];
      const col = (kind, normal) => classes ? ({grass: '#010000', asphalt: '#020000', gravel: '#030000', sand: '#040000', none: '#050000'})[kind] : normal;
      ctx.fillStyle = col('grass', '#6c7559');ctx.fillRect(0, 0, size, size);
      const ring = (flat, color) => {ctx.fillStyle = color;ctx.beginPath();for (let i = 0; i < flat.length; i += 2) {const [x, y] = P(flat[i], flat[i + 1]);i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);}ctx.closePath();ctx.fill();};
      d.areas.forEach((a, i) => ring(a.o, col(patchClass[a.k] || 'grass', jitter(patchColors[a.k] || '#888', .14, i + 7919))));
      paintStreets(ctx, d.roads, P, kx, classes);
      for (const r of d.roads.slice().sort((a, b) => patchRoadOrder.indexOf(a.k) - patchRoadOrder.indexOf(b.k))) {
        ctx.strokeStyle = col((isPath(r.k) && r.k !== 'cycleway') || r.k === 'rail' ? 'gravel' : 'asphalt', r.k === 'rail' ? '#6a6259' : r.k === 'tram' ? '#545556' : isPath(r.k) ? pathColour(r.k) : '#57595c');ctx.lineWidth = r.w * kx;ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();for (let i = 0; i < r.p.length; i += 2) {const [x, y] = P(r.p[i], r.p[i + 1]);i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);}ctx.stroke();
      }
      for (const s of d.sea) ring(s, col('grass', '#3e5d70'));
      for (const b of d.buildings) ring(b.ring.flat(), col('none', '#5a5652'));
      for (const l of d.landmarks) ring(l.ring, col('none', '#5a5652'));
      if (!classes) {const img = ctx.getImageData(0, 0, size, size), px = img.data;for (let i = 0; i < px.length; i += 4) {const n = (lib.rand() - .5) * 12;px[i] += n;px[i + 1] += n;px[i + 2] += n;}ctx.putImageData(img, 0, 0);}
      return c;
    }
    // Ground on a regular grid with normals from the height data itself, so neighbouring tiles light the same at their seams.
    function patchGround(d, x0, s0, x1, s1, res, material, name, drop, skip) {
      const ni = Math.round((x1 - x0) / res), nj = Math.round((s1 - s0) / res), count = (ni + 1) * (nj + 1);
      const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2), index = [];
      for (let j = 0; j <= nj; j++) for (let i = 0; i <= ni; i++) {
        const x = x0 + i * res, s = s0 + j * res, k = j * (ni + 1) + i, gx = (yLocal(x + 2, s) - yLocal(x - 2, s)) / 4, gs = (yLocal(x, s + 2) - yLocal(x, s - 2)) / 4, l = Math.hypot(gx, 1, gs);
        pos[k * 3] = x;pos[k * 3 + 1] = yLocal(x, s) - drop;pos[k * 3 + 2] = s;nor[k * 3] = -gx / l;nor[k * 3 + 1] = 1 / l;nor[k * 3 + 2] = -gs / l;
        uv[k * 2] = (x - d.x0) / (d.x1 - d.x0);uv[k * 2 + 1] = 1 - (s - d.s0) / (d.s1 - d.s0);
      }
      for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
        const cx = x0 + i * res, cs = s0 + j * res;
        if (cx >= -skip - 1e-6 && cx + res <= skip + 1e-6 && cs >= -skip - 1e-6 && cs + res <= skip + 1e-6) continue;// the old square draws this cell
        const a = j * (ni + 1) + i, b = a + 1, c = a + ni + 1, e = c + 1;index.push(a, c, b, b, c, e);
      }
      if (!index.length) return null;
      const g = new T.BufferGeometry();g.setAttribute('position', new T.BufferAttribute(pos, 3));g.setAttribute('normal', new T.BufferAttribute(nor, 3));g.setAttribute('uv', new T.BufferAttribute(uv, 2));g.setIndex(index);g.computeBoundingSphere();
      const m = new T.Mesh(g, material);m.receiveShadow = true;m.name = name;m.userData.noMerge = true;return m;
    }
    const patchMats = {water: new T.MeshStandardMaterial({color: 0x3e5d70, roughness: .15, metalness: .2, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2})};// always in front of the sea-level ground under it
    const groundOf = canvas => {const tex = new T.CanvasTexture(canvas);tex.colorSpace = T.SRGBColorSpace;tex.anisotropy = 8;return {tex, mat: new T.MeshStandardMaterial({map: tex, color: 0xa6a6a6, roughness: .97, metalness: 0, envMapIntensity: .35})};};
    const patches = districts.map(d => {
      const P = {d, farTrees: [], nearImagery: 'none'}, W = d.x1 - d.x0, H = d.s1 - d.s0;
      P.nearSize = Math.min(4096, 2 ** Math.ceil(Math.log2(Math.max(W, H) / .8)));P.farSize = Math.min(2048, P.nearSize / 2);
      P.near = groundOf(paintPatch(d, P.nearSize));P.far = groundOf(paintPatch(d, P.farSize));city.ground(P.near.mat);
      for (let tx = d.x0; tx < d.x1 - 1e-6; tx += PATCH_TILE) for (let ts = d.s0; ts < d.s1 - 1e-6; ts += PATCH_TILE) {
        const m = patchGround(d, tx, ts, Math.min(d.x1, tx + PATCH_TILE), Math.min(d.s1, ts + PATCH_TILE), d.step, P.near.mat, 'Terrain (district near)', 0, PLAY_HALF);if (m) geoNear.add(m);
      }
      const fm = patchGround(d, d.x0, d.s0, d.x1, d.s1, 16, P.far.mat, 'Terrain (district far)', .5, FAR_EXT);if (fm) geoFar.add(fm);
      const classSize = Math.min(2048, P.nearSize / 2), cls = paintPatch(d, classSize, true).getContext('2d').getImageData(0, 0, classSize, classSize).data;
      P.classSize = classSize;P.classes = new Uint8Array(classSize * classSize);for (let i = 0; i < P.classes.length; i++) P.classes[i] = cls[i * 4];
      // Buildings.
      const nearTiles = new Map(), farTiles = new Map(), tilesX = d.raw.tiles.nx;
      const nearSet = t => {if (!nearTiles.has(t)) nearTiles.set(t, cityBuilder());return nearTiles.get(t);};
      const farSet = t => {const k = `${Math.floor((t % tilesX) / 2)},${Math.floor(Math.floor(t / tilesX) / 2)}`;if (!farTiles.has(k)) farTiles.set(k, builder());return farTiles.get(k);};
      const STYLE_KIND = {brick: 'apartments', shed: 'shed', industrial: 'industrial', modern: '', plaster: ''};
      d.buildings.forEach((b, i) => {
        const ring = b.ring;if (ring.length < 3) return;
        let cx = 0, cs = 0, gm = Infinity;for (const p of ring) {cx += p[0];cs += p[1];gm = Math.min(gm, relLocal(p[0], p[1]));}cx /= ring.length;cs /= ring.length;
        const g0 = ground + relLocal(cx, cs), bottom = ground + gm - .6, top = g0 + b.h, set = nearSet(b.tile), f = farSet(b.tile);
        Object.assign(b, {cx, cs, base: g0, bottom, top});
        const tags = looks.byId(b.id) || {}, num = parseInt(String(b.id).slice(1), 10) || i + 1;
        const look = CT.classify({style: b.style, kind: tags.kind || STYLE_KIND[b.style] || '', h: b.h, x: cx, s: cs, colour: tags.colour, roofColour: tags.roofColour, roofShape: tags.roofShape,
          material: tags.material, year: tags.year, heritage: tags.heritage, architect: tags.architect, seed: num});
        b.look = look.cls;lookCount[look.cls] = (lookCount[look.cls] || 0) + 1;
        const tint = new T.Color(look.tint), seed = hashSeed(num);
        cityWalls(set, ring, look, bottom, g0, top, tint, seed);cityRoof(set, ring, b.hip, top, look, seed);
        farBuilding(f, ring, null, look, bottom, top, tint);
      });
      for (const set of nearTiles.values()) {const m = add(geoNear, finish(set), cityMat);if (m) {m.name = 'Buildings (district tile)';m.userData.noMerge = true;}}
      for (const set of farTiles.values()) {const m = add(geoFar, finish(set), farMat, false);if (m) m.name = 'Buildings (district far)';}
      // Trees: near tiles with full crowns; far tiles with light crowns, shown only within FAR_TREE_REACH of the camera.
      const treeTiles = new Map(), farTreeTiles = new Map(), tileOf = (x, s) => Math.floor((x - d.x0) / PATCH_TILE) + Math.floor((s - d.s0) / PATCH_TILE) * 1000;
      for (const t of d.trees) {
        const k = tileOf(t.x, t.s), fk = `${Math.floor((t.x - d.x0) / (2 * PATCH_TILE))},${Math.floor((t.s - d.s0) / (2 * PATCH_TILE))}`;
        if (!treeTiles.has(k)) treeTiles.set(k, []);treeTiles.get(k).push(t);if (!farTreeTiles.has(fk)) farTreeTiles.set(fk, []);farTreeTiles.get(fk).push(t);
      }
      for (const list of treeTiles.values()) plantTrees(geoNear, list, true, lightCrowns, lightTrunk);
      for (const [k, list] of farTreeTiles) {
        const g = new T.Group(), [i, j] = k.split(',').map(Number);g.name = 'Trees (district far)';geoFar.add(g);plantTrees(g, list, false, crownGeoFar, lightTrunk);
        P.farTrees.push({group: g, x: d.x0 + (i + .5) * 2 * PATCH_TILE, s: d.s0 + (j + .5) * 2 * PATCH_TILE});
      }
      // Sea: a water surface 25 cm above sea level where the terrain model is at sea level (Bjørvika).
      for (const flatRing of d.sea) {
        const shape = new T.Shape(pairs(flatRing).map(([x, s]) => new T.Vector2(x, -s))), geo = new T.ShapeGeometry(shape);geo.rotateX(-Math.PI / 2);
        for (const [parent, nm] of [[geoNear, 'Sea (near)'], [geoFar, 'Sea (far)']]) {const m = new T.Mesh(geo, patchMats.water);m.position.y = ground + d.seaRel + .25;m.receiveShadow = parent === geoNear;m.name = nm;m.userData.noMerge = true;parent.add(m);}
      }
      // Footsteps, traffic sound and greenery look-ups.
      P.traffic = new Map();
      for (const r of d.roads) {
        const w = {residential: .35, tertiary: .7, secondary: 1, primary: 1.4, trunk: 2, trunk_link: 1.2, motorway: 2.2, primary_link: 1, secondary_link: .8}[r.k];if (!w) continue;
        for (let i = 2; i < r.p.length; i += 2) {const a = [r.p[i - 2], r.p[i - 1]], b = [r.p[i], r.p[i + 1]], k = `${Math.floor((a[0] + b[0]) / 200)},${Math.floor((a[1] + b[1]) / 200)}`;if (!P.traffic.has(k)) P.traffic.set(k, []);P.traffic.get(k).push({a, b, w});}
      }
      P.green = new Map();for (const t of d.trees) {const k = `${Math.floor(t.x / 40)},${Math.floor(t.s / 40)}`;P.green.set(k, (P.green.get(k) || 0) + 1);}
      return P;
    });
    const patchAt = (x, s) => patches.find(P => DZ.covers(P.d, x, s));
    // Aerial imagery for a patch: tiles are drawn straight into its ground canvas (a mosaic of a whole patch would be too big).
    function patchImagery(P, which, zoom, token) {
      const d = P.d, target = P[which].tex.image, ctx = target.getContext('2d'), kx = target.width / (d.x1 - d.x0), ks = target.height / (d.s1 - d.s0);
      const lat0 = data.origin.lat, lon0 = data.origin.lon, lonOf = x => lon0 + x / KX, latOf = s => lat0 - s / 111320;
      const x0 = Math.floor(lonToX(lonOf(d.x0), zoom)), x1 = Math.floor(lonToX(lonOf(d.x1), zoom)), y0 = Math.floor(latToY(latOf(d.s0), zoom)), y1 = Math.floor(latToY(latOf(d.s1), zoom));
      const tmp = document.createElement('canvas');tmp.width = tmp.height = 256;const t = tmp.getContext('2d', {willReadFrequently: true}), lut = new Uint8ClampedArray(256);for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(i / 255, .58);
      const queue = [];for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) queue.push([i, j]);
      let pending = queue.length, active = 0, loaded = 0, failed = 0;
      return new Promise(resolve => {
        const done = ok => {ok ? loaded++ : failed++;active--;if (--pending === 0) resolve({loaded, failed});else next();};
        const next = () => {
          while (active < 8 && queue.length) {
            const [i, j] = queue.shift(), img = new Image();active++;img.crossOrigin = 'anonymous';img.referrerPolicy = 'no-referrer';
            img.onload = () => {
              if (token !== imageryToken) return done(false);
              t.drawImage(img, 0, 0);const px = t.getImageData(0, 0, 256, 256), v = px.data;for (let q = 0; q < v.length; q += 4) {v[q] = lut[v[q]];v[q + 1] = lut[v[q + 1]];v[q + 2] = lut[v[q + 2]];}t.putImageData(px, 0, 0);
              const wx = (xToLon(i, zoom) - lon0) * KX, ex = (xToLon(i + 1, zoom) - lon0) * KX, ns = -(yToLat(j, zoom) - lat0) * 111320, ss = -(yToLat(j + 1, zoom) - lat0) * 111320;
              ctx.drawImage(tmp, (wx - d.x0) * kx - .5, (ns - d.s0) * ks - .5, (ex - wx) * kx + 1, (ss - ns) * ks + 1);done(true);
            };
            img.onerror = () => done(false);img.src = tileUrl(zoom, i, j);
          }
        };
        if (!pending) resolve({loaded, failed});else next();
      });
    }
    // Roofs lean in the photo: cover the lean zones with the map painting (as maskLean does for the old square).
    function patchLean(P, which, base) {
      const d = P.d, target = P[which].tex.image, size = target.width, kx = size / (d.x1 - d.x0), ks = size / (d.s1 - d.s0), lean = data.imageryLean || [0, 0];
      const mask = document.createElement('canvas');mask.width = mask.height = size;const m = mask.getContext('2d');m.fillStyle = '#000';
      const poly = pts => {m.beginPath();pts.forEach((p, i) => {const u = (p[0] - d.x0) * kx, v = (p[1] - d.s0) * ks;i ? m.lineTo(u, v) : m.moveTo(u, v);});m.closePath();m.fill();};
      const sweep = (ring, h) => {const dx = lean[0] * h, dz = lean[1] * h;poly(ring);poly(ring.map(p => [p[0] + dx, p[1] + dz]));ring.forEach((a, i) => {const b = ring[(i + 1) % ring.length];poly([a, b, [b[0] + dx, b[1] + dz], [a[0] + dx, a[1] + dz]]);});};
      for (const b of d.buildings) sweep(b.ring, b.h + 1.5);
      for (const l of d.landmarks) sweep(pairs(l.ring), (l.top || l.fly || 20) * .7);
      const fill = document.createElement('canvas');fill.width = fill.height = size;const f = fill.getContext('2d');f.drawImage(base, 0, 0);f.globalCompositeOperation = 'destination-in';f.filter = 'blur(2px)';f.drawImage(mask, 0, 0);
      target.getContext('2d').drawImage(fill, 0, 0);
    }
    async function loadPatchImagery(P, which, token) {
      const zoom = which === 'near' ? 17 : 15, r = await patchImagery(P, which, zoom, token);
      if (token !== imageryToken || r.loaded <= r.failed) return false;
      const base = paintPatch(P.d, P[which].tex.image.width);fillShadows(P[which].tex.image, base);if (which === 'near') patchLean(P, which, base);
      P[which].tex.needsUpdate = true;return true;
    }
    function patchesImagery(on, token) {
      for (const P of patches) {
        if (!on) {for (const w of ['near', 'far']) {P[w].tex.image.getContext('2d').drawImage(paintPatch(P.d, P[w].tex.image.width), 0, 0);P[w].tex.needsUpdate = true;}P.nearImagery = 'none';continue;}
        P.nearImagery = 'wanted';loadPatchImagery(P, 'far', token);
      }
    }
    // Near imagery for a patch loads when the camera first comes within 700 m of it (a few hundred tiles at zoom 17).
    function update(camera) {
      if (!patches.length) return;
      const l = toLocal(camera.x, camera.z);
      for (const P of patches) {
        const d = P.d, dist = Math.hypot(l.x - Math.max(d.x0, Math.min(d.x1, l.x)), l.s - Math.max(d.s0, Math.min(d.s1, l.s)));
        if (P.nearImagery === 'wanted' && imageryState === 'on' && dist < 700) {P.nearImagery = 'loading';const token = imageryToken;loadPatchImagery(P, 'near', token).then(ok => {if (token === imageryToken) P.nearImagery = ok ? 'on' : 'failed';});}
        for (const t of P.farTrees) t.group.visible = Math.hypot(l.x - t.x, l.s - t.s) < FAR_TREE_REACH;
      }
    }

    // ---------- Sky and hills ----------
    const sunDirection = new T.Vector3(0, 1, 0);
    const sky = new T.Mesh(new T.SphereGeometry(20000, 48, 24), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false, uniforms: {sun: {value: sunDirection}, overcast: {value: 0}},
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 sun; uniform float overcast; varying vec3 vDir;
        float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){float v=0.0,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
        void main(){vec3 d=normalize(vDir);float up=clamp(d.y,0.0,1.0);vec3 col=mix(vec3(.70,.80,.89),vec3(.22,.42,.78),pow(up,.55));
          float s=max(dot(d,normalize(sun)),0.0);col+=(vec3(1.0,.9,.7)*pow(s,700.0)*6.0+vec3(1.0,.85,.6)*pow(s,12.0)*.25)*(1.0-overcast);
          // Real weather (issue #23): more and greyer clouds with the cloud cover; fully overcast the sky is a flat grey.
          if(d.y>0.0){vec2 uv=d.xz/(d.y+.12)*1.6;float c=smoothstep(.5-.42*overcast,.78-.3*overcast,fbm(uv+vec2(3.1,1.7)));col=mix(col,mix(vec3(1.0),vec3(.62,.65,.69),overcast)*(.92+.08*fbm(uv*3.0)),c*.85*smoothstep(0.0,.18,d.y));}
          col=mix(col,vec3(.60,.63,.67),overcast*overcast*.7);
          if(d.y<0.0) col=mix(vec3(.70,.80,.89)*.92,vec3(.58,.61,.64),overcast);gl_FragColor=vec4(col,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    sky.frustumCulled = false;far.add(sky);
    const hills = [[30, 3200, 280, 25], [55, 6500, 260, 30], [305, 6200, 360, 25], [335, 5000, 300, 22], [150, 3600, 90, 30], [180, 9000, 180, 40], [250, 12000, 150, 50], [95, 9000, 190, 40]];
    {
      const segments = 360, rows = 6, pos = [], index = [];
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= segments; i++) {
        const bearing = i / segments * 360, t = j / rows, r = bearing * Math.PI / 180, dx = Math.sin(r), dz = -Math.cos(r);let height = 18 + 40 * Math.sin(bearing * .07) * Math.sin(bearing * .19);
        // The ring starts at least 400 m beyond the ground data in that direction (the district patches reach 4 km south),
        // rising from the apron's own height there.
        let reach = 0;while (reach < 9000 && regions.some(g => dx * reach >= g.x0 && dx * reach <= g.x1 && dz * reach >= g.s0 && dz * reach <= g.s1)) reach += 25;
        const start = Math.max(2600, reach + 400), distance = start + t * 9000, rise = Math.min(1, t * 2.4), base = apronY(dx * start, dz * start) - 1;
        for (const [b, dist, hgt, wid] of hills) {const d = Math.min(Math.abs(bearing - b), 360 - Math.abs(bearing - b)), w = Math.exp(-(d * d) / (2 * wid * wid));height += hgt * w * Math.max(0, 1 - Math.abs(distance - dist) / (dist * .9));}
        height *= rise;pos.push(dx * distance, base + (ground - 8 - base) * rise + height, dz * distance);
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < segments; i++) {const a = j * (segments + 1) + i, b = a + segments + 1;index.push(a, b, a + 1, a + 1, b, b + 1);}
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setIndex(index);g.computeVertexNormals();
      geoFar.add(new T.Mesh(g, new T.MeshStandardMaterial({color: 0x3f5236, roughness: 1, side: T.DoubleSide})));
    }
    const farSun = new T.DirectionalLight(0xfff1dc, 2.4), farSky = new T.HemisphereLight(0xcfe0ee, 0x5a5a4a, 1.3);far.add(farSun, farSky);
    function setSun(direction) {sunDirection.copy(direction).normalize();farSun.position.copy(sunDirection).multiplyScalar(1000);}
    function setOvercast(v) {sky.material.uniforms.overcast.value = Math.max(0, Math.min(1, v));}// 0 clear … 1 fully overcast (real weather)

    // ---------- Collision and queries (model coordinates) ----------
    const ringWorld = flat => pairs(flat).map(([x, s]) => toWorld(x, s));
    function obstacles() {
      const list = [];
      data.buildings.forEach(b => {
        const o = b.r.o;if (Math.abs(o[0]) > PLAY_HALF + 40 || Math.abs(o[1]) > PLAY_HALF + 40) return;
        const rings = b.enter !== undefined ? data.enterable[b.enter].collide.map(r => r.o) : [o];
        for (const r of rings) list.push({points: ringWorld(r), minY: b.bottom - .5, maxY: b.top + 4, kind: 'building'});
      });
      const ownRings = (parts, minY, maxY) => parts.forEach(p => list.push({points: pairs(p.o).map(([x, z]) => ({x, z})), minY, maxY, kind: 'building'}));
      ownRings(own.lower, ownBottom - .5, -.16);ownRings(own.band, -.16, own.bandTop);ownRings(own.upper, own.bandTop, own.top + 4);
      const square = (x, s, r, h, kind) => {const pts = [[x - r, s - r], [x + r, s - r], [x + r, s + r], [x - r, s + r]].map(([a, b]) => toWorld(a, b)), y = yLocal(x, s);list.push({points: pts, minY: y - .5, maxY: y + h, kind});};
      const walkable = (x, s) => Math.abs(x) < PLAY_HALF && Math.abs(s) < PLAY_HALF;
      allTrees.forEach(t => {if (walkable(t.x, t.s)) square(t.x, t.s, .28, 6, 'tree');});
      lamps.forEach(l => {if (walkable(l.x, l.s)) square(l.x, l.s, .1, 5.2, 'lamp');});
      bushes.forEach(b => square(b.x, b.s, .45 * b.r, 1.2, 'bush'));
      hedgeObstacles.forEach(h => {const dx = h.b[0] - h.a[0], dz = h.b[1] - h.a[1], L = Math.hypot(dx, dz), nx = -dz / L * h.w / 2, nz = dx / L * h.w / 2;const pts = [[h.a[0] + nx, h.a[1] + nz], [h.b[0] + nx, h.b[1] + nz], [h.b[0] - nx, h.b[1] - nz], [h.a[0] - nx, h.a[1] - nz]].map(([a, b]) => toWorld(a, b)), y = yLocal(h.a[0], h.a[1]);list.push({points: pts, minY: y - .5, maxY: y + 1, kind: 'hedge'});});
      // District patches: their buildings (also those in the old square's outer band) and trees; the sea stops you at the quay
      // (quays stand 1.5 m or more above the water, so the block only reaches 0.8 m above it).
      for (const P of patches) {
        const d = P.d, pl = d.play, near = (x, s, m) => (x > pl.x0 - m && x < pl.x1 + m && s > pl.s0 - m && s < pl.s1 + m) || (Math.abs(x) < PLAY_HALF + m && Math.abs(s) < PLAY_HALF + m);
        for (const b of d.buildings) if (b.top !== undefined && near(b.cx, b.cs, 40)) list.push({points: b.ring.map(([x, s]) => toWorld(x, s)), minY: b.bottom - .5, maxY: b.top + 4, kind: 'building'});
        for (const t of d.trees) if (near(t.x, t.s, 0)) square(t.x, t.s, .28, 6, 'tree');
        for (const r of d.sea) list.push({points: ringWorld(r), minY: ground + d.seaRel - 3, maxY: ground + d.seaRel + .8, kind: 'water'});
      }
      return list;
    }
    function terrainFloor() {
      return {name: 'Neighbourhood', points: [[-PLAY_HALF, -PLAY_HALF], [PLAY_HALF, -PLAY_HALF], [PLAY_HALF, PLAY_HALF], [-PLAY_HALF, PLAY_HALF]].map(([x, s]) => toWorld(x, s)), height: p => heightWorld(p.x, p.z), ceilingHeight: Infinity, surfaceKind: 'terrain'};
    }
    // The old square plus one walkable floor per district patch (same ground everywhere, so where they overlap they join).
    function terrainFloors() {
      return [terrainFloor(), ...patches.map(({d}) => ({name: `District ${d.name}`, points: [[d.play.x0, d.play.s0], [d.play.x1, d.play.s0], [d.play.x1, d.play.s1], [d.play.x0, d.play.s1]].map(([x, s]) => toWorld(x, s)),
        height: p => heightWorld(p.x, p.z), ceilingHeight: Infinity, surfaceKind: 'terrain'}))];
    }
    const traffic = data.roads.filter(r => ['residential', 'tertiary', 'secondary', 'primary', 'trunk', 'trunk_link'].includes(r.k)).flatMap(r => {const p = pairs(r.p), w = {residential: .35, tertiary: .7, secondary: 1, primary: 1.4, trunk: 2, trunk_link: 1.2}[r.k];return p.slice(1).map((b, i) => ({a: p[i], b, w}));});
    function trafficDistance(x, z) {
      const l = toLocal(x, z);let best = 999;
      const check = sgm => {const dx = sgm.b[0] - sgm.a[0], dz = sgm.b[1] - sgm.a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((l.x - sgm.a[0]) * dx + (l.s - sgm.a[1]) * dz) / L2));const d = Math.hypot(l.x - sgm.a[0] - t * dx, l.s - sgm.a[1] - t * dz) / sgm.w;if (d < best) best = d;};
      for (const sgm of traffic) check(sgm);
      const P = patchAt(l.x, l.s);
      if (P) {const i = Math.floor(l.x / 100), j = Math.floor(l.s / 100);for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const sgm of P.traffic.get(`${i + a},${j + b}`) || []) check(sgm);}
      return best;
    }
    function greenery(x, z) {
      const l = toLocal(x, z);let n = 0;for (const t of allTrees) if (Math.abs(t.x - l.x) < 40 && Math.abs(t.s - l.s) < 40) n++;for (const b of bushes) if (Math.abs(b.x - l.x) < 25 && Math.abs(b.s - l.s) < 25) n += .3;
      const P = patchAt(l.x, l.s);if (P) {const i = Math.floor(l.x / 40), j = Math.floor(l.s / 40);let m = 0;for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) m += P.green.get(`${i + a},${j + b}`) || 0;n += m * .44;}// 120 m of cells ~ the 80 m box
      return Math.min(1, n / 18);
    }

    return {near, far, setImagery, setSun, setOvercast, get imageryState() {return imageryState;}, attribution: data.attribution, ground, heightWorld, toLocal, toWorld, terrainFloor, terrainFloors, obstacles, surfaceAt, trafficDistance, greenery, data, playHalf: PLAY_HALF, trees: allTrees,
      districts: patches.map(P => P.d), get districtImagery() {return patches.map(P => P.nearImagery);}, update, yLocal, geoNear, geoFar, looks: lookCount, city};
  }
  return {create};
});
