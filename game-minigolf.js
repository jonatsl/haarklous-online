/* Minigolf at the real courses (issue #114): Torshov minigolfpark (Hegermanns gate 25) and Grünerløkka Minigolfpark (Søndre
 * gate 1), both 18 Eternit lanes of Christiania Minigolf Club with a ticket kiosk; the free three-hole course in Jordal park; and
 * Oslo Camping in Fredshuset, Møllergata 12: a bar with an 18-hole felt course on two floors (11 up, 7 in the basement), a bar
 * counter with a bartender who serves by the Norwegian rules. Data: minigolf-data.js (tools/make-minigolf.py).
 *
 * Pure (Node-tested):
 *   KINDS[kind](L, W) -> hole definition in the lane frame: u along the lane from the tee end (0 .. L), v across (-W/2 .. W/2),
 *     {kind, name, L, W, tee [u, v], cup [u, v], walls [[u0, v0, u1, v1]], feats [height pieces], hazards [[u0, u1, v0, v1]],
 *      mills [{u, gap, period, half}], loops [{u, r, w}], tubes [{u0, u1, w}], deco}
 *   compile(def) -> hole (walls with normals, height h(u, v), grad(u, v)); newBall(hole); putt(ball, angle, power) -> speed;
 *   step(ball, hole, t, dt) -> events [{kind: 'wall' | 'cup' | 'lip' | 'water' | 'mill' | 'loop' | 'loopFail' | 'rest', ...}];
 *   simulate(ball, hole, {t0, maxT}) -> {events, t} (to rest or the cup); Scorecard(pars); serving(date, item, opts);
 *   courseLanes(course) -> [{n, kind, par, x, s, dir, side, L, W}] in the local map frame; laneCorners(lane, margin).
 * Browser: GameMinigolf.prepare(districts, data) notches Oslo Camping into Fredshuset and drops map trees under the lanes;
 *   GameMinigolf.create({T, lib, world, audio, avatars, root, data}) -> {group, floors, obstacles, games, near(p), poi(),
 *     cutsGround(x, z), inside(x, z, feet), barPrompt(p, look), placeName(x, z, feet), tick(dt, camera, player), remoteBall()}.
 *   Each course in games is a minigame (near/start/update/stop/layout/music/state).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameMinigolf = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const G = 9.81, BALL_R = .0213, CUP_R = .05, V_CAP = 1.25, MAX_SCORE = 7, MAX_PUTT = 4.4, MIN_PUTT = .25;
  const ROLL = {eternit: .055, concrete: .06, felt: .085}, E_WALL = .72, SUB = 1 / 480;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

  // ---------- The lanes: classic Eternit obstacles (WMF standard kinds) and the themed felt holes of Oslo Camping ----------
  // Every kind is made for any length L and width W; positions are fractions of L so indoor (4 m) and outdoor (5.6 m) lanes match.
  const box = (u0, v0, u1, v1) => [[u0, v0, u1, v0], [u1, v0, u1, v1], [u1, v1, u0, v1], [u0, v1, u0, v0]];
  const diamond = (u, v, r) => [[u - r, v, u, v - r], [u, v - r, u + r, v], [u + r, v, u, v + r], [u, v + r, u - r, v]];
  // A wall across the lane at u with openings [v, width] (the rest is solid).
  function across(u, W, gaps) {
    const out = [], g = gaps.slice().sort((a, b) => a[0] - b[0]);let v = -W / 2;
    for (const [c, w] of g) {if (c - w / 2 > v + 1e-6) out.push([u, v, u, c - w / 2]);v = c + w / 2;}
    if (v < W / 2 - 1e-6) out.push([u, v, u, W / 2]);return out;
  }
  const KINDS = {
    straight: (L, W) => ({name: 'Straight', tee: [.45, 0], cup: [L * .86, 0], deco: {target: true}}),
    pyramids: (L, W) => ({name: 'Pyramids', tee: [.45, 0], cup: [L * .87, 0],
      walls: [[-.33, .5], [0, .5], [.33, .5], [-.17, .62], [.17, .62]].flatMap(([v, f]) => diamond(L * f, v * W, .07)), deco: {pyramids: true}}),
    angle: (L, W) => ({name: 'Angle', tee: [.45, -W * .25], cup: [L * .86, W * .28], walls: [[L * .42, -W / 2, L * .6, W * .12]], deco: {}}),
    waves: (L, W) => ({name: 'Double wave', tee: [.45, 0], cup: [L * .88, 0], feats: [{t: 'waves', u0: L * .3, u1: L * .7, n: 2, h: .045}], deco: {}}),
    plateau: (L, W) => ({name: 'Plateau', tee: [.45, 0], cup: [L * .86, 0], feats: [{t: 'ramp', u0: L * .52, u1: L * .64, h: .1}], deco: {plateau: true}}),
    lightning: (L, W) => ({name: 'Lightning', tee: [.45, W * .25], cup: [L * .88, -W * .2],
      walls: [[L * .36, W / 2, L * .36, -W * .14], [L * .62, -W / 2, L * .62, W * .14]], deco: {}}),
    windmill: (L, W) => ({name: 'Windmill', tee: [.45, 0], cup: [L * .86, 0], walls: across(L * .55, W, [[0, .26]]), mills: [{u: L * .55, gap: .26, period: 3.6, half: .3}], deco: {mill: true}}),
    hill: (L, W) => ({name: 'Middle hill', tee: [.45, 0], cup: [L * .88, 0], feats: [{t: 'hill', u: L * .55, v: 0, ru: .55, rv: .5, h: .085}], deco: {}}),
    loop: (L, W) => ({name: 'Loop', tee: [.45, 0], cup: [L * .87, 0], loops: [{u: L * .5, r: .25, w: .3}],
      walls: [[L * .3, -W / 2, L * .44, -.15], [L * .3, W / 2, L * .44, .15], [L * .44, -.15, L * .56, -.15], [L * .44, .15, L * .56, .15]], deco: {}}),
    bridge: (L, W) => ({name: 'Bridge', tee: [.45, 0], cup: [L * .88, 0], feats: [{t: 'ramp', u0: L * .27, u1: L * .38, h: .1}, {t: 'ramp', u0: L * .64, u1: L * .75, h: -.1}],
      hazards: [[L * .38, L * .64, -W / 2, -.17], [L * .38, L * .64, .17, W / 2]], deco: {water: true}}),
    volcano: (L, W) => ({name: 'Volcano', tee: [.45, 0], cup: [L * .78, 0], feats: [{t: 'cone', u: L * .78, v: 0, r: .62, top: .12, h: .13}], deco: {volcano: true}}),
    tube: (L, W) => ({name: 'Tube', tee: [.45, 0], cup: [L * .88, W * .28], tubes: [{u0: L * .38, u1: L * .7, w: .32}], deco: {}}),
    gates: (L, W) => ({name: 'Gates', tee: [.45, 0], cup: [L * .86, 0], walls: across(L * .55, W, [[-W * .32, .12], [0, .12], [W * .32, .12]]), deco: {}}),
    slope: (L, W) => ({name: 'Slope', tee: [.45, W * .25], cup: [L * .86, -W * .3], feats: [{t: 'tilt', gu: 0, gv: .028}], deco: {}}),
    bowl: (L, W) => ({name: 'Bowl', tee: [.45, 0], cup: [L * .8, 0], feats: [{t: 'hill', u: L * .8, v: 0, ru: .6, rv: W * .48, h: -.05}], deco: {}}),
    bumpers: (L, W) => ({name: 'Bumpers', tee: [.45, 0], cup: [L * .9, 0],
      walls: [[L * .3, -W * .5, L * .38, -W * .1], [L * .45, W * .5, L * .52, W * .05], [L * .6, -W * .15, L * .7, W * .15], [L * .78, -W * .5, L * .78, -W * .2], [L * .78, W * .5, L * .78, W * .2]], deco: {}}),
    banks: (L, W) => ({name: 'Banks', tee: [.45, 0], cup: [L * .86, 0], walls: [[L * .62, -W * .22, L * .62, W * .22], [L * .62, -W * .22, L * .66, -W * .22], [L * .62, W * .22, L * .66, W * .22]], deco: {}}),
    uphill: (L, W) => ({name: 'Uphill', tee: [.45, 0], cup: [L * .88, 0], feats: [{t: 'ramp', u0: L * .35, u1: L * .72, h: .2}], deco: {}}),
    // Oslo Camping's themed holes (same physics, camping things on the lane).
    tent: (L, W) => ({...KINDS.tube(L, W), name: 'The tent', deco: {tent: true}}),
    caravan: (L, W) => ({...KINDS.windmill(L, W), name: 'The caravan door', deco: {caravan: true}}),
    campfire: (L, W) => ({...KINDS.volcano(L, W), name: 'Campfire', deco: {volcano: true, fire: true}}),
    canoe: (L, W) => ({...KINDS.bridge(L, W), name: 'Canoe over the lake', deco: {water: true, canoe: true}})
  };
  function holeDef(kind, L, W) {
    const d = KINDS[kind](L, W);
    return {kind, L, W, walls: [], feats: [], hazards: [], mills: [], loops: [], tubes: [], ...d};
  }
  // Height pieces: ramp (smooth rise between u0 and u1, then level), hill (cosine bump, negative = a bowl), cone (volcano with
  // a flat top), tilt (the whole lane tipped), waves (n bumps between u0 and u1).
  function heightOf(feats) {
    return (u, v) => {
      let h = 0;
      for (const f of feats) {
        if (f.t === 'ramp') h += f.h * smooth((u - f.u0) / (f.u1 - f.u0));
        else if (f.t === 'hill') {const d = Math.hypot((u - f.u) / f.ru, (v - f.v) / f.rv);if (d < 1) h += f.h * (.5 + .5 * Math.cos(Math.PI * d));}
        else if (f.t === 'cone') {const d = Math.hypot(u - f.u, v - f.v);h += d <= f.top ? f.h : d < f.r ? f.h * smooth((f.r - d) / (f.r - f.top)) : 0;}
        else if (f.t === 'tilt') h += f.gu * u + f.gv * v;
        else if (f.t === 'waves' && u > f.u0 && u < f.u1) h += f.h * .5 * (1 - Math.cos(2 * Math.PI * f.n * (u - f.u0) / (f.u1 - f.u0)));
      }
      return h;
    };
  }
  function compile(def, surface = 'eternit') {
    const L = def.L, W = def.W, segs = [...box(0, -W / 2, L, W / 2), ...def.walls];
    for (const t of def.tubes) segs.push(...across(t.u0, W, [[0, t.w]]), ...across(t.u1, W, [[0, t.w]]), [t.u0, -t.w / 2, t.u1, -t.w / 2], [t.u0, t.w / 2, t.u1, t.w / 2]);
    const walls = segs.map(([u0, v0, u1, v1]) => {const du = u1 - u0, dv = v1 - v0, len = Math.hypot(du, dv) || 1;return {u0, v0, u1, v1, du, dv, len2: du * du + dv * dv || 1, bu0: Math.min(u0, u1) - BALL_R, bu1: Math.max(u0, u1) + BALL_R, bv0: Math.min(v0, v1) - BALL_R, bv1: Math.max(v0, v1) + BALL_R};});
    const h = heightOf(def.feats), e = .004;
    const grad = (u, v) => [(h(u + e, v) - h(u - e, v)) / (2 * e), (h(u, v + e) - h(u, v - e)) / (2 * e)];
    return {...def, walls, h, grad, roll: ROLL[surface] || ROLL.eternit, surface};
  }

  // ---------- The ball ----------
  const newBall = hole => ({u: hole.tee[0], v: hole.tee[1], vu: 0, vv: 0, moving: false, over: false, holed: false, loop: null, time: 0, lie: [hole.tee[0], hole.tee[1]]});
  // Power 0..1 -> speed (m/s); a curve so the short putts are easy to judge.
  const puttSpeed = power => MIN_PUTT + (MAX_PUTT - MIN_PUTT) * Math.pow(clamp(power, 0, 1), 1.35);
  function putt(ball, angle, power) {
    const sp = puttSpeed(power);ball.lie = [ball.u, ball.v];ball.vu = Math.cos(angle) * sp;ball.vv = Math.sin(angle) * sp;ball.moving = true;ball.time = 0;ball.over = false;return sp;
  }
  // Is a windmill blade in front of the gap at time t? (Four blades; one blocks while within `half` radians of pointing down.)
  function millBlocked(m, t) {
    const ph = (t / m.period) % 1 * Math.PI * 2;
    for (let k = 0; k < 4; k++) {let a = (ph + k * Math.PI / 2) % (Math.PI * 2);if (a > Math.PI) a -= Math.PI * 2;if (Math.abs(a) < m.half) return true;}
    return false;
  }
  // A rolling ball needs v² ≥ 27/7 g r at the bottom to go round a loop of radius r; the loop's own friction takes a bit more.
  const loopNeed = r => Math.sqrt(27 / 7 * G * r) * 1.06;

  // One small step (dt ≤ SUB). Returns the events of the step.
  function step(ball, hole, t, dt) {
    const ev = [];
    if (!ball.moving || ball.holed) return ev;
    ball.time += dt;
    if (ball.loop) {
      const L = ball.loop;L.t += dt;
      if (L.t >= L.T) {
        const s = L.speed;ball.loop = null;
        if (L.ok) {ball.u = L.at + .02;ball.vu = s * .84;ball.vv = 0;ev.push({kind: 'loop'});}
        else {ball.u = L.at - .02;ball.vu = -s * .55;ball.vv = 0;ev.push({kind: 'loopFail'});}
      }
      return ev;
    }
    const pu = ball.u, pv = ball.v;
    // Slope: a rolling sphere accelerates at 5/7 g down the slope; rolling friction slows it.
    const [gu, gv] = hole.grad(ball.u, ball.v), k = 5 / 7 * G;
    ball.vu -= k * gu * dt;ball.vv -= k * gv * dt;
    let sp = Math.hypot(ball.vu, ball.vv);
    const dec = hole.roll * G * dt;
    if (sp > dec) {ball.vu *= (sp - dec) / sp;ball.vv *= (sp - dec) / sp;} else {ball.vu = 0;ball.vv = 0;}
    ball.u += ball.vu * dt;ball.v += ball.vv * dt;
    // Walls (circle against segments): push out, bounce with loss, a little friction along the wall.
    for (const w of hole.walls) {
      if (ball.u < w.bu0 || ball.u > w.bu1 || ball.v < w.bv0 || ball.v > w.bv1) continue;
      const t0 = clamp(((ball.u - w.u0) * w.du + (ball.v - w.v0) * w.dv) / w.len2, 0, 1), cu = w.u0 + w.du * t0, cv = w.v0 + w.dv * t0;
      let nu = ball.u - cu, nv = ball.v - cv;const d = Math.hypot(nu, nv);
      if (d >= BALL_R || d < 1e-9) continue;
      nu /= d;nv /= d;ball.u = cu + nu * BALL_R;ball.v = cv + nv * BALL_R;
      const vn = ball.vu * nu + ball.vv * nv;
      if (vn < 0) {
        const tu = ball.vu - vn * nu, tv = ball.vv - vn * nv;
        ball.vu = tu * .94 - vn * E_WALL * nu;ball.vv = tv * .94 - vn * E_WALL * nv;
        if (-vn > .15) ev.push({kind: 'wall', speed: -vn});
      }
    }
    // Windmill: a blade in the gap sends the ball back.
    for (const m of hole.mills) {
      if ((pu - m.u) * (ball.u - m.u) <= 0 && Math.abs(ball.v) < m.gap / 2 && millBlocked(m, t)) {
        const side = Math.sign(pu - m.u) || -1;ball.u = m.u + side * (BALL_R + .002);ball.vu = -ball.vu * .5;ball.vv *= .8;ev.push({kind: 'mill'});
      }
    }
    // Loop: going in (forward, through the channel) the ball rides round the loop, or rolls back down if it is too slow.
    for (const l of hole.loops) {
      if (pu < l.u && ball.u >= l.u && ball.vu > 0 && Math.abs(ball.v) < l.w / 2) {
        const s = Math.hypot(ball.vu, ball.vv), ok = s >= loopNeed(l.r);
        ball.loop = {at: l.u, r: l.r, speed: s, ok, t: 0, T: ok ? 2 * Math.PI * l.r / (s * .75) : .2 + s / 6};ball.u = l.u;ball.v = 0;ball.vu = ball.vv = 0;
        return ev;
      }
    }
    // Water beside a bridge: a penalty stroke and back to where the putt was played from.
    for (const [u0, u1, v0, v1] of hole.hazards) {
      if (ball.u > u0 && ball.u < u1 && ball.v > v0 && ball.v < v1) {ball.u = ball.lie[0];ball.v = ball.lie[1];ball.vu = ball.vv = 0;ball.moving = false;ev.push({kind: 'water'});return ev;}
    }
    // The cup: slow enough over the hole = in; too fast = lips out (bent away and slowed) or jumps over it.
    {
      const du = ball.u - hole.cup[0], dv = ball.v - hole.cup[1], d = Math.hypot(du, dv);sp = Math.hypot(ball.vu, ball.vv);
      if (d < CUP_R) {
        if (sp < V_CAP * (1 - .6 * (d / CUP_R) ** 2)) {ball.u = hole.cup[0];ball.v = hole.cup[1];ball.vu = ball.vv = 0;ball.moving = false;ball.holed = true;ev.push({kind: 'cup'});return ev;}
        if (!ball.over) {
          ball.over = true;
          if (sp < V_CAP * 2.2) {
            // Lip-out: the rim turns the ball away from the middle and takes speed off it.
            const side = Math.sign(du * ball.vv - dv * ball.vu) || 1, turn = side * (.35 + .9 * (d / CUP_R)) * (1 - sp / (V_CAP * 2.6)), c = Math.cos(turn), s = Math.sin(turn);
            const vu = ball.vu * c - ball.vv * s, vv = ball.vu * s + ball.vv * c;ball.vu = vu * .72;ball.vv = vv * .72;ev.push({kind: 'lip'});
          } else {ball.vu *= .88;ball.vv *= .88;ev.push({kind: 'lip', over: true});}
        }
      } else if (d > CUP_R + BALL_R) ball.over = false;
    }
    // At rest: slow, and the slope is not steep enough to keep it rolling.
    sp = Math.hypot(ball.vu, ball.vv);
    if ((sp < .02 && 5 / 7 * Math.hypot(gu, gv) < hole.roll) || ball.time > 30) {ball.vu = ball.vv = 0;ball.moving = false;ev.push({kind: 'rest'});}
    return ev;
  }
  // Run a putt to its end (tests, and catching up after a slow frame): substeps of 1/480 s.
  function simulate(ball, hole, {t0 = 0, maxT = 40} = {}) {
    const events = [];let t = t0;
    while (ball.moving && t - t0 < maxT) {events.push(...step(ball, hole, t, SUB));t += SUB;}
    return {events, t};
  }
  // The ball's height over the lane's base (for drawing): the lane surface plus its radius, or riding round the loop.
  function ballY(ball, hole) {
    if (ball.loop) {const L = ball.loop, f = L.ok ? L.t / L.T : Math.sin(Math.min(1, L.t / L.T) * Math.PI) * Math.min(.45, L.speed / 8), a = f * Math.PI * 2;return {u: L.at + Math.sin(a) * L.r * (L.ok ? 1 : .6), y: hole.h(L.at, 0) + L.r - Math.cos(a) * L.r + BALL_R};}
    return {u: ball.u, y: ball.holed ? hole.h(ball.u, ball.v) - .03 : hole.h(ball.u, ball.v) + BALL_R};
  }

  // ---------- Scoring: par per hole, at most 7 (after six strokes not holed, 7 is written), the total against par ----------
  class Scorecard {
    constructor(pars) {this.pars = pars.slice();this.scores = pars.map(() => null);}
    // strokes on a hole that ended (holed, or the sixth stroke missed): the score written is at most 7.
    write(i, strokes, holed = true) {const s = holed ? Math.min(MAX_SCORE, strokes) : MAX_SCORE;this.scores[i] = s;return s;}
    static over(strokes, holed) {return holed || strokes >= MAX_SCORE - 1;}
    get played() {return this.scores.filter(s => s !== null).length;}
    get total() {return this.scores.reduce((a, s) => a + (s || 0), 0);}
    get par() {return this.pars.reduce((a, b) => a + b, 0);}
    get parPlayed() {return this.pars.reduce((a, p, i) => a + (this.scores[i] !== null ? p : 0), 0);}
    get vsPar() {return this.total - this.parPlayed;}
    get complete() {return this.scores.every(s => s !== null);}
  }
  const scoreName = (s, par) => s === 1 ? 'Hole in one!' : s - par <= -2 ? 'Eagle!' : s - par === -1 ? 'Birdie!' : s === par ? 'Par' : s - par === 1 ? 'Bogey' : `+${s - par}`;

  // ---------- Serving rules at the bar (alkoholloven § 4-4 with Oslo's times, § 8-11 and the bar's own hours) ----------
  // item.group: 0 = no alcohol, 1 = beer and cider (up to 4.7 %), 2 = wine (4.7–22 %), 3 = spirits (22–60 %).
  // Oslo allows serving groups 1 and 2 from 06:00 and group 3 from 13:00, all until 03:00; the bar serves only while open;
  // nobody who is obviously drunk may be served (opts.drunk = the game's drunk seconds, 60+ = obviously drunk).
  const DRUNK_LIMIT = 60;
  function isOpen(open, d) {
    const day = d.getDay(), h = d.getHours() + d.getMinutes() / 60, [o, c] = open[day], [, cy] = open[(day + 6) % 7];
    return (h >= o && h < c) || (cy > 24 && h < cy - 24);
  }
  function serving(d, item, {open = null, drunk = 0} = {}) {
    if (open && !isOpen(open, d)) return {ok: false, why: 'closed'};
    if (!item.group) return {ok: true};
    const h = d.getHours() + d.getMinutes() / 60, from = item.group === 3 ? 13 : 6;
    if (h >= 3 && h < from) return {ok: false, why: 'hours'};
    if (drunk >= DRUNK_LIMIT) return {ok: false, why: 'drunk'};
    return {ok: true};
  }
  const BAR_MENU = [
    {id: 'pils', name: 'Pils 0,5 l', price: 119, group: 1, drunk: 30},
    {id: 'cider', name: 'Cider 0,33 l', price: 109, group: 1, drunk: 30},
    {id: 'vin', name: 'Glass of wine 15 cl', price: 145, group: 2, drunk: 30},
    {id: 'slush', name: 'Moroslush (with alcohol)', price: 129, group: 3, drunk: 30},
    {id: 'shot', name: 'Shot 4 cl', price: 135, group: 3, drunk: 30},
    {id: 'brus', name: 'Brus 0,33 l', price: 49, group: 0, drunk: -10},
    {id: 'toast', name: 'Toast (ham and cheese)', price: 89, group: 0, drunk: -30}
  ];

  // ---------- Lanes in the map (local frame: x east, s south) ----------
  // A course's rows (minigolf-data.js): the first lane's tee-end centre (x, s), the lane direction, the step to the next lane.
  function courseLanes(course) {
    const out = [], [L, W] = course.lane || [4, .9];let n = 0;
    for (const r of course.rows || []) for (let k = 0; k < r.count; k++) {
      const kind = course.order[n];
      out.push({n: n + 1, kind, par: course.pars[n], x: r.x + r.step[0] * k, s: r.s + r.step[1] * k, dir: r.dir.slice(), L, W, floor: r.floor || 0});n++;
    }
    return out;
  }
  // Corners of a lane's footprint (rails included), grown by m metres.
  function laneCorners(l, m = 0) {
    const [dx, ds] = l.dir, nx = -ds, ns = dx, a = -m - .05, b = l.L + m + .1, w = l.W / 2 + .06 + m;
    return [[a, -w], [b, -w], [b, w], [a, w]].map(([u, v]) => [l.x + dx * u + nx * v, l.s + ds * u + ns * v]);
  }
  // Lane frame -> local map point.
  const laneToLocal = (l, u, v) => [l.x + l.dir[0] * u - l.dir[1] * v, l.s + l.dir[1] * u + l.dir[0] * v];
  const insidePoly = (p, ring) => {let r = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;};

  // ---------- Oslo Camping's rooms: the bar floor (notch in Fredshuset) and the basement under it ----------
  // Frame: a along the Møllergata front (0 .. W), b into the building (0 .. D); y = 0 the bar floor, the basement 3.4 m down.
  const BASEMENT = 3.4, STOREY = 4.0;
  function barPlan(W, D) {
    const stair = {a0: W - 2.15, a1: W - .25, b0: D - 6.6, b1: D - 1.4};// straight flight down toward the back wall
    const counter = {a0: .25, a1: 2.1, b0: 4.2, b1: 10.6}, door = {a: W - 1.6, w: 1.6};
    // Lanes (4.0 x 0.9): upstairs 11 in three bands behind the bar, downstairs 7; each lane's tee end and its direction (+b or -b).
    const up = [], down = [];
    const L = 4.0, cols = [3.55, 5.15, 6.75, 8.35, 9.95, 11.55];
    cols.forEach(a => up.push({a, b: 4.4, dir: 1}));// band 1: b 4.4 .. 8.4, tees toward the front
    cols.slice(0, 5).forEach(a => up.push({a, b: 14.0, dir: -1}));// band 2: b 14.0 .. 10.0, tees toward the back (the stair is at a > W - 2.15)
    [[1.4, 2.0, 1], [2.9, 2.0, 1], [4.4, 2.0, 1], [5.9, 2.0, 1], [7.4, 2.0, 1], [8.9, 2.0, 1], [10.4, 2.0, 1]].forEach(([a, b, dir]) => down.push({a, b, dir}));
    return {W, D, L, lw: .9, stair, counter, door, up, down};
  }

  // The bar's frame in the local map: a along the front from the notch's P0, b into the building.
  const barLocal = (nt, a, b) => [nt.P0[0] + nt.u[0] * a + nt.n[0] * b, nt.P0[1] + nt.u[1] * a + nt.n[1] * b];

  // ---------- Browser ----------
  function prepare(districts, data) {
    const out = {trees: 0, notch: false};
    if (!data) return out;
    for (const c of data.courses) {
      if (c.kind === 'bar') {
        const d = (districts || []).find(x => x && x.name === c.district), b = d && d.buildings.find(x => x.id === c.building);
        const GS = (typeof window !== 'undefined' ? window : globalThis).GameShops;
        if (b && GS && !c.local) {
          const nt = GS.notchFor(b.ring, c.notch.edge, c.notch.t0, c.notch.t1, c.notch.depth);b.ring = nt.ring;b.hip = null;c.local = nt;c.bldg = b;c.patch = d;out.notch = true;
          // The ground is not drawn in the stairwell down to the basement.
          const st = barPlan(nt.W, nt.depth).stair;d.cuts = (d.cuts || []).concat([[[st.a0, st.b0], [st.a1, st.b0], [st.a1, st.b1], [st.a0, st.b1]].map(([a, bb]) => barLocal(nt, a, bb))]);
        }
        continue;
      }
      // Map trees standing on a lane are left out (the real courses have trees between the lanes, not on them).
      const lanes = courseLanes(c).map(l => laneCorners(l, .5));
      for (const d of districts || []) {const before = d.trees.length;d.trees = d.trees.filter(t => !lanes.some(r => insidePoly([t.x, t.s], r)));out.trees += before - d.trees.length;}
    }
    return out;
  }

  // A little geometry builder: triangles in a group's own coordinates, vertex colours, normals facing away from `ref`.
  // dim: the scene is lit brightly (sun, sky and the environment map), so plain colours are scaled to read like the textured ones.
  function geoBuilder(T, dim = .58) {
    const pos = [], nor = [], col = [], uv = [], c = new T.Color();
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    function tri(a, b, d, hex, ref, uvs) {
      let n = crs(sub(b, a), sub(d, a));const l = Math.hypot(...n) || 1;n = n.map(x => x / l);
      if (ref && n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2] < 0) {[b, d] = [d, b];n = n.map(x => -x);if (uvs) uvs = [uvs[0], uvs[2], uvs[1]];}
      c.set(hex).multiplyScalar(dim);for (const p of [a, b, d]) {pos.push(...p);nor.push(...n);col.push(c.r, c.g, c.b);}
      if (uvs) uv.push(...uvs.flat());else uv.push(0, 0, 0, 0, 0, 0);
    }
    const g = {
      tri,
      // quad a-b-c-d (in order round the edge); ref = a direction the face should look toward (or a point it faces away from).
      quad(a, b, cc, d, hex, ref, uvs) {tri(a, b, cc, hex, ref, uvs && [uvs[0], uvs[1], uvs[2]]);tri(a, cc, d, hex, ref, uvs && [uvs[0], uvs[2], uvs[3]]);},
      // A box from 8 corners: [x0y0z0 ...] given as a function corner(i, j, k) with i, j, k in {0, 1}.
      hexa(corner, hex, skipBottom = true, top = null) {
        const P = (i, j, k) => corner(i, j, k), mid = [0, 1, 2].map(q => [0, 1].flatMap(i => [0, 1].flatMap(j => [0, 1].map(k => P(i, j, k)[q]))).reduce((s, v) => s + v, 0) / 8);
        const face = (a, b, cc, d, h) => {const m = [0, 1, 2].map(q => (a[q] + b[q] + cc[q] + d[q]) / 4);g.quad(a, b, cc, d, h, sub(m, mid));};
        face(P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1), top ?? hex);
        if (!skipBottom) face(P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1), hex);
        face(P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), hex);face(P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1), hex);
        face(P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0), hex);face(P(1, 0, 0), P(1, 0, 1), P(1, 1, 1), P(1, 1, 0), hex);
      },
      get count() {return pos.length / 3;},
      mesh(mat, name) {
        if (!pos.length) return null;
        const geo = new T.BufferGeometry();geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
        geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));geo.computeBoundingSphere();
        const m = new T.Mesh(geo, mat);m.name = name || 'Minigolf';m.castShadow = m.receiveShadow = true;return m;
      }
    };
    return g;
  }

  const STYLE = `#golfHud{min-width:330px}#golfHud .pw{height:12px;border-radius:6px;background:#0006;margin:6px 0 4px;overflow:hidden;border:1px solid #fff4}
#golfHud .pw i{display:block;height:100%;background:linear-gradient(90deg,#7bd389,#f2c200 60%,#e8453c)}#golfHud .row{display:flex;gap:2px;margin-top:4px;font:11px/1.2 system-ui}
#golfHud .row span{flex:1;text-align:center;background:#0004;border-radius:3px;padding:1px 0}#golfHud .row span.now{outline:1px solid #fff}#golfHud .row span.u{color:#8fe39b}#golfHud .row span.o{color:#ffb3a8}
#golfCard{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#101a12ee;color:#fff;border-radius:14px;padding:18px 22px;font:14px system-ui;z-index:30;box-shadow:0 10px 40px #0008;max-width:94vw}
#golfCard table{border-collapse:collapse;margin:8px 0}#golfCard td,#golfCard th{border:1px solid #ffffff2a;padding:3px 7px;text-align:center}#golfCard th{color:#a9d8b0;font-weight:600}#golfCard .u{color:#8fe39b}#golfCard .o{color:#ffb3a8}
#golfCard h2{margin:0 0 4px;font-size:20px}#golfCard small{opacity:.75}`;

  function create({T, lib, world, audio, avatars, root: hudRoot, data, now = () => performance.now() / 1000, hooks = {}}) {
    const group = new T.Group();group.name = 'Minigolf';
    const floors = [], obstacles = [], hitboxes = [], courses = [], dynamic = [];
    const H = (x, z) => world.heightWorld(x, z);
    if (typeof document !== 'undefined' && !document.getElementById('golfStyle')) {const s = document.createElement('style');s.id = 'golfStyle';s.textContent = STYLE;document.head.append(s);}
    // Materials: one vertex-coloured material for nearly everything, metal rails, decals on the lanes (polygon offset, never coplanar
    // flicker), unlit glow (lamps, neon, fire), the hole-number atlas.
    const vc = new T.MeshStandardMaterial({vertexColors: true, roughness: .8, metalness: 0});
    const vcMetal = new T.MeshStandardMaterial({vertexColors: true, roughness: .38, metalness: .65});
    const decal = new T.MeshStandardMaterial({vertexColors: true, roughness: .85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4});
    const glow = new T.MeshBasicMaterial({vertexColors: true});
    const water = new T.MeshStandardMaterial({color: 0x2c6e9c, roughness: .12, metalness: .2, transparent: true, opacity: .88, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2});
    const canvasTex = (w, h, draw) => {const c = document.createElement('canvas');c.width = w;c.height = h;draw(c.getContext('2d'), w, h);const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;t.anisotropy = 4;return t;};
    const numTex = canvasTex(1024, 384, (g, w, h) => {
      for (let i = 0; i < 24; i++) {const x = (i % 8) * 128, y = Math.floor(i / 8) * 128;g.fillStyle = '#f4f1e6';g.fillRect(x + 4, y + 4, 120, 120);g.strokeStyle = '#1d5c2c';g.lineWidth = 8;g.strokeRect(x + 8, y + 8, 112, 112);g.fillStyle = '#1d5c2c';g.font = 'bold 72px Arial';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText(String(i + 1), x + 64, y + 68);}
    });
    const numMat = new T.MeshStandardMaterial({map: numTex, roughness: .7});
    const ballGeo = new T.SphereGeometry(BALL_R, 16, 12), ballMat = new T.MeshStandardMaterial({color: 0xffc21a, roughness: .35}), remoteBallMat = new T.MeshStandardMaterial({color: 0xff4f9a, roughness: .35});
    const SURF = {eternit: 0x6c8274, felt: 0x2b7438, concrete: 0x9a978a};
    const shade = (hex, k) => {const c = new T.Color(hex);c.multiplyScalar(k);return c.getHex();};
    const gauss = () => {let u = 0, v = 0;while (!u) u = Math.random();while (!v) v = Math.random();return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);};

    // ---------- One lane: the surface with its heights, rails, obstacles, the cup, the tee and the hole number ----------
    // F(u, v, y) -> a point in the course group's coordinates; base = the lane's surface height (world y of h = 0).
    function buildLane(G, Gm, Gd, Gg, Gn, lane, hole, F, theme) {
      const L = hole.L, W = hole.W, surf = SURF[hole.surface], deco = hole.deco || {}, up = [0, 1, 0];
      const inHaz = (u, v) => hole.hazards.some(([u0, u1, v0, v1]) => u > u0 - 1e-6 && u < u1 + 1e-6 && v > v0 - 1e-6 && v < v1 + 1e-6);
      // Grid of samples (finer than 0.1 m, with the edges of the water as their own lines).
      const us = new Set(), vs = new Set();for (let u = 0; u <= L + 1e-9; u += .1) us.add(+u.toFixed(4));us.add(L);
      for (let v = -W / 2; v <= W / 2 + 1e-9; v += W / 12) vs.add(+v.toFixed(4));vs.add(W / 2);
      for (const [u0, u1, v0, v1] of hole.hazards) {us.add(u0);us.add(u1);for (const v of [v0, v1]) if (Math.abs(v) < W / 2 - 1e-6) {vs.add(+(v - .0005).toFixed(4));vs.add(+(v + .0005).toFixed(4));}}
      const U = [...us].sort((a, b) => a - b), V = [...vs].sort((a, b) => a - b);
      const colAt = (u, v, y) => {
        if (deco.volcano) {const f = hole.feats.find(q => q.t === 'cone');if (f && Math.hypot(u - f.u, v - f.v) < f.r) return deco.fire ? 0x6b4a32 : 0x8a6b52;}
        if ((deco.water || deco.canoe) && u > hole.hazards[0][0] - .001 && u < hole.hazards[0][1] + .001 && Math.abs(v) < .17) return deco.canoe ? 0xb0402c : 0x9a7046;
        if (deco.plateau && u > L * .6) return shade(surf, .92);
        // A little mottling, like weathered Eternit boards or worn felt (the same for every lane: from the position, not random).
        const m = 1 + .045 * Math.sin(u * 7.3 + v * 3.1) * Math.sin(u * 2.3 - v * 9.7);
        return shade(surf, (y > .015 ? 1 + Math.min(.12, y) : 1) * m);
      };
      for (let i = 0; i + 1 < U.length; i++) for (let j = 0; j + 1 < V.length; j++) {
        const u0 = U[i], u1 = U[i + 1], v0 = V[j], v1 = V[j + 1], um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
        if (inHaz(um, vm)) continue;
        const p = (u, v) => F(u, v, hole.h(u, v));G.quad(p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1), colAt(um, vm, hole.h(um, vm)), up);
      }
      // Water beside a bridge (its own transparent mesh) and the dark pit under it.
      for (const [u0, u1, v0, v1] of hole.hazards) {Gw.quad(F(u0, v0, -.05), F(u1, v0, -.05), F(u1, v1, -.05), F(u0, v1, -.05), 0xffffff, up);G.quad(F(u0, v0, -.09), F(u1, v0, -.09), F(u1, v1, -.09), F(u0, v1, -.09), 0x24313a, up);}
      // Plinth under the lane down to the ground, with skirts up to the surface edge.
      const ground = Math.min(...[[0, -W / 2], [L, -W / 2], [L, W / 2], [0, W / 2], [L / 2, 0]].map(([u, v]) => lane.groundY(u, v))), low = Math.min(-.12, ground - .25);
      G.hexa((i, j, k) => F(i ? L + .07 : -.07, k ? W / 2 + .07 : -W / 2 - .07, j ? -.09 : low), theme.plinth);
      for (const [a, b] of [[[0, -W / 2], [L, -W / 2]], [[L, -W / 2], [L, W / 2]], [[L, W / 2], [0, W / 2]], [[0, W / 2], [0, -W / 2]]]) {
        const n = 10;for (let k = 0; k < n; k++) {const p0 = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], p1 = [a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n];
          const out = F((p0[0] + p1[0]) / 2 - L / 2, (p0[1] + p1[1]) / 2, 0), c0 = F(0, 0, 0), ref = [out[0] - c0[0] - (F(-L / 2, 0, 0)[0] - c0[0]), 0, out[2] - c0[2] - (F(-L / 2, 0, 0)[2] - c0[2])];
          G.quad(F(...p0, -.1), F(...p1, -.1), F(...p1, hole.h(...p1)), F(...p0, hole.h(...p0)), theme.plinth, ref);}
      }
      // Rails: the border sits just outside the lane line, inner walls straddle theirs; pieces of 0.25 m follow the slopes.
      const railH = theme.railH || .075, tall = deco.mill || deco.caravan ? .45 : 0;
      hole.walls.forEach((w, wi) => {
        const len = Math.sqrt(w.len2), n = Math.max(1, Math.ceil(len / .25)), nu = -w.dv / len, nv = w.du / len, border = wi < 4, th = border ? .04 : .035;
        // A border's outward side: away from the lane's middle.
        const side = border ? Math.sign(nu * ((w.u0 + w.u1) / 2 - L / 2) + nv * ((w.v0 + w.v1) / 2)) || 1 : 0, off0 = border ? 0 : -th / 2, off1 = border ? th : th / 2;
        const across = !border && Math.abs(w.du) < 1e-6 && Math.abs(Math.abs(w.dv) - 0) > 0;
        const block = !border && (hole.mills.length || hole.tubes.length || deco.gates || hole.kind === 'gates' || hole.kind === 'bumpers' || hole.kind === 'banks' || hole.kind === 'lightning');
        const hTop = tall && across ? tall : block ? .14 : railH, colr = !border && block ? (tall ? theme.mill : theme.block) : theme.rail;
        for (let k = 0; k < n; k++) {
          const a = k / n, b = (k + 1) / n, P = t => [w.u0 + w.du * t, w.v0 + w.dv * t], A = P(a), B = P(b), hA = hole.h(...A), hB = hole.h(...B);
          const o = (p, d) => [p[0] + nu * d * (border ? side : 1), p[1] + nv * d * (border ? side : 1)];
          const bottom = Math.min(hA, hB) - .03;
          (border ? Gm : G).hexa((i, j, kk) => {const p = o(i ? B : A, kk ? off1 : off0), y = j ? (i ? hB : hA) + hTop : bottom;return F(p[0], p[1], y);}, colr);
        }
      });
      // Tubes: a half pipe over the channel (the tent: a ridge tent over the whole lane).
      for (const t of hole.tubes) {
        if (deco.tent) {
          const r = W / 2 + .03, top = .55;
          for (const s of [-1, 1]) G.quad(F(t.u0 - .2, s * r, hole.h(t.u0, 0)), F(t.u1 + .2, s * r, hole.h(t.u1, 0)), F(t.u1 + .2, 0, top), F(t.u0 - .2, 0, top), s < 0 ? 0xe46a1f : 0xd85d14, null);
          for (const u of [t.u0 - .2, t.u1 + .2]) for (const s of [-1, 1]) G.tri(F(u, s * r, 0), F(u, s * (t.w / 2 + .02), 0), F(u, 0, top), 0xc4520f);
        } else {
          const r = t.w / 2 + .045, n = 10;
          for (let k = 0; k < n; k++) {const a0 = Math.PI * k / n, a1 = Math.PI * (k + 1) / n, pt = (u, a) => F(u, Math.cos(a) * r, hole.h(u, 0) + Math.sin(a) * r * .9);
            for (let s = 0; s < 4; s++) {const ua = t.u0 + (t.u1 - t.u0) * s / 4, ub = t.u0 + (t.u1 - t.u0) * (s + 1) / 4;G.quad(pt(ua, a0), pt(ub, a0), pt(ub, a1), pt(ua, a1), 0x3b6ea8, null);}}
        }
      }
      // Pyramids, the loop, the windmill house, the volcano's rim, the campfire.
      if (deco.pyramids) for (const w of hole.walls.slice(4)) if (w === hole.walls[4] || true) {/* drawn as blocks above */}
      if (deco.pyramids) {
        const cs = [];for (let i = 4; i < hole.walls.length; i += 4) {const q = hole.walls.slice(i, i + 4);cs.push([(q[0].u0 + q[1].u0 + q[2].u0 + q[3].u0) / 4, (q[0].v0 + q[1].v0 + q[2].v0 + q[3].v0) / 4]);}
        for (const [pu, pv] of cs) {const y0 = hole.h(pu, pv), top = F(pu, pv, y0 + .09), r = .075, c4 = [[pu - r, pv], [pu, pv - r], [pu + r, pv], [pu, pv + r]].map(([u, v]) => F(u, v, y0 - .01));for (let k = 0; k < 4; k++) G.tri(c4[k], c4[(k + 1) % 4], top, theme.pyramid, [0, 1, 0]);}
      }
      for (const l of hole.loops) {
        const n = 28, y0 = hole.h(l.u, 0), w = l.w / 2 + .01, pt = (a, v, r) => F(l.u + Math.sin(a) * r, v, y0 + l.r - Math.cos(a) * r);
        for (let k = 0; k < n; k++) {
          const a0 = Math.PI * 2 * k / n - .25, a1 = Math.PI * 2 * (k + 1) / n - .25, rr = l.r + BALL_R;
          G.quad(pt(a0, -w, rr), pt(a1, -w, rr), pt(a1, w, rr), pt(a0, w, rr), theme.loop, F(l.u, 0, y0 + l.r));// inside face toward the middle
          G.quad(pt(a0, -w, rr + .012), pt(a1, -w, rr + .012), pt(a1, w, rr + .012), pt(a0, w, rr + .012), shade(theme.loop, .8), null);
          for (const s of [-1, 1]) G.quad(pt(a0, s * w, rr - .03), pt(a1, s * w, rr - .03), pt(a1, s * w, rr + .012), pt(a0, s * w, rr + .012), theme.rail, null);
        }
        for (const s of [-1, 1]) G.hexa((i, j, k) => F(l.u - .05 + i * .1, s * (w + .02) + (k ? .04 : 0) * s, j ? y0 + l.r * 2 + .05 : y0), theme.rail);
      }
      for (const m of hole.mills) {
        const y0 = hole.h(m.u, 0), hub = F(m.u - .04, 0, y0 + .5);
        // House roof over the mill wall, and the turning blades (their own mesh, turned every frame from the shared clock).
        G.hexa((i, j, k) => F(m.u - .14 + i * .28, (k ? 1 : -1) * (W / 2 + .03), y0 + (j ? .62 : .45)), deco.caravan ? 0xf3efe2 : 0x8b3a2e);
        if (deco.caravan) {G.hexa((i, j, k) => F(m.u - .6 + i * 1.2, (k ? 1 : -1) * (W / 2 + .03), y0 + (j ? .95 : .62)), 0xf3efe2);G.hexa((i, j, k) => F(m.u - .62 + i * 1.24, (k ? 1 : -1) * (W / 2 + .05), y0 + (j ? .72 : .66)), 0x2f8fbf);}
        const bl = new T.Group();bl.position.set(...hub);const toW = new T.Vector3(...F(1, 0, 0)).sub(new T.Vector3(...F(0, 0, 0))).normalize();
        bl.quaternion.setFromUnitVectors(new T.Vector3(1, 0, 0), toW);
        const spin = new T.Group();bl.add(spin);const bladeM = new T.MeshStandardMaterial({color: deco.caravan ? 0x2f8fbf : 0xf2efe6, roughness: .6});
        for (let k = 0; k < 4; k++) {const arm = new T.Group();arm.rotation.x = k * Math.PI / 2;spin.add(arm);const b = new T.Mesh(new T.BoxGeometry(.03, .46, .1), bladeM);b.position.y = -.25;b.castShadow = true;arm.add(b);}
        const hubM = new T.Mesh(new T.CylinderGeometry(.04, .04, .06, 12), lib.metal(0x444444, .4));hubM.rotation.z = Math.PI / 2;bl.add(hubM);
        dynamic.push({spin, mill: m});lane.blades = bl;
      }
      if (deco.fire) {
        const f = hole.feats.find(q => q.t === 'cone');
        for (let k = 0; k < 6; k++) {const a = k / 6 * Math.PI * 2, r = f.r + .05;G.hexa((i, j, kk) => {const aa = a + (i ? .35 : -.35), rr = r + (kk ? .06 : 0);return F(f.u + Math.cos(aa) * rr, Math.sin(aa) * rr, (j ? .07 : -.01));}, 0x5b3a22);}
        for (let k = 0; k < 12; k++) {const a = k / 12 * Math.PI * 2, b = (k + 1) / 12 * Math.PI * 2, r = f.r * .8, y = hole.h(f.u + Math.cos(a) * r, Math.sin(a) * r) + .004;Gg.tri(F(f.u + Math.cos(a) * r, Math.sin(a) * r, y), F(f.u + Math.cos(b) * r, Math.sin(b) * r, y), F(f.u + Math.cos((a + b) / 2) * r * 1.05, Math.sin((a + b) / 2) * r * 1.05, y + .09), 0xff7a1a, null);}
      }
      // Cup (dark hole with a white rim), the tee mark and the target ring (decals, offset so they never flicker).
      const ring = (cu, cv, r0, r1, hex, n = 28) => {for (let k = 0; k < n; k++) {const a = k / n * Math.PI * 2, b = (k + 1) / n * Math.PI * 2, P = (r, t) => {const u = cu + Math.cos(t) * r, v = cv + Math.sin(t) * r;return F(u, v, hole.h(u, v) + .0015);};Gd.quad(P(r0, a), P(r0, b), P(r1, b), P(r1, a), hex, up);}};
      ring(hole.cup[0], hole.cup[1], 0, CUP_R, 0x0b0d0c);ring(hole.cup[0], hole.cup[1], CUP_R, CUP_R + .008, 0xf4f4f0);
      ring(hole.tee[0], hole.tee[1], .05, .065, 0xf4f4f0, 20);
      if (deco.target) {ring(hole.cup[0], hole.cup[1], .32, .335, 0xf4f4f0);ring(hole.cup[0], hole.cup[1], .62, .635, 0xf4f4f0);}
      // Hole number on a small post at the tee end (the atlas: 8 x 3 numbers).
      {
        const i = lane.n - 1, cu = (i % 8) / 8, cv = 1 - Math.floor(i / 8) / 3, du = 1 / 8, dv = 1 / 3, s = -W / 2 - .2, y0 = Math.max(0, lane.groundY(-.05, s));
        G.hexa((a, j, k) => F(-.04 + a * .05, s - .025 + k * .05, j ? .55 : y0 - .3), theme.post);
        const pa = F(-.07, s - .13, .7), pb = F(-.07, s + .13, .7), pc = F(-.07, s + .13, .44), pd = F(-.07, s - .13, .44);
        // Seen from the tee (looking along +u), +v is on the right when Wv points along u × up; else the picture is mirrored.
        const fu = [F(1, 0, 0)[0] - F(0, 0, 0)[0], F(1, 0, 0)[2] - F(0, 0, 0)[2]], fv = [F(0, 1, 0)[0] - F(0, 0, 0)[0], F(0, 1, 0)[2] - F(0, 0, 0)[2]], right = fv[0] * -fu[1] + fv[1] * fu[0] > 0;
        const L0 = right ? cu : cu + du, L1 = right ? cu + du : cu;
        Gn.quad(pa, pb, pc, pd, 0xffffff, [-fu[0], 0, -fu[1]], [[L0, cv], [L1, cv], [L1, cv - dv], [L0, cv - dv]]);
        G.hexa((a, j, k) => F(-.065 + a * .015, s - .14 + k * .28, j ? .71 : .43), theme.post);
      }
    }
    let Gw = null;// water builder of the course being built

    // ---------- The courses ----------
    const THEMES = {
      eternit: {plinth: 0x7d7b75, rail: 0xa9aeb2, block: 0xc9463b, mill: 0xf1ede2, pyramid: 0xf2f0ea, loop: 0x4f7fb7, post: 0x6b4a2b},
      concrete: {plinth: 0x8c8a84, rail: 0x9b9890, block: 0xd2a23a, mill: 0xf1ede2, pyramid: 0xe9e4d6, loop: 0x4f7fb7, post: 0x6b4a2b},
      felt: {plinth: 0x4a3322, rail: 0x8a5a33, block: 0xc77b2d, mill: 0xf3efe2, pyramid: 0x3d6b8f, loop: 0x7a3f9a, post: 0x4a3322, railH: .09}
    };
    function finishCourse(C, G, Gm, Gd, Gg, Gn) {
      for (const [b, m] of [[G, vc], [Gm, vcMetal], [Gd, decal], [Gg, glow], [Gw, water], [Gn, numMat]]) {const mesh = b.mesh(m, `Minigolf ${C.data.short}`);if (mesh) {if (b === Gd || b === Gg || b === Gw || b === Gn) mesh.castShadow = false;C.group.add(mesh);}}
    }
    function lanesFor(C, list, frame) {
      const G = geoBuilder(T), Gm = geoBuilder(T), Gd = geoBuilder(T), Gg = geoBuilder(T, 1), Gn = geoBuilder(T, 1);Gw = geoBuilder(T);
      const theme = THEMES[C.data.surface] || THEMES.eternit;
      for (const l of list) {
        const hole = compile(holeDef(l.kind, l.L, l.W), C.data.surface), fr = frame(l, hole);
        const lane = {...l, hole, ...fr, blades: null};
        buildLane(G, Gm, Gd, Gg, Gn, lane, hole, lane.F, theme);
        C.lanes.push(lane);
        // Walking: the lane (rails and all) is in the way; you stand at its tee end.
        const corners = [[-.12, -l.W / 2 - .12], [l.L + .12, -l.W / 2 - .12], [l.L + .12, l.W / 2 + .12], [-.12, l.W / 2 + .12]].map(([u, v]) => lane.world(u, v, 0));
        obstacles.push({points: corners.map(p => ({x: p.x, z: p.z})), minY: lane.y0 - 1.2, maxY: lane.y0 + (hole.mills.length || hole.loops.length ? .8 : .45), kind: 'minigolf'});
        if (lane.blades) C.group.add(lane.blades);
      }
      finishCourse(C, G, Gm, Gd, Gg, Gn);
    }
    // A lane in the open: its frame from the local map, its surface level with the highest ground under it plus 15 cm.
    function outdoorFrame(C) {
      return (l, hole) => {
        const o = world.toWorld(l.x, l.s), pu = world.toWorld(l.x + l.dir[0], l.s + l.dir[1]), pv = world.toWorld(l.x - l.dir[1], l.s + l.dir[0]);
        const Wu = [pu.x - o.x, pu.z - o.z], Wv = [pv.x - o.x, pv.z - o.z];
        let y0 = -1e9;for (const [u, v] of [[0, -l.W / 2], [l.L, -l.W / 2], [l.L, l.W / 2], [0, l.W / 2], [l.L / 2, 0], [l.L * .25, 0], [l.L * .75, 0]]) y0 = Math.max(y0, H(o.x + Wu[0] * u + Wv[0] * v, o.z + Wu[1] * u + Wv[1] * v));
        y0 += .15;const G0 = C.origin;
        const world_ = (u, v, y) => ({x: o.x + Wu[0] * u + Wv[0] * v, y: y0 + y, z: o.z + Wu[1] * u + Wv[1] * v});
        return {y0, Wu, Wv, o, world: world_, F: (u, v, y) => {const p = world_(u, v, y);return [p.x - G0.x, p.y - G0.y, p.z - G0.z];}, groundY: (u, v) => {const p = world_(u, v, 0);return H(p.x, p.z) - y0;},
          toLane: (x, z) => {const dx = x - o.x, dz = z - o.z;return [dx * Wu[0] + dz * Wu[1], dx * Wv[0] + dz * Wv[1]];}};
      };
    }

    // Fences round the outdoor courses (posts every 2.4 m, two rails, a gate gap), benches, the kiosk's ticket table.
    function fenceAndPark(C) {
      const d = C.data, G = geoBuilder(T), Gm = geoBuilder(T), G0 = C.origin, rel = (x, y, z) => [x - G0.x, y - G0.y, z - G0.z];
      if (d.gate) {
        const ring = d.outline, gate = world.toWorld(...d.gate);
        for (let i = 0; i < ring.length; i++) {
          const a = world.toWorld(...ring[i]), b = world.toWorld(...ring[(i + 1) % ring.length]), len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(len / 2.4));
          for (let k = 0; k < n; k++) {
            const p = {x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n}, q = {x: a.x + (b.x - a.x) * (k + 1) / n, z: a.z + (b.z - a.z) * (k + 1) / n};
            const mid = {x: (p.x + q.x) / 2, z: (p.z + q.z) / 2};if (Math.hypot(mid.x - gate.x, mid.z - gate.z) < .9 + len / n / 2 && Math.hypot(mid.x - gate.x, mid.z - gate.z) < 1.4) continue;
            const yp = H(p.x, p.z), yq = H(q.x, q.z), dx = (q.x - p.x) / (len / n), dz = (q.z - p.z) / (len / n), nx = -dz * .02, nz = dx * .02;
            Gm.hexa((i, j, kk) => rel(p.x + (kk ? nx : -nx) * 2 + (i ? .035 : -.035) * dx, j ? yp + 1.05 : yp - .2, p.z + (kk ? nz : -nz) * 2 + (i ? .035 : -.035) * dz), 0x3d5a3f);
            for (const hh of [.45, .95]) Gm.hexa((i, j, kk) => {const t = i ? 1 : 0, x = p.x + (q.x - p.x) * t + (kk ? nx : -nx), z = p.z + (q.z - p.z) * t + (kk ? nz : -nz), y = (i ? yq : yp) + hh + (j ? .05 : 0);return rel(x, y, z);}, 0x3d5a3f, false);
            obstacles.push({points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, w]) => ({x: (s < 0 ? p.x : q.x) + w * nx * 2.5, z: (s < 0 ? p.z : q.z) + w * nz * 2.5})), minY: Math.min(yp, yq) - .5, maxY: Math.max(yp, yq) + 1.1, kind: 'fence'});
          }
        }
        // Gate posts with a "MINIGOLF" board.
        const gd = d.gateDir, ga = world.toWorld(d.gate[0] - gd[1] * .85, d.gate[1] + gd[0] * .85), gb = world.toWorld(d.gate[0] + gd[1] * .85, d.gate[1] - gd[0] * .85);
        for (const p of [ga, gb]) {const y = H(p.x, p.z);G.hexa((i, j, k) => rel(p.x - .06 + i * .12, j ? y + 2.25 : y - .2, p.z - .06 + k * .12), 0x5b4128);}
        const ya = H(ga.x, ga.z), yb = H(gb.x, gb.z), sign = canvasTex(512, 96, (g, w, h) => {g.fillStyle = '#1d5c2c';g.fillRect(0, 0, w, h);g.fillStyle = '#fff';g.font = 'bold 54px Arial';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText('MINIGOLF', w / 2, h / 2 + 3);});
        const board = new T.Mesh(new T.BoxGeometry(Math.hypot(gb.x - ga.x, gb.z - ga.z) + .1, .32, .04), [vc, vc, vc, vc, new T.MeshStandardMaterial({map: sign}), new T.MeshStandardMaterial({map: (() => {const t = sign.clone();t.wrapS = T.RepeatWrapping;t.repeat.x = -1;t.offset.x = 1;t.needsUpdate = true;return t;})()})]);
        board.position.set((ga.x + gb.x) / 2 - G0.x, Math.max(ya, yb) + 2.05 - G0.y, (ga.z + gb.z) / 2 - G0.z);board.rotation.y = Math.atan2(-(gb.z - ga.z), gb.x - ga.x);C.group.add(board);
      }
      // Benches facing the lanes.
      const mid = (() => {const r = d.outline;return world.toWorld(r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length);})();
      for (const b of d.benches || []) {
        const p = world.toWorld(...b), y = H(p.x, p.z), dx = mid.x - p.x, dz = mid.z - p.z, l = Math.hypot(dx, dz), f = [dx / l, dz / l], s = [-f[1], f[0]];
        const at = (a, c, yy) => rel(p.x + s[0] * a + f[0] * c, y + yy, p.z + s[1] * a + f[1] * c);
        G.hexa((i, j, k) => at(-.8 + i * 1.6, -.2 + k * .4, j ? .46 : .42), 0x8a6238);G.hexa((i, j, k) => at(-.8 + i * 1.6, -.24 + k * .05, j ? .85 : .55), 0x8a6238);
        for (const a of [-.65, .65]) G.hexa((i, j, k) => at(a - .03 + i * .06, -.18 + k * .36, j ? .42 : -.1), 0x333333);
        obstacles.push({points: [[-.85, -.25], [.85, -.25], [.85, .22], [-.85, .22]].map(([a, c]) => ({x: p.x + s[0] * a + f[0] * c, z: p.z + s[1] * a + f[1] * c})), minY: y - .3, maxY: y + .9, kind: 'bench'});
      }
      // The ticket table beside the kiosk, toward the lanes, and the attendant.
      if (d.kiosk) {
        const kc = d.kiosk.reduce((a, p) => [a[0] + p[0] / d.kiosk.length, a[1] + p[1] / d.kiosk.length], [0, 0]), toward = [mid.x, mid.z], kw = world.toWorld(...kc);
        let dx = toward[0] - kw.x, dz = toward[1] - kw.z;const l = Math.hypot(dx, dz);dx /= l;dz /= l;
        // Step out from the kiosk until clear of its walls.
        let t = 1.5;while (t < 8 && insidePoly((p => {const q = world.toLocal(p.x, p.z);return [q.x, q.s];})({x: kw.x + dx * t, z: kw.z + dz * t}), d.kiosk)) t += .25;t += 1.0;
        const p = {x: kw.x + dx * t, z: kw.z + dz * t}, y = H(p.x, p.z), s = [-dz, dx];
        const at = (a, c, yy) => rel(p.x + s[0] * a + dx * c, y + yy, p.z + s[1] * a + dz * c);
        G.hexa((i, j, k) => at(-.6 + i * 1.2, -.3 + k * .6, j ? .8 : .76), 0xe9e4d8);G.hexa((i, j, k) => at(-.55 + i * 1.1, -.25 + k * .5, j ? .76 : -.1), 0x2f6f3a);
        G.hexa((i, j, k) => at(-.2 + i * .25, -.1 + k * .2, j ? .9 : .8), 0x9a2f2a);// the cash box
        const priceTex = canvasTex(512, 384, (g, w, h) => {g.fillStyle = '#1d5c2c';g.fillRect(0, 0, w, h);g.fillStyle = '#fff';g.textAlign = 'center';g.font = 'bold 44px Arial';g.fillText(d.short.toUpperCase() + ' MINIGOLF', w / 2, 62);g.font = '34px Arial';g.fillText(`Voksne ${d.price.adult} kr · Barn ${d.price.child} kr`, w / 2, 140);g.font = '28px Arial';g.fillText('Hver dag 12–21 i sesongen', w / 2, 210);g.fillText('Siste start 20:00', w / 2, 254);g.font = '24px Arial';g.fillText(d.operator, w / 2, 330);});
        const board = new T.Mesh(new T.PlaneGeometry(.9, .68), new T.MeshStandardMaterial({map: priceTex, roughness: .7}));const bp = at(0, -.45, 1.55);board.position.set(...bp);board.rotation.y = Math.atan2(dx, dz);C.group.add(board);// facing the lanes, where you buy
        G.hexa((i, j, k) => at(-.04 + i * .08, -.47 + k * .04, j ? 1.2 : -.1), 0x5b4128);
        obstacles.push({points: [[-.65, -.5], [.65, -.5], [.65, .35], [-.65, .35]].map(([a, c]) => ({x: p.x + s[0] * a + dx * c, z: p.z + s[1] * a + dz * c})), minY: y - .3, maxY: y + 1.6, kind: 'kiosk'});
        if (avatars) {const av = avatars.avatar(2, 'Billettselger', 0x2e7d32);av.group.position.set(p.x - G0.x - dx * .6, y - G0.y, p.z - G0.z - dz * .6);av.group.rotation.y = Math.atan2(-(-dx), -(-dz)) + Math.PI;C.group.add(av.group);av.pose({stance: 'stand'});C.staff = av;}
        C.ticketAt = {x: p.x + dx * .7, z: p.z + dz * .7, y};
        const hb = new T.Mesh(new T.BoxGeometry(1.3, 1.6, 1.0), new T.MeshBasicMaterial({visible: false}));hb.position.set(p.x - G0.x, y + .9 - G0.y, p.z - G0.z);hb.userData = {golfTicket: C, noMerge: true};C.group.add(hb);hitboxes.push(hb);
      }
      for (const [b, m] of [[G, vc], [Gm, vcMetal]]) {const mesh = b.mesh(m, `Minigolf ${d.short} park`);if (mesh) C.group.add(mesh);}
    }

    // ---------- Oslo Camping: the bar in Fredshuset, Møllergata 12 ----------
    function buildBar(C) {
      const d = C.data, nt = d.local, B = d.bldg, plan = barPlan(nt.W, nt.depth), W = plan.W, D = plan.D;
      const wpt = (a, b) => world.toWorld(...barLocal(nt, a, b));
      let maxH = -1e9;for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {const p = wpt(W * i / 10, D * j / 10);maxH = Math.max(maxH, H(p.x, p.z));}
      const y0 = maxH + .05, G0 = wpt(0, 0);G0.y = y0;C.origin = G0;C.floorY = y0;C.plan = plan;C.group.position.set(G0.x, G0.y, G0.z);
      const FB = (a, b, y) => {const p = wpt(a, b);return [p.x - G0.x, y, p.z - G0.z];}, WB = (a, b, y = 0) => {const p = wpt(a, b);return {x: p.x, y: y0 + y, z: p.z};};
      const rectW = (a0, a1, b0, b1) => [WB(a0, b0), WB(a1, b0), WB(a1, b1), WB(a0, b1)].map(p => ({x: p.x, z: p.z}));
      C.toBar = (x, z) => {const l = world.toLocal(x, z), dx = l.x - nt.P0[0], ds = l.s - nt.P0[1];return {a: dx * nt.u[0] + ds * nt.u[1], b: dx * nt.n[0] + ds * nt.n[1]};};
      const G = geoBuilder(T), Gm = geoBuilder(T), Gg = geoBuilder(T, 1), up = [0, 1, 0], st = plan.stair, BS = -BASEMENT;
      const box = (a0, a1, b0, b1, ya, yb, hex, g = G, top) => g.hexa((i, j, k) => FB(i ? a1 : a0, k ? b1 : b0, j ? yb : ya), hex, false, top);
      // Floors: planks upstairs (with the stairwell left open), concrete painted dark red downstairs.
      const plank = (a0, a1, b0, b1, y) => {for (let a = a0; a < a1 - 1e-6; a += .22) {const e = Math.min(a1, a + .22), k = Math.floor(a / .22);G.quad(FB(a, b0, y), FB(e, b0, y), FB(e, b1, y), FB(a, b1, y), [0x7a5634, 0x6e4d2e, 0x84603b, 0x735131][k % 4], up);}};
      const holes = [[0, W, 0, st.b0], [0, st.a0, st.b0, D], [st.a1, W, st.b0, D], [st.a0, st.a1, st.b1, D]];
      for (const [a0, a1, b0, b1] of holes) {plank(a0, a1, b0, b1, 0);G.quad(FB(a0, b0, -.25), FB(a1, b0, -.25), FB(a1, b1, -.25), FB(a0, b1, -.25), 0x1c1d1f, [0, -1, 0]);floors.push({name: 'Oslo Camping', points: rectW(a0, a1, b0, b1), y: y0, ceilingHeight: STOREY - .1, surfaceKind: 'wood'});}
      G.quad(FB(0, 0, BS), FB(W, 0, BS), FB(W, D, BS), FB(0, D, BS), 0x5a2a26, up);
      floors.push({name: 'Oslo Camping, downstairs', points: rectW(0, W, 0, D), y: y0 + BS, ceilingHeight: BASEMENT - .3, surfaceKind: 'tile'});
      // Ceilings and wall linings (4 cm in from the building's notch walls: nothing coplanar).
      G.quad(FB(0, 0, STOREY), FB(W, 0, STOREY), FB(W, D, STOREY), FB(0, D, STOREY), 0x17181a, [0, -1, 0]);
      const wall = (a0, b0, a1, b1, ya, yb, hex, inward) => G.quad(FB(a0, b0, ya), FB(a1, b1, ya), FB(a1, b1, yb), FB(a0, b0, yb), hex, inward);
      const inn = (a, b) => {const p = FB(a, b, 0), c = FB(W / 2, D / 2, 0);return [c[0] - p[0], 0, c[2] - p[2]];};
      for (const [ya, yb, lo, hi] of [[0, STOREY, 0x5b4128, 0x2f4a34], [BS, -.25, 0x2a3a2c, 0x203024]]) {
        for (const [a0, b0, a1, b1] of [[.04, .04, .04, D - .04], [.04, D - .04, W - .04, D - .04], [W - .04, D - .04, W - .04, .04]]) {wall(a0, b0, a1, b1, ya, ya + 1.1, lo, inn((a0 + a1) / 2, (b0 + b1) / 2));wall(a0, b0, a1, b1, ya + 1.1, yb, hi, inn((a0 + a1) / 2, (b0 + b1) / 2));}
        if (ya < 0) {wall(W - .04, .04, .04, .04, ya, ya + 1.1, lo, inn(W / 2, .04));wall(W - .04, .04, .04, .04, ya + 1.1, yb, hi, inn(W / 2, .04));}
      }
      // Basement walls (the earth round them is not drawn) for walking.
      for (const [a0, a1, b0, b1] of [[-.3, 0, -.3, D + .3], [W, W + .3, -.3, D + .3], [-.3, W + .3, -.3, 0], [-.3, W + .3, D, D + .3]]) obstacles.push({points: rectW(a0, a1, b0, b1), minY: y0 + BS - .3, maxY: y0 - .3, kind: 'wall'});
      // The front on Møllergata: shop window, the door, the sign; the facade above in the building's own look.
      const door = plan.door, dA = door.a - door.w / 2, dB = door.a + door.w / 2, fr = 0x1d1f22;
      box(0, W, -.07, .07, 0, .12, fr, Gm);box(0, W, -.07, .07, 2.9, 3.05, fr, Gm);for (const a of [0, 3.3, 6.6, 9.9, dA, dB, W]) box(Math.max(0, a - .05), Math.min(W, a + .05), -.07, .07, 0, 3.05, fr, Gm);
      const glass = new T.MeshPhysicalMaterial({color: 0xbfd3dc, transparent: true, opacity: .22, roughness: .04, metalness: .1, side: T.DoubleSide, depthWrite: false});
      for (const [a0, a1] of [[0, dA], [dB, W]]) {const m = new T.Mesh(new T.PlaneGeometry(a1 - a0, 2.8), glass);const p = FB((a0 + a1) / 2, 0, 1.5);m.position.set(...p);m.rotation.y = Math.atan2(-(FB(1, 0, 0)[2] - FB(0, 0, 0)[2]), FB(1, 0, 0)[0] - FB(0, 0, 0)[0]);C.group.add(m);obstacles.push({points: rectW(a0, a1, -.08, .08), minY: y0 - .5, maxY: y0 + 3.1, kind: 'glass'});}
      box(0, W, -.12, .02, 3.05, STOREY, 0x22262a);
      const signTex = canvasTex(1024, 192, (g, w, h) => {g.fillStyle = '#132016';g.fillRect(0, 0, w, h);g.fillStyle = '#ffd25a';g.font = 'bold 104px Georgia, serif';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText('OSLO CAMPING', w / 2, 82);g.font = 'bold 40px Arial';g.fillStyle = '#9fe0a8';g.fillText('MINIGOLF · BAR', w / 2, 158);});
      // A plane's front (+z) turned to face the way (dx, dz): rotation.y = atan2(dx, dz).
      const face = (a0, b0) => {const p = FB(0, 0, 0), q = FB(a0, b0, 0);return Math.atan2(q[0] - p[0], q[2] - p[2]);};
      const sign = new T.Mesh(new T.PlaneGeometry(6.5, 1.2), new T.MeshBasicMaterial({map: signTex}));sign.position.set(...FB(W / 2 - 1.2, -.13, 3.5));sign.rotation.y = face(0, -1);C.group.add(sign);
      if (B && world.facadeFill) world.facadeFill(B, nt.P0, nt.P1, y0 + STOREY);
      if (B && B.top) box(0, W, 0, D, B.top - y0 + .02, B.top - y0 + .1, 0x4a4b4d);
      // A ramp from the door down to the pavement when the floor is higher than the street there.
      {
        let rl = 1.2, rise = 0;for (let it = 0; it < 3; it++) {const e = WB(door.a, -rl);rise = y0 - H(e.x, e.z);rl = Math.max(1.2, Math.abs(rise) / .22);}
        {const e = WB(door.a, -rl);rise = y0 - H(e.x, e.z);}
        if (rise > .06) G.quad(FB(dA - .1, 0, 0), FB(dB + .1, 0, 0), FB(dB + .1, -rl, -rise), FB(dA - .1, -rl, -rise), 0x9c9a94, up);
        const o = WB(door.a, 0), v = wpt(0, 1), v0 = wpt(0, 0), vx = v.x - v0.x, vz = v.z - v0.z, grad = rise / rl;
        floors.push({name: 'Oslo Camping entrance', points: rectW(dA - .1, dB + .1, -rl, 0), y: y0, slope: {x: vx * grad, z: vz * grad, origin: {x: o.x, z: o.z}}, surfaceKind: 'stone', ceilingHeight: Infinity});
      }
      // The stair down: 18 risers along +b; railings round the opening upstairs, the space under it closed downstairs.
      {
        const n = 18, run = (st.b1 - st.b0) / n, rise = BASEMENT / n;
        for (let k = 0; k < n; k++) box(st.a0, st.a1, st.b0 + k * run, st.b0 + (k + 1) * run, -rise * (k + 1) - .05, -rise * (k + 1) + .0, 0x6e4d2e);
        G.hexa((i, j, k) => FB(i ? st.a1 : st.a0, st.b0 + (k ? st.b1 - st.b0 : 0), j ? (k ? BS - .05 : -.05) - .02 : (k ? BS : -.3) - .25), 0x2a2b2d);
        const v = wpt(0, 1), v0 = wpt(0, 0), g = -BASEMENT / (st.b1 - st.b0), o = WB(st.a0, st.b0);
        floors.push({name: 'Oslo Camping stair', points: rectW(st.a0, st.a1, st.b0, st.b1), y: y0, slope: {x: (v.x - v0.x) * g, z: (v.z - v0.z) * g, origin: {x: o.x, z: o.z}}, surfaceKind: 'wood', ceilingHeight: 4});
        box(st.a0 - .06, st.a0, st.b0, st.b1, 0, 1.0, 0x1d1f22, Gm);box(st.a0 - .06, st.a1, st.b1, st.b1 + .06, 0, 1.0, 0x1d1f22, Gm);
        obstacles.push({points: rectW(st.a0 - .1, st.a0, st.b0, st.b1 + .1), minY: y0 - .2, maxY: y0 + 1.1, kind: 'rail'}, {points: rectW(st.a0 - .1, st.a1 + .05, st.b1, st.b1 + .1), minY: y0 - .2, maxY: y0 + 1.1, kind: 'rail'});
        box(st.a0 - .05, st.a0, st.b0, st.b1, BS, -.25, 0x203024);// downstairs: the wall beside the stair
        for (let k = 0; k < 6; k++) {const b0 = st.b0 + k * .7, b1 = b0 + .7, yLow = -BASEMENT * Math.min(1, (b1 - st.b0) / (st.b1 - st.b0));if (yLow - .35 < BS + .3) break;obstacles.push({points: rectW(st.a0 - .05, st.a1 + .05, b0, b1), minY: y0 + BS - .2, maxY: y0 + yLow - .35, kind: 'stair'});}// .35 under the steps: someone on the stair just past a piece stands lower than its top
      }
      // The bar counter (camping-style planks), the back bar with bottles and taps, the bartender, the stools.
      const ct = plan.counter;
      box(ct.a0 + .9, ct.a1, ct.b0, ct.b1, 0, 1.05, 0x8a5a33);box(ct.a0 + .82, ct.a1 + .06, ct.b0 - .06, ct.b1 + .06, 1.05, 1.11, 0xc79b62);
      box(.05, .45, ct.b0, ct.b1, 0, 2.3, 0x3a2717);for (const y of [1.0, 1.45, 1.9]) box(.05, .5, ct.b0 + .1, ct.b1 - .1, y, y + .03, 0xc79b62);
      const bottleCols = [0x2f6b2a, 0x7a2a1d, 0xd8c25a, 0x1f3f7a, 0x9a6b2a, 0xe8e8e0];
      for (const y of [1.03, 1.48, 1.93]) for (let b = ct.b0 + .25, i = 0; b < ct.b1 - .2; b += .19, i++) box(.2, .3, b - .04, b + .04, y, y + .28, bottleCols[(i + Math.round(y * 7)) % 6], Gg);
      for (let i = 0; i < 4; i++) box(ct.a0 + 1.0, ct.a0 + 1.08, ct.b0 + 2.2 + i * .45, ct.b0 + 2.28 + i * .45, 1.11, 1.45, 0xd0d4d8, Gm);
      obstacles.push({points: rectW(ct.a0, ct.a1 + .06, ct.b0 - .06, ct.b1 + .06), minY: y0 - .2, maxY: y0 + 1.15, kind: 'bar'}, {points: rectW(0, .5, ct.b0, ct.b1), minY: y0 - .2, maxY: y0 + 2.3, kind: 'bar'});
      obstacles.push({points: rectW(0, ct.a0 + .9, ct.b0 - .3, ct.b0), minY: y0 - .2, maxY: y0 + 1.1, kind: 'bar'});
      for (let i = 0; i < 6; i++) {const b = ct.b0 + .5 + i * 1.05, cx = ct.a1 + .38;box(cx - .17, cx + .17, b - .17, b + .17, .72, .78, 0x8a2f24);box(cx - .03, cx + .03, b - .03, b + .03, 0, .72, 0x222222, Gm);}
      const neon = canvasTex(512, 128, (g, w, h) => {g.fillStyle = '#000';g.fillRect(0, 0, w, h);g.shadowColor = '#ff6a3d';g.shadowBlur = 24;g.fillStyle = '#ffb08a';g.font = 'bold 84px Arial';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText('🏕 BAR', w / 2, 70);});
      const nm = new T.Mesh(new T.PlaneGeometry(1.8, .45), new T.MeshBasicMaterial({map: neon, transparent: true, blending: T.AdditiveBlending, depthWrite: false}));nm.position.set(...FB(.08, (ct.b0 + ct.b1) / 2, 2.75));nm.rotation.y = face(1, 0);C.group.add(nm);
      C.barLocal = (a, b) => WB(a, b);
      if (avatars) {const av = avatars.avatar(3, 'Bartender', 0x2f4a34);const p = FB(.95, (ct.b0 + ct.b1) / 2, 0);av.group.position.set(...p);const f = FB(2, (ct.b0 + ct.b1) / 2, 0);av.group.rotation.y = Math.atan2(-(f[0] - p[0]), -(f[2] - p[2])) + Math.PI;C.group.add(av.group);av.pose({stance: 'stand'});C.staff = av;C.staffYaw = av.group.rotation.y;}
      const hb = new T.Mesh(new T.BoxGeometry(.8, .8, ct.b1 - ct.b0), new T.MeshBasicMaterial({visible: false}));hb.position.set(...FB(ct.a1 - .3, (ct.b0 + ct.b1) / 2, 1.2));hb.rotation.y = Math.atan2(-(FB(1, 0, 0)[2] - FB(0, 0, 0)[2]), FB(1, 0, 0)[0] - FB(0, 0, 0)[0]);hb.userData = {golfBar: C, noMerge: true};C.group.add(hb);hitboxes.push(hb);
      C.barSpot = WB(ct.a1 + .45, (ct.b0 + ct.b1) / 2 + .13);// between two stools, in the aisle along the counter
      // Picnic tables by the window, camping chairs and a tent in the back, string lights under the black ceiling.
      const picnic = (a, b, yb) => {box(a - .9, a + .9, b - .4, b + .4, yb + .72, yb + .77, 0xa5763f);for (const s of [-1, 1]) box(a - .9, a + .9, b + s * .62 - .14, b + s * .62 + .14, yb + .42, yb + .46, 0xa5763f);for (const s of [-.75, .75]) box(a + s - .04, a + s + .04, b - .7, b + .7, yb, yb + .72, 0x6d4c2b);obstacles.push({points: rectW(a - .95, a + .95, b - .8, b + .8), minY: y0 + yb - .2, maxY: y0 + yb + .8, kind: 'table'});};
      for (const a of [1.6, 4.6, 7.6, 10.6]) picnic(a, 1.8, 0);
      for (const a of [1.6, 4.6]) picnic(a, 16.8, 0);
      const tent = (a, b, yb, hex) => {const w = 1.1, h = 1.5, l = 1.8;for (const s of [-1, 1]) G.quad(FB(a - l / 2, b + s * w, yb), FB(a + l / 2, b + s * w, yb), FB(a + l / 2, b, yb + h), FB(a - l / 2, b, yb + h), hex, null);G.tri(FB(a + l / 2, b - w, yb), FB(a + l / 2, b + w, yb), FB(a + l / 2, b, yb + h), shade(hex, .8), null);obstacles.push({points: rectW(a - l / 2, a + l / 2, b - w, b + w), minY: y0 + yb - .2, maxY: y0 + yb + h, kind: 'tent'});};
      tent(8.4, 17.0, 0, 0xe46a1f);tent(9.6, 17.6, BS, 0x2f7d6a);// downstairs clear of the way from the stair (a 12.5)
      const lights = (yb, yc) => {for (let r = 0; r < 4; r++) for (let a = .6; a < W - .4; a += .55) {const b = 1.5 + r * (D - 3) / 3 + Math.sin(a * 1.7) * .25, y = yc - .25 - Math.abs(Math.sin(a * .9)) * .12, c = FB(a, b, y), s = .03;Gg.hexa((i, j, k) => [c[0] + (i ? s : -s), c[1] + (j ? s : -s), c[2] + (k ? s : -s)], [0xffe7a8, 0xffc76b, 0xfff1d0][(r + Math.round(a * 2)) % 3], false);}};
      lights(0, STOREY);lights(BS, -.25);
      // Downstairs ("SKOGEN" when the course is cleared away): pine trees between the walls, a sign, benches.
      for (const [a, b] of [[2.2, 10.0], [5.6, 12.4], [9.0, 9.6], [3.4, 15.8], [7.2, 16.6], [11.4, 11.6]]) {box(a - .09, a + .09, b - .09, b + .09, BS, BS + .9, 0x5b3d24);const n = 8;for (let k = 0; k < n; k++) {const t0 = k / n * Math.PI * 2, t1 = (k + 1) / n * Math.PI * 2, r = .7;for (const [yy, rr] of [[.7, r], [1.4, r * .75], [2.05, r * .5]]) G.tri(FB(a + Math.cos(t0) * rr, b + Math.sin(t0) * rr, BS + yy), FB(a + Math.cos(t1) * rr, b + Math.sin(t1) * rr, BS + yy), FB(a, b, BS + yy + .9), 0x23552e, null);}obstacles.push({points: rectW(a - .5, a + .5, b - .5, b + .5), minY: y0 + BS - .2, maxY: y0 + BS + 2.4, kind: 'tree'});}
      const skogen = canvasTex(512, 128, (g, w, h) => {g.fillStyle = '#0d1a10';g.fillRect(0, 0, w, h);g.fillStyle = '#7fd38b';g.font = 'bold 86px Georgia, serif';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText('SKOGEN', w / 2, 68);});
      const sk = new T.Mesh(new T.PlaneGeometry(2.4, .6), new T.MeshBasicMaterial({map: skogen}));sk.position.set(...FB(W / 2, D - .06, BS + 2.3));sk.rotation.y = face(0, -1);C.group.add(sk);
      const menuTex = canvasTex(512, 640, (g, w, h) => {g.fillStyle = '#1b130c';g.fillRect(0, 0, w, h);g.fillStyle = '#f3e3c2';g.textAlign = 'center';g.font = 'bold 46px Georgia';g.fillText('Oslo Camping', w / 2, 64);g.font = '30px Arial';g.textAlign = 'left';
        BAR_MENU.forEach((it, i) => {g.fillText(it.name, 34, 140 + i * 50);g.textAlign = 'right';g.fillText(`${it.price},-`, w - 34, 140 + i * 50);g.textAlign = 'left';});
        g.fillText(`Minigolf 18 hull`, 34, 140 + BAR_MENU.length * 50 + 20);g.textAlign = 'right';g.fillText(`${d.price.adult},-`, w - 34, 140 + BAR_MENU.length * 50 + 20);g.textAlign = 'center';g.font = '22px Arial';g.fillText('20 år etter kl. 19 · Legitimasjon', w / 2, h - 30);});
      const menuB = new T.Mesh(new T.PlaneGeometry(1.0, 1.25), new T.MeshStandardMaterial({map: menuTex, roughness: .8}));menuB.position.set(...FB(.07, ct.b1 + .9, 1.9));menuB.rotation.y = nm.rotation.y;C.group.add(menuB);
      for (const [b, m] of [[G, vc], [Gm, vcMetal], [Gg, glow]]) {const mesh = b.mesh(m, 'Oslo Camping');if (mesh) {if (b === Gg) mesh.castShadow = false;C.group.add(mesh);}}
      C.cutRect = rectW(st.a0, st.a1, st.b0, st.b1);C.notchRect = rectW(0, W, 0, D);
      // The lanes: 11 upstairs, 7 downstairs; felt on raised wooden frames.
      const list = [...plan.up.map(l => ({...l, y: 0})), ...plan.down.map(l => ({...l, y: BS}))].map((l, i) => ({n: i + 1, kind: d.order[i], par: d.pars[i], a: l.a, b: l.b, dir: l.dir, floor: l.y, L: plan.L, W: plan.lw}));
      lanesFor(C, list, (l) => {
        const o = WB(l.a, l.b), p1 = WB(l.a, l.b + l.dir), p2 = WB(l.a - l.dir, l.b), Wu = [p1.x - o.x, p1.z - o.z], Wv = [p2.x - o.x, p2.z - o.z], yb = y0 + l.floor + .12;
        const world_ = (u, v, y) => ({x: o.x + Wu[0] * u + Wv[0] * v, y: yb + y, z: o.z + Wu[1] * u + Wv[1] * v});
        return {y0: yb, Wu, Wv, o, world: world_, F: (u, v, y) => {const p = world_(u, v, y);return [p.x - G0.x, p.y - G0.y, p.z - G0.z];}, groundY: () => -.12,
          toLane: (x, z) => {const dx = x - o.x, dz = z - o.z;return [dx * Wu[0] + dz * Wu[1], dx * Wv[0] + dz * Wv[1]];}};
      });
    }

    // ---------- Build them all ----------
    const COURSES = (data && data.courses) || [];
    COURSES.forEach((d, ci) => {
      if (d.kind === 'bar' && !d.local) return;// the Møllergata patch is missing: no bar
      const C = {data: d, index: ci, group: new T.Group(), lanes: [], paid: false};C.group.name = `Minigolf · ${d.name}`;group.add(C.group);
      if (d.kind === 'bar') buildBar(C);
      else {
        const first = d.rows[0], o = world.toWorld(first.x, first.s);C.origin = {x: o.x, y: H(o.x, o.z), z: o.z};C.group.position.set(C.origin.x, C.origin.y, C.origin.z);
        lanesFor(C, courseLanes(d), outdoorFrame(C));fenceAndPark(C);
      }
      C.centre = (() => {const ps = C.lanes.map(l => l.world(l.L / 2, 0, 0));return {x: ps.reduce((a, p) => a + p.x, 0) / ps.length, z: ps.reduce((a, p) => a + p.z, 0) / ps.length};})();
      C.game = makeGame(C);courses.push(C);
    });

    // ---------- Playing a round ----------
    const hud = typeof document !== 'undefined' ? (() => {const h = document.createElement('div');h.id = 'golfHud';h.className = 'game-card';h.hidden = true;(hudRoot || document.body).append(h);return h;})() : null;
    const card = typeof document !== 'undefined' ? (() => {const h = document.createElement('div');h.id = 'golfCard';h.hidden = true;(hudRoot || document.body).append(h);return h;})() : null;
    const ball = new T.Mesh(ballGeo, ballMat);ball.castShadow = true;ball.visible = false;ball.name = 'Minigolf ball';group.add(ball);
    // Aim line: 14 dashes along the lane surface (a dynamic ribbon).
    const DASH = 14, aimGeo = new T.BufferGeometry(), aimPos = new Float32Array(DASH * 6 * 3);aimGeo.setAttribute('position', new T.BufferAttribute(aimPos, 3));
    const aimLine = new T.Mesh(aimGeo, new T.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: .8, depthWrite: false, side: T.DoubleSide}));aimLine.frustumCulled = false;aimLine.visible = false;aimLine.renderOrder = 3;group.add(aimLine);
    const ping = t => {const x = t % 2;return x < 1 ? x : 2 - x;};
    function scoreRow(C, R) {
      const pars = C.lanes.map(l => l.par);
      return C.lanes.map((l, i) => {const s = R.card.scores[i], cls = s === null ? (i === R.i ? 'now' : '') : s < pars[i] ? 'u' : s > pars[i] ? 'o' : '';return `<span class="${cls}${i === R.i && s === null ? ' now' : ''}">${s === null ? (i === R.i ? '•' : '·') : s}</span>`;}).join('');
    }
    function showCard(C, R) {
      if (!card) return;
      const pars = C.lanes.map(l => l.par), n = pars.length, half = n > 9 ? Math.ceil(n / 2) : n;
      const part = (a, b) => `<tr><th>Hole</th>${pars.slice(a, b).map((_, i) => `<th>${a + i + 1}</th>`).join('')}<th>${b === n && a ? 'In' : n > 9 ? 'Out' : 'Total'}</th></tr><tr><td>Par</td>${pars.slice(a, b).map(p => `<td>${p}</td>`).join('')}<td>${pars.slice(a, b).reduce((x, y) => x + y, 0)}</td></tr><tr><td>You</td>${R.card.scores.slice(a, b).map((s, i) => `<td class="${s === null ? '' : s < pars[a + i] ? 'u' : s > pars[a + i] ? 'o' : ''}">${s ?? '–'}</td>`).join('')}<td>${R.card.scores.slice(a, b).reduce((x, y) => x + (y || 0), 0)}</td></tr>`;
      const vs = R.card.vsPar;
      card.innerHTML = `<h2>⛳ ${C.data.name}</h2><small>${C.data.address}</small><table>${part(0, half)}${n > 9 ? part(half, n) : ''}</table><b>Total ${R.card.total} · par ${R.card.parPlayed} · ${vs > 0 ? '+' : ''}${vs}</b>${R.best ? ' · <b>New best!</b>' : ''}<br><small>✕ / ○ / Space close</small>`;
      card.hidden = false;
    }
    function makeGame(C) {
      const g = {name: C.data.name, music: 'minigolf', active: false, course: C};
      let R = null;
      // game-main reads g.walk (as for disc golf): between holes R2 does not charge and □ takes you to the next tee.
      Object.defineProperty(g, 'walk', {get: () => R && R.walk != null ? R.walk : null});
      const teeSpot = l => l.world(-.45, 0, 0);
      const standFor = (l, b, aim) => {const su = b.u - Math.cos(aim) * .32 - Math.sin(aim) * .22 * 0, sv = b.v - Math.sin(aim) * .32;const p = l.world(su, sv + .28, l.hole.h(clamp(b.u, 0, l.L), clamp(b.v, -l.W / 2, l.W / 2)));return p;};
      g.nearLane = p => {let best = null;for (const l of C.lanes) {const t = teeSpot(l), d = Math.hypot(p.x - t.x, p.z - t.z);if (d < 1.7 && Math.abs(p.y - (l.y0 - .12)) < 1.4 && (!best || d < best.d)) best = {l, d};}return best && best.l;};
      g.near = p => {if (g.active) return null;const l = g.nearLane(p);return l ? `□ Play minigolf · ${C.data.short} · hole ${l.n} (par ${l.par})` : null;};
      function beginHole(i) {
        const l = C.lanes[i];R.i = i;R.walk = null;R.ball = newBall(l.hole);R.strokes = 0;R.aim = Math.atan2(l.hole.cup[1] - l.hole.tee[1], l.hole.cup[0] - l.hole.tee[0]);R.phase = 'aim';R.meter = 0;R.held = false;R.cam = null;R.lastYaw = null;
        R.msg = `Hole ${l.n} · ${l.hole.name} · par ${l.par}`;const s = standFor(l, R.ball, R.aim);
        return {teleport: {x: s.x, z: s.z, y: l.y0 - .12, yaw: worldYaw(l, R.aim)}};
      }
      // Lane angle <-> the game's yaw (forward = (-sin yaw, -cos yaw) in world x, z).
      const worldYaw = (l, a) => {const dx = l.Wu[0] * Math.cos(a) + l.Wv[0] * Math.sin(a), dz = l.Wu[1] * Math.cos(a) + l.Wv[1] * Math.sin(a);return Math.atan2(-dx, -dz);};
      g.start = p => {
        const l = g.nearLane(p) || C.lanes[0];g.active = true;
        R = {card: new Scorecard(C.lanes.map(x => x.par)), first: l.n - 1, i: l.n - 1, t: now(), acc: 0, lastYaw: null, end: 0};
        const r = beginHole(l.n - 1);return {x: r.teleport.x, z: r.teleport.z, y: r.teleport.y, yaw: r.teleport.yaw};
      };
      g.stop = () => {g.active = false;R = null;ball.visible = false;aimLine.visible = false;if (hud) hud.hidden = true;if (card) card.hidden = true;C.paid = C.data.price.adult === 0;};
      // Behind the tee of the lane you are on: back on the path between the lanes.
      const offLane = () => {const l = C.lanes[R.i], t = teeSpot(l);return {x: t.x, z: t.z, y: l.y0 - .12, yaw: worldYaw(l, Math.PI)};};
      const nextIndex = () => {const n = C.lanes.length;for (let k = 1; k <= n; k++) {const j = (R.i + k) % n;if (R.card.scores[j] === null) return j;}return -1;};
      function finishHole(score, holed) {
        const l = C.lanes[R.i], s = R.card.write(R.i, score, holed), name = holed ? scoreName(s, l.par) : 'Max 7';
        R.msg = `Hole ${l.n}: ${s} stroke${s > 1 ? 's' : ''} · ${name}`;R.phase = 'holed';R.wait = 2.2;
        if (holed && s === 1) {audio && audio.sfx('cheer');hooks.earn && hooks.earn(50, `Hole in one at ${C.data.short}, hole ${l.n}`);}
        else if (holed && s < l.par) audio && audio.sfx('cheer');
        hooks.onEvent && hooks.onEvent('minigolf-hole', {course: C.data.name, hole: l.n, strokes: s, par: l.par});
      }
      g.update = (dt, input, camera) => {
        if (!g.active || !R) return null;
        const out = {};
        if (R.phase === 'card') {
          R.end -= dt;if (R.end <= 0 || input.cancel || input.skip || input.release) {const m = R.doneMsg, t = offLane();g.stop();return {done: m, teleport: t};}
          return {lock: true, camera: R.camView};
        }
        if (input.cancel) {const m = `Minigolf stopped after ${R.card.played} hole${R.card.played === 1 ? '' : 's'} (${R.card.total} strokes).`, t = offLane();g.stop();return {done: m, teleport: t};}
        const l = C.lanes[R.i], hole = l.hole, b = R.ball;
        // Walking to the next tee (the minimap shows it); □ takes you straight there.
        if (R.walk !== null && R.walk !== undefined) {
          const n = C.lanes[R.walk], t = teeSpot(n), at = input.at || t, d = Math.hypot(at.x - t.x, at.z - t.z);R.toTee = d;
          if (input.skip || (d < 1.2 && Math.abs((at.y ?? t.y) - (n.y0 - .12)) < 1.6)) return beginHole(R.walk);
          R.msg = `Walk to the tee of hole ${n.n} (${Math.round(d)} m) – □ takes you there`;render(0);return {walk: true};
        }
        // Aim: the right stick / mouse turn the aim (as they turn you), the left stick fine-tunes it.
        if (R.lastYaw === null) R.lastYaw = input.aimYaw;
        // k: +1 or -1 so that turning right (yaw down) turns the aim to the right on screen whichever way the lane's frame is drawn.
        if (R.phase === 'aim') {const k = Math.sign(Math.atan2(Math.sin(worldYaw(l, .01) - worldYaw(l, 0)), Math.cos(worldYaw(l, .01) - worldYaw(l, 0)))) || 1;R.aim += ((input.aimYaw - R.lastYaw) - (input.hyzer || 0) * .55 * dt) * k;}
        R.lastYaw = input.aimYaw;
        const t = now();
        if (R.phase === 'aim') {
          // The putt uses the power the meter showed when you let go (a slow frame does not add to it).
          const held = input.charge > 0, shown = R.power || 0;if (held && !R.held) R.meter = 0;if (held) R.meter += dt;R.held = held;
          R.power = held ? ping(R.meter / 1.5) : 0;
          if (input.release) {
            const p = shown * (1 + gauss() * .06 * (input.drunk || 0)), a = R.aim + gauss() * .02 * (input.drunk || 0);
            putt(b, a, clamp(p, .01, 1));R.strokes++;R.phase = 'roll';R.meter = 0;R.held = false;R.t = t;R.acc = 0;audio && audio.sfx('putt', {gain: .4 + p * .6});
            R.msg = `Stroke ${R.strokes}`;
          }
        } else if (R.phase === 'roll') {
          R.acc = Math.min(R.acc + dt, .12);
          while (R.acc >= SUB && b.moving) {
            for (const e of step(b, hole, R.t, SUB)) {
              if (e.kind === 'wall') audio && audio.sfx('golfWall', {gain: Math.min(1, e.speed / 2.5)});
              else if (e.kind === 'lip') {audio && audio.sfx('golfLip');R.msg = e.over ? 'Too fast – over the hole' : 'Lipped out!';}
              else if (e.kind === 'cup') audio && audio.sfx('golfCup');
              else if (e.kind === 'water') {audio && audio.sfx('splash', {gain: .5});R.strokes++;R.msg = 'In the water: one stroke penalty, play again from where you were';}
              else if (e.kind === 'mill') audio && audio.sfx('thud', {gain: .5});
              else if (e.kind === 'loop') audio && audio.sfx('golfLoop');
              else if (e.kind === 'loopFail') R.msg = 'Not enough speed for the loop';
            }
            R.acc -= SUB;R.t += SUB;
          }
          if (!b.moving) {
            if (b.holed) finishHole(R.strokes, true);
            else if (Scorecard.over(R.strokes, false)) finishHole(MAX_SCORE, false);
            else {R.phase = 'aim';R.aim = Math.atan2(hole.cup[1] - b.v, hole.cup[0] - b.u);out.face = worldYaw(l, R.aim);R.lastYaw = out.face;}
          }
        } else if (R.phase === 'holed') {
          R.wait -= dt;
          if (R.wait <= 0) {
            ball.visible = false;const j = nextIndex();
            if (j < 0) {
              const total = R.card.total, par = R.card.par;R.best = !!(hooks.onEvent && hooks.onEvent('minigolf-round', {course: C.data.name, total, par, holes: C.lanes.length}));
              if (total <= par && hooks.earn) hooks.earn(100, `${C.data.short}: a round at or under par`);
              audio && audio.sfx(total <= par ? 'cheer' : 'coin');
              R.doneMsg = `${C.data.name}: ${total} strokes, par ${par} (${total - par >= 0 ? '+' : ''}${total - par}).`;R.phase = 'card';R.end = 9;showCard(C, R);if (hud) hud.hidden = true;C.paid = C.data.price.adult === 0;
              return {lock: true, camera: R.camView};
            }
            const t = offLane();R.walk = j;return {teleport: t};// off the lane first (you stood on it to putt), then walk
          }
        }
        // Ball, aim line, camera.
        const bp = ballY(b, hole), bw = l.world(bp.u, b.loop ? 0 : b.v, bp.y);ball.visible = true;ball.position.set(bw.x, bw.y, bw.z);
        if (R.phase === 'aim') {
          const len = .5 + 1.9 * (R.held ? R.power : .35), du = Math.cos(R.aim), dv = Math.sin(R.aim), nu = -dv * .012, nv = du * .012;
          for (let k = 0; k < DASH; k++) {
            const s0 = .06 + len * k / DASH, s1 = s0 + len / DASH * .55, P = (s, o) => {const u = b.u + du * s + nu * o, v = b.v + dv * s + nv * o, w = l.world(u, v, hole.h(clamp(u, 0, l.L), clamp(v, -l.W / 2, l.W / 2)) + .006);return [w.x - group.position.x, w.y, w.z - group.position.z];};
            const q = [P(s0, -1), P(s1, -1), P(s1, 1), P(s0, -1), P(s1, 1), P(s0, 1)];q.forEach((p, i) => aimPos.set(p, (k * 6 + i) * 3));
          }
          aimGeo.attributes.position.needsUpdate = true;aimLine.visible = true;
        } else aimLine.visible = false;
        const up = l.y0, fwd = [Math.cos(R.aim), Math.sin(R.aim)];
        let eye, look;
        if (input.alt) {const m = l.world(l.L * .5, 0, 0);eye = l.world(-l.L * .35, 0, l.L * .95);look = m;}
        else if (R.phase === 'aim' || R.phase === 'holed') {eye = l.world(b.u - fwd[0] * 1.25, b.v - fwd[1] * 1.25, hole.h(clamp(b.u, 0, l.L), clamp(b.v, -l.W / 2, l.W / 2)) + .85);look = l.world(b.u + fwd[0] * 1.4, b.v + fwd[1] * 1.4, 0);}
        else {
          const sp = Math.hypot(b.vu, b.vv) || 1, du = b.vu / sp, dv = b.vv / sp;eye = l.world(b.u - du * 1.1, b.v - dv * 1.1, bp.y + .7);look = bw;
        }
        if (!R.cam) R.cam = {x: eye.x, y: eye.y, z: eye.z};const k = 1 - Math.exp(-dt * (R.phase === 'roll' ? 4 : 8));
        R.cam.x += (eye.x - R.cam.x) * k;R.cam.y += (eye.y - R.cam.y) * k;R.cam.z += (eye.z - R.cam.z) * k;
        out.camera = {x: R.cam.x, y: R.cam.y, z: R.cam.z, lookAt: new T.Vector3(look.x, look.y, look.z)};R.camView = out.camera;
        // You stand beside the ball (others in the lobby see you there).
        if (R.phase === 'aim') {const s = standFor(l, b, R.aim);out.stand = {x: s.x, z: s.z, y: up - .12 + Math.max(0, hole.h(clamp(b.u, 0, l.L), clamp(b.v, -l.W / 2, l.W / 2)))};}
        out.lock = true;render(R.phase === 'aim' && R.held ? R.power : 0);
        return out;
      };
      function render(power) {
        if (!hud || !R) return;
        const l = C.lanes[R.walk ?? R.i];hud.hidden = false;
        hud.innerHTML = `<b>⛳ ${C.data.short} · hole ${l.n} of ${C.lanes.length} · par ${l.par}</b><span>${R.walk != null ? `Total ${R.card.total} (${R.card.vsPar > 0 ? '+' : ''}${R.card.vsPar})` : `Stroke ${R.strokes + (R.phase === 'aim' ? 1 : 0)} · total ${R.card.total} (${R.card.vsPar > 0 ? '+' : ''}${R.card.vsPar})`}</span>`
          + `<div class="pw"><i style="width:${Math.round(power * 100)}%"></i></div><small>${R.msg || ''}</small><div class="row">${scoreRow(C, R)}</div>`
          + `<small>Aim: right stick / mouse (left stick fine) · hold R2 / left mouse, let go to putt · L2 / right mouse: whole lane · ○ / C quit</small>`;
      }
      g.layout = () => {
        if (!g.active || !R) return null;
        const loc = p => {const q = world.toLocal(p.x, p.z);return [q.x, q.s];};
        if (!C.plan) C.plan = null;
        return {name: C.data.name, outline: (C.data.outline || C.data.fredshuset).flat(), holes: C.lanes.map(l => ({n: l.n, tee: loc(l.world(.45, 0, 0)), basket: loc(l.world(l.hole.cup[0], l.hole.cup[1], 0))})), current: R.walk ?? R.i, walking: R.walk != null, lie: null, distance: 0};
      };
      g.net = () => {if (!g.active || !R || R.walk != null || R.phase === 'card') return null;const r = v => Math.round(v * 100) / 100;return [C.index, R.i + 1, r(ball.position.x), r(ball.position.y), r(ball.position.z)];};
      g.state = () => R && {hole: R.i + 1, strokes: R.strokes, phase: R.phase, power: R.power || 0, held: R.held, walk: R.walk, aim: R.aim, ball: {...R.ball}, card: R.card.scores.slice(), total: R.card.total, vsPar: R.card.vsPar};
      return g;
    }

    // ---------- Prompts: the kiosks, the bar, the tees ----------
    const KR = v => `${v} kr`;
    function prompt(p, look) {
      const u = (look && look.userData) || {};
      for (const C of courses) {
        if (Math.hypot(p.x - C.centre.x, p.z - C.centre.z) > 60) continue;
        if (C.data.kind === 'bar' && (u.golfBar === C || (C.barSpot && Math.hypot(p.x - C.barSpot.x, p.z - C.barSpot.z) < 1.4 && Math.abs(p.y - C.floorY) < 1))) return {text: '□ The bar: drinks, toast and minigolf tickets', act: () => openBar(C)};
        if (C.ticketAt && (u.golfTicket === C || Math.hypot(p.x - C.ticketAt.x, p.z - C.ticketAt.z) < 1.6)) {
          return C.paid ? {text: `You have a ticket for ${C.data.short} · start at any tee`, act: () => {}} : {text: `□ Buy a round of minigolf · ${KR(C.data.price.adult)} (children ${KR(C.data.price.child)})`, act: () => buyRound(C)};
        }
        const l = C.game.nearLane(p);
        if (l) {
          if (!C.paid && C.data.price.adult > 0) return {text: `Minigolf · ${C.data.short}: buy a ticket first (${C.data.kind === 'bar' ? 'at the bar' : 'at the kiosk'}, ${KR(C.data.price.adult)})`, act: () => hooks.notice && hooks.notice(C.data.kind === 'bar' ? 'Tickets are sold at the bar.' : 'Tickets are sold at the kiosk by the entrance.', 3)};
          return {text: `□ Play minigolf · ${C.data.short} · hole ${l.n} (par ${l.par})`, act: () => hooks.start && hooks.start(C.game)};
        }
      }
      return null;
    }
    function buyRound(C) {
      if (!hooks.pay || !hooks.pay(C.data.price.adult)) {say(C, `Det koster ${C.data.price.adult} kroner – det har du ikke.`);hooks.notice && hooks.notice(`Not enough money: a round costs ${KR(C.data.price.adult)}.`, 3);return false;}
      C.paid = true;audio && audio.sfx('register');say(C, C.data.kind === 'bar' ? 'Værsågod, kølle og ball! Hull 1 er ved vinduet.' : 'Værsågod! Kølle og ball – god runde!');hooks.notice && hooks.notice(`Paid ${KR(C.data.price.adult)} for a round at ${C.data.short}. Go to any tee and press □.`, 4);return true;
    }
    const say = (C, t) => {if (C.staff) C.staff.say(t);};
    function openBar(C) {
      if (!hooks.menu) return;
      hooks.menu.show({title: () => `🏕 Oslo Camping · bar · ${hooks.money ? KR(Math.round(hooks.money())) : ''}`, note: () => `${C.data.hours} · 20 years after 19:00`,
        items: () => [...BAR_MENU.map(it => ({label: `${it.name} · ${KR(it.price)}`, sub: it.group ? `Alcohol (group ${it.group}) · +30 s drunk` : it.drunk < 0 ? 'Sobers you up a little' : 'No alcohol', act: () => buyDrink(C, it)})),
          {label: C.paid ? 'You have a minigolf ticket' : `A round of minigolf, 18 holes · ${KR(C.data.price.adult)}`, sub: `Students ${KR(C.data.price.student)}, children ${KR(C.data.price.child)} · 11 holes up here, 7 downstairs`, done: C.paid, act: () => buyRound(C)}]});
    }
    function buyDrink(C, it) {
      const r = serving(new Date(), it, {open: C.data.open, drunk: hooks.drunk ? hooks.drunk() : 0});
      if (!r.ok) {
        const line = {closed: ['Vi har stengt nå – kom tilbake i åpningstiden.', `Oslo Camping is closed now (${C.data.hours}).`], hours: [it.group === 3 ? 'Brennevin serverer vi først fra klokka 13.' : 'Skjenkingen er stengt nå.', it.group === 3 ? 'No spirits before 13:00 (alcohol act § 4-4, Oslo).' : 'No alcohol served between 03:00 and 06:00 (alcohol act § 4-4).'], drunk: ['Nei du, nå har du fått nok. Vil du ha en brus?', 'The bartender will not serve you: you are obviously drunk (alcohol act § 8-11). Try a soda or a toast.']}[r.why];
        say(C, line[0]);hooks.notice && hooks.notice(line[1], 5);audio && audio.sfx('locked');return;
      }
      if (!hooks.pay || !hooks.pay(it.price)) {say(C, 'Kortet ble avvist.');hooks.notice && hooks.notice(`Not enough money (${KR(it.price)}).`, 3);return;}
      audio && audio.sfx('register');say(C, ['Skål!', 'Værsågod!', 'Kos deg!'][Math.floor(Math.random() * 3)]);hooks.drink && hooks.drink(it);
    }

    // ---------- Each frame: the windmills turn, the staff look at you, far courses are hidden ----------
    function tick(dt, camera, player) {
      const t = now();
      for (const d of dynamic) d.spin.rotation.x = (t / d.mill.period) % 1 * Math.PI * 2;
      for (const C of courses) {
        const dist = Math.hypot(camera.position.x - C.centre.x, camera.position.z - C.centre.z);C.group.visible = dist < (C.data.kind === 'bar' ? 450 : 260);// the bar's shop front fills the notch in Fredshuset, so it stays
        if (C.staff && dist < 40) {
          const s = C.staff.group, wp = s.getWorldPosition(new T.Vector3()), want = Math.atan2(-(player.x - wp.x), -(player.z - wp.z)) - (C.group.rotation.y || 0);
          let d = want - s.rotation.y;d = Math.atan2(Math.sin(d), Math.cos(d));s.rotation.y += d * Math.min(1, dt * 2.5);C.staff.pose({stance: 'stand', speed: 0, dt});C.staff.update(dt, camera);
        }
      }
    }
    const bar = courses.find(C => C.data.kind === 'bar');
    const inRect = (r, x, z) => insidePoly([x, z], r.map(p => [p.x, p.z]));
    function inside(x, z, feet) {
      if (!bar) return null;
      if (!inRect(bar.notchRect, x, z)) return null;
      if (feet > bar.floorY - .6 && feet < bar.floorY + STOREY) return {floor: 0};
      if (feet > bar.floorY - BASEMENT - .6 && feet <= bar.floorY - .6) return {floor: -1};
      return null;
    }
    return {group, floors, obstacles, hitboxes, courses, games: courses.map(C => C.game), prompt, buyRound, openBar, buyDrink, tick, inside,
      cutsGround: (x, z) => !!bar && inRect(bar.cutRect, x, z),
      lampAt: (x, z, feet) => {const i = inside(x, z, feet);if (!i) return null;const c = bar.plan, p = (a, b) => {const q = world.toWorld(...barLocal(bar.data.local, a, b));return q;}, q = p(c.W / 2, c.D / 2);return {x: q.x, y: bar.floorY + (i.floor ? -1.0 : 3.2), z: q.z, power: 30, reach: 18};},
      placeName: (x, z, feet) => {const i = inside(x, z, feet);if (i) return i.floor ? 'Oslo Camping, downstairs · Møllergata 12' : 'Oslo Camping · Møllergata 12';for (const C of courses) if (C.data.outline && insidePoly((q => [q.x, q.s])(world.toLocal(x, z)), C.data.outline)) return C.data.name;return null;},
      poi: () => courses.map(C => {const q = world.toLocal(C.centre.x, C.centre.z);return {x: q.x, s: q.s, color: '#2e7d32', label: C.data.kind === 'bar' ? 'Oslo Camping (minigolf bar)' : `Minigolf · ${C.data.short}`, glyph: '⛳', course: C.data.name};}),
      // Places parked vehicles and bike racks must keep free (game-main's fleet): every lane, the gates, the ticket tables, the bar's door.
      keepClear: () => [...courses.flatMap(C => C.lanes.map(l => ({...l.world(l.L / 2, 0, 0), r: l.L / 2 + 1.2}))),
        ...courses.filter(C => C.ticketAt).map(C => ({...C.ticketAt, r: 3})), ...courses.filter(C => C.data.gate).map(C => ({...world.toWorld(...C.data.gate), r: 3})),
        ...courses.filter(C => C.barLocal).map(C => ({...C.barLocal(C.plan.door.a, -2), r: 5}))],
      remoteBall: () => {const m = new T.Mesh(ballGeo, remoteBallMat);m.name = 'Remote minigolf ball';return m;},
      get active() {return courses.map(C => C.game).find(g => g.active) || null;}};
  }

  return {KINDS, holeDef, compile, newBall, putt, puttSpeed, step, simulate, ballY, millBlocked, loopNeed, Scorecard, scoreName, serving, isOpen, BAR_MENU, DRUNK_LIMIT,
    courseLanes, laneCorners, laneToLocal, insidePoly, barPlan, barLocal, prepare, create, BALL_R, CUP_R, V_CAP, MAX_SCORE, MAX_PUTT, MIN_PUTT, BASEMENT, STOREY, SUB, ROLL};
});
