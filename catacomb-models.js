/* Catacomb models: procedural human skulls, femurs and an ossuary bone-wall texture (GitHub issue 43).
 * CatacombModels.create({T}) -> {skull, femur, boneWall, boneColor}
 *   skull({lod = 'high' | 'low' | 'far', jaw = false}) indexed BufferGeometry: position, normal, uv, color (bone tint x
 *     occlusion, linear RGB). Metres; face toward +z, top +y, x/z centred on the bounding box, y = 0 at the lowest point.
 *     About 0.20 long, 0.14 wide, 0.16 tall (0.21 with the jaw). Triangles: high <= 6000, low <= 700, far <= 160.
 *   femur({lod}) indexed BufferGeometry, same attributes, 0.45 m along +x, bounding box centred on the origin
 *     (head and trochanter at -x, condyles at +x, head toward +z, knee front toward +y). high <= 1200, low <= 200, far 40.
 *   boneWall({size = 1024}) {map, normal, tile: [1, 0.625]}: canvas textures (browser only) of a stacked-bone ossuary
 *     wall, tileable both ways, repeat = 1 / tile.
 *   boneColor  material colour for vertexColors: true (tint and occlusion are already in the vertex colours).
 * Shapes are signed-distance fields in millimetres, projected along rays from a centre point (skull: a geodesic sphere
 * warped to be denser over the face; femur: a capsule), so meshes are crack-free with exact budgets. Occlusion and
 * hole darkness are sampled from the same fields. Results are memoised and deterministic (no Math.random).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CatacombModels = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const {sqrt, abs, min, max, sin, cos, PI, floor, atan2, acos} = Math;
  const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
  const ss = (a, b, v) => {const t = clamp((v - a) / (b - a));return t * t * (3 - 2 * t);};
  const lin = c => c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);

  // ---------- distance primitives (millimetres) ----------
  const smin = (a, b, k) => {const h = max(k - abs(a - b), 0) / k;return min(a, b) - h * h * k * .25;};
  const smax = (a, b, k) => -smin(-a, -b, k);
  function ell(x, y, z, rx, ry, rz) {
    const a = x / rx, b = y / ry, c = z / rz, k0 = sqrt(a * a + b * b + c * c), k1 = sqrt(a * a / (rx * rx) + b * b / (ry * ry) + c * c / (rz * rz));
    return k1 < 1e-9 ? -min(rx, ry, rz) : k0 * (k0 - 1) / k1;
  }
  // Capsule from a to b with radius ra at a and rb at b.
  function cap(x, y, z, ax, ay, az, bx, by, bz, ra, rb = ra) {
    const px = x - ax, py = y - ay, pz = z - az, dx = bx - ax, dy = by - ay, dz = bz - az, h = clamp((px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz));
    const qx = px - dx * h, qy = py - dy * h, qz = pz - dz * h;return sqrt(qx * qx + qy * qy + qz * qz) - (ra + (rb - ra) * h);
  }
  function rbox(x, y, z, bx, by, bz, r) {
    const qx = abs(x) - bx + r, qy = abs(y) - by + r, qz = abs(z) - bz + r, ox = max(qx, 0), oy = max(qy, 0), oz = max(qz, 0);
    return sqrt(ox * ox + oy * oy + oz * oz) + min(max(qx, qy, qz), 0) - r;
  }
  // Signed distance to a 2D polygon given as a flat [x0, y0, x1, y1, ...] list.
  function poly(px, py, P) {
    let d = (px - P[0]) ** 2 + (py - P[1]) ** 2, s = 1;
    for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) {
      const ex = P[j] - P[i], ey = P[j + 1] - P[i + 1], wx = px - P[i], wy = py - P[i + 1], h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey)), bx = wx - ex * h, by = wy - ey * h;
      d = min(d, bx * bx + by * by);
      const c1 = py >= P[i + 1], c2 = py < P[j + 1], c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * sqrt(d);
  }
  // A 2D distance extruded to half thickness w with rounded edges of radius r.
  const extrude = (d2, dw, w, r) => {const qx = d2 + r, qy = abs(dw) - w + r;return sqrt(max(qx, 0) ** 2 + max(qy, 0) ** 2) + min(max(qx, qy), 0) - r;};

  // ---------- deterministic noise ----------
  function hash(i, j, k, s) {let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683) + Math.imul(s, 1274126177)) | 0;h = Math.imul(h ^ h >>> 13, 1274126177);return ((h ^ h >>> 16) >>> 0) / 4294967296;}
  function noise(x, y, z, s = 0) {
    const i = floor(x), j = floor(y), k = floor(z), fx = x - i, fy = y - j, fz = z - k, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), h = (a, b, c) => hash(i + a, j + b, k + c, s);
    return lerp(lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v), lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v), w);
  }
  const fbm = (x, y, z, s) => noise(x, y, z, s) * .55 + noise(x * 2.1, y * 2.1, z * 2.1, s + 1) * .3 + noise(x * 4.3, y * 4.3, z * 4.3, s + 2) * .15;

  // ---------- skull field (mm; origin between the ear holes on the eye-ear plane, face toward +z) ----------
  const ARCH = [[46, -8, 60, 7, 4.2], [55, -7.5, 52, 6, 3.4], [61, -6.5, 43, 5, 2.8], [63, -5, 33, 4.6, 2.6], [62, -4, 23, 4.8, 2.7], [58, -3, 13, 6, 3.8]];
  const archField = (X, y, z) => {let d = 1e9;for (let i = 0; i < ARCH.length - 1; i++) {const a = ARCH[i], b = ARCH[i + 1];d = min(d, cap(X, y, z, a[0], a[1], a[2], b[0], b[1], b[2], a[4] + .8, b[4] + .8));}return d;};
  // Hole shapes (negative inside), used for carving and for darkening their insides.
  function orbitHole(X, y, z) {
    const ox = X - 31, oy = y - 17, oz = z - 82, lx = .951 * ox - .309 * oz, lz = .309 * ox + .951 * oz;
    const o = smin(rbox(lx, oy + lx * .12, lz, 19.5, 17, 15, 10), ell(X - 27, y - 15, z - 60, 15.5, 14.5, 22), 8);
    return smin(o, cap(X, y, z, 25, 15, 52, 15, 13, 26, 7, 4), 8);
  }
  const noseHole = (x, X, y, z) => smin(smin(ell(X - 6.8, y + 15, z - 92, 7.8, 8.5, 30), ell(x, y + 4, z - 92, 4.8, 11, 30), 5), ell(x, y + 8, z - 58, 15, 17, 28), 6);
  const earHole = (X, y, z) => cap(X, y, z, 70, -3, 3, 50, -2, 3, 4.5);
  // How far a point sits behind the rim of an orbit, the nose or an ear opening (0 elsewhere).
  function holeDepth(x, y, z) {
    const X = abs(x);let d = 0;
    if (z > 20 && X < 55 && orbitHole(X, y, z) < 1.5) d = max(d, -((X - 31) * .309 + (z - 79) * .951));
    if (z > 20 && X < 25 && y < 12 && noseHole(x, X, y, z) < 1.5) d = max(d, 94 + (y + 10) * .15 - z);
    if (X > 40 && y < 6 && y > -12 && earHole(X, y, z) < 1.5) d = max(d, 63 - X);
    return d;
  }
  // Rays that fall deep into an orbit or the nose stop on a flat floor 7 mm behind the opening (see star()).
  function holeFloor(x, y, z, cx, cy, cz, dx, dy, dz, t) {
    const X = abs(x), s = x < 0 ? -1 : 1;
    if (z > 20 && X < 55 && orbitHole(X, y, z) < 1.5) {const den = s * .309 * dx + .951 * dz;if (den > .1) t = max(t, (.309 * 31 + .951 * 79 - 7 - s * .309 * cx - .951 * cz) / den);}
    else if (z > 20 && X < 25 && y < 12 && noseHole(x, X, y, z) < 1.5) {const den = dz - .15 * dy;if (den > .1) t = max(t, (86.5 - cz + .15 * cy) / den);}
    return t;
  }
  // Skull without the jaw. Parts are skipped where they cannot reach the point (cheap box tests keep it fast).
  // holes: 0 = none; otherwise orbits and nose are carved (holes - 1) mm smaller (far LOD, whose colours blur outward).
  function cranium(x, y, z, holes, arch, band) {
    const X = abs(x);
    // Brain case: a narrow frontal egg and a wider parietal-occipital egg, base flattened.
    let d = smin(ell(x, y - 40, z + 18, 70, 72, 80), ell(x, y - 40, z - 12, 58, 72, 78), 24);
    d = smax(d, -y - 24, 14);
    // Upper face band (orbits are carved into it), maxilla and the skull-base block under the vault.
    if (y < 47 && z > -34) {
      let f = ell(x, y - 15, z - 56, 49, 24, 34);
      f = smin(f, ell(x, y + 21, z - 58, 33, 21, 32), 10);
      f = smin(f, ell(x, y + 14, z - 18, 43, 20, 44), 10);
      d = smin(d, f, 8);
    }
    // Temporal fossa: a shallow hollow on the side of the head, deepest just behind the orbit rim.
    if (X > 30 && y > -14 && y < 56 && z > -21 && z < 67) {const px = X - 47 - (55 - z) * .32;d = smax(d, -rbox(px - 16, y - 21, z - 23, 16, 25, 34, 10), 12);}
    if (z > 22) {
      d = smin(d, cap(X, y, z, 7, 32, 88.5, 40, 35.5, 76, 5.5, 5), 6);          // brow ridge
      d = smin(d, cap(X, y, z, 45.5, -4, 64, 45, 33, 69, 5.5, 5), 5);           // lateral orbit rim
      d = smin(d, cap(X, y, z, 20, -1, 83, 43, -4, 69, 4.5, 5), 5);             // lower orbit rim
      d = smin(d, ell(X - 45, y + 8, z - 62, 9, 12, 11), 6);                     // cheekbone
      if (X < 12) d = smin(d, cap(x, y, z, 0, 27, 89, 0, 7, 94, 5.5, 4), 5);    // nasal bones
      if (y < -16) {                                                             // alveolar ridge over the tooth roots
        d = smin(d, cap(X, y, z, 0, -31, 86, 13, -31, 82, 6), 4);
        d = smin(d, cap(X, y, z, 13, -31, 82, 25, -30.5, 66, 6, 6.5), 4);
        d = smin(d, cap(X, y, z, 25, -30.5, 66, 30, -29.5, 36, 6.5, 7), 4);
      }
    }
    if (X > 38 && y < 8 && z < 26) {
      d = smin(d, ell(X - 53, y + 19, z + 8, 9, 14, 10), 8);                     // mastoid
      d = smin(d, ell(X - 57, y + 4, z - 12, 8, 6, 8), 5);                       // arch root
    }
    if (z < -86) d = smin(d, ell(x, y - 4, z + 99, 8, 5, 5), 6);              // occipital knob
    if (arch && X > 38 && y < 6 && z > 4 && z < 70) d = smin(d, archField(X, y, z), 3);
    if (band && y < -30 && z > 25) d = smin(d, min(cap(X, y, z, 0, -42, 85, 17, -42, 79, 5), cap(X, y, z, 17, -42, 79, 27, -40, 60, 5), cap(X, y, z, 27, -40, 60, 29, -39, 40, 5.5)), 2);
    if (holes) {
      if (z > 19 && X < 54) d = smax(d, 1 - holes - orbitHole(X, y, z), 3.5);                         // orbits
      if (z > 26 && X < 24 && y < 12 && y > -30) d = smax(d, 1 - holes - noseHole(x, X, y, z), 2);    // nasal aperture (inverted heart)
      if (X > 44 && y < 4 && y > -10) d = smax(d, -earHole(X, y, z), 1.5);                // ear canal
      if (y < -16 && z < -2) d = smax(d, -ell(x, y + 26, z + 22, 15, 8, 18), 2);          // foramen magnum
    }
    if (X < 4 && y < -17 && y > -26 && z > 80) d = smin(d, cap(x, y, z, 0, -22, 84, 0, -21, 95, 2.2, 1.2), 2); // nasal spine
    return d;
  }
  // Mandible: the body is a rounded slab swept along a U curve; the ramus (with its notch, condyle neck and
  // coronoid) is a side outline in the (z, y) plane, extruded to 8 mm.
  const MCURVE = [[0, 82], [10, 79.5], [18, 73.5], [24, 64], [29, 51], [33, 38], [38, 25], [43, 12], [46, 2]];
  const MSEG = MCURVE.slice(1).map((b, i) => {const a = MCURVE[i], dx = b[0] - a[0], dz = b[1] - a[1], L = sqrt(dx * dx + dz * dz);return [a[0], a[1], dx, dz, L, 1 / (L * L)];}), MLEN = MSEG.reduce((s, q) => s + q[4], 0);
  const RAMUS = [4, -60, 5, -40, 8, -19, 14, -23, 22, -25, 29, -18, 33, -13, 35, -24, 34, -40, 38, -55, 30, -62, 16, -67, 10, -66.5, 6, -64];
  function mandible(x, y, z, filler) {
    const X = abs(x);
    let best = 1e9, bt = 0, acc = 0;
    for (const [ax, az, dx, dz, L, iL2] of MSEG) {
      const h = clamp(((X - ax) * dx + (z - az) * dz) * iL2), qx = X - ax - dx * h, qz = z - az - dz * h, dd = qx * qx + qz * qz;
      if (dd < best) {best = dd;bt = (acc + L * h) / MLEN;}
      acc += L;
    }
    const w = lerp(6, 4.8, bt), top = lerp(-53, -50, bt), bot = lerp(-88, -67, Math.pow(bt, 1.1)), r = min(w, 5), qx = sqrt(best) - w + r, qy = abs(y - (top + bot) / 2) - (top - bot) / 2 + r;
    let d = sqrt(max(qx, 0) ** 2 + max(qy, 0) ** 2) + min(max(qx, qy), 0) - r;
    if (X > 30 && z < 50) d = smin(d, extrude(poly(z, y, RAMUS) - 2, X - 45.5 - (14 - z) * .08, 4, 2.5), 6);
    if (X > 36 && y > -34 && z < 18) {
      d = smin(d, cap(X, y, z, 46.5, -26, 5, 48.5, -10, 6, 5), 3);             // condyle neck
      d = smin(d, ell(X - 50, y + 8, z - 7, 10, 5, 6), 3);                     // condyle
    }
    if (X < 20 && y < -70 && z > 72) d = smin(d, ell(x, y + 82, z - 84.5, 10, 7, 4.5), 6); // chin
    if (filler) d = smin(d, ell(x, y + 66, z - 40, 32, 9, 32), 4);
    return d;
  }
  // Tooth rows: crown centres along a dental arch (x >= 0 half), widths along the arch, depths, crown heights.
  // Only the first 7 per side are built: wisdom teeth are left out (often lost, and it keeps the budget).
  const ROWS = [
    {up: 1, arch: [[0, 85.5], [9, 83.5], [17, 79], [23, 72], [26.5, 63], [28, 54], [29, 45], [29.5, 36], [29.5, 27]], w: [8.5, 6.5, 7.5, 7, 6.5, 10, 9, 8.5], d: [7, 6, 8, 9, 9, 11, 11, 10], h: [10.5, 9, 10, 8.5, 8, 7, 7, 6.5], tilt: [14, 12, 8, 4, 3, 2, 2, 2]},
    {up: 0, arch: [[0, 81.5], [8, 79.5], [15, 75.5], [21, 69], [24.5, 61], [26, 52], [27, 43], [27.5, 34], [27.5, 25]], w: [5.5, 6, 7, 7, 7, 11, 10.5, 10], d: [6, 6.5, 7.5, 7.5, 8, 10.5, 10, 9.5], h: [9, 9, 11, 8.5, 8, 7.5, 7, 7], tilt: [16, 14, 8, 4, 3, 2, 2, 2]}
  ];
  function archAt(arch, s) {
    for (let i = 0; i < arch.length - 1; i++) {
      const a = arch[i], b = arch[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s <= L || i === arch.length - 2) {const t = s / L;return {x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t), tx: (b[0] - a[0]) / L, tz: (b[1] - a[1]) / L};}
      s -= L;
    }
  }
  const TEETH = [];
  ROWS.forEach((row, ri) => {
    let s = 0;
    row.w.slice(0, 7).forEach((w, k) => {
      const p = archAt(row.arch, s + w / 2 + .15);s += w + .3;
      for (const side of [1, -1]) {
        const id = ri * 16 + k * 2 + (side > 0 ? 0 : 1), j = hash(id, 3, 9, 77) - .5, frac = (s - w / 2) / 64, h = row.h[k] + j * .8;
        const nx = -p.tz * side, nz = p.tx, tilt = (row.tilt[k] + j * 5) * PI / 180, tip = row.up ? -47.5 + 5 * frac : -45 + 2.5 * frac;
        const ax = nx * sin(tilt), ay = (row.up ? -1 : 1) * cos(tilt), az = nz * sin(tilt);
        // Gum point so that the crown middle sits on the arch and the tip on the bite line.
        const gy = row.up ? tip + h * cos(tilt) : tip - h * cos(tilt);
        TEETH.push({up: row.up, k, id, j, w: w * (1 + j * .04), d: row.d[k], h, gx: p.x * side - ax * h * .5, gy, gz: p.z - az * h * .5, ax, ay, az, tx: p.tx * side, tz: p.tz, nx, nz,
          cx: p.x * side, cy: gy + ay * h * .5, cz: p.z});
      }
    });
  });
  function teethField(x, y, z, lower) {
    let d = 1e9;
    for (const t of TEETH) if ((t.up || lower) && abs(x - t.cx) < 14 && abs(z - t.cz) < 14) {const r = max(t.w, t.d) * .4;d = min(d, ell(x - t.cx, y - t.cy, z - t.cz, r, t.h * .45, r));}
    return d;
  }

  // ---------- femur field (mm; shaft along x, head toward +z, knee front toward +y) ----------
  function femurField(x, y, z) {
    const u = clamp(x / 185, -1, 1), bow = 6 * (1 - u * u), r = 13 + 2 * u * u;
    let d = max(sqrt((y - bow) ** 2 + z * z * 1.1) - r, abs(x) - 180);
    d = smin(d, min(cap(x, y, z, -130, -8, 0, 0, -3.5, 0, 3), cap(x, y, z, 0, -3.5, 0, 130, -8, 0, 3)), 6);  // linea aspera
    d = smin(d, cap(x, y, z, -168, 1, 2, -197, 4, 36, 14, 12.5), 10);       // neck
    d = smin(d, sqrt((x + 204) ** 2 + (y - 5) ** 2 + (z - 42) ** 2) - 23, 4); // head
    d = smax(d, -(sqrt((x + 207) ** 2 + (y - 5) ** 2 + (z - 64) ** 2) - 3.5), 2); // fovea pit on the head
    d = smin(d, ell(x + 196, y, z + 15, 22, 17, 14), 10);                    // greater trochanter
    d = smin(d, ell(x + 158, y + 13, z - 11, 8, 8, 7), 5);                   // lesser trochanter
    d = smin(d, cap(x, y, z, -192, -7, -14, -160, -12, 8, 5), 6);            // intertrochanteric crest
    d = smin(d, ell(x - 166, y + 2, z, 34, 19, 29), 16);                     // distal flare
    d = smin(d, min(ell(x - 198, y + 8, z - 20, 26, 27, 14.5), ell(x - 198, y + 8, z + 19, 26, 27, 15.5)), 8); // condyles
    d = smin(d, min(sqrt((x - 186) ** 2 + (y + 1) ** 2 + (z - 33) ** 2), sqrt((x - 186) ** 2 + (y + 1) ** 2 + (z + 34) ** 2)) - 8, 8); // epicondyles
    d = smax(d, -cap(x, y, z, 185, -32, 0, 240, -26, 0, 7.5), 4);           // notch between the condyles
    d = smax(d, -cap(x, y, z, 158, 25, 0, 214, 20, 0, 6.5), 5);             // knee-cap groove
    return d;
  }

  // ---------- meshing ----------
  // Sphere directions: subdivided icosahedron (20 f^2 triangles), outward winding.
  function geodesic(f) {
    const t = (1 + sqrt(5)) / 2, V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const dirs = [], tris = [], keys = new Map();
    const vid = (x, y, z) => {const l = sqrt(x * x + y * y + z * z);x /= l;y /= l;z /= l;const key = Math.round(x * 1e5) + ',' + Math.round(y * 1e5) + ',' + Math.round(z * 1e5);let id = keys.get(key);if (id === undefined) {id = dirs.length / 3;keys.set(key, id);dirs.push(x, y, z);}return id;};
    for (const [a, b, c] of F) {
      const A = V[a], B = V[b], C = V[c], g = [];
      for (let i = 0; i <= f; i++) {g.push([]);for (let j = 0; j <= f - i; j++) g[i].push(vid(A[0] + ((B[0] - A[0]) * i + (C[0] - A[0]) * j) / f, A[1] + ((B[1] - A[1]) * i + (C[1] - A[1]) * j) / f, A[2] + ((B[2] - A[2]) * i + (C[2] - A[2]) * j) / f));}
      for (let i = 0; i < f; i++) for (let j = 0; j < f - i; j++) {tris.push(g[i][j], g[i + 1][j], g[i][j + 1]);if (i + j < f - 1) tris.push(g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]);}
    }
    return {dirs, tris};
  }
  // Pulls directions toward axis a (strength k < 1), so the face gets more vertices than the back of the head.
  function warp({dirs, tris}, ax, ay, az, k) {
    const l = sqrt(ax * ax + ay * ay + az * az), out = [];ax /= l;ay /= l;az /= l;
    for (let i = 0; i < dirs.length; i += 3) {
      const x = dirs[i], y = dirs[i + 1], z = dirs[i + 2], c = clamp(x * ax + y * ay + z * az, -1, 1), s = acos(c) / PI, th = (s - k * sin(PI * s) / PI) * PI;
      let px = x - ax * c, py = y - ay * c, pz = z - az * c;const pl = sqrt(px * px + py * py + pz * pz);
      if (pl < 1e-9) {out.push(x, y, z);continue;}
      px /= pl;py /= pl;pz /= pl;out.push(ax * cos(th) + px * sin(th), ay * cos(th) + py * sin(th), az * cos(th) + pz * sin(th));
    }
    return {dirs: out, tris};
  }
  // First surface crossing met when walking in from outside along centre + d * t.
  function trace(field, cx, cy, cz, dx, dy, dz, t) {
    let prev = t;
    for (let n = 0; n < 200 && t > 0; n++) {
      const d = field(cx + dx * t, cy + dy * t, cz + dz * t);
      if (d < .1) {
        if (d > -.1) return t;
        let a = t, b = prev;                       // overshot: bisect between inside (a) and outside (b)
        for (let k = 0; k < 10; k++) {const m = (a + b) / 2;if (field(cx + dx * m, cy + dy * m, cz + dz * m) < 0) a = m;else b = m;}
        return (a + b) / 2;
      }
      prev = t;t -= d > 3 ? d : max(d * .9, .04);
    }
    return max(t, 0);
  }
  function gradient(field, x, y, z, e, out) {
    const a = field(x + e, y - e, z - e), b = field(x - e, y - e, z + e), c = field(x - e, y + e, z - e), d = field(x + e, y + e, z + e);
    const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d, l = sqrt(nx * nx + ny * ny + nz * nz) || 1;out[0] = nx / l;out[1] = ny / l;out[2] = nz / l;return out;
  }
  const AO_STEPS = [2, 5, 10, 18];
  function occlusion(field, x, y, z, nx, ny, nz, scale = 1) {
    let occ = 0, w = 1;
    for (const s of AO_STEPS) {const h = s * scale;occ += w * clamp((h - field(x + nx * h, y + ny * h, z + nz * h)) / h);w *= .72;}
    return clamp(1 - occ * .48);
  }

  // Mesh accumulator in millimetres.
  function Mesh() {this.p = [];this.n = [];this.c = [];this.u = [];this.i = [];}
  Mesh.prototype.vert = function (x, y, z, nx, ny, nz, col, u, v) {this.p.push(x, y, z);this.n.push(nx, ny, nz);this.c.push(col[0], col[1], col[2]);this.u.push(u, v);return this.p.length / 3 - 1;};
  // Area-weighted face normals for the vertices from v0 on (used by teeth and arch tubes).
  Mesh.prototype.faceNormals = function (v0, i0) {
    const P = this.p, N = this.n;for (let v = v0 * 3; v < N.length; v++) N[v] = 0;
    for (let i = i0; i < this.i.length; i += 3) {
      const a = this.i[i] * 3, b = this.i[i + 1] * 3, c = this.i[i + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) {N[q] += nx;N[q + 1] += ny;N[q + 2] += nz;}
    }
    for (let v = v0 * 3; v < N.length; v += 3) {const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1;N[v] /= l;N[v + 1] /= l;N[v + 2] /= l;}
  };
  // Rings of points (each ring an array of [x, y, z]) joined into a tube; optional tip point closes the last ring.
  // Winding is flipped when the first face points inward.
  Mesh.prototype.rings = function (rings, tip, colour, uvOf) {
    const v0 = this.p.length / 3, i0 = this.i.length, S = rings[0].length;
    for (const ring of rings) for (const q of ring) this.vert(q[0], q[1], q[2], 0, 0, 0, colour, ...uvOf(q));
    for (let r = 0; r < rings.length - 1; r++) for (let j = 0; j < S; j++) {const a = v0 + r * S + j, b = v0 + (r + 1) * S + j, c = v0 + (r + 1) * S + (j + 1) % S, d = v0 + r * S + (j + 1) % S;this.i.push(a, b, d, b, c, d);}
    if (tip) {const t = this.vert(tip[0], tip[1], tip[2], 0, 0, 0, colour, ...uvOf(tip)), L = v0 + (rings.length - 1) * S;for (let j = 0; j < S; j++) this.i.push(L + j, t, L + (j + 1) % S);}
    // Orientation check: the first quad's normal against the direction away from the ring centre.
    const P = this.p, ia = this.i[i0] * 3, ib = this.i[i0 + 1] * 3, ic = this.i[i0 + 2] * 3, cen = rings[0].reduce((s, q) => [s[0] + q[0] / S, s[1] + q[1] / S, s[2] + q[2] / S], [0, 0, 0]);
    const ux = P[ib] - P[ia], uy = P[ib + 1] - P[ia + 1], uz = P[ib + 2] - P[ia + 2], vx = P[ic] - P[ia], vy = P[ic + 1] - P[ia + 1], vz = P[ic + 2] - P[ia + 2];
    if ((uy * vz - uz * vy) * (P[ia] - cen[0]) + (uz * vx - ux * vz) * (P[ia + 1] - cen[1]) + (ux * vy - uy * vx) * (P[ia + 2] - cen[2]) < 0) for (let i = i0; i < this.i.length; i += 3) {const s = this.i[i + 1];this.i[i + 1] = this.i[i + 2];this.i[i + 2] = s;}
    this.faceNormals(v0, i0);
    return v0;
  };
  // Projects a star-shaped field along rays from a centre; the colour callback gets position and normal.
  // floor(x, y, z, cx, cy, cz, dx, dy, dz, t) may return a smaller depth for rays that fall deep into a hole: the
  // vertex then becomes a black floor (normal toward the opening), which keeps triangles from stretching down the walls.
  // Then, while under `budget` triangles, the edge with the highest score (length x (bend + colour contrast)) is split
  // at the mid ray; both triangles on it are halved, so the mesh stays closed and detail goes to rims and ridges.
  // probe > 0 (small budgets) also traces each edge's mid ray and adds how far that point (distance and shade) is from
  // the straight edge, so a bright nose bridge between two dark orbits or the tip of the chin is not skipped.
  function star(mesh, field, centre, sphere, tMax, colourOf, floor, budget = 0, probe = 0) {
    const [cx, cy, cz] = centre, base = mesh.p.length / 3, D = [], SH = [], TT = [], P = mesh.p, N = mesh.n, probes = new Map();
    const sample = (dx, dy, dz, from = tMax) => {
      const l = sqrt(dx * dx + dy * dy + dz * dz), g = [0, 0, 0];dx /= l;dy /= l;dz /= l;
      if (from < tMax && field(cx + dx * from, cy + dy * from, cz + dz * from) < 1) from = tMax;   // started inside: from the top
      const t0 = trace(field, cx, cy, cz, dx, dy, dz, from), t = floor ? floor(cx + dx * t0, cy + dy * t0, cz + dz * t0, cx, cy, cz, dx, dy, dz, t0) : t0, x = cx + dx * t, y = cy + dy * t, z = cz + dz * t;
      let c;
      if (t > t0 + .01) {g[0] = -dx;g[1] = -dy;g[2] = -dz;c = colourOf(x, y, z, g[0], g[1], g[2]).map(v => v * .5);c.shade = 0;}
      else {gradient(field, x, y, z, .3, g);c = colourOf(x, y, z, g[0], g[1], g[2]);}
      return {dx, dy, dz, t, x, y, z, g, c, shade: c.shade ?? (c[0] + c[1] + c[2]) / 3};
    };
    const add = (dx, dy, dz, s = sample(dx, dy, dz)) => {
      D.push(s.dx, s.dy, s.dz);SH.push(s.shade);TT.push(s.t);
      return mesh.vert(s.x, s.y, s.z, s.g[0], s.g[1], s.g[2], s.c, .5 + atan2(s.dx, s.dz) / (2 * PI), 1 - acos(clamp(s.dy, -1, 1)) / PI) - base;
    };
    for (let i = 0; i < sphere.dirs.length; i += 3) add(sphere.dirs[i], sphere.dirs[i + 1], sphere.dirs[i + 2]);
    const tris = sphere.tris.slice();
    if (budget > tris.length / 3) {
      const edges = new Map(), hs = [], ha = [], hb = [], key = (a, b) => a < b ? a * 1048576 + b : b * 1048576 + a;
      const link = (a, b, t) => {const k = key(a, b), e = edges.get(k);if (e) e.push(t);else edges.set(k, [t]);};
      const score = (a, b) => {
        // Edge size across the rays (gap between the rays x distance), so depth jumps at hole rims do not count.
        const A = (base + a) * 3, B = (base + b) * 3, ra = TT[a], rb = TT[b], r = (ra + rb) / 2, ex = D[a * 3] - D[b * 3], ey = D[a * 3 + 1] - D[b * 3 + 1], ez = D[a * 3 + 2] - D[b * 3 + 2];
        const len = r * sqrt(ex * ex + ey * ey + ez * ez);
        if (len < .9) return 0;
        const bend = 1 - (N[A] * N[B] + N[A + 1] * N[B + 1] + N[A + 2] * N[B + 2]), shade = abs(SH[a] - SH[b]);
        let err = 0;
        if (probe) {const m = sample(D[a * 3] + D[b * 3], D[a * 3 + 1] + D[b * 3 + 1], D[a * 3 + 2] + D[b * 3 + 2], max(ra, rb) + 4);probes.set(key(a, b), m);err = probe * (abs(m.t - r) + 20 * abs(m.shade - (SH[a] + SH[b]) / 2));}
        return len * (bend * 3 + shade * 2 + .02) + err;
      };
      const push = (a, b) => {   // binary max-heap on parallel arrays
        let i = hs.length;hs.push(score(a, b));ha.push(a);hb.push(b);
        while (i > 0) {const p = (i - 1) >> 1;if (hs[p] >= hs[i]) break;[hs[p], hs[i]] = [hs[i], hs[p]];[ha[p], ha[i]] = [ha[i], ha[p]];[hb[p], hb[i]] = [hb[i], hb[p]];i = p;}
      };
      const pop = () => {
        const top = [hs[0], ha[0], hb[0]], s = hs.pop(), a = ha.pop(), b = hb.pop();
        if (hs.length) {
          hs[0] = s;ha[0] = a;hb[0] = b;let i = 0;
          for (;;) {const l = 2 * i + 1, r = l + 1;let m = i;if (l < hs.length && hs[l] > hs[m]) m = l;if (r < hs.length && hs[r] > hs[m]) m = r;if (m === i) break;[hs[m], hs[i]] = [hs[i], hs[m]];[ha[m], ha[i]] = [ha[i], ha[m]];[hb[m], hb[i]] = [hb[i], hb[m]];i = m;}
        }
        return top;
      };
      for (let t = 0; t < tris.length / 3; t++) for (let k = 0; k < 3; k++) {const a = tris[t * 3 + k], b = tris[t * 3 + (k + 1) % 3];link(a, b, t);if (a < b) push(a, b);}
      while (tris.length / 3 + 2 <= budget && hs.length) {
        const [s, a, b] = pop();
        if (s <= 0) break;
        const ts = edges.get(key(a, b));
        if (!ts) continue;
        edges.delete(key(a, b));
        const m = add(D[a * 3] + D[b * 3], D[a * 3 + 1] + D[b * 3 + 1], D[a * 3 + 2] + D[b * 3 + 2], probes.get(key(a, b)) || sample(D[a * 3] + D[b * 3], D[a * 3 + 1] + D[b * 3 + 1], D[a * 3 + 2] + D[b * 3 + 2], min(tMax, max(TT[a], TT[b]) + 4)));
        push(a, m);push(m, b);
        for (const t of ts) {
          let k = 0;while (!((tris[t * 3 + k] === a && tris[t * 3 + (k + 1) % 3] === b) || (tris[t * 3 + k] === b && tris[t * 3 + (k + 1) % 3] === a))) k++;
          const p = tris[t * 3 + k], q = tris[t * 3 + (k + 1) % 3], c = tris[t * 3 + (k + 2) % 3], nt = tris.length / 3;
          tris[t * 3] = p;tris[t * 3 + 1] = m;tris[t * 3 + 2] = c;tris.push(m, q, c);    // (p, q, c) -> (p, m, c) + (m, q, c)
          const qc = edges.get(key(q, c));qc[qc.indexOf(t)] = nt;
          link(p, m, t);link(m, q, nt);link(m, c, t);link(m, c, nt);push(m, c);
        }
      }
    }
    for (const t of tris) mesh.i.push(base + t);
  }
  // Recolours vertices from v0 on (teeth and tubes get their normals only after meshing).
  function recolour(mesh, v0, colourOf) {
    const P = mesh.p, N = mesh.n, C = mesh.c;
    for (let v = v0 * 3; v < P.length; v += 3) {const c = colourOf(P[v], P[v + 1], P[v + 2], N[v], N[v + 1], N[v + 2], v / 3);C[v] = c[0];C[v + 1] = c[1];C[v + 2] = c[2];}
  }
  // Finished geometry in metres; place: 'base' = x/z centred, lowest point at y = 0; 'centre' = bounding box centred.
  function toGeometry(T, mesh, place) {
    const P = mesh.p, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < P.length; i++) {const a = i % 3;if (P[i] < lo[a]) lo[a] = P[i];if (P[i] > hi[a]) hi[a] = P[i];}
    const off = [(lo[0] + hi[0]) / 2, place === 'base' ? lo[1] : (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], pos = new Float32Array(P.length);
    for (let i = 0; i < P.length; i++) pos[i] = (P[i] - off[i % 3]) * .001;
    const g = new T.BufferGeometry(), count = P.length / 3;
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array(mesh.n), 3));
    g.setAttribute('uv', new T.BufferAttribute(new Float32Array(mesh.u), 2));
    g.setAttribute('color', new T.BufferAttribute(new Float32Array(mesh.c), 3));
    g.setIndex(new T.BufferAttribute(count < 65536 ? new Uint16Array(mesh.i) : new Uint32Array(mesh.i), 1));
    g.computeBoundingBox();g.computeBoundingSphere();
    return g;
  }

  // ---------- colours ----------
  // Aged bone: ivory with yellow-brown stains, darker in creases and holes. Returns linear RGB.
  function boneColour(x, y, z, ao, depth, extra = 1) {
    const p = fbm(x / 26, y / 26, z / 26, 3), q = noise(x / 3.5, y / 3.5, z / 3.5, 7), stain = ss(.4, .72, p) * .8, soot = ss(.55, .8, noise(x / 40 + 3, y / 40, z / 40, 5)) * .35;
    let r = lerp(.84, .68, stain), g = lerp(.78, .56, stain), b = lerp(.64, .4, stain);
    const shade = (.14 + .86 * Math.pow(ao, 1.4)) * (1 - .975 * ss(1, 8, depth)), k = (.9 + .16 * q) * (1 - soot) * shade * extra, out = [lin(r) * k, lin(g) * k, lin(b) * k];
    out.shade = shade;   // light and shadow only (no stains): steers mesh refinement
    return out;
  }
  // Faint wavy suture lines on the vault: coronal, sagittal, lambdoid.
  function suture(x, y, z) {
    const X = abs(x), wig = (s, f) => 1.6 * sin(s * .55 + f) + .9 * sin(s * 1.7 + 2 * f);
    let s = 0;
    if (y > 28) s = max(s, 1 - abs(z - 10 - .36 * (112 - y) + wig(x, 1)) / 1.6);
    if (y > 70 && z < 12 && z > -86) s = max(s, 1 - abs(x + wig(z, 2)) / 1.4);
    if (z < -40 && y > -2) s = max(s, 1 - abs(z + 88 - .5 * (80 - y) + wig(X, 3)) / 1.6);
    return clamp(s);
  }

  function create({T}) {
    const cache = new Map(), memo = (key, make) => {if (!cache.has(key)) cache.set(key, make());return cache.get(key);};
    const SPHERES = {};
    const sphere = (f, ax, ay, az, k) => memo(`sphere${f},${ax},${ay},${az},${k}`, () => warp(SPHERES[f] || (SPHERES[f] = geodesic(f)), ax, ay, az, k));

    // level 0 = high, 1 = low, 2 = far.
    function buildSkull(level, jaw) {
      const high = level === 0;
      const mesh = new Mesh(), C = jaw && !high ? [0, level === 2 ? 0 : 8, 24] : [0, 22, 22], uvOf = q => {const dx = q[0] - C[0], dy = q[1] - C[1], dz = q[2] - C[2], l = Math.hypot(dx, dy, dz) || 1;return [.5 + atan2(dx, dz) / (2 * PI), 1 - acos(clamp(dy / l, -1, 1)) / PI];};
      // Low and far jaws also get the lower tooth band and a cheek filler: one solid face outline at a distance.
      const lowJaw = (x, y, z) => {const X = abs(x);return min(mandible(x, y, z, 0), cap(X, y, z, 0, -49, 81.5, 15, -49, 75.5, 4.5), cap(X, y, z, 15, -49, 75.5, 26, -48, 52, 4.5), ell(X - 38, y + 36, z - 42, 9, 16, 16));};
      const holes = level === 2 ? 4 : 1, shape = high ? (x, y, z) => cranium(x, y, z, 1, 0, 0) : jaw ? (x, y, z) => min(cranium(x, y, z, holes, 1, 1), lowJaw(x, y, z)) : (x, y, z) => cranium(x, y, z, holes, 1, 1);
      const full = (x, y, z) => {
        let d = cranium(x, y, z, holes, 1, !high);
        if (jaw && y < 2 && z > -15 && abs(x) < 66) d = min(d, high ? mandible(x, y, z, 0) : lowJaw(x, y, z));
        if (high && y < -25 && y > -62 && z > 15) d = min(d, teethField(x, y, z, jaw));
        return d;
      };
      const skullColour = (x, y, z, nx, ny, nz) => {
        const depth = holeDepth(x, y, z), vault = y > 0 && z < 70 ? 1 - .22 * suture(x, y, z) : 1;
        let col = boneColour(x, y, z, occlusion(full, x, y, z, nx, ny, nz), depth, vault);
        if (!high && y < -36 && y > (jaw ? -54 : -48) && z > 22 && abs(x) < 33) col = col.map((c, i) => c * [1.12, 1.1, 1.0][i]);  // tooth band, a little paler
        return col;
      };
      // Cranium: face-weighted sphere, refined up to its share of the budget (teeth 30 and arches 60 triangles each).
      const f = high ? (jaw ? 10 : 12) : level === 1 ? 4 : 2, budget = high ? (jaw ? 3540 : 5440) : level === 1 ? 690 : 160;
      star(mesh, shape, C, sphere(f, 0, -.35, .94, level === 2 ? .6 : .5), jaw && !high ? 150 : 135, skullColour, holeFloor, budget, level === 2 ? 1.2 : 0);
      if (!high) return mesh;
      // Zygomatic arches as real bars, so the temple hollow shows behind them.
      for (const side of [1, -1]) {
        const rings = [];
        for (let i = 0; i < ARCH.length; i++) {
          const a = ARCH[Math.max(i - 1, 0)], b = ARCH[Math.min(i + 1, ARCH.length - 1)], p = ARCH[i], tx = b[0] - a[0], tz = b[2] - a[2], tl = Math.hypot(tx, tz), sx = tz / tl, sz = -tx / tl;
          const ring = [];for (let j = 0; j < 6; j++) {const an = j / 6 * 2 * PI, c = cos(an) * p[4], s = sin(an) * p[3];ring.push([(p[0] + sx * c) * side, p[1] + s, p[2] + sz * c]);}
          rings.push(ring);
        }
        const v0 = mesh.rings(rings, null, [0, 0, 0], uvOf);
        recolour(mesh, v0, skullColour);
      }
      // Teeth: rings from inside the bone to the crown, tip closed by a fan.
      for (const t of TEETH) {
        if (!t.up && !jaw) continue;
        const type = t.k < 2 ? 0 : t.k === 2 ? 1 : t.k < 5 ? 2 : 3, S = 6;
        // Ring profile: [fraction of crown height, width scale, depth scale].
        const prof = [[-.15, .78, .82], [.42, 1, 1], [.84, [.97, .74, .9, .95][type], [.5, .8, .9, .93][type]]], tipE = [1.0, 1.1, .98, .93][type];
        let ux = t.tx, uz = t.tz;const vx = t.nx - t.ax * (t.nx * t.ax + t.nz * t.az), vy = -t.ay * (t.nx * t.ax + t.nz * t.az), vz = t.nz - t.az * (t.nx * t.ax + t.nz * t.az), vl = Math.hypot(vx, vy, vz);
        const rings = prof.map(([e, sw, sd]) => {
          const cx = t.gx + t.ax * e * t.h, cy = t.gy + t.ay * e * t.h, cz = t.gz + t.az * e * t.h, ring = [];
          for (let j = 0; j < S; j++) {const an = (j + .5) / S * 2 * PI, a = cos(an) * t.w / 2 * sw, b = sin(an) * t.d / 2 * sd;ring.push([cx + ux * a + vx / vl * b, cy + vy / vl * b, cz + uz * a + vz / vl * b]);}
          return ring;
        });
        const v0 = mesh.rings(rings, [t.gx + t.ax * tipE * t.h, t.gy + t.ay * tipE * t.h, t.gz + t.az * tipE * t.h], [0, 0, 0], uvOf);
        const tint = [.88 + t.j * .1, .82 + t.j * .08, .62 + t.j * .02];
        recolour(mesh, v0, (x, y, z, nx, ny, nz, v) => {
          const ao = occlusion(full, x, y, z, nx, ny, nz, .7), neck = (v - v0) < S ? .4 : 1;
          const k = (.18 + .82 * Math.pow(ao, 1.3)) * neck * (.92 + .1 * noise(x / 2, y / 2, z / 2, 11));
          return [lin(tint[0]) * k, lin(tint[1]) * k, lin(tint[2]) * k];
        });
      }
      // Lower jaw: its own star projection from inside the mouth floor.
      if (jaw) {
        const v0 = mesh.p.length / 3, M = [0, -62, 36], shape = (x, y, z) => mandible(x, y, z, 1);
        star(mesh, shape, M, sphere(6, 0, -.45, .9, .3), 110, (x, y, z, nx, ny, nz) => {
          const inside = max(0, mandible(x, y, z, 0));     // the mouth-floor filler is not bone: keep it dark
          return boneColour(x, y, z, occlusion(full, x, y, z, nx, ny, nz), inside * 3);
        }, null, 1500);
        for (let v = v0; v < mesh.p.length / 3; v++) {const uv = uvOf([mesh.p[v * 3], mesh.p[v * 3 + 1], mesh.p[v * 3 + 2]]);mesh.u[v * 2] = uv[0];mesh.u[v * 2 + 1] = uv[1];}
      }
      return mesh;
    }
    const level = lod => lod === 'low' ? 1 : lod === 'far' ? 2 : 0;
    function skull({lod = 'high', jaw = false} = {}) {
      const l = level(lod);
      return memo(`skull:${l}:${!!jaw}`, () => toGeometry(T, buildSkull(l, !!jaw), 'base'));
    }

    // Femur: rings around the shaft axis plus hemispherical caps at both ends.
    function femur({lod = 'high'} = {}) {
      const l = level(lod);
      return memo(`femur:${l}`, () => {
        const mesh = new Mesh(), S = [20, 9, 5][l], A = -178, B = 180, g = [0, 0, 0];
        const capA = [[15, 30, 45, 60, 75], [35, 70], [55]][l], capB = capA.slice().reverse();
        const cyl = [[-178, -168, -158, -148, -136, -118, -85, -40, 0, 40, 85, 118, 136, 150, 162, 172, 180], [-170, -140, -60, 60, 140, 170], [-165, 165]][l];
        const stations = [...capA.map(a => [A, -a * PI / 180]), ...cyl.map(x => [x, null]), ...capB.map(a => [B, a * PI / 180])];
        const colourOf = (x, y, z, nx, ny, nz) => {
          const ao = occlusion(femurField, x, y, z, nx, ny, nz), joint = ss(190, 215, abs(x)) * .08, dirt = ss(.5, .8, fbm(x / 60, y / 30, z / 30, 21)) * .25;
          return boneColour(x * 1.7, y, z, ao, 0, (1 + joint) * (1 - dirt));
        };
        const ray = (ox, dx, dy, dz) => {
          const t = trace(femurField, ox, 0, 0, dx, dy, dz, 95), x = ox + dx * t, y = dy * t, z = dz * t;gradient(femurField, x, y, z, .3, g);
          return mesh.vert(x, y, z, g[0], g[1], g[2], colourOf(x, y, z, g[0], g[1], g[2]), (x + 230) / 460, 0);
        };
        const poleA = ray(A, -1, 0, 0), ringStart = mesh.p.length / 3;
        for (const [x0, a] of stations) for (let j = 0; j < S; j++) {
          const ph = j / S * 2 * PI, cy = cos(ph), cz = sin(ph), v = a === null ? ray(x0, 0, cy, cz) : ray(x0, a < 0 ? -cos(-a) : cos(a), sin(abs(a)) * cy, sin(abs(a)) * cz);
          mesh.u[v * 2 + 1] = j / S;
        }
        const poleB = ray(B, 1, 0, 0), R = stations.length;
        for (let j = 0; j < S; j++) {const j1 = (j + 1) % S;mesh.i.push(poleA, ringStart + j1, ringStart + j);mesh.i.push(poleB, ringStart + (R - 1) * S + j, ringStart + (R - 1) * S + j1);}
        for (let r = 0; r < R - 1; r++) for (let j = 0; j < S; j++) {const j1 = (j + 1) % S, a = ringStart + r * S + j, b = ringStart + (r + 1) * S + j, c = ringStart + (r + 1) * S + j1, d = ringStart + r * S + j1;mesh.i.push(a, d, b, b, d, c);}
        return toGeometry(T, mesh, 'centre');
      });
    }

    // ---------- ossuary wall texture ----------
    // Bone ends are splatted into typed arrays as domes with a depth test (the nearer bone wins); then height minus its
    // blur darkens the gaps and contacts, and a Sobel pass gives the normal map. One canvas write per texture.
    function boneWall({size = 1024} = {}) {
      return memo(`wall:${size}`, () => {
        let seed = 98765, xs = 2463534242;
        const rand = () => {seed = (seed * 16807) % 2147483647;return seed / 2147483647;};
        const grain = () => {xs ^= xs << 13;xs ^= xs >>> 17;xs ^= xs << 5;return (xs >>> 0) / 4294967296;};   // fast per-pixel noise
        const W = size, H = Math.round(size * .625), px = W / 1000, N = W * H;      // 1 m across, px per mm
        const Z = new Float32Array(N).fill(-60), R = new Float32Array(N).fill(.05), G = new Float32Array(N).fill(.04), B = new Float32Array(N).fill(.03);
        const WX = new Int32Array(W * 3);for (let i = 0; i < W * 3; i++) WX[i] = i % W;  // wrap table for x + W
        // Tileable smooth noise from a random lattice of cw cells across, with per-column and per-row lookup tables.
        const lattice = cw => {
          const ch = Math.max(2, Math.round(cw * H / W)), v = new Float32Array(cw * ch), i0 = new Int32Array(W), i1 = new Int32Array(W), u = new Float32Array(W), j0 = new Int32Array(H), j1 = new Int32Array(H), t = new Float32Array(H);
          for (let i = 0; i < v.length; i++) v[i] = rand();
          for (let x = 0; x < W; x++) {const f = x * cw / W, i = floor(f), s = f - i;i0[x] = i % cw;i1[x] = (i + 1) % cw;u[x] = s * s * (3 - 2 * s);}
          for (let y = 0; y < H; y++) {const f = y * ch / H, j = floor(f), s = f - j;j0[y] = (j % ch) * cw;j1[y] = ((j + 1) % ch) * cw;t[y] = s * s * (3 - 2 * s);}
          return {v, i0, i1, u, j0, j1, t};
        };
        const at = (L, x, y) => {const a = L.v[L.j0[y] + L.i0[x]], b = L.v[L.j0[y] + L.i1[x]], c = L.v[L.j1[y] + L.i0[x]], d = L.v[L.j1[y] + L.i1[x]], u = L.u[x];return a + (b - a) * u + (c - a + (a - b - c + d) * u) * L.t[y];};
        const mottle = lattice(110), grime = lattice(7), stain = lattice(28);
        const PALETTE = [[.84, .78, .66], [.78, .71, .56], [.7, .61, .45], [.64, .57, .47], [.56, .49, .39], [.47, .41, .33], [.36, .31, .26], [.27, .24, .21], [.8, .77, .7]];
        const pick = (f = 1) => {const c = PALETTE[floor(rand() * PALETTE.length)], k = (.88 + rand() * .22) * f;return [c[0] * k, c[1] * k, c[2] * k];};
        // One dome: centre (x, y), radii and rotation in px, base height z0, peak height amp; hole = marrow cavity
        // (fraction of the radius) for a broken shaft; crack = 1 scratches a crack across.
        function dome(x, y, rx, ry, a, z0, amp, c, hole, crack) {
          const ca = cos(a), sa = sin(a), r = max(rx, ry), irx = 1 / rx, iry = 1 / ry, h2 = hole * hole, ih2 = hole ? 1 / h2 : 0, cav = 7 * px, rimZ = z0 + amp * sqrt(1 - h2);
          const ct = rand() * PI, cc = cos(ct), cs = sin(ct), co = (rand() - .5) * .8, cw = .7 / r, cr = c[0], cg = c[1], cb = c[2];
          const x0 = floor(x - r) | 0, x1 = Math.ceil(x + r) | 0, y0 = floor(y - r) | 0, y1 = Math.ceil(y + r) | 0;
          let row = ((y0 % H) + H) % H;
          for (let yy = y0; yy <= y1; yy++) {
            const base = row * W, dy = yy - y, dys = dy * sa, dyc = dy * ca;
            for (let xx = x0; xx <= x1; xx++) {
              const dx = xx - x, u = (dx * ca + dys) * irx, v = (dyc - dx * sa) * iry, q = u * u + v * v;
              if (q >= 1) continue;
              const s = sqrt(1 - q);let z = z0 + amp * s, k = .74 + .26 * s;
              if (q < h2) {z = rimZ - cav * (1 - q * ih2);k = .3;}
              if (crack && abs(u * cc + v * cs - co + .06 * sin(u * 11 + v * 7)) < cw) {z -= .6;k *= .45;}
              const i = base + WX[xx + W];
              if (z > Z[i]) {Z[i] = z;R[i] = cr * k;G[i] = cg * k;B[i] = cb * k;}
            }
            if (++row === H) row = 0;
          }
        }
        // A bone lying along the row: a cylinder of half length L and radius rr, tilted by a, with knobs at both ends.
        function rod(x, y, L, rr, a, z0, c) {
          x %= W;
          const ca = cos(a), sa = sin(a), ex = abs(ca) * L + rr, ey = abs(sa) * L + rr, cr = c[0], cg = c[1], cb = c[2], f = .9 / px;
          const x0 = floor(x - ex) | 0, x1 = Math.ceil(x + ex) | 0, y0 = floor(y - ey) | 0, y1 = Math.ceil(y + ey) | 0;
          let row = ((y0 % H) + H) % H;
          for (let yy = y0; yy <= y1; yy++) {
            const base = row * W, dy = yy - y;
            for (let xx = x0; xx <= x1; xx++) {
              const dx = xx - x, u = dx * ca + dy * sa, v = (dy * ca - dx * sa) / rr;
              if (abs(v) >= 1 || abs(u) > L) continue;
              const s = sqrt(1 - v * v), z = z0 + rr * s, k = (.74 + .26 * s) * (.94 + .06 * sin(u * f + v * 3)), i = base + WX[xx + W];
              if (z > Z[i]) {Z[i] = z;R[i] = cr * k;G[i] = cg * k;B[i] = cb * k;}
            }
            if (++row === H) row = 0;
          }
          for (const e of [-1, 1]) dome(x + e * L * ca, y + e * L * sa, rr * 1.35, rr * 1.2, a + rand() - .5, z0, rr * 1.15, c, 0, rand() < .3 ? 1 : 0);
        }
        // Back layer: smaller, darker bones that show through the gaps.
        for (let i = 0, n = N / (900 * px * px); i < n; i++) {const r = (8 + rand() * 12) * px;dome(rand() * W, rand() * H, r, r * (.7 + rand() * .3), rand() * PI, -34 * px, r * .8, pick(.5), 0, 0);}
        // Layers: mostly rows of bone ends, now and then a row of shafts laid lengthwise.
        const rows = [];let total = 0;
        while (total < H * .95) {const shaft = rows.length % 5 === 3, h = (shaft ? 34 + rand() * 10 : 54 + rand() * 18) * px;rows.push({h, shaft});total += h;}
        let y = 0;
        for (const row of rows) {
          const h = row.h * H / total, yc = y + h / 2, z0 = (rand() - .5) * 8 * px;
          if (row.shaft) {
            let x = rand() * W;const end = x + W;
            while (x < end) {const L = (70 + rand() * 120) * px, rr = h * (.28 + rand() * .1);rod(x + L, yc + (rand() - .5) * h * .3, L, rr, (rand() - .5) * .12, z0 - 4 * px, pick());x += 2 * L + rr * (2.2 + rand() * 1.5);}
          } else {
            const radii = [];let sum = 0;
            while (sum < W) {const r = min((20 + rand() * 15) * px, h * .58);radii.push(r);sum += 2 * r * .92;}
            const scale = W / sum;let x = rand() * W;
            for (const r of radii) {
              x += r * .92 * scale;
              const cx = x, cy = yc + (rand() - .5) * max(0, h - 2 * r) + (rand() - .5) * 5 * px, c = pick(), kind = rand(), a = rand() * PI, zz = z0 + (rand() - .5) * 8 * px, crack = rand() < .25 ? 1 : 0;
              if (kind < .47) dome(cx, cy, r, r * (.88 + rand() * .12), a, zz, r * (.75 + rand() * .25), c, 0, crack);                       // femur or humerus head
              else if (kind < .73) {                                                                                                        // two condyles
                dome(cx, cy, r, r * .8, a, zz, r * .45, c, 0, 0);
                for (const e of [-1, 1]) {const rr = r * (.56 + rand() * .06);dome(cx + cos(a) * r * .42 * e, cy + sin(a) * r * .42 * e, rr, rr * .9, a, zz + r * .15, rr * .85, c, 0, e > 0 ? crack : 0);}
              } else if (kind < .9) {                                                                                                       // knobbly end
                dome(cx, cy, r, r * .74, a, zz, r * .55, c, 0, crack);
                for (let b = 0; b < 3; b++) {const rr = r * (.28 + rand() * .18), d = r * .45 * rand(), t = rand() * 7;dome(cx + cos(t) * d, cy + sin(t) * d * .7, rr, rr, 0, zz + r * .3, rr * .8, c, 0, 0);}
              } else dome(cx, cy, r * .78, r * .72, a, zz - 3 * px, r * .3, pick(1.08), .45 + rand() * .15, crack);                         // broken shaft
              x += r * .92 * scale;
            }
          }
          y += h;
        }
        // Blur of the height (box passes, wrapping): pixels lower than their surroundings get darker.
        const blur = (src, rad) => {
          const tmp = new Float32Array(N), out = new Float32Array(N), acc = new Float32Array(W), inv = 1 / (2 * rad + 1);
          for (let yy = 0; yy < H; yy++) {const row = yy * W;let s = 0;for (let k = -rad; k <= rad; k++) s += src[row + WX[k + W]];for (let xx = 0; xx < W; xx++) {tmp[row + xx] = s * inv;s += src[row + WX[xx + rad + 1 + W]] - src[row + WX[xx - rad + W]];}}
          for (let k = -rad; k <= rad; k++) {const row = ((k + H) % H) * W;for (let xx = 0; xx < W; xx++) acc[xx] += tmp[row + xx];}
          for (let yy = 0; yy < H; yy++) {const row = yy * W, add = ((yy + rad + 1) % H) * W, sub = ((yy - rad + H) % H) * W;for (let xx = 0; xx < W; xx++) {out[row + xx] = acc[xx] * inv;acc[xx] += tmp[add + xx] - tmp[sub + xx];}}
          return out;
        };
        const rad = Math.max(2, Math.round(5 * px)), soft = blur(Z, rad + 1), floorZ = -20 * px, zc = new Float32Array(N);
        for (let i = 0; i < N; i++) zc[i] = Z[i] > floorZ ? Z[i] : floorZ;
        const canvas = () => {const c = document.createElement('canvas');c.width = W;c.height = H;return c;};
        const col = canvas(), nrm = canvas(), cx2 = col.getContext('2d'), nx2 = nrm.getContext('2d'), ci = cx2.createImageData(W, H), ni = nx2.createImageData(W, H), cd = ci.data, nd = ni.data, boneZ = -30 * px, ipx = 1 / px;
        for (let yy = 0; yy < H; yy++) {
          const up = ((yy + H - 1) % H) * W, mid = yy * W, dn = ((yy + 1) % H) * W;
          for (let xx = 0; xx < W; xx++) {
            const i = mid + xx, l = WX[xx - 1 + W], r = WX[xx + 1 + W], o = i * 4;
            // Normal (Sobel on the height, clamped in the deep gaps); same convention as materials.js normalFrom.
            const dx = (zc[up + r] + 2 * zc[mid + r] + zc[dn + r] - zc[up + l] - 2 * zc[mid + l] - zc[dn + l]) * .125, dy = (zc[dn + l] + 2 * zc[dn + xx] + zc[dn + r] - zc[up + l] - 2 * zc[up + xx] - zc[up + r]) * .125, len = 127.5 / sqrt(dx * dx + dy * dy + 1);
            nd[o] = 127.5 - dx * len;nd[o + 1] = 127.5 + dy * len;nd[o + 2] = 127.5 + len;nd[o + 3] = 255;
            // Colour: occlusion from the blurred height, soot, stains, grain and pores.
            const bone = Z[i] > boneZ, cavity = soft[i] - Z[i], ao = cavity > 0 ? 1 / (1 + cavity * ipx * .045) : 1, sv = bone ? clamp((at(stain, xx, yy) - .55) * 4) : 0, st = sv * sv * (3 - 2 * sv) * .25;
            let k = 255 * ao * (.7 + .4 * at(grime, xx, yy)) * (.86 + .24 * at(mottle, xx, yy)) * (.92 + .16 * grain());
            if (bone && grain() < .012) k *= .5;
            cd[o] = R[i] * k * (1 - st * .1);cd[o + 1] = G[i] * k * (1 - st * .3);cd[o + 2] = B[i] * k * (1 - st * .55);cd[o + 3] = 255;
          }
        }
        cx2.putImageData(ci, 0, 0);nx2.putImageData(ni, 0, 0);
        const tile = [1, H / W], tex = (c, srgb) => {const t = new T.CanvasTexture(c);t.wrapS = t.wrapT = T.RepeatWrapping;if (srgb) t.colorSpace = T.SRGBColorSpace;t.repeat.set(1 / tile[0], 1 / tile[1]);t.needsUpdate = true;return t;};
        return {map: tex(col, true), normal: tex(nrm, false), tile};
      });
    }
    return {skull, femur, boneWall, boneColor: 0xffffff};
  }
  return {create};
});
