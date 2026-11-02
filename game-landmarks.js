/* Key buildings of the district patches (issue #38, 2 Nov 2026: "You have to implement some of the key buildings").
 * Each stands on its real OpenStreetMap footprint (tools/make-district.py):
 * - churches (Sofienberg, Paulus, Kampen, Vålerenga, Grønland, Gamlebyen, Tøyen): brick nave with tall arched windows, a steep
 *   gable roof, and a square tower with clock faces, belfry openings and a spire at the narrow end of the footprint;
 * - MUNCH in Bjørvika: the 60 m tower whose top floors bend toward the fjord, perforated aluminium and the MUNCH sign;
 * - the Opera: white roof rising from the plaza to 32 m that you can walk up, glass walls and the stage tower;
 * - the tall brick chimneys (Freiapipa 50 m, Ringnespipa 40 m and others with a mapped height).
 * Heights, colours and shapes are estimates from photos (about ±20 %).
 * GameLandmarks.create({T, lib, world}) -> {obstacles, vehicleObstacles, floors, poi}
 *   meshes go into world.geoNear (and copies into world.geoFar); obstacles / floors are in model coordinates.
 */
(function (root, factory) {
  root.GameLandmarks = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function create({T, lib, world}) {
    const obstacles = [], vehicleObstacles = [], floors = [], poi = [], ground = world.ground;
    const yAt = (x, s) => world.yLocal(x, s), toW = (x, s) => world.toWorld(x, s);// yLocal is a world height (ground included)
    const pairs = flat => {const out = [];for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);return out;};
    const area = ring => ring.reduce((a, p, i) => {const q = ring[(i + 1) % ring.length];return a + p[0] * q[1] - q[0] * p[1];}, 0) / 2;
    const put = (geo, mat, shadow = true) => {
      const m = new T.Mesh(geo, mat);m.castShadow = m.receiveShadow = shadow;m.userData.noMerge = true;m.name = 'Landmark';world.geoNear.add(m);
      const f = new T.Mesh(geo, mat);f.name = 'Landmark (far)';world.geoFar.add(f);return m;
    };
    const canvasTex = (w, h, draw, mw, mh) => {const c = document.createElement('canvas');c.width = w;c.height = h;draw(c.getContext('2d'), w, h);const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;t.wrapS = t.wrapT = T.RepeatWrapping;if (mw) t.repeat.set(1 / mw, 1 / mh);t.anisotropy = 8;return t;};
    // Geometry helpers in the local frame (x east, s south; y up). Walls carry uv in metres (u along, v up from vBase).
    function wallsGeo(ring, y0, top, vBase = y0) {
      const r = area(ring) > 0 ? ring.slice().reverse() : ring, pos = [], uv = [], idx = [];let u = 0;
      for (let i = 0; i < r.length; i++) {
        const a = r[i], c = r[(i + 1) % r.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);if (len < .02) continue;
        const ya = typeof top === 'function' ? top(a) : top, yc = typeof top === 'function' ? top(c) : top, b = pos.length / 3;
        pos.push(a[0], y0, a[1], c[0], y0, c[1], c[0], yc, c[1], a[0], ya, a[1]);uv.push(u, y0 - vBase, u + len, y0 - vBase, u + len, yc - vBase, u, ya - vBase);idx.push(b, b + 1, b + 2, b, b + 2, b + 3);u += len;
      }
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));g.setIndex(idx);g.computeVertexNormals();return g;
    }
    function capGeo(ring, y) {
      const contour = ring.map(p => new T.Vector2(p[0], p[1])), tris = T.ShapeUtils.triangulateShape(contour, []), pos = [], uv = [], idx = [];
      for (const p of contour) {pos.push(p.x, typeof y === 'function' ? y([p.x, p.y]) : y, p.y);uv.push(p.x / 4, p.y / 4);}
      for (const t of tris) idx.push(t[0], t[2], t[1]);
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));g.setIndex(idx);g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) {const ix = g.index.array;for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];g.computeVertexNormals();}
      return g;
    }
    // Keep the part of a ring where f(p) >= 0 (f linear): Sutherland–Hodgman against one line.
    function clip(ring, f) {
      const out = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], fa = f(a), fb = f(b);
        if (fa >= 0) out.push(a);
        if ((fa >= 0) !== (fb >= 0)) {const t = fa / (fa - fb);out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);}
      }
      return out;
    }
    const obstacle = (ring, minY, maxY, list = obstacles) => list.push({points: ring.map(([x, s]) => toW(x, s)), minY, maxY, kind: 'building'});
    // Width of the footprint across the axis at a (for the nave's roof).
    function widthAt(ring, c, u, n, a) {
      const hits = [];
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length], ap = (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1], aq = (q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1];
        if ((ap - a) * (aq - a) > 0 || ap === aq) continue;
        const t = (a - ap) / (aq - ap), bp = (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1], bq = (q[0] - c[0]) * n[0] + (q[1] - c[1]) * n[1];hits.push(bp + (bq - bp) * t);
      }
      return hits.length >= 2 ? Math.max(...hits) - Math.min(...hits) : 0;
    }

    // ---------- Churches ----------
    const churchTex = canvasTex(256, 768, (x, w, h) => {
      x.fillStyle = '#ffffff';x.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 6) for (let i = (y / 6 % 2) * 9; i < w; i += 18) {x.fillStyle = `rgba(0,0,0,${.03 + Math.random() * .07})`;x.fillRect(i, h - y - 5, 17, 5);}
      // One tall arched window per 4 m bay, from 2.6 m to 8.2 m (texture 4 m x 12 m, v up).
      const px = w / 4, py = h / 12, wx = w / 2 - .75 * px, top = h - 8.2 * py, bottom = h - 2.6 * py;
      x.fillStyle = '#e8e2d6';x.beginPath();x.moveTo(wx - 5, bottom + 5);x.lineTo(wx - 5, top + .75 * px);x.arc(w / 2, top + .75 * px, .75 * px + 5, Math.PI, 0);x.lineTo(wx + 1.5 * px + 5, bottom + 5);x.fill();
      x.fillStyle = '#2a3038';x.beginPath();x.moveTo(wx, bottom);x.lineTo(wx, top + .75 * px);x.arc(w / 2, top + .75 * px, .75 * px, Math.PI, 0);x.lineTo(wx + 1.5 * px, bottom);x.fill();
      x.fillStyle = '#58626c';x.fillRect(w / 2 - 2, top + 10, 4, bottom - top - 10);for (let k = 1; k < 5; k++) x.fillRect(wx, top + .75 * px + k * (bottom - top - .75 * px) / 5, 1.5 * px, 3);
      x.fillStyle = 'rgba(0,0,0,.18)';x.fillRect(0, h - 1.2 * py, w, 6);
    }, 4, 12);
    const roofTex = canvasTex(128, 128, (x, w, h) => {x.fillStyle = '#fff';x.fillRect(0, 0, w, h);for (let y = 0; y < h; y += 8) for (let i = (y / 8 % 2) * 8; i < w; i += 16) {x.fillStyle = `rgba(0,0,0,${.06 + Math.random() * .12})`;x.fillRect(i + 1, y + 1, 14, 6);}}, 2, 2);
    const clockTex = canvasTex(256, 256, (x, w) => {
      x.fillStyle = '#f4f1e8';x.beginPath();x.arc(w / 2, w / 2, w / 2 - 6, 0, 7);x.fill();x.lineWidth = 10;x.strokeStyle = '#2d2a26';x.stroke();
      x.fillStyle = '#2d2a26';for (let k = 0; k < 12; k++) {const a = k / 12 * Math.PI * 2;x.fillRect(w / 2 + Math.sin(a) * (w / 2 - 30) - 5, w / 2 - Math.cos(a) * (w / 2 - 30) - 5, 10, 10);}
      x.lineCap = 'round';x.lineWidth = 9;x.beginPath();x.moveTo(w / 2, w / 2);x.lineTo(w / 2 + 50, w / 2 - 30);x.stroke();x.lineWidth = 6;x.beginPath();x.moveTo(w / 2, w / 2);x.lineTo(w / 2 - 20, w / 2 - 88);x.stroke();
    });
    for (const l of world.districts.flatMap(d => d.landmarks).filter(l => l.kind === 'church')) {
      const ring = pairs(l.ring), c = l.c, u = l.axis, n = [-u[1], u[0]], yb = yAt(c[0], c[1]), y0 = ground + l.g - .6;
      const P = (a, b) => [c[0] + u[0] * a + n[0] * b, c[1] + u[1] * a + n[1] * b];
      const wallMat = new T.MeshStandardMaterial({map: churchTex, color: new T.Color(l.wall), roughness: .85}), slate = new T.MeshStandardMaterial({map: roofTex, color: new T.Color(l.spire), roughness: .55, metalness: .25});
      const side = l.tower.side, end = l.tower.end, eave = yb + l.eave, spireH = l.top * .42, towerTop = yb + l.top - spireH;
      put(wallsGeo(ring, y0, eave, yb), wallMat);put(capGeo(ring, eave), slate);
      // Nave roof: a 48° gable over the nave's typical width, from the far end to the tower.
      const a0 = end > 0 ? -l.L / 2 - .3 : -l.L / 2 + side, a1 = end > 0 ? l.L / 2 - side : l.L / 2 + .3, widths = [];
      for (let k = 1; k < 10; k++) {const w = widthAt(ring, c, u, n, a0 + (a1 - a0) * k / 10);if (w > 2) widths.push(w);}
      widths.sort((p, q) => p - q);const half = (widths.length ? widths[Math.floor(widths.length / 2)] : l.W) / 2 + .35, ridge = eave + half * Math.tan(48 * Math.PI / 180);
      {
        const A = P(a0, -half), B = P(a1, -half), C = P(a1, half), D = P(a0, half), R0 = P(a0, 0), R1 = P(a1, 0), v = (p, y) => [p[0], y, p[1]];
        const pos = [...v(A, eave), ...v(B, eave), ...v(R1, ridge), ...v(R0, ridge), ...v(C, eave), ...v(D, eave), ...v(R0, ridge), ...v(R1, ridge)];
        const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1].map((t, i) => t * (i % 2 ? half * 1.5 : Math.abs(a1 - a0)) / 2), 2));
        g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);g.computeVertexNormals();
        if (g.attributes.normal.getY(0) < 0) {g.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);g.computeVertexNormals();}
        slate.side = T.DoubleSide;put(g, slate);
        const gable = [...v(A, eave), ...v(D, eave), ...v(R0, ridge), ...v(B, eave), ...v(C, eave), ...v(R1, ridge)], gg = new T.BufferGeometry();
        gg.setAttribute('position', new T.Float32BufferAttribute(gable, 3));gg.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2 * half, 0, half, ridge - eave, 0, 0, 2 * half, 0, half, ridge - eave].map(t => t), 2));gg.computeVertexNormals();
        put(gg, new T.MeshStandardMaterial({map: churchTex, color: new T.Color(l.wall), roughness: .85, side: T.DoubleSide}));
      }
      // Tower: brick shaft, belfry openings, four clock faces and an eight-sided spire.
      const tc = P(end * (l.L / 2 - side / 2), 0), tr = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => P(end * (l.L / 2 - side / 2) + p * side / 2, q * side / 2));
      put(wallsGeo(tr, y0, towerTop, yb), wallMat);put(capGeo(tr, towerTop), slate);
      const yaw = Math.atan2(u[1], u[0]), clockMat = new T.MeshStandardMaterial({map: clockTex, roughness: .6}), holeMat = new T.MeshStandardMaterial({color: 0x1d2024, roughness: 1});
      for (const dir of [u, [-u[0], -u[1]], n, [-n[0], -n[1]]]) {
        const off = side / 2 + .04, at = (y, m) => {m.position.set(tc[0] + dir[0] * off, y, tc[1] + dir[1] * off);m.rotation.y = Math.atan2(dir[0], dir[1]);m.userData.noMerge = true;world.geoNear.add(m);};
        at(towerTop - side * .45, new T.Mesh(new T.CircleGeometry(side * .24, 32), clockMat));at(towerTop - side * 1.15, new T.Mesh(new T.PlaneGeometry(side * .32, side * .55), holeMat));
      }
      const spire = new T.ConeGeometry(side * .5, spireH, 8);spire.rotateY(Math.PI / 8 - yaw);spire.translate(tc[0], towerTop + spireH / 2, tc[1]);put(spire, slate);
      const cross = new T.BoxGeometry(.18, 2.2, .18);cross.translate(tc[0], towerTop + spireH + 1.1, tc[1]);put(cross, lib.metal(0xc9a64a, .35));
      obstacle(ring, y0 - .5, ridge + 2);obstacle(tr, y0 - .5, yb + l.top);
      poi.push({x: tc[0], s: tc[1], label: l.name, glyph: '✝', color: '#6d4c41'});
    }

    // ---------- MUNCH ----------
    for (const l of world.districts.flatMap(d => d.landmarks).filter(l => l.kind === 'munch')) {
      const base = pairs(l.ring), c = l.c, u = l.axis, n = [-u[1], u[0]], yb = yAt(c[0], c[1]), y0 = ground + l.g - .6, kink = yb + l.top * .72, top = yb + l.top;
      // The mapped outline includes the glass base; the tower above it is a slab about 32 m deep along the long axis.
      const hl = l.L * .44, hw = Math.min(l.W / 2, 16), ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => [c[0] + u[0] * p * hl + n[0] * q * hw, c[1] + u[1] * p * hl + n[1] * q * hw]);
      // The top floors bend toward the fjord (the -axis end, south-south-west): shift with height above the kink.
      const lean = (p, y) => {const t = Math.max(0, (y - kink) / (top - kink));return [p[0] - u[0] * 11 * t * t, p[1] - u[1] * 11 * t * t];};
      const alu = canvasTex(256, 256, (x, w, h) => {x.fillStyle = '#d9dcdf';x.fillRect(0, 0, w, h);for (let i = 0; i < w; i += 6) {x.fillStyle = `rgba(90,96,104,${.12 + (i % 24 === 0 ? .25 : 0)})`;x.fillRect(i, 0, 2, h);}for (let y = 0; y < h; y += 32) {x.fillStyle = 'rgba(40,46,52,.28)';x.fillRect(0, y, w, 3);}}, 4, 4.2);
      const mat = new T.MeshStandardMaterial({map: alu, roughness: .38, metalness: .55}), glass = new T.MeshStandardMaterial({color: 0x3a4a58, roughness: .2, metalness: .5});
      put(wallsGeo(base, y0, yb + 4.5, yb), glass);put(capGeo(base, yb + 4.5), new T.MeshStandardMaterial({color: 0x9aa0a6, roughness: .6}));
      // Facade in 1.2 m bands so the bend is smooth.
      for (let y = yb + 4.5; y < top - 1e-6; y += 1.2) {
        const y1 = Math.min(top, y + 1.2), lower = ring.map(p => lean(p, y));
        const g = wallsGeo(lower, y, y1, yb), pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - y1) < 1e-4) {const q = lean([pos.getX(i), pos.getZ(i)], y1), p0 = lean([pos.getX(i), pos.getZ(i)], y);pos.setXYZ(i, pos.getX(i) + q[0] - p0[0], y1, pos.getZ(i) + q[1] - p0[1]);}
        g.computeVertexNormals();put(g, mat);
      }
      put(capGeo(ring.map(p => lean(p, top)), top), new T.MeshStandardMaterial({color: 0x9aa0a6, roughness: .6}));
      // The MUNCH sign on the fjord side, just below the bend (above it the leaning floors would hide it).
      const signTex = canvasTex(1024, 256, (x, w, h) => {x.fillStyle = 'rgba(0,0,0,0)';x.clearRect(0, 0, w, h);x.fillStyle = '#e4002b';x.font = 'bold 200px Arial, Helvetica, sans-serif';x.textAlign = 'center';x.textBaseline = 'middle';x.fillText('MUNCH', w / 2, h / 2 + 10);});
      const signY = kink - 4, front = [c[0] - u[0] * (hl + .3), c[1] - u[1] * (hl + .3)];
      const sign = new T.Mesh(new T.PlaneGeometry(26, 6.5), new T.MeshStandardMaterial({map: signTex, transparent: true, roughness: .5, emissive: 0x550010}));
      sign.position.set(front[0], signY, front[1]);sign.rotation.y = Math.atan2(-u[0], -u[1]);sign.userData.noMerge = true;world.geoNear.add(sign);
      obstacle(base, y0 - .5, top + 4);poi.push({x: c[0], s: c[1], label: 'MUNCH', glyph: '◼', color: '#c62828'});
    }

    // ---------- The Opera: a white roof you can walk up from the plaza ----------
    for (const l of world.districts.flatMap(d => d.landmarks).filter(l => l.kind === 'opera')) {
      const ring = pairs(l.ring), c = l.c, u = l.axis, n = [-u[1], u[0]], y0 = ground + l.g - .6;
      const along = p => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1], aTop = -l.L * .2, aLow = l.L / 2;
      // Roof height: from just below the lowest ground at the plaza end (+axis, west-north-west), so you step straight onto
      // it, rising to the plateau at aTop, then level.
      const lowEnd = ring.filter(p => along(p) > aLow - 12), yb = Math.min(...(lowEnd.length ? lowEnd : ring).map(p => yAt(p[0], p[1]))) - .2;
      const roofY = p => yb + l.roof * Math.min(1, Math.max(0, (aLow - along(p)) / (aLow - aTop)));
      const marble = new T.MeshStandardMaterial({map: canvasTex(256, 256, (x, w, h) => {x.fillStyle = '#f1efea';x.fillRect(0, 0, w, h);for (let i = 0; i < 400; i++) {x.fillStyle = `rgba(120,120,115,${Math.random() * .08})`;x.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 30, 1 + Math.random() * 2);}x.strokeStyle = 'rgba(150,148,140,.35)';for (let k = 0; k < w; k += 64) {x.beginPath();x.moveTo(k, 0);x.lineTo(k, h);x.moveTo(0, k);x.lineTo(w, k);x.stroke();}}, 6, 6), roughness: .6});
      const glass = new T.MeshStandardMaterial({color: 0x5a7385, roughness: .15, metalness: .45});
      put(wallsGeo(ring, y0, p => roofY(p) - .05), glass);
      for (const part of [clip(ring, p => along(p) - aTop), clip(ring, p => aTop - along(p))]) if (part.length >= 3) put(capGeo(part, roofY), marble);
      // Stage tower (aluminium) on the plateau.
      const fly = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => [c[0] + u[0] * (aTop - 22 + p * 22) + n[0] * q * 18, c[1] + u[1] * (aTop - 22 + p * 22) + n[1] * q * 18]);
      const flyTop = yb + l.fly, alu = new T.MeshStandardMaterial({color: 0xc7ccd0, roughness: .35, metalness: .55});
      put(wallsGeo(fly, yb + l.roof - 1, flyTop), alu);put(capGeo(fly, flyTop), alu);
      floors.push({name: 'Opera roof', points: ring.map(([x, s]) => toW(x, s)), height: p => {const q = world.toLocal(p.x, p.z);return Math.max(yAt(q.x, q.s), roofY([q.x, q.s]));}, ceilingHeight: Infinity, surfaceKind: 'stone'});
      // Under the roof is closed: walkers on the ground meet the wall where the roof is a metre or more up; vehicles never get in.
      const under = clip(ring, p => (aLow - 10) - along(p));if (under.length >= 3) obstacle(under, y0 - .5, yb + .9);
      obstacle(fly, yb + l.roof - 2, flyTop + 2);obstacle(ring, y0 - .5, yb + l.roof + 2, vehicleObstacles);
      poi.push({x: c[0], s: c[1], label: 'Operahuset (walk up the roof)', glyph: '◭', color: '#455a64'});
    }

    // ---------- Chimneys ----------
    {
      const brick = lib.brick(), cap = lib.concrete(0x4a4644);
      for (const [x, s, h] of world.districts.flatMap(d => d.chimneys)) {
        const y = yAt(x, s), r0 = Math.max(1.4, h * .045), r1 = r0 * .62;
        const g = new T.CylinderGeometry(r1, r0, h, 20, 6, true), uv = g.attributes.uv;for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r0, uv.getY(i) * h);
        g.translate(x, y + h / 2 - .5, s);put(g, brick);
        const top = new T.CylinderGeometry(r1 * 1.12, r1 * 1.12, .9, 20);top.translate(x, y + h - .5, s);put(top, cap);
        obstacle([[x - r0, s - r0], [x + r0, s - r0], [x + r0, s + r0], [x - r0, s + r0]], y - 1, y + h);
      }
    }
    return {obstacles, vehicleObstacles, floors, poi};
  }
  return {create};
});
