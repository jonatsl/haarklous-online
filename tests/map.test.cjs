const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../game-map.js');

const W = 1280, H = 720, MARGIN = 52;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('edgePoint puts the pin on the rectangle inside the margin, toward the waypoint', () => {
  const right = M.edgePoint(1, 0, W, H, MARGIN);near(right.x, W - MARGIN);near(right.y, H / 2);near(right.angle, 0);
  const up = M.edgePoint(0, -5, W, H, MARGIN);near(up.x, W / 2);near(up.y, MARGIN);near(up.angle, -Math.PI / 2);
  // A diagonal hits the nearer side first (the screen is wider than tall, so the top / bottom).
  const diag = M.edgePoint(1, 1, W, H, MARGIN);near(diag.y, H - MARGIN);near(diag.x, W / 2 + (H / 2 - MARGIN));
  // No direction at all: straight down.
  const none = M.edgePoint(0, 0, W, H, MARGIN);near(none.x, W / 2);near(none.y, H - MARGIN);
});

test('screenSpot: on the point when it is in view, on the edge when it is off screen or behind you', () => {
  // In front (camera space -z is ahead), projected near the middle.
  const inView = M.screenSpot({x: 1, y: 0, z: -20}, {x: .1, y: .2}, W, H, MARGIN);
  assert.equal(inView.edge, false);near(inView.x, (1.1 / 2) * W);near(inView.y, (.8 / 2) * H);
  // In front but far to the right of the view: right edge.
  const offRight = M.screenSpot({x: 40, y: 0, z: -5}, {x: 3.5, y: 0}, W, H, MARGIN);
  assert.equal(offRight.edge, true);near(offRight.x, W - MARGIN);near(offRight.y, H / 2);
  // Straight behind you: bottom middle. Behind and to the left: bottom, left of the middle, never at the top.
  const behind = M.screenSpot({x: 0, y: .3, z: 30}, {x: 0, y: 0}, W, H, MARGIN);
  assert.equal(behind.edge, true);near(behind.x, W / 2);near(behind.y, H - MARGIN);
  const behindLeft = M.screenSpot({x: -30, y: 2, z: 10}, {x: 0, y: 0}, W, H, MARGIN);
  assert.equal(behindLeft.edge, true);assert.ok(behindLeft.x < W / 2 && behindLeft.y > H / 2, JSON.stringify(behindLeft));
});

test('toRim keeps blips inside the minimap', () => {
  assert.deepEqual(M.toRim(3, 4, 10), {u: 3, v: 4, out: false});
  const q = M.toRim(30, 40, 10);assert.equal(q.out, true);near(q.u, 6);near(q.v, 8);
});

test('distances read in metres, then kilometres', () => {
  assert.equal(M.distanceText(6.4), '6 m');assert.equal(M.distanceText(999.4), '999 m');assert.equal(M.distanceText(1234), '1.2 km');
});

test('the minimap shows 90 m on foot and zooms out with speed and height, at most 300 m', () => {
  assert.equal(M.minimapRange(0, 0), 90);assert.equal(M.minimapRange(1.4, 0) < 100, true);
  assert.ok(M.minimapRange(17, 0) > 150, 'a car at 60 km/h sees further');
  assert.equal(M.minimapRange(60, 3000), 300);assert.equal(M.minimapRange(-5, -10), 90);
  assert.equal(M.REACH, 7);
});

test('a disc golf course without an outline gets one round its tees and baskets (issue #60)', () => {
  const holes = [{tee: [94.4, 9.8], basket: [162.45, 26.22]}, {tee: [163.52, 34.14], basket: [125.99, 93.23]}], pad = 14;
  const o = M.courseOutline(holes, pad), pts = [];for (let i = 0; i < o.length; i += 2) pts.push([o[i], o[i + 1]]);
  assert.ok(pts.length >= 6);
  // Convex, one way round: every turn has the same sign.
  const turn = i => {const [a, b, c] = [pts[i], pts[(i + 1) % pts.length], pts[(i + 2) % pts.length]];return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);};
  const sign = Math.sign(turn(0));for (let i = 0; i < pts.length; i++) assert.equal(Math.sign(turn(i)), sign);
  // Every tee and basket is inside, at least 12 m from the edge.
  for (const h of holes) for (const p of [h.tee, h.basket]) for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    assert.ok(sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / L > 12, `${p} is near edge ${i}`);
  }
});

test('during a round the minimap zooms so the hole fits: 40 m at least, 300 m at most', () => {
  // On the tee of a 106 m hole the basket (106 m away) is inside the rim.
  const r = M.courseRange([0, 0], [[0, 0], [106.3, 0]]);assert.ok(r > 106.3 && r < 130, String(r));
  // Near the basket: the close-in floor. Far from the course: never wider than 300 m.
  assert.equal(M.courseRange([0, 0], [[5, 0]]), 40);assert.equal(M.courseRange([0, 0], [[2000, 0]]), 300);
});
