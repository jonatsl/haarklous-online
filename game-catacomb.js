/* The catacomb (issue #43): three stone mausoleums in Torshovdalen lead down long stairs to a large catacomb under the park.
 * Layout from catacomb-layout.js (pure, tested); skulls, femurs and the bone-wall texture from catacomb-models.js.
 * Lit galleries have burning torches on the walls; in the dark quarry tunnels a torch prompt appears (□ / L1 / Q). Underground
 * the map is wiped and draws only what you have seen down there (map.layer = catacomb.mapLayer); it is kept in localStorage.
 * Light: the torches' light is baked into the vertices with line of sight on the grid, so no three.js lights are added and the
 * rest of the world's shaders never change. The catacomb's materials add the baked light (flickering in four groups) and your
 * torch (a spot light in the shader). Outdoor light (sun, sky, environment) only reaches the mausoleums and the top of the stairs.
 * GameCatacomb.create({T, lib, world, audio}) -> {group, layout, floors, obstacles, vehicleObstacles, cutsGround(x, z), poi(),
 *   update(dt, {camera, player}) -> {depth, deep, inside, dark}, prompt(player), toggleLamp(), lamp, mapLayer, placeName(player), explorer}
 */
(function (root, factory) {
  root.GameCatacomb = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const DI = [0, 1, 0, -1], DJ = [-1, 0, 1, 0];// N E S W (north = -s)
  const SAVE_KEY = 'haarklous-catacomb-map-v1';
  function create({T, lib, world, audio}) {
    const CL = window.CatacombLayout, models = window.CatacombModels ? window.CatacombModels.create({T}) : null;
    const L = CL.build({heightLocal: (x, s) => {const w = world.toWorld(x, s);return world.heightWorld(w.x, w.z);}});
    const {CELL, X0, S0, NX, NS, FLOOR_Y, S, kind, style} = L;
    const group = new T.Group();group.name = 'Catacomb';group.rotation.y = world.data.geo.theta;group.position.set(world.data.geo.x, 0, world.data.geo.z);
    let seed = 90210;const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cellBox = c => {const i = c % NX, j = Math.floor(c / NX);return {x0: X0 + i * CELL, s0: S0 + j * CELL, x1: X0 + (i + 1) * CELL, s1: S0 + (j + 1) * CELL};};
    const roomCells = r => {const out = [];for (let j = r.cells[1]; j <= r.cells[3]; j++) for (let i = r.cells[0]; i <= r.cells[2]; i++) out.push(L.id(i, j));return out;};
    const room = id => L.rooms.find(r => r.id === id);

    // ---------- Procedural textures ----------
    const cv = (w, h = w) => {const c = document.createElement('canvas');c.width = w;c.height = h;return c;};
    function normalFrom(height, strength) {
      const w = height.width, h = height.height, src = height.getContext('2d').getImageData(0, 0, w, h).data, out = cv(w, h), ctx = out.getContext('2d'), img = ctx.createImageData(w, h);
      const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;img.data[i] = (-dx / l * .5 + .5) * 255;img.data[i + 1] = (dy / l * .5 + .5) * 255;img.data[i + 2] = (1 / l * .5 + .5) * 255;img.data[i + 3] = 255;}
      ctx.putImageData(img, 0, 0);return out;
    }
    const tex = (c, tile, color = true) => {const t = new T.CanvasTexture(c);t.wrapS = t.wrapT = T.RepeatWrapping;t.anisotropy = 8;if (color) t.colorSpace = T.SRGBColorSpace;t.repeat.set(1 / tile[0], 1 / tile[1]);return t;};
    const blur = (c, r) => {const o = cv(c.width, c.height), x = o.getContext('2d');x.filter = `blur(${r}px)`;for (const dx of [-c.width, 0, c.width]) for (const dy of [-c.height, 0, c.height]) x.drawImage(c, dx, dy);return o;};
    const grey = v => `rgb(${v | 0},${v | 0},${v | 0})`;
    // Tileable blobs painted into several canvases at once (colour and height share the same shapes).
    function blobs(ctxs, w, h, n, r, f) {for (let i = 0; i < n; i++) {const x = rand() * w, y = rand() * h, rr = r * (.4 + rand()), v = rand();for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) ctxs.forEach((c, k) => {c.fillStyle = f(v, k);c.beginPath();c.arc(x + dx, y + dy, rr, 0, 7);c.fill();});}}
    // Soft tileable mottling in greys (many faint blobs, blurred), laid over a colour canvas with multiply.
    function cloud(W, H, n, r, soft) {const c = cv(W, H), x = c.getContext('2d');x.fillStyle = '#c8c8c8';x.fillRect(0, 0, W, H);blobs([x], W, H, n, r, v => `rgba(${v > .5 ? '255,255,255' : '40,40,40'},.16)`);return blur(c, soft);}
    function grain(ctxs, W, H, n, a) {for (let i = 0; i < n; i++) {const px = rand() * W, py = rand() * H, s = 1 + rand() * 2, v = rand() > .5;ctxs.forEach((c, k) => {c.fillStyle = k ? (v ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.18)') : (v ? `rgba(225,215,195,${a})` : `rgba(40,34,28,${a})`);c.fillRect(px, py, s, s);});}}
    // Dressed limestone blocks in courses (lit galleries, halls, mausoleums).
    function masonry() {
      const W = 1024, H = 512, px = 512, c = cv(W, H), h = cv(W, H), x = c.getContext('2d'), y = h.getContext('2d');
      x.fillStyle = '#2f2923';x.fillRect(0, 0, W, H);y.fillStyle = '#000';y.fillRect(0, 0, W, H);
      const rows = [];for (let top = 0; top < H - 60; ) {const rh = Math.round((.2 + rand() * .12) * px);rows.push([top, rh]);top += rh;}
      const last = rows[rows.length - 1];last[1] = H - last[0];
      for (const [r0, rh] of rows) for (let a = -rand() * 200; a < W; ) {
        const bw = (.32 + rand() * .5) * px, base = 150 + rand() * 34, tint = rand() * 12, hv = 175 + rand() * 50;
        for (const dx of [0, -W]) {
          const bx = a + dx;x.fillStyle = `rgb(${base + 12 + tint | 0},${base + 3 | 0},${base - 16 - tint | 0})`;x.fillRect(bx + 3, r0 + 3, bw - 6, rh - 6);
          // Worn arrises: darker round the edge of each block, a little light on its top edge.
          x.strokeStyle = 'rgba(30,24,18,.28)';x.lineWidth = 7;x.strokeRect(bx + 6, r0 + 6, bw - 12, rh - 12);x.fillStyle = 'rgba(255,245,225,.08)';x.fillRect(bx + 4, r0 + 4, bw - 8, 5);
          y.fillStyle = grey(hv);y.fillRect(bx + 5, r0 + 5, bw - 10, rh - 10);
        }
        a += bw;
      }
      grain([x, y], W, H, 9000, .14);
      x.globalCompositeOperation = 'multiply';x.drawImage(cloud(W, H, 260, 60, 28), 0, 0);x.globalCompositeOperation = 'source-over';
      return {map: tex(c, [2, 1]), normal: tex(normalFrom(blur(h, 1.6), 2.4), [2, 1], false)};
    }
    // Raw quarry rock: mottled limestone with fine grain and a few cracks (dark tunnels and every ceiling).
    function rock(dark) {
      const W = 512, c = cv(W), h = cv(W), x = c.getContext('2d'), y = h.getContext('2d');
      x.fillStyle = dark ? '#7a705f' : '#8d8270';x.fillRect(0, 0, W, W);y.fillStyle = '#808080';y.fillRect(0, 0, W, W);
      const hc = cloud(W, W, 220, 40, 12);y.globalAlpha = .9;y.drawImage(hc, 0, 0);y.globalAlpha = 1;
      grain([x, y], W, W, 7000, .12);
      for (let i = 0; i < 14; i++) {let px = rand() * W, py = rand() * W;x.strokeStyle = 'rgba(35,29,22,.35)';y.strokeStyle = 'rgba(20,20,20,.8)';x.lineWidth = y.lineWidth = .8 + rand();x.beginPath();y.beginPath();x.moveTo(px, py);y.moveTo(px, py);for (let k = 0; k < 9; k++) {px += (rand() - .5) * 36;py += (rand() - .3) * 26;x.lineTo(px, py);y.lineTo(px, py);}x.stroke();y.stroke();}
      x.globalCompositeOperation = 'multiply';x.drawImage(cloud(W, W, 160, 46, 20), 0, 0);x.globalCompositeOperation = 'source-over';
      return {map: tex(c, [2.4, 2.4]), normal: tex(normalFrom(blur(h, 1.2), 3), [2.4, 2.4], false)};
    }
    // Trodden earth with gravel (gallery floors); worn flagstones (rooms, stairs).
    function earth() {
      const W = 512, c = cv(W), h = cv(W), x = c.getContext('2d'), y = h.getContext('2d');
      x.fillStyle = '#5a4e40';x.fillRect(0, 0, W, W);y.fillStyle = '#707070';y.fillRect(0, 0, W, W);
      blobs([x, y], W, W, 120, 40, (v, k) => k ? grey(100 + v * 40) : `rgba(${70 + v * 40 | 0},${60 + v * 34 | 0},${48 + v * 26 | 0},.3)`);
      blobs([x, y], W, W, 2600, 2.6, (v, k) => k ? grey(150 + v * 100) : `rgb(${120 + v * 80 | 0},${110 + v * 70 | 0},${92 + v * 60 | 0})`);
      return {map: tex(c, [2, 2]), normal: tex(normalFrom(blur(h, .8), 2), [2, 2], false)};
    }
    // Worn flagstones in courses of different widths (rooms, stairs).
    function flags() {
      const W = 512, c = cv(W), h = cv(W), x = c.getContext('2d'), y = h.getContext('2d'), px = W / 2;
      x.fillStyle = '#29241e';x.fillRect(0, 0, W, W);y.fillStyle = '#000';y.fillRect(0, 0, W, W);
      const rows = [];for (let top = 0; top < W - 60; ) {const rh = Math.round((.36 + rand() * .22) * px);rows.push([top, rh]);top += rh;}rows[rows.length - 1][1] = W - rows[rows.length - 1][0];
      for (const [r0, rh] of rows) for (let a = -rand() * 120; a < W; ) {
        const bw = (.4 + rand() * .45) * px, v = 104 + rand() * 46, hv = 175 + rand() * 50;
        for (const dx of [0, -W]) {x.fillStyle = `rgb(${v + 8 | 0},${v | 0},${v - 12 | 0})`;x.fillRect(a + dx + 4, r0 + 4, bw - 8, rh - 8);x.strokeStyle = 'rgba(25,20,15,.3)';x.lineWidth = 6;x.strokeRect(a + dx + 7, r0 + 7, bw - 14, rh - 14);y.fillStyle = grey(hv);y.fillRect(a + dx + 6, r0 + 6, bw - 12, rh - 12);}
        a += bw;
      }
      grain([x, y], W, W, 5000, .14);
      x.globalCompositeOperation = 'multiply';x.drawImage(cloud(W, W, 140, 40, 18), 0, 0);x.globalCompositeOperation = 'source-over';
      return {map: tex(c, [2, 2]), normal: tex(normalFrom(blur(h, 1.5), 2.2), [2, 2], false)};
    }
    function cobweb() {
      const W = 256, c = cv(W), x = c.getContext('2d');x.strokeStyle = 'rgba(235,230,220,.75)';x.lineWidth = 1;
      const spokes = 11;for (let i = 0; i < spokes; i++) {const a = i / spokes * Math.PI / 2;x.beginPath();x.moveTo(0, 0);x.lineTo(Math.cos(a) * W, Math.sin(a) * W);x.stroke();}
      for (let r = 14; r < W; r += 12 + rand() * 9) {x.beginPath();for (let i = 0; i <= spokes; i++) {const a = i / spokes * Math.PI / 2, rr = r * (.93 + rand() * .1);i ? x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : x.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);}x.stroke();}
      const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;return t;
    }
    // Engraved tablet: dark letters cut into pale stone.
    function tablet(lines, w = 1024, h = 384) {
      const c = cv(w, h), x = c.getContext('2d');x.fillStyle = '#b6ab95';x.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {x.fillStyle = `rgba(${rand() > .5 ? '255,250,240' : '40,32,24'},${rand() * .12})`;x.fillRect(rand() * w, rand() * h, 3, 3);}
      x.strokeStyle = '#4a4034';x.lineWidth = 8;x.strokeRect(18, 18, w - 36, h - 36);x.textAlign = 'center';x.textBaseline = 'middle';
      lines.forEach((l, i) => {const size = l.size || 64;x.font = `${l.bold === false ? '' : 'bold '}${size}px Georgia, 'Times New Roman', serif`;const yy = h / 2 + (i - (lines.length - 1) / 2) * size * 1.25;
        x.fillStyle = 'rgba(255,250,235,.55)';x.fillText(l.text, w / 2 + 2, yy + 2);x.fillStyle = '#2d251c';x.fillText(l.text, w / 2, yy);});
      const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;t.anisotropy = 8;return t;
    }
    const TX = {masonry: masonry(), rock: rock(false), quarry: rock(true), earth: earth(), flags: flags(), cobweb: cobweb()};
    TX.bones = models ? models.boneWall({size: 768}) : null;

    // ---------- Materials: baked torch light, outdoor-light mask, your torch ----------
    const U = {uFlick: {value: new T.Vector4(1, 1, 1, 1)}, uLamp: {value: new T.Vector4(1, .93, .82, 0)}, uLampPos: {value: new T.Vector3(.17, -.2, .05)}, uLampDir: {value: new T.Vector3(-.03, .05, -1).normalize()}, uLampCos: {value: new T.Vector2(Math.cos(.52), Math.cos(.22))}, uDark: {value: .014}};
    function bakeMaterial(params, {instanced = false} = {}) {
      const m = new T.MeshStandardMaterial({metalness: 0, envMapIntensity: 0, ...params}), a = instanced ? 'i' : '';
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nattribute vec3 ${a}bake;attribute vec3 ${a}bakeDir;attribute vec2 ${a}bakeX;varying vec3 vBake;varying vec3 vBakeDir;varying vec2 vBakeX;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBake = ${a}bake;vBakeX = ${a}bakeX;vBakeDir = mat3(modelViewMatrix) * ${a}bakeDir;`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBake;varying vec3 vBakeDir;varying vec2 vBakeX;uniform vec4 uFlick;uniform vec4 uLamp;uniform vec3 uLampPos;uniform vec3 uLampDir;uniform vec2 uLampCos;uniform float uDark;')
          .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            float sky = vBakeX.x;
            reflectedLight.directDiffuse *= sky;reflectedLight.directSpecular *= sky;reflectedLight.indirectDiffuse *= sky;reflectedLight.indirectSpecular *= sky;
            reflectedLight.indirectDiffuse += material.diffuseColor * uDark;
            float relief = 1.0;
            if (dot(vBakeDir, vBakeDir) > .0004) {vec3 d = normalize(vBakeDir);vec3 g = normalize(vNormal);relief = clamp((max(dot(geometryNormal, d), 0.0) + .2) / (max(dot(g, d), 0.0) + .2), .3, 1.8);}
            int ph = int(vBakeX.y + .5);float fl = ph == 0 ? uFlick.x : ph == 1 ? uFlick.y : ph == 2 ? uFlick.z : uFlick.w;
            reflectedLight.directDiffuse += BRDF_Lambert(material.diffuseColor) * vBake * fl * relief;
            if (uLamp.w > 0.0) {
              vec3 lv = uLampPos - geometryPosition;float dl = length(lv);vec3 ld = lv / max(dl, .001);
              float spot = smoothstep(uLampCos.x, uLampCos.y, dot(-ld, uLampDir));
              IncidentLight il;il.direction = ld;il.visible = true;il.color = uLamp.rgb * uLamp.w * (spot * .94 + .06) * getDistanceAttenuation(dl, 34.0, 2.0);
              RE_Direct(il, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
            }
          }`);
      };
      m.customProgramCacheKey = () => 'catacomb-' + a;
      return m;
    }
    const MAT = {
      masonry: bakeMaterial({map: TX.masonry.map, normalMap: TX.masonry.normal, roughness: .86, color: 0xd8cfbf}),
      rock: bakeMaterial({map: TX.rock.map, normalMap: TX.rock.normal, roughness: .93, color: 0xc4baa8}),
      quarry: bakeMaterial({map: TX.quarry.map, normalMap: TX.quarry.normal, roughness: .95, color: 0xc4baa8}),
      earth: bakeMaterial({map: TX.earth.map, normalMap: TX.earth.normal, roughness: .97, color: 0xc8beb0}),
      flags: bakeMaterial({map: TX.flags.map, normalMap: TX.flags.normal, roughness: .8, color: 0xd9d2c4}),
      bones: TX.bones ? bakeMaterial({map: TX.bones.map, normalMap: TX.bones.normal, roughness: .78, color: 0xffffff}) : bakeMaterial({color: 0xb9ab8e, roughness: .8}),
      iron: bakeMaterial({color: 0x2b2826, roughness: .55, metalness: .6}),
      wood: bakeMaterial({color: 0x4a3322, roughness: .85}),
      soot: bakeMaterial({color: 0x17130f, roughness: .9}),
      water: bakeMaterial({color: 0x0b1214, roughness: .04, metalness: .3}),
      wax: bakeMaterial({color: 0xe8dcc0, roughness: .6}),
      stone: bakeMaterial({map: TX.rock.map, normalMap: TX.rock.normal, normalScale: new T.Vector2(.45, .45), roughness: .78, color: 0xf0e6d4}),
      web: bakeMaterial({map: TX.cobweb, transparent: true, alphaTest: .05, side: T.DoubleSide, depthWrite: false, roughness: 1}),
    };
    const boneColor = models ? models.boneColor : 0xd9ccb0;
    const SKULL_MAT = bakeMaterial({color: boneColor, roughness: .78, vertexColors: true}, {instanced: true});

    // ---------- Light baking ----------
    const TORCH_RGB = [1, .5, .19], TORCH_I = 4.2, RANGE = 11;
    const torches = L.torches.map(t => ({...t}));
    const candles = [];// small lights placed with the props: {x, s, y, i, phase}
    let bins = null;// filled on the first bake, after the props have placed their candles
    function lightAt(x, s, y, nx, ny, ns, own) {
      let r = 0, g = 0, b = 0, dx = 0, dy = 0, ds = 0, best = 0, phase = 0;
      // Line of sight from a point a hair inside its own cell (points on a cell edge would otherwise test the rock behind).
      const c = own >= 0 ? L.centre(own % NX, Math.floor(own / NX)) : null, px = c ? x + (c.x - x) * .04 : x, ps = c ? s + (c.s - s) * .04 : s;
      const add = (lx, ls, ly, I, ph) => {
        const vx = lx - x, vy = ly - y, vs = ls - s, d = Math.hypot(vx, vy, vs);if (d > RANGE || d < 1e-4) return;
        // Pale limestone throws a lot of light back: surfaces turned away still get a fifth (bounce).
        const ndl = nx === null ? 1 : .2 + .8 * Math.max(0, (vx * nx + vy * ny + vs * ns) / d);
        if (!L.los(lx, ls, px, ps)) return;
        const q = 1 - Math.pow(d / RANGE, 4), w = I * q * q / (.4 + d * d * .8);
        r += TORCH_RGB[0] * w * ndl;g += TORCH_RGB[1] * w * ndl;b += TORCH_RGB[2] * w * ndl;dx += vx / d * w;dy += vy / d * w;ds += vs / d * w;if (w > best) {best = w;phase = ph;}
      };
      // Lights in 12 m bins: a point only looks at the bins round it (the range is 11 m).
      if (!bins) {bins = new Map();const put = q => {const k = Math.floor(q.x / 12) + ',' + Math.floor(q.s / 12);if (!bins.has(k)) bins.set(k, []);bins.get(k).push(q);};torches.forEach(t => put({x: t.x + t.nx * .06, s: t.s + t.ns * .06, y: t.y + .28, i: TORCH_I, phase: t.phase}));candles.forEach(put);}
      const bi = Math.floor(x / 12), bj = Math.floor(s / 12);for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {const list = bins.get((bi + di) + ',' + (bj + dj));if (list) for (const q of list) add(q.x, q.s, q.y, q.i, q.phase);}
      const dl = Math.hypot(dx, dy, ds) || 1;
      return [r, g, b, dx / dl, dy / dl, ds / dl, phase];
    }
    // Daylight on a stair: full in the mausoleum's doorway, gone 9 m in.
    function skyAt(cell, x, s) {const k = cell >= 0 ? L.stairOf[cell] : -1;if (k < 0) return 0;const t = L.entrances[k].tOf(x, s);return Math.pow(Math.max(0, Math.min(1, 1 - (t - 1) / 9)), 2);}
    // Position noise shared by every surface through a point, so walls, vaults and arches meet without cracks.
    const hash = (x, y, z) => {const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;return h - Math.floor(h);};
    function vnoise(x, y, z) {
      const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), f = t => t * t * (3 - 2 * t), a = f(x - i), b = f(y - j), c = f(z - k);
      const l = (p, q, r) => hash(i + p, j + q, k + r), m = (q, r) => l(0, q, r) * (1 - a) + l(1, q, r) * a;
      return (m(0, 0) * (1 - b) + m(1, 0) * b) * (1 - c) + (m(0, 1) * (1 - b) + m(1, 1) * b) * c;
    }
    const roughCell = new Float32Array(NX * NS);for (let c = 0; c < NX * NS; c++) roughCell[c] = L.isDark(c) ? .09 : style[c] === S.stair ? .015 : .035;
    function roughAt(x, s) {const fi = (x - X0) / CELL - .5, fj = (s - S0) / CELL - .5, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, g = (a, b) => roughCell[Math.min(NS - 1, Math.max(0, b)) * NX + Math.min(NX - 1, Math.max(0, a))];return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;}
    function displace(x, y, s) {const a = roughAt(x, s), f = 1.7;return [x + (vnoise(x * f, y * f, s * f) - .5) * 2.2 * a, y + (vnoise(x * f + 17, y * f, s * f) - .5) * 1.6 * a, s + (vnoise(x * f, y * f + 31, s * f) - .5) * 2.2 * a];}

    // ---------- Geometry buckets: one per chunk (8 x 8 cells; each stair is its own) and material ----------
    const CH = 8, chunks = new Map();
    const chunkKey = c => {const k = L.stairOf[c];return k >= 0 ? 'e' + k : Math.floor((c % NX) / CH) + ',' + Math.floor(Math.floor(c / NX) / CH);};
    const chunkAt = (x, s) => {const c = L.cellOf(x, s);return c ? chunkKey(c.idx) : '0,0';};
    function chunk(key) {if (!chunks.has(key)) chunks.set(key, {key, mats: new Map(), skulls: [], femurs: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]});return chunks.get(key);}
    function bucket(key, mat) {const ch = chunk(key);if (!ch.mats.has(mat)) ch.mats.set(mat, {pos: [], nrm: [], uv: [], bake: [], dir: [], x: [], idx: []});return ch.mats.get(mat);}
    const push3 = (a, v) => a.push(v[0], v[1], v[2]);
    // A grid of (nu+1) x (nv+1) points from f(u, v) -> {p: [x, y, s], uv}; n is the side it faces (winding and normals follow it).
    function patch(key, mat, nu, nv, f, n, cell, opts = {}) {
      const b = bucket(key, mat), base = b.pos.length / 3, P = [], raw = [];
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {const q = f(i / nu, j / nv);raw.push(q);P.push(opts.flat ? q.p : displace(q.p[0], q.p[1], q.p[2]));}
      const at = (i, j) => P[Math.min(nv, Math.max(0, j)) * (nu + 1) + Math.min(nu, Math.max(0, i))];
      const sub = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]], crs = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
      let flip = false;{const nn = crs(sub(raw[nu + 1].p, raw[0].p), sub(raw[1].p, raw[0].p));flip = nn[0] * n[0] + nn[1] * n[1] + nn[2] * n[2] < 0;}
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const k = j * (nu + 1) + i, q = raw[k], p = P[k];
        let nn = crs(sub(at(i, j + 1), at(i, j - 1)), sub(at(i + 1, j), at(i - 1, j)));if (flip) nn = nn.map(v => -v);
        const l = Math.hypot(...nn);nn = l > 1e-9 ? nn.map(v => v / l) : n;
        const lit = lightAt(q.p[0], q.p[2], q.p[1] + n[1] * .04, n[0], n[1], n[2], cell);
        push3(b.pos, p);push3(b.nrm, nn);b.uv.push(q.uv[0], q.uv[1]);push3(b.bake, lit);b.dir.push(lit[3], lit[4], lit[5]);b.x.push(opts.sky ?? skyAt(cell, q.p[0], q.p[2]), lit[6]);
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {const a = base + j * (nu + 1) + i, c = a + nu + 1;if (flip) b.idx.push(a, a + 1, c, a + 1, c + 1, c);else b.idx.push(a, c, a + 1, a + 1, c, c + 1);}
    }
    // A three.js geometry placed with matrix m (catacomb frame) into a bucket, baked per vertex.
    const tmpV = new T.Vector3(), tmpN = new T.Vector3(), nm = new T.Matrix3();
    function addGeometry(key, mat, geo, m, cell, opts = {}) {
      const b = bucket(key, mat), g = geo, base = b.pos.length / 3, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;nm.getNormalMatrix(m);
      for (let i = 0; i < P.count; i++) {
        tmpV.fromBufferAttribute(P, i).applyMatrix4(m);tmpN.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        const lit = lightAt(tmpV.x, tmpV.z, tmpV.y, tmpN.x, tmpN.y, tmpN.z, cell);
        b.pos.push(tmpV.x, tmpV.y, tmpV.z);b.nrm.push(tmpN.x, tmpN.y, tmpN.z);b.uv.push(UV ? UV.getX(i) * (opts.uvScale || 1) : 0, UV ? UV.getY(i) * (opts.uvScale || 1) : 0);push3(b.bake, lit);b.dir.push(lit[3], lit[4], lit[5]);b.x.push(opts.sky ?? skyAt(cell, tmpV.x, tmpV.z), lit[6]);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) b.idx.push(base + g.index.getX(i));else for (let i = 0; i < P.count; i++) b.idx.push(base + i);
    }
    const M4 = (x, y, s, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) => new T.Matrix4().compose(new T.Vector3(x, y, s), new T.Quaternion().setFromEuler(new T.Euler(pitch, yaw, roll, 'YXZ')), new T.Vector3(sx, sy, sz));
    // A box in metres with uv in metres (for the stone textures), placed at (x, y, s) bottom-centre.
    function box(key, mat, x, y, s, w, h, d, yaw, cell, opts) {const g = new T.BoxGeometry(w, h, d);boxUVm(g, w, h, d);addGeometry(key, mat, g, M4(x, y + h / 2, s, yaw), cell, opts);}
    function boxUVm(g, w, h, d) {const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;for (let i = 0; i < p.count; i++) {const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));uv.setXY(i, ax > .5 ? p.getZ(i) : p.getX(i), ay > .5 ? p.getZ(i) : p.getY(i));}}
    const wallMat = c => L.isDark(c) ? MAT.quarry : MAT.masonry;
    const bonesCell = c => style[c] === S.ossuary || style[c] === S.chapel;
    const STACK = 1.45, INSET = .22;
    function edgeOf(c, k) {
      const B = cellBox(c);
      if (k === 0) return {a: [B.x0, B.s0], b: [B.x1, B.s0], n: [0, 1]};
      if (k === 2) return {a: [B.x1, B.s1], b: [B.x0, B.s1], n: [0, -1]};
      if (k === 1) return {a: [B.x1, B.s0], b: [B.x1, B.s1], n: [-1, 0]};
      return {a: [B.x0, B.s1], b: [B.x0, B.s0], n: [1, 0]};
    }

    // ---------- Props first (their candles light the walls) ----------
    const props = [], obstaclesLocal = [];// obstacle polygons in local [x, s] with minY/maxY
    const block = (x, s, hw, hd, yaw, y0, y1) => {const c = Math.cos(yaw), sn = Math.sin(yaw), pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => [x + a * c + b * sn, s - a * sn + b * c]);obstaclesLocal.push({pts, minY: y0, maxY: y1});};
    const ring = (x, s, r, y0, y1, n = 12) => obstaclesLocal.push({pts: Array.from({length: n}, (_, i) => [x + Math.cos(i / n * 6.283) * r, s + Math.sin(i / n * 6.283) * r]), minY: y0, maxY: y1});
    const candle = (x, s, y, i = 1.1) => {candles.push({x, s, y: y + .2, i, phase: candles.length % 4});props.push({kind: 'candle', x, s, y});};
    {
      const R = room('rotunda');props.push({kind: 'pillar', x: R.cx, s: R.cs});ring(R.cx, R.cs, 1.05, FLOOR_Y - 1, FLOOR_Y + 4);
      for (const id of ['chapel', 'sacellum', 'bonehall']) {
        const r = room(id), c = L.cellOf(r.cx, r.cs).idx;
        // The altar of skulls stands against the wall farthest from the room's doorways.
        const sides = [0, 1, 2, 3].map(k => {const E = k === 0 ? r.s0 : k === 2 ? r.s1 : k === 1 ? r.x1 : r.x0;let doors = 0;roomCells(r).forEach(q => {const o = L.open(q), qi = q % NX + DI[k], qj = Math.floor(q / NX) + DJ[k], n = L.id(qi, qj);if (o[k] && L.roomOf[n] !== r.index) doors++;});return {k, doors, E};});
        const side = sides.sort((a, b) => a.doors - b.doors || ((b.k % 2 ? r.s1 - r.s0 : r.x1 - r.x0) - (a.k % 2 ? r.s1 - r.s0 : r.x1 - r.x0)))[0].k;
        const nx = -DI[side], ns = -DJ[side], ax = side % 2 ? r.x1 - (side === 1 ? 0 : r.x1 - r.x0) : r.cx, as = side % 2 ? r.cs : (side === 0 ? r.s0 : r.s1);
        const x = ax + nx * .75, s = as + ns * .75, yaw = Math.atan2(nx, ns);
        props.push({kind: 'altar', x, s, yaw, nx, ns, cell: c});block(x, s, .95, .5, yaw, FLOOR_Y - 1, FLOOR_Y + 1.1);
        candle(x + Math.cos(yaw) * .75, s - Math.sin(yaw) * .75, FLOOR_Y + .95);candle(x - Math.cos(yaw) * .75, s + Math.sin(yaw) * .75, FLOOR_Y + .95);
        if (id === 'bonehall') for (const [u, v] of [[-.27, -.27], [.27, -.27], [-.27, .27], [.27, .27]]) {const px = r.cx + u * (r.x1 - r.x0), ps = r.cs + v * (r.s1 - r.s0);props.push({kind: 'column', x: px, s: ps, h: L.ceilAt(L.cellOf(px, ps).idx, px, ps) - FLOOR_Y + .3});block(px, ps, .32, .32, 0, FLOOR_Y - 1, FLOOR_Y + 4);}
      }
      const C = room('crypt');props.push({kind: 'sarcophagus', x: C.cx, s: C.cs, yaw: (C.x1 - C.x0) > (C.s1 - C.s0) ? Math.PI / 2 : 0});block(C.cx, C.cs, ...((C.x1 - C.x0) > (C.s1 - C.s0) ? [1.2, .55] : [.55, 1.2]), 0, FLOOR_Y - 1, FLOOR_Y + 1.1);
      for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) candle(C.cx + u * 1.6, C.cs + v * .95, FLOOR_Y + .02, 1.3);
      for (const [u, v] of [[-.36, -.33], [.36, -.33], [-.36, .33], [.36, .33]]) {const px = C.cx + u * (C.x1 - C.x0), ps = C.cs + v * (C.s1 - C.s0);props.push({kind: 'column', x: px, s: ps, h: L.ceilAt(L.cellOf(px, ps).idx, px, ps) - FLOOR_Y + .3});block(px, ps, .3, .3, 0, FLOOR_Y - 1, FLOOR_Y + 4);}
      const Wl = room('well');props.push({kind: 'well', x: Wl.cx, s: Wl.cs});block(Wl.cx, Wl.cs, 1.25, 1.25, 0, FLOOR_Y - 1, FLOOR_Y + .7);
      const Cv = room('cavern');for (let i = 0; i < 9; i++) {const x = Cv.x0 + 1.2 + rand() * (Cv.x1 - Cv.x0 - 2.4), s = Cv.s0 + 1.2 + rand() * (Cv.s1 - Cv.s0 - 2.4), r = .35 + rand() * .55;props.push({kind: 'rubble', x, s, r});ring(x, s, r * .9, FLOOR_Y - 1, FLOOR_Y + r * 1.2, 8);}
      for (const [u, v] of [[-.3, -.3], [.3, .3]]) {const x = Cv.cx + u * (Cv.x1 - Cv.x0), s = Cv.cs + v * (Cv.s1 - Cv.s0);props.push({kind: 'prop', x, s});block(x, s, .12, .12, 0, FLOOR_Y - 1, FLOOR_Y + 4);}
      const Wr = room('workroom');props.push({kind: 'table', x: Wr.cx, s: Wr.cs});block(Wr.cx, Wr.cs, .9, .45, 0, FLOOR_Y - 1, FLOOR_Y + .8);
      for (const [u, v] of [[.38, -.32], [.34, .3]]) {const x = Wr.cx + u * (Wr.x1 - Wr.x0), s = Wr.cs + v * (Wr.s1 - Wr.s0);props.push({kind: 'barrel', x, s});ring(x, s, .32, FLOOR_Y - 1, FLOOR_Y + .9, 8);}
      // Timber props in long straight dark tunnels, cobwebs and loose bones in dead ends.
      let since = 0;
      for (let c = 0; c < NX * NS; c++) {
        if (kind[c] !== L.CORRIDOR || !L.isDark(c)) continue;
        const o = L.open(c), n = o.filter(Boolean).length, ctr = L.centre(c % NX, Math.floor(c / NX));
        if (L.vault[c] && ++since > 5 && rand() < .5) {since = 0;props.push({kind: 'frame', x: ctr.x, s: ctr.s, along: L.vault[c], cell: c});const across = L.vault[c] === 1;for (const d of [-.82, .82]) block(ctr.x + (across ? d : 0), ctr.s + (across ? 0 : d), .09, .09, 0, FLOOR_Y - 1, FLOOR_Y + 2.2);}
        if (n === 1) {props.push({kind: 'web', cell: c});props.push({kind: 'scatter', cell: c});}
      }
    }

    // ---------- Floors, ceilings, walls, arches ----------
    const doorEdge = new Map();L.entrances.forEach(e => doorEdge.set(e.cells[0] * 4 + (e.alongX ? (e.sign > 0 ? 3 : 1) : (e.sign > 0 ? 0 : 2)), e));
    for (let c = 0; c < NX * NS; c++) {
      if (!L.walkable(c)) continue;
      const B = cellBox(c), key = chunkKey(c), open = L.open(c), stair = L.stairOf[c] >= 0;
      if (!stair) {
        // Floor, reaching 12 cm under the walls where there is rock.
        const fx0 = B.x0 - (open[3] ? 0 : .12), fx1 = B.x1 + (open[1] ? 0 : .12), fs0 = B.s0 - (open[0] ? 0 : .12), fs1 = B.s1 + (open[2] ? 0 : .12);
        const paved = kind[c] === L.ROOM && !L.isDark(c);
        patch(key, paved ? MAT.flags : MAT.earth, 4, 4, (u, v) => {const x = fx0 + (fx1 - fx0) * u, s = fs0 + (fs1 - fs0) * v;return {p: [x, FLOOR_Y, s], uv: [x, s]};}, [0, 1, 0], c, {flat: true});
      }
      const vault = L.vault[c], along2 = vault === 2;
      patch(key, L.isDark(c) ? MAT.quarry : MAT.rock, vault ? 8 : stair ? 2 : 4, 4, (u, v) => {const x = along2 ? B.x0 + CELL * v : B.x0 + CELL * u, s = along2 ? B.s0 + CELL * u : B.s0 + CELL * v;return {p: [x, L.ceilAt(c, x, s), s], uv: [x, s]};}, [0, -1, 0], c);
      for (let k = 0; k < 4; k++) {
        const E = edgeOf(c, k), n3 = [E.n[0], 0, E.n[1]], u0 = p => Math.abs(E.n[0]) ? p[1] : p[0];
        const pt = t => [E.a[0] + (E.b[0] - E.a[0]) * t, E.a[1] + (E.b[1] - E.a[1]) * t];
        if (open[k]) {
          // Arch face (lunette) where this cell's lower ceiling meets the neighbour's higher one; it faces the neighbour.
          const nb = L.id(c % NX + DI[k], Math.floor(c / NX) + DJ[k]), hA = t => L.ceilAt(c, ...pt(t)), hB = t => L.ceilAt(nb, ...pt(t));
          let diff = 0;for (let t = 0; t <= 1.0001; t += .125) diff = Math.max(diff, hB(t) - hA(t));
          if (diff > .02) patch(key, wallMat(nb), 8, 1, (u, v) => {const [x, s] = pt(u), lo = hA(u) - .06, hi = Math.max(hA(u), hB(u)) + .1, y = lo + (hi - lo) * v;return {p: [x, y, s], uv: [u0([x, s]), y - FLOOR_Y]};}, [-E.n[0], 0, -E.n[1]], nb);
          continue;
        }
        if (doorEdge.has(c * 4 + k)) continue;// the mausoleum's front wall is built with the mausoleum
        const bot = (x, s) => stair ? L.floorAt(c, x, s) - .35 : FLOOR_Y - .12;
        const wall = (lo, mat = wallMat(c)) => patch(key, mat, 8, 4, (u, v) => {const [x, s] = pt(u), y0 = lo ? lo : bot(x, s), y1 = L.ceilAt(c, x, s) + .25, y = y0 + (y1 - y0) * v;return {p: [x, y, s], uv: [u0([x, s]), y - FLOOR_Y]};}, n3, c);
        if (bonesCell(c)) {wall(FLOOR_Y + STACK - .05);boneStack(c, k, E, key);} else wall();
      }
      if (stair) stairSteps(c, L.entrances[L.stairOf[c]], key);
    }
    // ---------- Ossuary walls: bones stacked 1.45 m high, 22 cm proud of the rock, with rows of skulls ----------
    function boneStack(c, k, E, key) {
      const nx = E.n[0], ns = E.n[1], open = L.open(c), prev = (k + 3) % 4, next = (k + 1) % 4, ux = (E.b[0] - E.a[0]) / CELL, us = (E.b[1] - E.a[1]) / CELL;
      // Where the side wall turns away the stack ends with a face; at inner corners it stops at the other stack's face.
      const da = open[prev] ? 0 : INSET, dz = open[next] ? 0 : INSET, A = [E.a[0] + nx * INSET + ux * da, E.a[1] + ns * INSET + us * da], Z = [E.b[0] + nx * INSET - ux * dz, E.b[1] + ns * INSET - us * dz];
      // uv in metres (the bone texture's repeat is set to its real size).
      const along = p => Math.abs(nx) ? p[1] : p[0], len = Math.hypot(Z[0] - A[0], Z[1] - A[1]);
      patch(key, MAT.bones, 8, 3, (u, v) => {const x = A[0] + (Z[0] - A[0]) * u, s = A[1] + (Z[1] - A[1]) * u, y = FLOOR_Y + STACK * v;return {p: [x, y, s], uv: [along([x, s]), y - FLOOR_Y]};}, [nx, 0, ns], c, {flat: true});
      patch(key, MAT.bones, 8, 1, (u, v) => {const x = A[0] + (Z[0] - A[0]) * u - nx * INSET * v, s = A[1] + (Z[1] - A[1]) * u - ns * INSET * v;return {p: [x, FLOOR_Y + STACK, s], uv: [along([x, s]), v * INSET]};}, [0, 1, 0], c, {flat: true});
      for (const [end, side, P] of [[open[prev], -1, A], [open[next], 1, Z]]) if (end) patch(key, MAT.bones, 1, 3, (u, v) => {const x = P[0] - nx * INSET * u, s = P[1] - ns * INSET * u;return {p: [x, FLOOR_Y + STACK * v, s], uv: [u * INSET, STACK * v]};}, [ux * side, 0, us * side], c, {flat: true});
      const n = Math.max(1, Math.floor(len / .24)), yaw = Math.atan2(nx, ns), ch = chunk(key);
      for (let i = 0; i < n; i++) {
        const t = (i + .5) / n, x = A[0] + (Z[0] - A[0]) * t, s = A[1] + (Z[1] - A[1]) * t;
        for (const h of [.34, .94]) ch.skulls.push({x: x - nx * .035, s: s - ns * .035, y: FLOOR_Y + h, yaw: yaw + (rand() - .5) * .25, tilt: (rand() - .5) * .14, cell: c, n: [nx, 0, ns]});
        if (i % 2 === 0 || rand() < .35) ch.skulls.push({x: x - nx * .1, s: s - ns * .1, y: FLOOR_Y + STACK, yaw: yaw + (rand() - .5) * .6, tilt: (rand() - .5) * .1, cell: c, n: [nx, 0, ns]});
      }
    }
    // ---------- Stairs: stone steps around the walking ramp (its line runs through the middle of every tread) ----------
    function stairSteps(c, e, key) {
      const B = cellBox(c), ta = e.tOf(B.x0, B.s0), tb = e.tOf(B.x1, B.s1), t0 = Math.min(ta, tb), t1 = Math.max(ta, tb), dirN = e.alongX ? [e.sign, 0, 0] : [0, 0, e.sign];
      const quad = (pa, pb, ya, yb, n) => patch(key, MAT.flags, 1, 1, (u, v) => {const w = -1.12 + 2.24 * u, t = pa + (pb - pa) * v, p = e.toLocal(t, w), y = ya + (yb - ya) * v;return {p: [p.x, y, p.s], uv: [w, n[1] ? t : y]};}, n, c, {flat: true});
      const tread = (a, b, y) => {a = Math.max(a, t0);b = Math.min(b, t1);if (b - a > 1e-4) quad(a, b, y, y, [0, 1, 0]);};
      const riser = (t, yHi, yLo) => {if (t >= t0 - 1e-6 && t < t1 - 1e-6) quad(t, t, yHi, yLo, [-dirN[0], 0, -dirN[2]]);};
      tread(0, e.t0, e.top);
      const flights = e.landing ? [[e.t0, e.tMid], [e.tMid + e.landing, e.tBottom]] : [[e.t0, e.tBottom]];
      if (e.landing) tread(e.tMid, e.tMid + e.landing, e.floorT(e.tMid));
      for (const [k0, k1] of flights) {
        const n = Math.max(1, Math.round((k1 - k0) / .28)), go = (k1 - k0) / n, yA = e.floorT(k0), rise = (yA - e.floorT(k1)) / n;
        for (let i = 0; i < n; i++) {const y = yA - (i + .5) * rise;tread(k0 + i * go, k0 + (i + 1) * go, y);riser(k0 + i * go, i ? yA - (i - .5) * rise : yA, y);}
        riser(k1, yA - (n - .5) * rise, e.floorT(k1));
      }
    }

    // ---------- Props: geometry ----------
    const skullHi = models ? models.skull({lod: 'high'}) : new T.SphereGeometry(.085, 16, 12).translate(0, .085, 0), skullLo = models ? models.skull({lod: 'low'}) : new T.SphereGeometry(.085, 8, 6).translate(0, .085, 0);
    const jawHi = models ? models.skull({lod: 'high', jaw: true}) : skullHi, jawLo = models ? models.skull({lod: 'low', jaw: true}) : skullLo;
    const femurHi = models ? models.femur({lod: 'high'}) : new T.CylinderGeometry(.018, .018, .45, 8).rotateZ(Math.PI / 2), femurLo = models ? models.femur({lod: 'low'}) : femurHi;
    // The far version, where the models have one (fewer triangles than the light one), else the light one.
    const tris = geo => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const farOf = (make, lo) => {try {const f = models && make();return f && tris(f) < tris(lo) ? f : lo;} catch {return lo;}};
    const skullFar = farOf(() => models.skull({lod: 'far'}), skullLo), jawFar = farOf(() => models.skull({lod: 'far', jaw: true}), jawLo), femurFar = farOf(() => models.femur({lod: 'far'}), femurLo);
    const HI_CAP = 32;
    const cellAt = (x, s) => {const q = L.cellOf(x, s);return q ? q.idx : -1;};
    for (const p of props) {
      const key = p.cell !== undefined ? chunkKey(p.cell) : chunkAt(p.x, p.s), cell = p.cell !== undefined ? p.cell : cellAt(p.x, p.s), ch = chunk(key);
      if (p.kind === 'pillar') {
        // The bone barrel of the rotunda: stacked bones round a core, three rings of skulls, a stone cap.
        const g = new T.CylinderGeometry(.95, 1.0, 2.3, 28, 4, true), uv = g.attributes.uv;for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 2.3);
        addGeometry(key, MAT.bones, g, M4(p.x, FLOOR_Y + 1.15, p.s), cell);
        addGeometry(key, MAT.stone, new T.CylinderGeometry(1.12, 1.12, .22, 28), M4(p.x, FLOOR_Y + 2.41, p.s), cell, {uvScale: 2});
        for (const [h, n] of [[.36, 15], [1.0, 16], [1.62, 15]]) for (let i = 0; i < n; i++) {const a = (i + (h > .9 && h < 1.1 ? .5 : 0)) / n * Math.PI * 2, nx = Math.sin(a), ns = Math.cos(a);ch.skulls.push({x: p.x + nx * .91, s: p.s + ns * .91, y: FLOOR_Y + h, yaw: a, tilt: 0, cell, n: [nx, 0, ns]});}
        for (let i = 0; i < 12; i++) {const a = i / 12 * Math.PI * 2;ch.skulls.push({x: p.x + Math.sin(a) * .7, s: p.s + Math.cos(a) * .7, y: FLOOR_Y + 2.52, yaw: a, tilt: 0, cell, n: [Math.sin(a), 0, Math.cos(a)]});}
      } else if (p.kind === 'altar') {
        box(key, MAT.stone, p.x, FLOOR_Y, p.s, 1.9, .9, 1.0, p.yaw, cell);box(key, MAT.stone, p.x, FLOOR_Y + .9, p.s, 2.06, .08, 1.12, p.yaw, cell);
        // A pyramid of skulls on the altar, a stone cross on the wall behind it.
        const fx = Math.sin(p.yaw), fs = Math.cos(p.yaw), rx = Math.cos(p.yaw), rs = -Math.sin(p.yaw);
        [[5, .98, .12], [4, 1.13, -.04], [3, 1.28, -.18], [1, 1.43, -.3]].forEach(([n, y, d]) => {for (let i = 0; i < n; i++) {const u = (i - (n - 1) / 2) * .22;ch.skulls.push({x: p.x + rx * u + fx * d, s: p.s + rs * u + fs * d, y: FLOOR_Y + y - .1, yaw: p.yaw, tilt: 0, cell, n: [fx, 0, fs]});}});
        const wx = p.x - fx * .73, ws = p.s - fs * .73;box(key, MAT.stone, wx, FLOOR_Y + 1.5, ws, .14, 1.15, .08, p.yaw, cell);box(key, MAT.stone, wx, FLOOR_Y + 2.2, ws, .62, .14, .08, p.yaw, cell);
      } else if (p.kind === 'column') {
        box(key, MAT.stone, p.x, FLOOR_Y, p.s, .62, .22, .62, 0, cell);box(key, MAT.masonry, p.x, FLOOR_Y + .22, p.s, .5, p.h - .5, .5, 0, cell);box(key, MAT.stone, p.x, FLOOR_Y + p.h - .28, p.s, .62, .28, .62, 0, cell);
      } else if (p.kind === 'sarcophagus') {
        box(key, MAT.stone, p.x, FLOOR_Y, p.s, 2.3, .14, 1.0, p.yaw, cell);box(key, MAT.stone, p.x, FLOOR_Y + .14, p.s, 2.1, .66, .82, p.yaw, cell);
        box(key, MAT.stone, p.x, FLOOR_Y + .8, p.s, 2.24, .16, .96, p.yaw, cell);box(key, MAT.stone, p.x, FLOOR_Y + .96, p.s, 1.9, .07, .7, p.yaw, cell);
        const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);box(key, MAT.stone, p.x, FLOOR_Y + 1.03, p.s, 1.3, .04, .12, p.yaw, cell);box(key, MAT.stone, p.x + c * .3, FLOOR_Y + 1.03, p.s - sn * .3, .12, .04, .5, p.yaw, cell);
        ch.skulls.push({x: p.x - c * .7, s: p.s + sn * .7, y: FLOOR_Y + 1.03, yaw: p.yaw + Math.PI / 2, tilt: 0, cell, n: [0, 1, 0], jaw: true});
      } else if (p.kind === 'candle') {
        addGeometry(key, MAT.wax, new T.CylinderGeometry(.03, .034, .2, 10), M4(p.x, p.y + .1, p.s), cell);
      } else if (p.kind === 'well') {
        // A square stone curb round a pool of black water.
        for (const [dx, ds, w, d] of [[0, -1.1, 2.5, .3], [0, 1.1, 2.5, .3], [-1.1, 0, .3, 1.9], [1.1, 0, .3, 1.9]]) box(key, MAT.stone, p.x + dx, FLOOR_Y, p.s + ds, w, .62, d, 0, cell);
        patch(key, MAT.water, 1, 1, (u, v) => ({p: [p.x - .95 + 1.9 * u, FLOOR_Y + .18, p.s - .95 + 1.9 * v], uv: [u, v]}), [0, 1, 0], cell, {flat: true});
      } else if (p.kind === 'rubble') {
        const g = new T.IcosahedronGeometry(p.r, 1), pos = g.attributes.position;for (let i = 0; i < pos.count; i++) {const f = .75 + hash(pos.getX(i) * 9, pos.getY(i) * 9, pos.getZ(i) * 9) * .5;pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * .7, pos.getZ(i) * f);}g.computeVertexNormals();
        addGeometry(key, MAT.quarry, g, M4(p.x, FLOOR_Y + p.r * .25, p.s, rand() * 6), cell, {uvScale: 1});
      } else if (p.kind === 'prop') {
        box(key, MAT.wood, p.x, FLOOR_Y, p.s, .2, 3.3, .2, .1, cell);box(key, MAT.wood, p.x, FLOOR_Y + 3.0, p.s, 1.6, .18, .26, .1, cell);
      } else if (p.kind === 'frame') {
        const across = p.along === 1;
        for (const d of [-.82, .82]) box(key, MAT.wood, p.x + (across ? d : 0), FLOOR_Y, p.s + (across ? 0 : d), .16, 2.05, .16, 0, cell);
        box(key, MAT.wood, p.x, FLOOR_Y + 2.0, p.s, across ? 1.95 : .2, .18, across ? .2 : 1.95, 0, cell);
      } else if (p.kind === 'table') {
        box(key, MAT.wood, p.x, FLOOR_Y + .74, p.s, 1.8, .07, .9, 0, cell);for (const [u, v] of [[-.8, -.38], [.8, -.38], [-.8, .38], [.8, .38]]) box(key, MAT.wood, p.x + u, FLOOR_Y, p.s + v, .08, .74, .08, 0, cell);
        box(key, MAT.iron, p.x - .3, FLOOR_Y + .81, p.s + .1, .16, .22, .16, 0, cell);// an old lantern
        ch.skulls.push({x: p.x + .45, s: p.s - .12, y: FLOOR_Y + .81, yaw: 2.4, tilt: 0, cell, n: [0, 1, 0], jaw: true});
      } else if (p.kind === 'barrel') {
        addGeometry(key, MAT.wood, new T.CylinderGeometry(.3, .3, .9, 14), M4(p.x, FLOOR_Y + .45, p.s), cell);
      } else if (p.kind === 'web') {
        // Cobweb across the corner where the dead end's ceiling meets its far wall.
        const c = p.cell, o = L.open(c), k = o.indexOf(true), back = (k + 2) % 4, E = edgeOf(c, back), y = L.ceilAt(c, (E.a[0] + E.b[0]) / 2, (E.a[1] + E.b[1]) / 2);
        patch(key, MAT.web, 1, 1, (u, v) => {const x = E.a[0] + (E.b[0] - E.a[0]) * (.15 + .7 * u) + E.n[0] * .45 * v, s = E.a[1] + (E.b[1] - E.a[1]) * (.15 + .7 * u) + E.n[1] * .45 * v;return {p: [x, y - .75 + .7 * v, s], uv: [u, v]};}, [E.n[0], -.5, E.n[1]], c, {flat: true});
      } else if (p.kind === 'scatter') {
        const ctr = L.centre(p.cell % NX, Math.floor(p.cell / NX));
        for (let i = 0; i < 3; i++) ch.skulls.push({x: ctr.x + (rand() - .5) * 1.2, s: ctr.s + (rand() - .5) * 1.2, y: FLOOR_Y, yaw: rand() * 6.3, tilt: (rand() - .5) * 1.2, cell: p.cell, n: [0, 1, 0], jaw: rand() < .5});
        for (let i = 0; i < 5; i++) ch.femurs.push({x: ctr.x + (rand() - .5) * 1.4, s: ctr.s + (rand() - .5) * 1.4, y: FLOOR_Y + .025, yaw: rand() * 6.3, cell: p.cell});
      }
    }
    // ---------- Torches: iron bracket, wooden stick ----------
    const flames = [];
    for (const t of torches) {
      const key = chunkKey(t.cell), yaw = Math.atan2(t.nx, t.ns), wx = t.x - t.nx * .1, ws = t.s - t.ns * .1;
      box(key, MAT.iron, wx, t.y - .2, ws, .07, .28, .03, yaw, t.cell);
      addGeometry(key, MAT.iron, new T.CylinderGeometry(.012, .012, .16, 6).rotateX(Math.PI / 2), M4(wx + t.nx * .08, t.y - .05, ws + t.ns * .08, yaw), t.cell);
      addGeometry(key, MAT.iron, new T.TorusGeometry(.04, .01, 6, 12).rotateX(Math.PI / 2), M4(t.x, t.y - .05, t.s), t.cell);
      addGeometry(key, MAT.wood, new T.CylinderGeometry(.03, .022, .5, 8), M4(t.x, t.y, t.s, yaw, 1, 1, 1, .26), t.cell);
      addGeometry(key, MAT.soot, new T.CylinderGeometry(.045, .034, .12, 8), M4(t.x + t.nx * .06, t.y + .24, t.s + t.ns * .06, yaw, 1, 1, 1, .26), t.cell);
      flames.push({x: t.x + t.nx * .07, s: t.s + t.ns * .07, y: t.y + .3, size: 1, phase: t.phase + rand()});
    }
    for (const c of candles) flames.push({x: c.x, s: c.s, y: c.y, size: .28, phase: c.phase + rand()});
    // ---------- Engraved tablets: the entrance halls, the rotunda, the crypt and the streets above (like Paris) ----------
    const tablets = [];
    function tabletOn(c, k, lines, w = 1.1, h = .42, y = 1.55) {
      const E = edgeOf(c, k), mid = [(E.a[0] + E.b[0]) / 2, (E.a[1] + E.b[1]) / 2], ux = (E.b[0] - E.a[0]) / CELL, us = (E.b[1] - E.a[1]) / CELL, off = bonesCell(c) ? INSET + .03 : .04, key = chunkKey(c);
      const mat = bakeMaterial({map: tablet(lines), roughness: .85});tablets.push(mat);
      patch(key, mat, 1, 1, (u, v) => {const a = (u - .5) * w, x = mid[0] + ux * a + E.n[0] * off, s = mid[1] + us * a + E.n[1] * off;return {p: [x, FLOOR_Y + y + (v - .5) * h, s], uv: [u, v]};}, [E.n[0], 0, E.n[1]], c, {flat: true});
    }
    const wallSide = c => [0, 1, 2, 3].find(k => !L.open(c)[k] && !doorEdge.has(c * 4 + k));
    for (const e of L.entrances) {
      const hall = room(e.hall.id), cells = roomCells(hall);
      // On a hall wall facing the stair: where it leads, and the old warning of the Paris catacombs in Norwegian.
      const back = cells.find(c => {const k = e.alongX ? (e.sign > 0 ? 1 : 3) : (e.sign > 0 ? 2 : 0);return !L.open(c)[k] && Math.abs((c % NX) - (hall.cells[0] + hall.cells[2]) / 2) + Math.abs(Math.floor(c / NX) - (hall.cells[1] + hall.cells[3]) / 2) < 1.1;});
      if (back !== undefined) tabletOn(back, e.alongX ? (e.sign > 0 ? 1 : 3) : (e.sign > 0 ? 2 : 0), [{text: 'STANS!', size: 70}, {text: 'HER BEGYNNER DØDENS RIKE', size: 58}, {text: `UTGANG ${e.word} – OPP TIL ${e.sted}`, size: 30, bold: false}], 1.5, .56, 1.65);
    }
    {const R = room('rotunda'), c = roomCells(R).find(q => wallSide(q) !== undefined);if (c !== undefined) tabletOn(c, wallSide(c), [{text: 'MEMENTO MORI', size: 92}], 1.2, .4, 1.75);}
    {const C = room('crypt'), c = roomCells(C).find(q => wallSide(q) !== undefined);if (c !== undefined) tabletOn(c, wallSide(c), [{text: 'QUOD TU ES, EGO FUI', size: 62}, {text: 'QUOD EGO SUM, TU ERIS', size: 62}], 1.5, .5, 1.7);}
    {
      // Street names: a lit gallery that runs under a named street gets its name carved on the wall, once per street.
      const named = (world.data.roads || []).filter(r => r.n && !['footway', 'path', 'steps', 'cycleway', 'track', 'pedestrian', 'service'].includes(r.k)), done = new Set();
      const dist = (x, s, p) => {let best = Infinity;for (let i = 0; i + 3 < p.length; i += 2) {const ax = p[i], as = p[i + 1], dx = p[i + 2] - ax, ds = p[i + 3] - as, L2 = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / L2));best = Math.min(best, Math.hypot(x - ax - dx * t, s - as - ds * t));}return best;};
      for (const r of L.runs) {
        const c = r.cells[Math.floor(r.cells.length / 2)];if (r.cells.length < 3 || L.isDark(c) || kind[c] !== L.CORRIDOR || L.stairOf[c] >= 0) continue;
        const p = L.centre(c % NX, Math.floor(c / NX)), road = named.find(q => !done.has(q.n) && dist(p.x, p.s, q.p) < 9);
        if (road) {done.add(road.n);tabletOn(c, r.side, [{text: road.n.toUpperCase(), size: 74}], 1.0, .3, bonesCell(c) ? 1.7 : 1.55);}
      }
    }

    // ---------- Mausoleums on the surface ----------
    const outside = new T.Group();outside.name = 'Catacomb mausoleums';group.add(outside);
    const extStone = new T.MeshStandardMaterial({map: TX.masonry.map, normalMap: TX.masonry.normal, roughness: .85, color: 0xd7cdbb}), extIron = lib.metal(0x1e1c1b, .5);
    const signMat = e => new T.MeshStandardMaterial({map: tablet([{text: 'KATAKOMBENE', size: 104}, {text: `INNGANG ${e.word}`, size: 46, bold: false}]), roughness: .8});
    function extBox(x0, x1, y0, y1, s0, s1, mat = extStone) {const w = x1 - x0, h = y1 - y0, d = s1 - s0, g = new T.BoxGeometry(w, h, d);boxUVm(g, w, h, d);const m = new T.Mesh(g, mat);m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (s0 + s1) / 2);m.castShadow = m.receiveShadow = true;outside.add(m);return m;}
    for (const e of L.entrances) {
      const [x0, s0, x1, s1] = e.rect, top = e.top, wallTop = top + 3.4;let low = Infinity;
      for (let a = 0; a <= 8; a++) for (const [x, s] of [[x0 + (x1 - x0) * a / 8, s0], [x0 + (x1 - x0) * a / 8, s1], [x0, s0 + (s1 - s0) * a / 8], [x1, s0 + (s1 - s0) * a / 8]]) {const w = world.toWorld(x, s);low = Math.min(low, world.heightWorld(w.x, w.z));}
      const foot = low - .6, g0 = e.line - e.doorWidth / 2, g1 = e.line + e.doorWidth / 2;
      // In the stair's frame (t along, w across): walls 1 m thick; the side and back walls stop 10 cm short of the inner faces
      // (the catacomb's own walls are there), the front wall is whole.
      const tw = (ta, tb, wa, wb, ya, yb, mat) => {const A = e.toLocal(ta, wa), B = e.toLocal(tb, wb);return extBox(Math.min(A.x, B.x), Math.max(A.x, B.x), ya, yb, Math.min(A.s, B.s), Math.max(A.s, B.s), mat);};
      tw(0, 8, -2, -1.1, foot, wallTop);tw(0, 8, 1.1, 2, foot, wallTop);tw(7.1, 8, -1.1, 1.1, foot, wallTop);
      tw(0, 1, -1.1, g0 - e.line, foot, wallTop);tw(0, 1, g1 - e.line, 1.1, foot, wallTop);tw(0, 1, g0 - e.line, g1 - e.line, top + 2.3, wallTop);
      tw(1, 7.1, -1.1, 1.1, top + 3.0 + .25, wallTop);// above the ceiling
      tw(-.12, 8.12, -2.12, 2.12, wallTop, wallTop + .22);// cornice
      // Gabled roof along the stair, with stone pediments.
      const ridge = wallTop + .22 + 1.15, roofG = new T.BufferGeometry(), P = [], Ia = [];
      const v = (t, w, y) => {const p = e.toLocal(t, w);P.push(p.x, y, p.s);return P.length / 3 - 1;};
      const a0 = v(-.3, -2.35, wallTop + .2), a1 = v(8.3, -2.35, wallTop + .2), b0 = v(-.3, 0, ridge), b1 = v(8.3, 0, ridge), c0 = v(-.3, 2.35, wallTop + .2), c1 = v(8.3, 2.35, wallTop + .2);
      Ia.push(a0, a1, b1, a0, b1, b0, c0, b0, b1, c0, b1, c1);
      roofG.setAttribute('position', new T.Float32BufferAttribute(P, 3));roofG.setIndex(Ia);roofG.computeVertexNormals();
      const roof = new T.Mesh(roofG, new T.MeshStandardMaterial({color: 0x56514c, roughness: .8, side: T.DoubleSide}));roof.castShadow = roof.receiveShadow = true;outside.add(roof);
      for (const t of [-.05, 8.05]) {const ped = new T.BufferGeometry(), q = [], add = (w, y) => {const p = e.toLocal(t, w);q.push(p.x, y, p.s);};add(-2.12, wallTop + .22);add(2.12, wallTop + .22);add(0, ridge - .05);ped.setAttribute('position', new T.Float32BufferAttribute(q, 3));ped.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 4, 0, 2, 1], 2));ped.computeVertexNormals();const m = new T.Mesh(ped, new T.MeshStandardMaterial({map: TX.masonry.map, color: 0xcfc5b3, roughness: .85, side: T.DoubleSide}));m.castShadow = true;outside.add(m);}
      // The sign over the door, a stone skull in a niche above it, and the iron gate standing open.
      const face = e.toLocal(-.03, 0), yaw = Math.atan2(-e.dir[0], -e.dir[1]);
      const sign = new T.Mesh(new T.PlaneGeometry(1.9, .66), signMat(e));sign.position.set(face.x, top + 2.75, face.s);sign.rotation.y = yaw;outside.add(sign);
      const stoneSkull = new T.Mesh(skullLo, new T.MeshStandardMaterial({color: 0xcfc5b3, roughness: .9}));const sk = e.toLocal(-.02, 0);stoneSkull.position.set(sk.x, wallTop + .32, sk.s);stoneSkull.rotation.y = yaw;stoneSkull.scale.setScalar(1.6);outside.add(stoneSkull);
      const gate = new T.Group();for (let i = 0; i <= 7; i++) {const b = new T.Mesh(new T.BoxGeometry(.025, 2.2, .025), extIron);b.position.set(i * e.doorWidth / 7, 1.1, 0);gate.add(b);}
      for (const y of [.12, 1.1, 2.15]) {const b = new T.Mesh(new T.BoxGeometry(e.doorWidth, .04, .03), extIron);b.position.set(e.doorWidth / 2, y, 0);gate.add(b);}
      const hinge = e.toLocal(-.06, g0 - e.line);gate.position.set(hinge.x, top + .02, hinge.s);gate.rotation.y = yaw - 2.0;outside.add(gate);
      // Door threshold rising from the ground to the landing (as walked), lit by the day.
      const tc = L.cellOf(e.toLocal(1.5, 0).x, e.toLocal(1.5, 0).s).idx;
      patch(chunkKey(tc), MAT.flags, 1, 4, (u, v2) => {const w = (u - .5) * e.doorWidth, t = v2, p = e.toLocal(t, w), d = e.toLocal(0, w), dw = world.toWorld(d.x, d.s), g = world.heightWorld(dw.x, dw.z);return {p: [p.x, g + (top - g) * t, p.s], uv: [w, t]};}, [0, 1, 0], tc, {flat: true, sky: 1});
      // Iron lanterns either side of the door.
      for (const w of [-1.45, 1.45]) {const p = e.toLocal(-.18, w), m = new T.Mesh(new T.BoxGeometry(.18, .3, .18), extIron);m.position.set(p.x, top + 2.15, p.s);outside.add(m);}
    }
    lib.mergeStatic(outside);
    const doorGlows = L.entrances.map(e => {
      const m = new T.Mesh(new T.PlaneGeometry(e.doorWidth + .2, 2.5), new T.MeshBasicMaterial({color: 0xe4ecf2, fog: false})), p = e.toLocal(-.25, 0);
      m.position.set(p.x, e.top + 1.15, p.s);m.rotation.y = Math.atan2(e.dir[0], e.dir[1]);m.visible = false;group.add(m);return m;
    });

    // ---------- Build the meshes ----------
    const chunkGroups = [];
    for (const ch of chunks.values()) {
      const g = new T.Group();g.name = 'Catacomb ' + ch.key;const entrance = ch.key[0] === 'e';
      for (const [mat, b] of ch.mats) {
        if (!b.idx.length) continue;
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));geo.setAttribute('normal', new T.Float32BufferAttribute(b.nrm, 3));geo.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
        geo.setAttribute('bake', new T.Float32BufferAttribute(b.bake, 3));geo.setAttribute('bakeDir', new T.Float32BufferAttribute(b.dir, 3));geo.setAttribute('bakeX', new T.Float32BufferAttribute(b.x, 2));
        geo.setIndex(b.idx);geo.computeBoundingSphere();geo.computeBoundingBox();
        const m = new T.Mesh(geo, mat);m.castShadow = entrance && !mat.transparent;m.receiveShadow = entrance;m.renderOrder = mat.transparent ? 2 : 0;g.add(m);
        const bb = geo.boundingBox;for (let i = 0; i < 3; i++) {ch.min[i] = Math.min(ch.min[i], bb.min.getComponent(i));ch.max[i] = Math.max(ch.max[i], bb.max.getComponent(i));}
      }
      // Skulls and femurs, instanced in three levels of detail: the HI_CAP nearest within 3.5 m in full detail (picked as you
      // move; they are hidden in the light set meanwhile), the rest of a near chunk light, far chunks lighter still.
      const inst = (list, hi, lo, far, place) => {
        if (!list.length) return null;
        const n = list.length, ib = new Float32Array(n * 3), id = new Float32Array(n * 3), ix = new Float32Array(n * 2), mats = new Float32Array(n * 16);
        list.forEach((q, i) => {const l = lightAt(q.x, q.s, q.y + .09, q.n ? q.n[0] : 0, q.n ? q.n[1] : 1, q.n ? q.n[2] : 0, q.cell);ib.set(l.slice(0, 3), i * 3);id.set(l.slice(3, 6), i * 3);ix[i * 2 + 1] = l[6];place(q).toArray(mats, i * 16);});
        const shared = [new T.InstancedBufferAttribute(ib, 3), new T.InstancedBufferAttribute(id, 3), new T.InstancedBufferAttribute(ix, 2)];
        const make = (src, cap, attrs) => {
          const geo = new T.BufferGeometry();for (const [k, a] of Object.entries(src.attributes)) geo.setAttribute(k, a);geo.setIndex(src.index);
          ['ibake', 'ibakeDir', 'ibakeX'].forEach((k, i) => geo.setAttribute(k, attrs[i]));
          const im = new T.InstancedMesh(geo, SKULL_MAT, cap);if (cap === n) {im.instanceMatrix.array.set(mats);im.computeBoundingSphere();}im.instanceMatrix.needsUpdate = true;return im;
        };
        const lo2 = make(lo, n, shared), far2 = make(far, n, shared), hi2 = make(hi, HI_CAP, [new T.InstancedBufferAttribute(new Float32Array(HI_CAP * 3), 3), new T.InstancedBufferAttribute(new Float32Array(HI_CAP * 3), 3), new T.InstancedBufferAttribute(new Float32Array(HI_CAP * 2), 2)]);
        hi2.count = 0;hi2.frustumCulled = false;far2.visible = false;g.add(hi2, lo2, far2);
        return {hi: hi2, lo: lo2, far: far2, list, mats, ib, id, ix, promoted: [], key: ''};
      };
      const skullM = q => M4(q.x, q.y, q.s, q.yaw, 1, 1, 1, q.tilt || 0, q.roll || 0);
      ch.skullSets = [inst(ch.skulls.filter(q => !q.jaw), skullHi, skullLo, skullFar, skullM), inst(ch.skulls.filter(q => q.jaw), jawHi, jawLo, jawFar, skullM), inst(ch.femurs, femurHi, femurLo, femurFar, q => M4(q.x, q.y, q.s, q.yaw))].filter(Boolean);
      ch.group = g;ch.entrance = entrance;g.visible = false;group.add(g);chunkGroups.push(ch);
    }
    // ---------- Flames: one instanced quad per torch and candle, drawn as a flickering flame with a glow ----------
    const flameGeo = new T.InstancedBufferGeometry();flameGeo.setAttribute('position', new T.Float32BufferAttribute([-.5, -.2, 0, .5, -.2, 0, .5, .8, 0, -.5, .8, 0], 3));flameGeo.setIndex([0, 1, 2, 0, 2, 3]);
    flameGeo.setAttribute('iPos', new T.InstancedBufferAttribute(new Float32Array(flames.flatMap(f => [f.x, f.y, f.s])), 3));flameGeo.setAttribute('iSize', new T.InstancedBufferAttribute(new Float32Array(flames.map(f => f.size)), 1));flameGeo.setAttribute('iPhase', new T.InstancedBufferAttribute(new Float32Array(flames.map(f => f.phase)), 1));
    flameGeo.instanceCount = flames.length;
    const flameMat = new T.ShaderMaterial({transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: {uTime: {value: 0}},
      vertexShader: `attribute vec3 iPos;attribute float iSize;attribute float iPhase;varying vec2 vUv;varying float vPhase;varying float vFade;
        void main() {vec4 mv = modelViewMatrix * vec4(iPos, 1.0);float sz = iSize * .42;mv.xy += position.xy * vec2(sz, sz * 1.15);vUv = vec2(position.x * 2.0, (position.y + .2));vPhase = iPhase;vFade = smoothstep(36.0, 22.0, -mv.z);gl_Position = projectionMatrix * mv;}`,
      fragmentShader: `uniform float uTime;varying vec2 vUv;varying float vPhase;varying float vFade;
        float h(vec2 p) {return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);}
        float n(vec2 p) {vec2 i = floor(p), f = fract(p);f = f * f * (3.0 - 2.0 * f);return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);}
        void main() {
          float t = uTime * 1.0 + vPhase * 9.0, y = vUv.y;
          float wob = (n(vec2(y * 3.0 - t * 2.2, vPhase * 7.0)) - .5) * .5 * y + (n(vec2(t * 1.3, vPhase)) - .5) * .12;
          float x = vUv.x + wob, w = .42 * pow(max(1.0 - y / .78, 0.0), .75) * smoothstep(-.02, .12, y);
          float body = (1.0 - smoothstep(.0, 1.0, abs(x) / max(w, .001))) * smoothstep(.85, .25, y + (n(vec2(x * 4.0, y * 5.0 - t * 4.0)) - .5) * .35);
          vec3 col = mix(vec3(.9, .22, .03), vec3(1.0, .62, .18), smoothstep(.15, .7, body)) + vec3(1.0, .95, .7) * smoothstep(.65, 1.0, body) * (1.0 - smoothstep(.2, .55, y));
          float glow = exp(-length(vec2(vUv.x, (y - .22) * 1.3)) * 3.2) * .22;
          gl_FragColor = vec4((col * body * 1.6 + vec3(1.0, .45, .12) * glow) * vFade, 1.0);
        }`});
    const flameMesh = new T.Mesh(flameGeo, flameMat);flameMesh.frustumCulled = false;flameMesh.renderOrder = 3;group.add(flameMesh);

    // ---------- Collision ----------
    const toWorld = (x, s) => world.toWorld(x, s);
    const extra = obstaclesLocal.map(o => ({points: o.pts.map(([x, s]) => toWorld(x, s)), minY: o.minY, maxY: o.maxY, kind: 'catacomb'}));
    const floors = L.floors(toWorld, world.toLocal), obstacles = [...L.obstacles(toWorld), ...extra], vehicleObstacles = L.vehicleObstacles(toWorld);
    const cutsGround = (x, z) => {const l = world.toLocal(x, z);return L.cutsGround(l.x, l.s);};

    // ---------- Light level per cell (is it dark here?) ----------
    const cellLight = new Float32Array(NX * NS);for (let c = 0; c < NX * NS; c++) if (L.walkable(c)) {const p = L.centre(c % NX, Math.floor(c / NX)), l = lightAt(p.x, p.s, L.floorAt(c, p.x, p.s) + 1.2, null, 0, 0, c);cellLight[c] = l[0] + l[1] + l[2] + skyAt(c, p.x, p.s) * 6;}
    // Torch-lit cells are mostly above 0.45, the dark tunnels below 0.04.
    const DARK_BELOW = .15;

    // ---------- Discovery (the map underground) ----------
    let saved = null;try {saved = localStorage.getItem(SAVE_KEY);} catch {}
    const explorer = CL.explorer(L, saved);let savedCount = explorer.count, saveT = 0, revealT = 0, dirty = true;
    const save = () => {try {localStorage.setItem(SAVE_KEY, explorer.save());} catch {}savedCount = explorer.count;};

    // ---------- Your torch ----------
    const lamp = {on: false, level: 0};
    function toggleLamp(on = !lamp.on) {lamp.on = on;if (audio) audio.sfx('click');return lamp.on;}

    // ---------- Sounds: dripping water, a low hum of the earth, torches crackling ----------
    let snd = null, dripT = 1;
    function sounds(dt, depth, torchNear) {
      const ctx = audio && audio.context;if (!ctx) return;
      if (!snd) {
        const out = ctx.createGain();out.gain.value = 0;out.connect(ctx.destination);
        const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);let b = 0;for (let i = 0; i < len; i++) {b = b * .985 + (Math.random() * 2 - 1) * .1;d[i] = b;}
        const hum = ctx.createBufferSource();hum.buffer = buf;hum.loop = true;const lp = ctx.createBiquadFilter();lp.type = 'lowpass';lp.frequency.value = 160;const hg = ctx.createGain();hg.gain.value = .5;hum.connect(lp).connect(hg).connect(out);hum.start();
        const wbuf = ctx.createBuffer(1, len, ctx.sampleRate), w = wbuf.getChannelData(0);for (let i = 0; i < len; i++) w[i] = (Math.random() * 2 - 1) * (Math.random() < .004 ? 1 : .08);
        const crack = ctx.createBufferSource();crack.buffer = wbuf;crack.loop = true;const bp = ctx.createBiquadFilter();bp.type = 'bandpass';bp.frequency.value = 2400;bp.Q.value = .6;const cg = ctx.createGain();cg.gain.value = 0;crack.connect(bp).connect(cg).connect(out);crack.start();
        const echo = ctx.createDelay(1);echo.delayTime.value = .19;const fb = ctx.createGain();fb.gain.value = .38;echo.connect(fb).connect(echo);echo.connect(out);
        snd = {out, cg, echo};
      }
      const t = ctx.currentTime;snd.out.gain.setTargetAtTime(depth * .35, t, .4);snd.cg.gain.setTargetAtTime(torchNear * .6, t, .2);
      if (depth > .5 && (dripT -= dt) <= 0) {
        dripT = 1.2 + Math.random() * 4;const o = ctx.createOscillator(), g = ctx.createGain(), f = 900 + Math.random() * 1700;
        o.frequency.setValueAtTime(f, t);o.frequency.exponentialRampToValueAtTime(f * .45, t + .09);g.gain.setValueAtTime(0, t);g.gain.linearRampToValueAtTime(.12 + Math.random() * .1, t + .004);g.gain.exponentialRampToValueAtTime(.001, t + .16);
        o.connect(g);g.connect(snd.out);g.connect(snd.echo);o.start(t);o.stop(t + .2);
      }
    }

    // Full-detail skulls: the nearest ones within 3.5 m of the camera move to the detailed set, and are hidden in the light one.
    function promote(set, cl, cy) {
      const near = [];
      if (cl) for (let i = 0; i < set.list.length; i++) {const q = set.list[i], d = Math.hypot(q.x - cl.x, q.y - cy, q.s - cl.s);if (d < 3.5) near.push([d, i]);}
      const want = near.sort((a, b) => a[0] - b[0]).slice(0, HI_CAP).map(n => n[1]), key = want.join();if (key === set.key) return;set.key = key;
      const lo = set.lo.instanceMatrix.array, h = set.hi, ha = h.geometry.attributes;
      for (const i of set.promoted) lo.set(set.mats.subarray(i * 16, i * 16 + 16), i * 16);
      for (const i of want) lo.fill(0, i * 16, i * 16 + 16);
      want.forEach((i, k) => {h.instanceMatrix.array.set(set.mats.subarray(i * 16, i * 16 + 16), k * 16);ha.ibake.array.set(set.ib.subarray(i * 3, i * 3 + 3), k * 3);ha.ibakeDir.array.set(set.id.subarray(i * 3, i * 3 + 3), k * 3);ha.ibakeX.array.set(set.ix.subarray(i * 2, i * 2 + 2), k * 2);});
      h.count = want.length;set.promoted = want;set.lo.instanceMatrix.needsUpdate = h.instanceMatrix.needsUpdate = ha.ibake.needsUpdate = ha.ibakeDir.needsUpdate = ha.ibakeX.needsUpdate = true;
    }
    // ---------- Update ----------
    let visT = 0, flickT = 0, last = {depth: 0, deep: false, inside: false, dark: false, cell: -1};
    const fl = [1, 1, 1, 1], flTarget = [1, 1, 1, 1];
    function update(dt, {camera, player}) {
      const lp = world.toLocal(player.x, player.z), cell = L.cellOf(lp.x, lp.s), depth = L.depth(lp.x, lp.s, player.feet), deep = L.deep(lp.x, lp.s, player.feet), inside = L.inside(lp.x, lp.s, player.feet);
      const dark = inside && !!cell && cellLight[cell.idx] < DARK_BELOW;
      // Flames and their light flicker in four groups.
      flameMat.uniforms.uTime.value += dt;flickT -= dt;if (flickT <= 0) {flickT = .07;for (let i = 0; i < 4; i++) flTarget[i] = .82 + Math.random() * .3;}
      for (let i = 0; i < 4; i++) fl[i] += (flTarget[i] - fl[i]) * Math.min(1, dt * 14);U.uFlick.value.set(fl[0], fl[1], fl[2], fl[3]);
      if (lamp.on && depth <= 0 && !inside) lamp.on = false;
      lamp.level += ((lamp.on ? 1 : 0) - lamp.level) * Math.min(1, dt * 12);U.uLamp.value.w = lamp.level < .01 ? 0 : lamp.level * 40;
      // Chunks near the camera are drawn; on the surface only the stairs (they show through the mausoleum doors).
      visT -= dt;if (visT <= 0) {
        visT = .25;const cl = world.toLocal(camera.position.x, camera.position.z), cy = camera.position.y, under = L.inside(cl.x, cl.s, cy - 1.5) || depth > 0;
        for (const ch of chunkGroups) {
          const dx = Math.max(ch.min[0] - cl.x, 0, cl.x - ch.max[0]), dy = Math.max(ch.min[1] - cy, 0, cy - ch.max[1]), ds = Math.max(ch.min[2] - cl.s, 0, cl.s - ch.max[2]), d = Math.hypot(dx, dy, ds);
          ch.group.visible = ch.entrance ? d < 70 : under && d < 38;
          if (ch.group.visible) for (const s of ch.skullSets) {const near = d < 8;s.lo.visible = s.hi.visible = near;s.far.visible = !near;promote(s, d < 5 ? cl : null, cy);}
        }
      }
      // Deep down the world above is not drawn: daylight in the far-off doorways is a bright quad instead.
      const cl = world.toLocal(camera.position.x, camera.position.z), camDeep = L.deep(cl.x, cl.s, camera.position.y - 1.6);
      for (const g of doorGlows) g.visible = camDeep;
      if (inside) {revealT -= dt;if (revealT <= 0) {revealT = .2;const r = !dark ? 13 : lamp.on ? 11 : 3.5;if (explorer.reveal(lp.x, lp.s, r)) dirty = true;}}
      saveT -= dt;if (saveT <= 0 && explorer.count !== savedCount) {saveT = 2;save();}
      let torchNear = 0;if (depth > 0) for (const t of torches) {const d = Math.hypot(t.x - lp.x, t.s - lp.s);if (d < 6) torchNear = Math.max(torchNear, 1 - d / 6);}
      sounds(dt, depth, torchNear);
      last = {depth, deep, camDeep, inside, dark, cell: cell ? cell.idx : -1};return last;
    }
    function prompt() {
      if (!last.inside || !last.dark || lamp.on) return null;
      return {text: '□ / L1  Switch on your torch – it is dark down here', act: () => toggleLamp(true)};
    }
    function placeName(player) {
      const lp = world.toLocal(player.x, player.z);if (!L.inside(lp.x, lp.s, player.feet)) return null;
      const c = L.cellOf(lp.x, lp.s), r = c && L.roomOf[c.idx] >= 0 ? L.rooms[L.roomOf[c.idx]] : null;return r ? `${r.name}, the catacombs under Torshovdalen` : 'The catacombs under Torshovdalen';
    }

    // ---------- The map underground: only what you have seen ----------
    let paths = null;
    function buildPaths() {
      const lit = new Path2D(), dark = new Path2D(), stair = new Path2D(), walls = new Path2D();
      for (let c = 0; c < NX * NS; c++) {
        if (!explorer.seen[c]) continue;const B = cellBox(c), p = L.stairOf[c] >= 0 ? stair : L.isDark(c) ? dark : lit;p.rect(B.x0, B.s0, CELL, CELL);
        const o = L.open(c);for (let k = 0; k < 4; k++) if (!o[k]) {const E = edgeOf(c, k);walls.moveTo(E.a[0], E.a[1]);walls.lineTo(E.b[0], E.b[1]);}
      }
      paths = {lit, dark, stair, walls};dirty = false;
    }
    const mapLayer = {
      draw(ctx, {P, k, w, h, dpr = 1, rotation = 0, player}) {
        if (dirty || !paths) buildPaths();
        ctx.fillStyle = '#0d0b09';ctx.fillRect(0, 0, w, h);
        const o = P(0, 0), ex = P(1, 0), es = P(0, 1);
        ctx.save();ctx.transform(ex[0] - o[0], ex[1] - o[1], es[0] - o[0], es[1] - o[1], o[0], o[1]);
        ctx.fillStyle = '#c2ab80';ctx.fill(paths.lit);ctx.fillStyle = '#7d6c55';ctx.fill(paths.dark);ctx.fillStyle = '#9b927f';ctx.fill(paths.stair);
        ctx.strokeStyle = '#2b2118';ctx.lineWidth = Math.max(.25, 2 * dpr / k);ctx.lineCap = 'round';ctx.stroke(paths.walls);
        ctx.restore();
        // Text sits a few pixels above its point on screen (the minimap is turned, so offsets are in pixels, not metres).
        const label = (x, s, text, color = '#f2e6cc', size = 12, up = 0) => {const [u, v] = P(x, s);ctx.font = `bold ${size * dpr}px system-ui, sans-serif`;ctx.textAlign = 'center';ctx.lineWidth = 3 * dpr;ctx.strokeStyle = '#0d0b09';ctx.strokeText(text, u, v - up * dpr);ctx.fillStyle = color;ctx.fillText(text, u, v - up * dpr);};
        for (const t of torches) if (explorer.seen[t.cell]) {const [u, v] = P(t.x, t.s);ctx.fillStyle = '#ff8a2a';ctx.beginPath();ctx.arc(u, v, 2.4 * dpr, 0, 7);ctx.fill();}
        const big = w > 300;// the full map; the minimap gets no names
        if (big && k > .9 * dpr) for (const r of L.rooms) if (!r.entrance && roomCells(r).some(c => explorer.seen[c])) label(r.cx, r.cs, r.name, '#f2e6cc', 11);
        // The three ways out are always marked (you know where the mausoleums are).
        for (const e of L.entrances) {
          const p = e.toLocal(1.5, 0), [u, v] = P(p.x, p.s);ctx.fillStyle = '#3b2f2f';ctx.beginPath();ctx.arc(u, v, 10 * dpr, 0, 7);ctx.fill();ctx.strokeStyle = '#f2e6cc';ctx.lineWidth = 2 * dpr;ctx.stroke();
          ctx.fillStyle = '#f2e6cc';ctx.font = `bold ${12 * dpr}px system-ui`;ctx.textAlign = 'center';ctx.textBaseline = 'middle';ctx.fillText('↑', u, v + .5);ctx.textBaseline = 'alphabetic';if (big) label(p.x, p.s, `${e.label} exit`, '#f2e6cc', 12, 15);
        }
        const arrow = (x, z, a, color, size, name) => {const l = world.toLocal(x, z), [u, v] = P(l.x, l.s), r = size * dpr;ctx.save();ctx.translate(u, v);ctx.rotate(a + rotation);ctx.fillStyle = color;ctx.beginPath();ctx.moveTo(0, -r * 1.4);ctx.lineTo(r, r);ctx.lineTo(0, r * .45);ctx.lineTo(-r, r);ctx.closePath();ctx.fill();ctx.strokeStyle = '#fff';ctx.lineWidth = 2;ctx.stroke();ctx.restore();if (name) label(l.x, l.s, name, '#fff', 11, 16);};
        // Other players: only those down here too.
        for (const p of (player && player.others) || []) {const l = world.toLocal(p.x, p.z);if (p.y !== undefined && L.inside(l.x, l.s, p.y)) arrow(p.x, p.z, p.headingLocal, p.color, 7, p.name);}
        if (player) arrow(player.x, player.z, player.headingLocal, '#4fa3ff', 8);
        if (w > 300) {
          ctx.fillStyle = '#f2e6cc';ctx.font = `bold ${15 * dpr}px Georgia, serif`;ctx.textAlign = 'left';ctx.fillText('The catacombs', 20 * dpr, 30 * dpr);
          ctx.font = `${12 * dpr}px system-ui`;ctx.fillText(`The map shows only what you have seen down here · ${Math.min(100, Math.round(explorer.count / countWalk * 100))} % explored`, 20 * dpr, 48 * dpr);
          ctx.fillStyle = '#a89a80';ctx.fillText('Left stick / drag: pan · right stick / wheel: zoom · ○ / M: close', 20 * dpr, 66 * dpr);
          const bar = 20 * k;ctx.fillRect(20 * dpr, h - 30 * dpr, bar, 4 * dpr);ctx.fillText('20 m', 20 * dpr, h - 38 * dpr);
        }
      }
    };
    let countWalk = 0;for (let c = 0; c < NX * NS; c++) if (L.walkable(c)) countWalk++;
    const poi = () => L.entrances.map(e => {const d = e.toLocal(-1.5, 0);return {x: d.x, s: d.s, color: '#3b2f2f', label: `Catacomb (${e.label.toLowerCase()} entrance)`, glyph: '☠'};});
    return {group, layout: L, floors, obstacles, vehicleObstacles, cutsGround, poi, update, prompt, toggleLamp, lamp, mapLayer, placeName, explorer, cellLight, flames: flameMesh, chunks: chunkGroups,
      get state() {return last;}, hall: id => {const r = room('hall-' + id);return world.toWorld(r.cx, r.cs);}, FLOOR_Y};
  }
  return {create};
});
