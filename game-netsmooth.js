/* Smooth poses for vehicles driven by other players (issue #135). Pure (Node-tested in tests/netsmooth.test.cjs).
 * The driver sends its vehicle's state about 12 times a second with its own time stamp (performance.now(), ms, appended to
 * the state array). The receiver keeps the last few samples and shows the vehicle a short, adaptive delay in the past,
 * interpolated between the two samples around that moment: the result moves smoothly whatever the network's jitter is.
 * GameNetSmooth.layout(n, aircraft) -> a channel string for a state array of length n:
 *   'l' linear, 'a' angle (wrapped), 'q' quaternion (4 channels, slerp), 's' step (never eased).
 *   Ground vehicles: x y z, yaw pitch roll, speed, extras (steering, lean ...); aircraft: x y z, quaternion, speed spin throttle, grounded.
 * new GameNetSmooth.Track(layout, opts)
 *   push(sample, stamp, arrival): stamp = the driver's clock (s) or null (then the arrival time stands in); arrival = local s.
 *   sample(now) -> reused array (the pose to show now, local s) or null before the first sample.
 *   newest: the last raw sample (a copy) · count · delay (s) · reset().
 * The render clock: the driver's clock maps to ours by `off` = the smallest (arrival − stamp) in the last `window` samples (the
 * fastest trip); the render time is now − off − delay, where delay = the largest recent gap between samples + the largest
 * recent extra trip time + `margin`, clamped to [minDelay, maxDelay]. The render clock runs at our frame time and is nudged
 * toward that target by at most ±`slew` (10 %), so a new estimate never makes the vehicle jump. Past the newest sample it
 * extrapolates with the last velocity for at most `extrapolate` s, then holds. A sample that changes the pose being shown
 * (it came late, during extrapolation) does not snap it: the difference is eased out over `blend` s.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameNetSmooth = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const DEFAULTS = {minDelay: .08, maxDelay: .18, margin: .02, extrapolate: .2, slew: .1, gain: 2, window: 24, size: 12, teleport: 25, blend: .12, pause: .5};
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function layout(n, aircraft) {
    if (aircraft) return ('lllqqqqlll' + 's'.repeat(Math.max(0, n - 10))).slice(0, n);
    return ('lllaaal' + 'l'.repeat(Math.max(0, n - 7))).slice(0, n);
  }

  // Slerp of the quaternions at a[i..i+3] and b[i..i+3] into out[i..i+3] (shortest way, normalised).
  function slerp(a, b, i, f, out) {
    let ax = a[i], ay = a[i + 1], az = a[i + 2], aw = a[i + 3], bx = b[i], by = b[i + 1], bz = b[i + 2], bw = b[i + 3];
    let d = ax * bx + ay * by + az * bz + aw * bw;if (d < 0) {d = -d;bx = -bx;by = -by;bz = -bz;bw = -bw;}
    let ka = 1 - f, kb = f;
    if (d < .9995) {const th = Math.acos(Math.min(1, d)), s = Math.sin(th);ka = Math.sin((1 - f) * th) / s;kb = Math.sin(f * th) / s;}
    let x = ax * ka + bx * kb, y = ay * ka + by * kb, z = az * ka + bz * kb, w = aw * ka + bw * kb;const l = Math.hypot(x, y, z, w) || 1;
    out[i] = x / l;out[i + 1] = y / l;out[i + 2] = z / l;out[i + 3] = w / l;
  }

  class Track {
    constructor(lay, opts = {}) {
      this.lay = lay;this.n = lay.length;this.o = Object.assign({}, DEFAULTS, opts);const N = this.o.size, W = this.o.window;
      this.buf = Array.from({length: N}, () => new Float64Array(this.n));this.ts = new Float64Array(N);
      this.gaps = new Float64Array(W);this.trips = new Float64Array(W);
      this.out = new Array(this.n).fill(0);this.err = new Float64Array(this.n);this.tmpA = new Float64Array(this.n);this.tmpB = new Float64Array(this.n);
      this.reset();
    }
    reset() {this.count = 0;this.head = -1;this.stats = 0;this.off = null;this.delay = this.o.minDelay + .04;this.renderT = null;this.lastNow = null;this.stamped = false;this.err.fill(0);}
    idx(k) {return (this.head - k + this.o.size * 2) % this.o.size;}// k = 0 newest, 1 the one before, ...
    get newest() {return this.count ? Array.from(this.buf[this.head]) : null;}
    // The pose at render time t (no blend) into out.
    evalAt(t, out) {
      const lay = this.lay, n = this.n, N = this.buf[this.head];
      if (t >= this.ts[this.head]) {
        let e = 0, P = null, span = 0;
        if (this.count > 1) {const p = this.idx(1);P = this.buf[p];span = this.ts[this.head] - this.ts[p];e = Math.min(t - this.ts[this.head], this.o.extrapolate);}
        const go = P && span > 1e-4 && span < this.o.pause;
        for (let j = 0; j < n; j++) {const c = lay[j];out[j] = go && (c === 'l' || c === 'a') ? N[j] + (c === 'a' ? wrap(N[j] - P[j]) : N[j] - P[j]) / span * e : N[j];}
        return out;
      }
      let k = 1;for (; k < this.count; k++) if (this.ts[this.idx(k)] <= t) break;
      if (k >= this.count) {const A = this.buf[this.idx(this.count - 1)];for (let j = 0; j < n; j++) out[j] = A[j];return out;}// older than all
      const ia = this.idx(k), ib = this.idx(k - 1), A = this.buf[ia], B = this.buf[ib], f = (t - this.ts[ia]) / Math.max(1e-6, this.ts[ib] - this.ts[ia]);
      for (let j = 0; j < n; j++) {
        const c = lay[j];
        if (c === 'l') out[j] = A[j] + (B[j] - A[j]) * f;
        else if (c === 'a') out[j] = A[j] + wrap(B[j] - A[j]) * f;
        else if (c === 'q') {slerp(A, B, j, f, out);j += 3;}
        else out[j] = f < 1 ? A[j] : B[j];
      }
      return out;
    }
    push(sample, stamp, arrival) {
      const o = this.o;
      const own = stamp != null && isFinite(stamp);
      if (!own) stamp = this.stamped && this.off != null ? arrival - this.off : arrival;// no stamp (an older game): where it would be
      if (this.count) {
        const last = this.ts[this.head], L = this.buf[this.head];
        if (stamp <= last) {if (last - stamp > 1) this.reset();else stamp = last + .001;}// the driver's game restarted / same time
        if (this.count && Math.hypot(sample[0] - L[0], sample[1] - L[1], sample[2] - L[2]) > o.teleport) this.reset();// a respawn or a new lobby
      }
      if (own) this.stamped = true;
      // How the shown pose changes because of this sample (only while extrapolating): eased out, not snapped.
      const blend = this.count && this.renderT != null && this.renderT > this.ts[this.head];
      if (blend) this.evalAt(this.renderT, this.tmpA);
      const gap = this.count ? stamp - this.ts[this.head] : 0;
      this.head = (this.head + 1) % o.size;const B = this.buf[this.head];for (let j = 0; j < this.n; j++) B[j] = sample[j];this.ts[this.head] = stamp;this.count = Math.min(o.size, this.count + 1);
      if (blend) {
        this.evalAt(this.renderT, this.tmpB);const lay = this.lay;
        for (let j = 0; j < this.n; j++) if (lay[j] === 'l') this.err[j] += this.tmpA[j] - this.tmpB[j];else if (lay[j] === 'a') this.err[j] = wrap(this.err[j] + this.tmpA[j] - this.tmpB[j]);
        if (Math.hypot(this.err[0], this.err[1], this.err[2]) > o.teleport) this.err.fill(0);
      }
      // Clock mapping and delay from the last `window` samples.
      const w = this.stats % o.window;this.trips[w] = arrival - stamp;this.gaps[w] = gap > 0 && gap < o.pause ? gap : 0;this.stats++;
      const m = Math.min(this.stats, o.window);let off = Infinity, maxGap = 0, maxTrip = -Infinity;
      for (let i = 0; i < m; i++) {off = Math.min(off, this.trips[i]);maxGap = Math.max(maxGap, this.gaps[i]);maxTrip = Math.max(maxTrip, this.trips[i]);}
      this.off = off;this.delay = clamp(maxGap + (maxTrip - off) + o.margin, o.minDelay, o.maxDelay);
    }
    sample(now) {
      if (!this.count) return null;
      const o = this.o, target = now - this.off - this.delay, dt = this.lastNow == null ? 0 : clamp(now - this.lastNow, 0, .25);this.lastNow = now;
      if (this.renderT == null) this.renderT = target;
      else {this.renderT += dt;const e = target - this.renderT;if (Math.abs(e) > .5) this.renderT = target;else this.renderT += clamp(e * o.gain, -o.slew, o.slew) * dt;}
      const out = this.evalAt(this.renderT, this.out), k = Math.exp(-dt / o.blend), lay = this.lay;
      for (let j = 0; j < this.n; j++) if (lay[j] === 'l' || lay[j] === 'a') {out[j] += this.err[j];this.err[j] *= k;}
      return out;
    }
  }
  return {layout, Track, DEFAULTS, slerp};
});
