/* Procedural soundtrack (Web Audio API, no sound files). Every track is composed here as notes and synthesised live,
 * scheduled bar by bar a little ahead of time, and loops seamlessly.
 *   main      "Torshov Evening" – calm lo-fi / ambient (electric piano, pad, soft bass, brushed drums, bells), D major,
 *                                  72 bpm, 45 bars = exactly 150 s (2.5 minutes)
 *   discgolf  "Fairway Breeze"  – breezy acoustic guitar picking, shaker, claps, whistled tune, G major, 96 bpm, 32 bars = 80 s
 *   petanque  "Café du parc"    – French musette waltz (accordion, oom-pah-pah, mandolin), A minor / C major, 160 bpm 3/4,
 *                                  64 bars = 72 s
 *   mission   "Stairwell"       – tense pulse ostinato, drone, heartbeat kick, strings, low brass, D minor, 100 bpm,
 *                                  32 bars = 76.8 s
 *   minigolf  "Putting Green Swing" – swing with walking bass, brushes, ride, electric piano, whistle and bells, F major,
 *                                  120 bpm, AABA 32 bars = 64 s (issue #114; also plays inside Oslo Camping)
 * Records for the LP player in Rathkes gate 1C (issue #116; GameMusic.records): lp1 "Søndagsjazz" (jazz trio, 73.8 s),
 * lp2 "Bossa på Løkka" (bossa nova, 72.7 s), lp3 "Lavalampe" (soul and disco, 68.6 s), lp4 "Fjellvise" (folk waltz, 80 s).
 * GameMusic.create() -> {attach(audioContext), play(name|null), setVolume(0..1), volume, current, position(),
 *   recordPlay(name, pos, needle), recordStop(fade), recordOutput (GainNode to route), record, duck(0..1), context}
 * GameMusic.tracks -> {name: {title, artist, style, record, bpm, beats, bars, seconds}}
 * GameMusic.renderOffline(name, seconds) -> Promise<AudioBuffer> (tests and previews)
 */
(function (root, factory) {
  root.GameMusic = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  function mulberry32(a) {return function () {a |= 0;a = a + 0x6D2B79F5 | 0;let t = Math.imul(a ^ a >>> 15, 1 | a);t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;return ((t ^ t >>> 14) >>> 0) / 4294967296;};}

  // ---------- Instruments ----------
  function makeKit(ctx) {
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const osc = (type, f, t) => {const o = ctx.createOscillator();o.type = type;o.frequency.setValueAtTime(f, t);return o;};
    const gain = v => {const g = ctx.createGain();g.gain.value = v;return g;};
    const filt = (type, f, q = .7) => {const b = ctx.createBiquadFilter();b.type = type;b.frequency.value = f;b.Q.value = q;return b;};
    const noise = (t, dur) => {const s = ctx.createBufferSource();s.buffer = noiseBuf;s.start(t, Math.random() * 1.5);s.stop(t + dur);return s;};
    // Every voice goes to the track's dry bus and, scaled, to its reverb bus.
    function send(node, bus, wet) {node.connect(bus.dry);if (wet) {const g = gain(wet);node.connect(g);g.connect(bus.wet);}}
    // Attack to a level, hold, then release (linear ramps: no clicks, and they always reach zero).
    function hold(p, t, level, attack, dur, release) {p.setValueAtTime(0, t);p.linearRampToValueAtTime(level, t + attack);p.setValueAtTime(level, t + Math.max(attack, dur));p.linearRampToValueAtTime(0, t + Math.max(attack, dur) + release);}
    return {
      // Rhodes-like electric piano: two-operator FM with a decaying index plus a short tine.
      epiano(bus, t, m, dur, vel = .5) {
        const f = mtof(m), car = osc('sine', f, t), mod = osc('sine', f, t), mg = gain(0), amp = gain(0), tine = osc('sine', f * 4.02, t), tg = gain(0);
        mg.gain.setValueAtTime(f * (.3 + 1.4 * vel), t);mg.gain.setTargetAtTime(f * .12, t, .35);mod.connect(mg).connect(car.frequency);
        tg.gain.setValueAtTime(.16 * vel, t);tg.gain.setTargetAtTime(0, t, .05);tine.connect(tg).connect(amp);car.connect(amp);
        const p = amp.gain, pk = .1 * vel;p.setValueAtTime(0, t);p.linearRampToValueAtTime(pk, t + .005);p.setTargetAtTime(pk * .35, t + .005, .5);p.setTargetAtTime(0, t + dur, .12);
        send(amp, bus, .35);const end = t + dur + .9;[car, mod, tine].forEach(o => {o.start(t);o.stop(end);});
      },
      // Warm detuned-saw pad behind a slowly opening low-pass.
      pad(bus, t, m, dur, vel = .5, bright = 900) {
        const f = mtof(m), lp = filt('lowpass', bright * .5, .4), amp = gain(0);
        lp.frequency.setValueAtTime(bright * .5, t);lp.frequency.linearRampToValueAtTime(bright, t + dur * .5);lp.frequency.linearRampToValueAtTime(bright * .6, t + dur + 1.2);
        const os = [-7, 7].map(c => {const o = osc('sawtooth', f * Math.pow(2, c / 1200), t);o.connect(lp);return o;});
        lp.connect(amp);hold(amp.gain, t, .028 * vel, Math.min(1.2, dur * .4), dur, 1.4);
        send(amp, bus, .6);os.forEach(o => {o.start(t);o.stop(t + dur + 1.5);});
      },
      bass(bus, t, m, dur, vel = .5) {
        const f = mtof(m), o1 = osc('sine', f, t), o2 = osc('triangle', f * 2, t), g2 = gain(.18), lp = filt('lowpass', 520), amp = gain(0);
        o1.connect(lp);o2.connect(g2).connect(lp);lp.connect(amp);
        const p = amp.gain;p.setValueAtTime(0, t);p.linearRampToValueAtTime(.24 * vel, t + .012);p.setTargetAtTime(.17 * vel, t + .012, .25);p.setValueAtTime(.17 * vel, t + dur);p.linearRampToValueAtTime(0, t + dur + .08);
        send(amp, bus, 0);[o1, o2].forEach(o => {o.start(t);o.stop(t + dur + .15);});
      },
      kick(bus, t, vel = .6) {
        const o = osc('sine', 120, t), amp = gain(0);o.frequency.exponentialRampToValueAtTime(42, t + .12);
        amp.gain.setValueAtTime(.55 * vel, t);amp.gain.setTargetAtTime(0, t + .02, .09);o.connect(amp);send(amp, bus, 0);o.start(t);o.stop(t + .6);
      },
      brush(bus, t, vel = .5) {const n = noise(t, .35), bp = filt('bandpass', 2600, .6), amp = gain(0);n.connect(bp).connect(amp);amp.gain.setValueAtTime(0, t);amp.gain.linearRampToValueAtTime(.09 * vel, t + .006);amp.gain.setTargetAtTime(0, t + .01, .07);send(amp, bus, .25);},
      hat(bus, t, vel = .4, open = false) {const n = noise(t, open ? .45 : .12), hp = filt('highpass', 7500), amp = gain(0);n.connect(hp).connect(amp);amp.gain.setValueAtTime(.05 * vel, t);amp.gain.setTargetAtTime(0, t + .002, open ? .08 : .018);send(amp, bus, .1);},
      shaker(bus, t, vel = .4) {const n = noise(t, .12), bp = filt('bandpass', 6500, 1.2), amp = gain(0);n.connect(bp).connect(amp);amp.gain.setValueAtTime(0, t);amp.gain.linearRampToValueAtTime(.06 * vel, t + .015);amp.gain.setTargetAtTime(0, t + .02, .025);send(amp, bus, .1);},
      clap(bus, t, vel = .5) {const bp = filt('bandpass', 1300, .9), amp = gain(0);bp.connect(amp);for (let i = 0; i < 3; i++) noise(t + i * .011, .02).connect(bp);amp.gain.setValueAtTime(.12 * vel, t);amp.gain.setTargetAtTime(0, t + .03, .05);send(amp, bus, .3);},
      // Soft mallet bell / celesta.
      bell(bus, t, m, dur, vel = .5) {
        const f = mtof(m), o1 = osc('sine', f, t), o2 = osc('sine', f * 4, t), g2 = gain(0), amp = gain(0);
        g2.gain.setValueAtTime(.3, t);g2.gain.setTargetAtTime(0, t, .06);o1.connect(amp);o2.connect(g2).connect(amp);
        amp.gain.setValueAtTime(0, t);amp.gain.linearRampToValueAtTime(.075 * vel, t + .003);amp.gain.setTargetAtTime(0, t + .003, Math.min(.6, dur * .5 + .15));
        send(amp, bus, .45);[o1, o2].forEach(o => {o.start(t);o.stop(t + dur + 2.5);});
      },
      // Plucked steel string (guitar, mandolin): bright attack that darkens quickly.
      pluck(bus, t, m, dur, vel = .5) {
        const f = mtof(m), o = osc('sawtooth', f, t), o2 = osc('triangle', f * 1.003, t), lp = filt('lowpass', 3200, 1.5), amp = gain(0);
        lp.frequency.setValueAtTime(800 + 3200 * vel, t);lp.frequency.setTargetAtTime(f * 1.5 + 200, t, .07);
        o.connect(lp);o2.connect(lp);lp.connect(amp);amp.gain.setValueAtTime(0, t);amp.gain.linearRampToValueAtTime(.1 * vel, t + .003);amp.gain.setTargetAtTime(0, t + .003, Math.min(.45, dur * .4));
        send(amp, bus, .3);[o, o2].forEach(x => {x.start(t);x.stop(t + dur + 2);});
      },
      // Whistled melody: sine with a small scoop into the note and delayed vibrato.
      whistle(bus, t, m, dur, vel = .5) {
        const f = mtof(m), o = osc('sine', f * .985, t), lfo = osc('sine', 5.2, t), lg = gain(0), amp = gain(0);
        o.frequency.linearRampToValueAtTime(f, t + .05);lg.gain.setValueAtTime(0, t);lg.gain.linearRampToValueAtTime(f * .007, t + Math.min(.5, dur));lfo.connect(lg).connect(o.frequency);
        o.connect(amp);hold(amp.gain, t, .055 * vel, .04, Math.max(.05, dur - .05), .08);
        send(amp, bus, .4);[o, lfo].forEach(x => {x.start(t);x.stop(t + dur + .2);});
      },
      // Musette accordion: three reeds (one flat, one sharp, one in tune) beating against each other.
      accordion(bus, t, m, dur, vel = .5) {
        const f = mtof(m), lp = filt('lowpass', 2600, .8), pk = filt('peaking', 1200, 1), amp = gain(0);pk.gain.value = 4;
        const os = [['sawtooth', -14, .5], ['sawtooth', 13, .5], ['square', 0, .25]].map(([ty, c, g]) => {const o = osc(ty, f * Math.pow(2, c / 1200), t), gg = gain(g);o.connect(gg).connect(lp);return o;});
        lp.connect(pk).connect(amp);hold(amp.gain, t, .085 * vel, .025, Math.max(.03, dur - .04), .05);
        send(amp, bus, .25);os.forEach(o => {o.start(t);o.stop(t + dur + .1);});
      },
      drone(bus, t, m, dur, vel = .5) {
        const f = mtof(m), o = osc('sawtooth', f, t), s = osc('sine', f / 2, t), lp = filt('lowpass', 160, 2), amp = gain(0), sg = gain(.8);
        lp.frequency.setValueAtTime(140, t);lp.frequency.linearRampToValueAtTime(280, t + dur / 2);lp.frequency.linearRampToValueAtTime(140, t + dur);
        o.connect(lp);s.connect(sg).connect(amp);lp.connect(amp);hold(amp.gain, t, .1 * vel, .6, dur, .8);
        send(amp, bus, .3);[o, s].forEach(x => {x.start(t);x.stop(t + dur + .9);});
      },
      // Resonant saw pulse for the ostinato.
      pulse(bus, t, m, dur, vel = .5, cut = 1400) {
        const f = mtof(m), o = osc('sawtooth', f, t), lp = filt('lowpass', cut, 7), amp = gain(0);
        lp.frequency.setValueAtTime(cut, t);lp.frequency.setTargetAtTime(220, t, .05);o.connect(lp).connect(amp);
        amp.gain.setValueAtTime(0, t);amp.gain.linearRampToValueAtTime(.05 * vel, t + .004);amp.gain.setTargetAtTime(0, t + .01, dur * .35);
        send(amp, bus, .2);o.start(t);o.stop(t + dur + .3);
      },
      strings(bus, t, m, dur, vel = .5) {
        const f = mtof(m), lp = filt('lowpass', 1600, .5), amp = gain(0), lfo = osc('sine', 4.8, t), lg = gain(f * .004);lfo.connect(lg);
        const os = [-9, 0, 9].map(c => {const o = osc('sawtooth', f * Math.pow(2, c / 1200), t);lg.connect(o.frequency);o.connect(lp);return o;});
        lp.connect(amp);hold(amp.gain, t, .018 * vel, Math.min(1, dur * .5), dur, 1);
        send(amp, bus, .5);[...os, lfo].forEach(o => {o.start(t);o.stop(t + dur + 1.1);});
      },
      // Low brass swell ("braam").
      braam(bus, t, m, dur, vel = .5) {
        const lp = filt('lowpass', 120, 3), amp = gain(0);lp.frequency.setValueAtTime(120, t);lp.frequency.linearRampToValueAtTime(900, t + .5);lp.frequency.setTargetAtTime(150, t + .6, dur * .4);
        const os = [0, 12, 7, -12].map((iv, i) => {const o = osc('sawtooth', mtof(m + iv) * (1 + (i - 1.5) * .002), t);o.connect(lp);return o;});
        lp.connect(amp);amp.gain.setValueAtTime(0, t);amp.gain.linearRampToValueAtTime(.065 * vel, t + .25);amp.gain.setTargetAtTime(0, t + dur * .6, dur * .3);
        send(amp, bus, .5);os.forEach(o => {o.start(t);o.stop(t + dur + 1.5);});
      },
      tom(bus, t, m, vel = .5) {
        const o = osc('sine', mtof(m) * 1.6, t), amp = gain(0);o.frequency.exponentialRampToValueAtTime(mtof(m), t + .15);o.connect(amp);
        amp.gain.setValueAtTime(.3 * vel, t);amp.gain.setTargetAtTime(0, t + .02, .14);send(amp, bus, .35);o.start(t);o.stop(t + .9);
      },
      // A few vinyl crackles per bar (lo-fi character).
      crackle(bus, t, len, rnd, vel = .5) {
        const hp = filt('highpass', 2500, .5), amp = gain(.03 * vel);hp.connect(amp);send(amp, bus, 0);
        const n = 3 + Math.floor(rnd() * 5);for (let i = 0; i < n; i++) noise(t + rnd() * len, .0025).connect(hp);
      }
    };
  }
  // Notes as [beat, midi, beats]; plays them with one instrument.
  function line(k, bus, voice, t, beat, notes, vel, shift = 0) {notes.forEach(([b, m, d]) => k[voice](bus, t + b * beat, m + shift, d * beat, vel));}

  // ---------- Open world: "Torshov Evening" (D major, 72 bpm, 45 bars = 150 s) ----------
  // Intro (4 bars) · A (16) · B with bell melody (16) · A' with a second melody (8) · one bar of pad that leads back to the intro.
  const MAIN = (() => {
    const A = [{b: 38, v: [54, 57, 61, 64]}, {b: 35, v: [57, 61, 62, 66]}, {b: 43, v: [54, 57, 59, 62]}, {b: 45, v: [55, 59, 62, 64]}]; // Dmaj9 Bm9 Gmaj9 A9sus4
    const B = [{b: 43, v: [54, 57, 59, 62]}, {b: 42, v: [57, 61, 64, 66]}, {b: 40, v: [55, 59, 62, 66]}, {b: 45, v: [55, 59, 62, 64]}, // Gmaj9 F#m7 Em9 A9sus4
      {b: 35, v: [57, 61, 62, 66]}, {b: 43, v: [54, 57, 59, 62]}, {b: 40, v: [55, 59, 62, 66]}, {b: 45, v: [55, 59, 61, 66]}]; // Bm9 Gmaj9 Em9 A13
    const MB = [
      [[0, 74, 1.5], [1.5, 76, .5], [2, 78, 1], [3, 76, 1]], [[0, 73, 2], [2.5, 71, .5], [3, 69, 1]],
      [[0, 71, 1], [1, 74, 1], [2, 78, 1.5], [3.5, 76, .5]], [[0, 76, 3], [3, 74, .5], [3.5, 76, .5]],
      [[0, 78, 1.5], [1.5, 81, .5], [2, 78, 1], [3, 76, 1]], [[0, 74, 2], [2, 71, 1], [3, 74, 1]],
      [[0, 76, 1], [1, 74, .5], [1.5, 71, .5], [2, 69, 2]], [[0, 73, 1], [1, 76, 1], [2, 74, 2]]];
    const MA2 = [
      [[0, 69, 1], [1, 73, 1], [2, 76, 2]], [[0, 74, 1.5], [1.5, 73, .5], [2, 71, 2]], [[0, 71, 1], [1, 74, 1], [2, 78, 1], [3, 76, 1]], [[0, 74, 3]],
      [[0, 81, 1.5], [1.5, 78, .5], [2, 76, 1], [3, 73, 1]], [[0, 74, 2], [2, 71, 1], [3, 69, 1]], [[0, 71, 1], [1, 69, 1], [2, 66, 2]], [[0, 69, 4]]];
    return {title: 'Torshov Evening', bpm: 72, beats: 4, bars: 45, render(k, bus, bar, t, beat, rnd) {
      const sec = bar < 4 ? 'intro' : bar < 20 ? 'A' : bar < 36 ? 'B' : bar < 44 ? 'A2' : 'outro', len = beat * 4, sw = beat * .08;
      const ch = sec === 'B' ? B[(bar - 20) % 8] : sec === 'outro' ? A[0] : A[bar % 4];
      const calm = sec === 'intro' || sec === 'outro';
      ch.v.forEach(m => k.pad(bus, t, m, len + .2, calm ? .9 : .6));
      k.crackle(bus, t, len, rnd, .6);
      const strum = (at, d, vel) => ch.v.forEach((m, i) => k.epiano(bus, at + i * .014, m, d, vel));
      if (calm) {strum(t, len * .95, .42);if (sec === 'outro') k.bass(bus, t, ch.b, len * .9, .35);return;}
      strum(t, beat * 1.4, .5);strum(t + beat * 2.5, beat * 1.3, .38);
      if (rnd() < .4) k.epiano(bus, t + beat * 3.5, ch.v[3] + 12, beat * .5, .22);
      k.bass(bus, t, ch.b, beat * 2.3, .55);k.bass(bus, t + beat * 2.5, ch.b + (bar % 2 ? 12 : 7), beat * 1.3, .45);
      if (sec === 'A' && bar < 6) {for (let i = 0; i < 4; i++) k.hat(bus, t + i * beat, .25);}
      else {
        k.kick(bus, t, .6);k.kick(bus, t + beat * 2.5, .5);if (rnd() < .3) k.kick(bus, t + beat * 1.75, .3);
        k.brush(bus, t + beat, .7);k.brush(bus, t + beat * 3, .75);
        for (let i = 0; i < 8; i++) k.hat(bus, t + i * beat / 2 + (i % 2 ? sw : 0), i % 2 ? .3 : .5);
        if (sec === 'B') for (let i = 0; i < 4; i++) if (rnd() < .5) k.hat(bus, t + (i + .75) * beat, .15);
      }
      if (sec === 'A' && bar >= 12) ch.v.concat(ch.v.map(m => m + 12)).forEach((m, i) => k.bell(bus, t + i * beat / 2 + (i % 2 ? sw : 0), m, beat * .5, .2));
      if (sec === 'B') {const mel = MB[(bar - 20) % 8];line(k, bus, 'bell', t, beat, mel, .55);if (bar >= 28) line(k, bus, 'epiano', t, beat, mel, .25, -12);}
      if (sec === 'A2') line(k, bus, 'bell', t, beat, MA2[bar - 36], .45);
    }};
  })();

  // ---------- Disc golf: "Fairway Breeze" (G major, 96 bpm, 32 bars = 80 s) ----------
  const DISC = (() => {
    const C = [{g: [43, 47, 50, 55, 59, 67], bl: [43, 43, 47, 50]}, {g: [42, 50, 54, 57, 62, 66], bl: [42, 42, 45, 50]}, // G, D/F#
      {g: [40, 47, 52, 55, 59, 62], bl: [40, 40, 43, 47]}, {g: [48, 52, 55, 62, 64, 67], bl: [36, 36, 43, 48]}]; // Em7, Cadd9
    const ARP = [0, 2, 3, 4, 5, 4, 3, 2];
    const MEL = [
      [[0, 74, 1], [1, 76, .5], [1.5, 79, 1.5], [3, 76, 1]], [[0, 74, 2], [2, 71, 1], [3, 69, 1]],
      [[0, 71, 1], [1, 74, 1], [2, 76, 1], [3, 79, 1]], [[0, 76, 3], [3, 74, 1]],
      [[0, 79, 1], [1, 81, .5], [1.5, 83, 1.5], [3, 81, 1]], [[0, 78, 2], [2, 76, 1], [3, 74, 1]],
      [[0, 76, 1], [1, 74, 1], [2, 71, 1], [3, 69, 1]], [[0, 67, 4]]];
    return {title: 'Fairway Breeze', bpm: 96, beats: 4, bars: 32, render(k, bus, bar, t, beat, rnd) {
      const ch = C[bar % 4], e = beat / 2;
      ARP.forEach((idx, i) => k.pluck(bus, t + i * e + (i % 2 ? e * .06 : 0), ch.g[idx], beat * 1.5, i === 0 ? .7 : .45 + rnd() * .1));
      if (bar >= 4) for (let i = 0; i < 16; i++) k.shaker(bus, t + i * beat / 4, i % 4 === 2 ? .8 : i % 2 ? .3 : .5);
      if (bar >= 8) {
        [[0, .9, .55], [1.5, .45, .4], [2, .9, .5], [3, .9, .45]].forEach(([b, d, v], i) => k.bass(bus, t + b * beat, ch.bl[i], d * beat, v));
        k.kick(bus, t, .55);k.kick(bus, t + beat * 2, .5);k.clap(bus, t + beat, .5);k.clap(bus, t + beat * 3, .55);
      }
      if (bar >= 16) {line(k, bus, 'whistle', t, beat, MEL[bar % 8], .75);if (bar >= 24) line(k, bus, 'bell', t, beat, MEL[bar % 8], .3);}
      if (bar === 31) k.hat(bus, t + beat * 3.5, .5, true);
    }};
  })();

  // ---------- Petanque: "Café du parc" (musette waltz, 160 bpm 3/4, 64 bars = 72 s) ----------
  const PET = (() => {
    const CH = {Am: {b: [45, 52], v: [57, 60, 64]}, E7: {b: [40, 47], v: [56, 62, 64]}, Dm: {b: [38, 45], v: [57, 62, 65]}, C: {b: [48, 43], v: [55, 60, 64]},
      G7: {b: [43, 50], v: [55, 59, 65]}, F: {b: [41, 48], v: [57, 60, 65]}, A7: {b: [45, 52], v: [55, 61, 64]}};
    const PA = 'Am Am E7 E7 E7 E7 Am Am Dm Dm Am Am E7 E7 Am Am'.split(' '), PB = 'C C G7 G7 G7 G7 C C F F C A7 Dm E7 Am Am'.split(' ');
    const MA = [
      [[0, 76, 1], [1, 77, 1], [2, 76, 1]], [[0, 72, 2], [2, 69, 1]], [[0, 71, 1], [1, 72, 1], [2, 71, 1]], [[0, 68, 2], [2, 64, 1]],
      [[0, 71, 1], [1, 74, 1], [2, 77, 1]], [[0, 76, 1], [1, 74, 1], [2, 71, 1]], [[0, 72, 1], [1, 71, 1], [2, 72, 1]], [[0, 69, 3]],
      [[0, 74, 1], [1, 77, 1], [2, 81, 1]], [[0, 79, 1.5], [1.5, 77, .5], [2, 74, 1]], [[0, 76, 1], [1, 72, 1], [2, 69, 1]], [[0, 72, 1], [1, 76, 1], [2, 81, 1]],
      [[0, 80, 2], [2, 77, 1]], [[0, 76, 1], [1, 74, 1], [2, 71, 1]], [[0, 72, 1], [1, 71, 1], [2, 68, 1]], [[0, 69, 3]]];
    const MBm = [
      [[0, 79, 1], [1, 76, 1], [2, 72, 1]], [[0, 79, 2], [2, 81, 1]], [[0, 79, 1], [1, 77, 1], [2, 74, 1]], [[0, 71, 2], [2, 74, 1]],
      [[0, 77, 1], [1, 76, 1], [2, 74, 1]], [[0, 79, 1], [1, 77, 1], [2, 74, 1]], [[0, 76, 1], [1, 74, 1], [2, 76, 1]], [[0, 72, 3]],
      [[0, 77, 1], [1, 81, 1], [2, 84, 1]], [[0, 81, 2], [2, 77, 1]], [[0, 79, 1], [1, 76, 1], [2, 72, 1]], [[0, 73, 1], [1, 76, 1], [2, 79, 1]],
      [[0, 77, 2], [2, 74, 1]], [[0, 76, 1], [1, 80, 1], [2, 83, 1]], [[0, 81, 1], [1, 76, 1], [2, 72, 1]], [[0, 69, 3]]];
    return {title: 'Café du parc', bpm: 160, beats: 3, bars: 64, render(k, bus, bar, t, beat) {
      const partB = bar >= 32 && bar < 48, i = bar % 16, ch = CH[(partB ? PB : PA)[i]], mel = (partB ? MBm : MA)[i];
      k.bass(bus, t, ch.b[bar % 2], beat * .8, .8);
      for (const bt of [1, 2]) {ch.v.forEach(m => k.accordion(bus, t + bt * beat, m, beat * .42, .3));k.brush(bus, t + bt * beat, .35);}
      line(k, bus, 'accordion', t, beat, mel, .6);
      if (bar >= 16 && bar < 32) line(k, bus, 'pluck', t, beat, mel, .3, 12);
    }};
  })();

  // ---------- Hostage rescue: "Stairwell" (D minor, 100 bpm, 32 bars = 76.8 s) ----------
  const MISSION = (() => {
    const P = [{r: 50, d: 38, cl: [62, 65, 69]}, {r: 46, d: 34, cl: [62, 65, 70]}, {r: 43, d: 31, cl: [62, 67, 70]}, {r: 45, d: 33, cl: [61, 64, 69]}]; // Dm Bb Gm A
    const PAT = [0, 12, 0, 7, 0, 12, 0, 10, 0, 12, 0, 7, 0, 15, 12, 7];
    return {title: 'Stairwell', bpm: 100, beats: 4, bars: 32, render(k, bus, bar, t, beat) {
      const ci = Math.floor(bar / 2) % 4, ch = P[ci], s = beat / 4, len = beat * 4, sec = Math.floor(bar / 8);
      if (bar % 2 === 0) k.drone(bus, t, ch.d, len * 2, .8);
      const cut = 700 + sec * 350 + (bar % 8) * 40, n = bar === 31 ? 8 : 16;
      for (let i = 0; i < n; i++) k.pulse(bus, t + i * s, ch.r + (ci === 3 && PAT[i] === 15 ? 16 : PAT[i]), s * 1.6, i % 4 === 0 ? .8 : .5, cut);
      if (sec >= 1) {
        k.kick(bus, t, .75);k.kick(bus, t + beat * .35, .5);k.kick(bus, t + beat * 2, .7);k.kick(bus, t + beat * 2.35, .45);
        for (let i = 0; i < 8; i++) k.hat(bus, t + i * beat / 2, i % 2 ? .45 : .25);
      }
      if (sec >= 2 && bar % 2 === 0) (sec === 3 ? ch.cl.concat([ch.cl[2] + 1]) : ch.cl).forEach(m => k.strings(bus, t, m, len * 2, .7));
      if (sec >= 2 && bar % 2 === 1) {k.tom(bus, t + beat * 3, 45, .6);k.tom(bus, t + beat * 3.5, 41, .7);}
      if (sec === 3 && bar % 4 === 0) k.braam(bus, t, ch.d + 12, len * 1.5, .8);
    }};
  })();

  // ---------- Minigolf: "Putting Green Swing" (F major, 120 bpm swing, AABA 32 bars = 64 s; issue #114) ----------
  // Walking bass, brushes and a ride cymbal, electric piano comping on the off-beats, a whistled tune with bells over the A parts.
  const GOLF = (() => {
    const C = {F: {b: 41, v: [57, 60, 64, 65], t: 4}, Dm: {b: 38, v: [57, 60, 62, 65], t: 3}, Gm: {b: 43, v: [58, 62, 65, 67], t: 3}, C7: {b: 36, v: [58, 60, 64, 67], t: 4},
      Bb: {b: 46, v: [57, 62, 65, 70], t: 4}, Bbm: {b: 46, v: [58, 61, 65, 67], t: 3}, D7: {b: 38, v: [57, 60, 62, 66], t: 4}};
    const A = 'F Dm Gm C7 F Dm Gm C7'.split(' '), B = 'Bb Bbm F D7 Gm C7 F C7'.split(' ');
    const MA = [
      [[0, 72, .67], [.67, 74, .33], [1, 77, 1], [2, 76, .67], [2.67, 74, .33], [3, 72, 1]], [[0, 69, 1.5], [2, 72, .67], [2.67, 74, .33], [3, 77, 1]],
      [[0, 79, 1], [1, 77, .67], [1.67, 74, .33], [2, 70, 2]], [[0, 72, 2.5], [3, 76, .67], [3.67, 77, .33]],
      [[0, 81, .67], [.67, 79, .33], [1, 77, 1], [2, 74, .67], [2.67, 77, .33], [3, 81, 1]], [[0, 79, 1.5], [2, 77, .67], [2.67, 74, .33], [3, 72, 1]],
      [[0, 74, .67], [.67, 77, .33], [1, 79, .67], [1.67, 77, .33], [2, 74, 1], [3, 70, 1]], [[0, 72, 3]]];
    return {title: 'Putting Green Swing', bpm: 120, beats: 4, bars: 32, render(k, bus, bar, t, beat, rnd) {
      const part = bar < 16 ? 'A' : bar < 24 ? 'B' : 'A', i = bar % 8, name = (part === 'A' ? A : B)[i], ch = C[name], next = C[(part === 'A' ? A : B)[(i + 1) % 8]];
      const sw = beat * .33;// swung eighths: the off-beat comes a third late
      // Walking bass: root, third, fifth, a step into the next chord.
      [ch.b, ch.b + ch.t, ch.b + 7, next.b + (next.b > ch.b ? -1 : 1)].forEach((m, q) => k.bass(bus, t + q * beat, m, beat * .85, q ? .5 : .62));
      // Comping: short chords on the "and" of 2 and on 4.
      for (const at of [1 + .67, 3]) ch.v.forEach((m, j) => k.epiano(bus, t + at * beat + j * .01, m, beat * .45, .28));
      // Ride cymbal (swung), brush on 2 and 4, a soft kick on 1.
      for (let q = 0; q < 4; q++) {k.hat(bus, t + q * beat, .38, q % 2 === 1);if (q % 2 === 1) k.hat(bus, t + q * beat + beat - sw, .2);}
      k.brush(bus, t + beat, .55);k.brush(bus, t + beat * 3, .6);k.kick(bus, t, .35);if (rnd() < .3) k.kick(bus, t + beat * 2.67, .2);
      if (part === 'A' && bar >= 8) {line(k, bus, 'whistle', t, beat, MA[i], .7);if (bar >= 24) line(k, bus, 'bell', t, beat, MA[i], .25);}
      else if (part === 'A' && bar >= 2) line(k, bus, 'bell', t, beat, MA[i], .4);
      if (part === 'B') ch.v.forEach((m, j) => k.pluck(bus, t + j * beat * .5 + (j % 2 ? sw * .5 : 0), m + 12, beat * .5, .32));
    }};
  })();

  // ---------- Records for the LP player in Rathkes gate 1C (issue #116): four original pieces, each with vinyl crackle ----------
  // Swung eighths: an off-beat note (x.5) comes a little late.
  const swing = (b, amt = .16) => Math.abs(b % 1 - .5) < 1e-6 ? b + amt : b;
  function sline(k, bus, voice, t, beat, notes, vel, shift = 0) {notes.forEach(([b, m, d]) => k[voice](bus, t + swing(b) * beat, m + shift, d * beat, vel));}
  const strumAt = (k, bus, voice, t, notes, dur, vel, spread = .012) => notes.forEach((m, i) => k[voice](bus, t + i * spread, m, dur, vel));
  // A bass note near the last one (walking lines stay in one octave).
  const near = (n, r) => {while (n - r > 6) n -= 12;while (r - n > 6) n += 12;return n;};

  // "Søndagsjazz" – Trio Herslebs: a swinging jazz trio (electric piano, walking bass, brushes and ride, vibes melody),
  // F major, 104 bpm, AABA of 8 bars = 32 bars (73.8 s).
  const JAZZ = (() => {
    const C = {Gm9: [43, [58, 62, 65, 69], 3], C13: [36, [58, 62, 64, 69], 4], Fmaj9: [41, [57, 60, 64, 67], 4], Dm9: [38, [57, 60, 64, 65], 3],
      C7b9: [36, [58, 61, 64, 67], 4], F6: [41, [57, 60, 62, 65], 4], Bbmaj7: [46, [57, 62, 65, 69], 4], Eb9: [39, [55, 58, 61, 65], 4],
      Am7: [45, [55, 60, 64, 67], 3], D7b9: [38, [54, 57, 60, 63], 4], Gm7: [43, [58, 62, 65, 67], 3], C7sus: [36, [55, 58, 60, 65], 5]};
    const A = 'Gm9 C13 Fmaj9 Dm9 Gm9 C7b9 F6 F6'.split(' '), B = 'Bbmaj7 Eb9 Am7 D7b9 Gm7 C7b9 F6 C7sus'.split(' ');
    const MA = [[[0, 74, 1.5], [1.5, 72, .5], [2, 70, 1], [3, 69, 1]], [[0, 67, 2], [2.5, 69, .5], [3, 70, 1]], [[0, 72, 1.5], [1.5, 69, .5], [2, 67, 2]], [[0, 69, 3], [3, 65, 1]],
      [[0, 70, 1], [1, 74, 1], [2, 77, 1.5], [3.5, 76, .5]], [[0, 73, 1], [1, 70, 1], [2, 67, 1], [3, 64, 1]], [[0, 65, 1.5], [1.5, 67, .5], [2, 69, 2]], [[0, 65, 3]]];
    const MB = [[[0, 74, 1], [1, 77, 1], [2, 81, 2]], [[0, 79, 1.5], [1.5, 77, .5], [2, 73, 2]], [[0, 76, 1], [1, 72, 1], [2, 79, 2]], [[0, 78, 1.5], [1.5, 75, .5], [2, 72, 2]],
      [[0, 74, 1], [1, 70, 1], [2, 77, 2]], [[0, 76, 2], [2, 70, 1], [3, 72, 1]], [[0, 69, 2], [2, 74, 2]], [[0, 72, 3], [3, 79, 1]]];
    const chordAt = bar => {const sec = Math.floor(bar / 8) % 4, list = sec === 2 ? B : A;return C[list[bar % 8]];};
    return {title: 'Søndagsjazz', artist: 'Trio Herslebs', style: 'jazz trio', bpm: 104, beats: 4, bars: 32, record: true, render(k, bus, bar, t, beat, rnd) {
      const sec = Math.floor(bar / 8), [r, v, third] = chordAt(bar), [nr] = chordAt((bar + 1) % 32);
      k.crackle(bus, t, beat * 4, rnd, .7);
      // Walking bass: root, third, fifth, a step into the next chord.
      const walk = [r, r + third, r + 7, near(nr, r) + (bar % 2 ? 1 : -1)].map(n => n > 55 ? n - 12 : n);
      walk.forEach((n, i) => k.bass(bus, t + i * beat, n, beat * .9, i ? .5 : .6));
      // Comping (the Charleston rhythm, turned round every other bar).
      for (const [b, d, vel] of bar % 2 ? [[1, .5, .3], [2.5, 1.2, .34]] : [[0, .9, .36], [1.5, .4, .28]]) strumAt(k, bus, 'epiano', t + swing(b) * beat, v, d * beat, vel);
      // Ride cymbal (ding, ding-da), brushes on 2 and 4, a soft kick.
      for (const b of [0, 1, 1.5, 2, 3, 3.5]) k.hat(bus, t + swing(b) * beat, b % 1 ? .25 : .38, b === 0 || b === 2);
      k.brush(bus, t + beat, .55);k.brush(bus, t + beat * 3, .6);k.kick(bus, t, .22);
      const mel = (sec === 2 ? MB : MA)[bar % 8];
      if (sec === 1) {sline(k, bus, 'epiano', t, beat, mel, .42, 12);sline(k, bus, 'bell', t, beat, mel, .18);}
      else sline(k, bus, 'bell', t, beat, mel, sec === 3 ? .55 : .5);
    }};
  })();

  // "Bossa på Løkka" – Akerselva Kvartett: bossa nova (nylon-string guitar, bass, shaker and rim, whistled tune), D minor,
  // 132 bpm, intro 8 + AABA = 40 bars (72.7 s).
  const BOSSA = (() => {
    const C = {Dm9: [38, [53, 57, 60, 64]], G13: [43, [53, 57, 59, 64]], Cmaj9: [36, [52, 55, 59, 62]], A7b13: [45, [55, 61, 65, 69]],
      Fmaj7: [41, [57, 60, 64, 65]], Bb9: [46, [56, 60, 62, 65]], Em7b5: [40, [55, 58, 62, 64]], A7: [45, [55, 61, 64, 69]], Gm9: [43, [53, 57, 58, 62]]};
    const A = 'Dm9 Dm9 G13 G13 Cmaj9 Cmaj9 A7b13 A7b13'.split(' '), B = 'Fmaj7 Bb9 Em7b5 A7 Dm9 G13 Gm9 A7b13'.split(' ');
    const MA = [[[0, 69, 1.5], [1.5, 72, .5], [2, 74, 1], [3, 76, 1]], [[0, 77, 3], [3, 76, 1]], [[0, 74, 1], [1, 71, 1], [2, 76, 2]], [[0, 74, 3]],
      [[0, 71, 1.5], [1.5, 74, .5], [2, 76, 1], [3, 79, 1]], [[0, 76, 2], [2, 74, 1], [3, 72, 1]], [[0, 73, 1], [1, 77, 1], [2, 76, 2]], [[0, 73, 3]]];
    const MB = [[[0, 76, 1.5], [1.5, 77, .5], [2, 81, 2]], [[0, 80, 1.5], [1.5, 77, .5], [2, 74, 2]], [[0, 74, 1], [1, 72, 1], [2, 70, 2]], [[0, 73, 2], [2, 76, 2]],
      [[0, 77, 1.5], [1.5, 76, .5], [2, 74, 1], [3, 72, 1]], [[0, 71, 2], [2, 76, 2]], [[0, 74, 1.5], [1.5, 70, .5], [2, 69, 2]], [[0, 73, 1], [1, 76, 1], [2, 77, 2]]];
    return {title: 'Bossa på Løkka', artist: 'Akerselva Kvartett', style: 'bossa nova', bpm: 132, beats: 4, bars: 40, record: true, render(k, bus, bar, t, beat, rnd) {
      const sec = bar < 8 ? 'intro' : bar < 16 ? 'A' : bar < 24 ? 'A2' : bar < 32 ? 'B' : 'A3', [r, v] = C[(sec === 'B' ? B : A)[bar % 8]];
      k.crackle(bus, t, beat * 4, rnd, .7);
      const fifth = r + 7 > 50 ? r - 5 : r + 7;
      for (const [b, n, d] of [[0, r, 1.4], [1.5, r, .4], [2, fifth, 1.4], [3.5, fifth, .4]]) k.bass(bus, t + b * beat, n, d * beat, b % 1 ? .38 : .5);
      // The guitar's two-bar pattern; the rim clicks between its chords.
      const hits = bar % 2 ? [1, 2.5] : [0, 1.5, 3], rim = bar % 2 ? [0, 1.5, 3] : [1, 2.5];
      for (const b of hits) strumAt(k, bus, 'pluck', t + b * beat, v, beat * .5, .32, .008);
      for (const b of rim) k.clap(bus, t + b * beat, .16);
      for (let i = 0; i < 8; i++) k.shaker(bus, t + i * beat / 2, i % 2 ? .35 : .55);
      k.kick(bus, t, .28);k.kick(bus, t + beat * 2, .22);
      if (sec === 'A' || sec === 'A2') {sline(k, bus, 'whistle', t, beat, MA[bar % 8], .7);if (sec === 'A2') sline(k, bus, 'bell', t, beat, MA[bar % 8], .2, 12);}
      if (sec === 'B') sline(k, bus, 'whistle', t, beat, MB[bar % 8], .7);
      if (sec === 'A3') sline(k, bus, 'bell', t, beat, MA[bar % 8], .45);
    }};
  })();

  // "Lavalampe" – Disko Herslebs: seventies soul and disco (four on the floor, octave bass, electric piano stabs, strings,
  // vibes lead), A minor, 112 bpm, 32 bars (68.6 s).
  const DISCO = (() => {
    const C = {Am9: [33, [55, 59, 60, 64], 10], D9: [38, [54, 57, 60, 64], 10], Fmaj7: [41, [53, 57, 60, 64], 7], E7: [40, [56, 59, 62, 67], 10]};
    const A = 'Am9 Am9 D9 D9'.split(' '), B = 'Fmaj7 Fmaj7 E7 E7'.split(' ');
    const LEAD = [[[0, 76, .5], [.5, 79, .5], [1, 81, 1], [2.5, 79, .5], [3, 76, 1]], [[0, 74, .75], [.75, 72, .75], [1.5, 69, 2.5]], [[0, 72, .5], [.5, 74, .5], [1, 76, 1], [2.5, 78, .5], [3, 76, 1]], [[0, 74, 2], [2, 72, 1], [3, 69, 1]],
      [[0, 81, .5], [.5, 84, .5], [1, 83, 1], [2, 81, 1], [3, 79, 1]], [[0, 76, 3], [3, 79, 1]], [[0, 78, 1], [1, 76, .5], [1.5, 74, .5], [2, 72, 1], [3, 74, 1]], [[0, 69, 4]]];
    const RIFF = [[[0, 77, .5], [.5, 76, .5], [1, 72, 1.5]], [], [[0, 74, .5], [.5, 71, .5], [1, 68, 1.5]], []];
    return {title: 'Lavalampe', artist: 'Disko Herslebs', style: 'soul and disco', bpm: 112, beats: 4, bars: 32, record: true, render(k, bus, bar, t, beat, rnd) {
      const sec = bar < 16 ? 'A' : bar < 24 ? 'B' : 'A2', [r, v, step] = C[(sec === 'B' ? B : A)[bar % 4]], e = beat / 2;
      k.crackle(bus, t, beat * 4, rnd, .7);
      [0, 12, 0, 12, 0, 12, step, 12].forEach((o, i) => k.bass(bus, t + i * e, r + o, e * .8, i % 2 ? .42 : .55));
      for (let i = 0; i < 4; i++) {k.kick(bus, t + i * beat, .55);k.hat(bus, t + (i + .5) * beat, .38, true);k.hat(bus, t + (i + .25) * beat, .15);k.hat(bus, t + (i + .75) * beat, .15);}
      k.clap(bus, t + beat, .45);k.clap(bus, t + beat * 3, .5);
      if (bar >= 4) for (const b of [.5, 1.75, 2.5, 3.75]) strumAt(k, bus, 'epiano', t + b * beat, v, beat * .3, .26, .006);
      if (sec === 'B') {v.forEach(m => k.strings(bus, t, m + 12, beat * 4, .55));sline(k, bus, 'bell', t, beat, RIFF[bar % 4], .45);}
      else if (bar % 2 === 1) v.forEach(m => k.strings(bus, t + beat * 3.5, m + 12, beat * .45, .7));
      if (sec === 'A2') sline(k, bus, 'bell', t, beat, LEAD[bar % 8], .55);
      if (sec === 'A' && bar >= 8) sline(k, bus, 'epiano', t, beat, LEAD[bar % 8], .3, -12);
    }};
  })();

  // "Fjellvise" – Rathkes Spellemenn: a folk waltz (plucked strings, drone, whistled tune with a Lydian C#, bells), G major,
  // 3/4, 108 bpm, 48 bars (80 s).
  const FOLK = (() => {
    const C = {G: [43, [55, 59, 62]], C: [36, [55, 60, 64]], Em: [40, [55, 59, 64]], D: [38, [54, 57, 62]], Am: [45, [57, 60, 64]]};
    const A = 'G G C G Em C D G'.split(' '), B = 'C G Am D G Em D G'.split(' '), INTRO = 'G G G G'.split(' '), OUTRO = 'G C G G'.split(' ');
    const MA = [[[0, 74, 1], [1, 76, 1], [2, 78, 1]], [[0, 79, 2], [2, 74, 1]], [[0, 76, 1], [1, 73, 1], [2, 74, 1]], [[0, 71, 3]],
      [[0, 71, 1], [1, 74, 1], [2, 79, 1]], [[0, 76, 2], [2, 72, 1]], [[0, 74, 1], [1, 72, 1], [2, 69, 1]], [[0, 67, 3]]];
    const MB = [[[0, 76, 1], [1, 79, 1], [2, 81, 1]], [[0, 83, 2], [2, 81, 1]], [[0, 81, 1], [1, 79, 1], [2, 76, 1]], [[0, 78, 2], [2, 74, 1]],
      [[0, 79, 1], [1, 78, 1], [2, 79, 1]], [[0, 76, 2], [2, 71, 1]], [[0, 72, 1], [1, 74, 1], [2, 78, 1]], [[0, 79, 3]]];
    const part = bar => bar < 4 ? ['intro', INTRO[bar]] : bar < 12 ? ['A', A[(bar - 4) % 8]] : bar < 20 ? ['A2', A[(bar - 4) % 8]] : bar < 28 ? ['B', B[(bar - 4) % 8]] : bar < 36 ? ['A3', A[(bar - 4) % 8]] : bar < 44 ? ['B2', B[(bar - 4) % 8]] : ['outro', OUTRO[bar - 44]];
    return {title: 'Fjellvise', artist: 'Rathkes Spellemenn', style: 'folk waltz', bpm: 108, beats: 3, bars: 48, record: true, render(k, bus, bar, t, beat, rnd) {
      const [sec, name] = part(bar), [r, v] = C[name], i = (bar - 4) % 8;
      k.crackle(bus, t, beat * 3, rnd, .7);
      if (bar % 2 === 0) {k.pad(bus, t, 55, beat * 6 + .2, .55, 700);k.pad(bus, t, 62, beat * 6 + .2, .45, 700);}
      k.bass(bus, t, r, beat * .9, .62);
      for (const b of [1, 2]) strumAt(k, bus, 'pluck', t + b * beat, v, beat * .45, .34, .01);
      if (bar % 4 === 3) k.shaker(bus, t + beat * 2.5, .4);
      if (sec === 'A' || sec === 'A2') {line(k, bus, 'whistle', t, beat, MA[i], sec === 'A2' ? .6 : .9);if (sec === 'A2') line(k, bus, 'pluck', t, beat, MA[i], .55, 12);}
      if (sec === 'B' || sec === 'B2') {line(k, bus, 'whistle', t, beat, MB[i], .85);if (sec === 'B') line(k, bus, 'bell', t, beat, MB[i], .32);}
      if (sec === 'A3') {line(k, bus, 'bell', t, beat, MA[i], .65);line(k, bus, 'whistle', t, beat, MA[i], .4, -12);}
      if (sec === 'outro' && bar === 47) k.whistle(bus, t, 67, beat * 2.5, .45);
    }};
  })();

  const TRACKS = {main: MAIN, discgolf: DISC, petanque: PET, mission: MISSION, minigolf: GOLF, lp1: JAZZ, lp2: BOSSA, lp3: DISCO, lp4: FOLK};
  const RECORDS = ['lp1', 'lp2', 'lp3', 'lp4'];
  const info = {};
  for (const [name, d] of Object.entries(TRACKS)) info[name] = {title: d.title, artist: d.artist, style: d.style, record: !!d.record, bpm: d.bpm, beats: d.beats, bars: d.bars, seconds: d.bars * d.beats * 60 / d.bpm};
  const barSeed = (name, bar) => mulberry32(bar * 977 + name.length * 31 + 13);

  // Shared output chain: master volume -> gentle compressor -> speakers; one generated hall reverb.
  function chain(ctx, volume) {
    const master = ctx.createGain();master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();comp.threshold.value = -18;comp.ratio.value = 3;comp.attack.value = .01;comp.release.value = .25;
    master.connect(comp).connect(ctx.destination);
    const reverb = ctx.createConvolver(), len = Math.floor(ctx.sampleRate * 3.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {const ch = ir.getChannelData(c);let lp = 0;for (let i = 0; i < len; i++) {lp += ((Math.random() * 2 - 1) - lp) * .35;ch[i] = lp * Math.pow(1 - i / len, 2.6) * (i < 600 ? i / 600 : 1);}}
    reverb.buffer = ir;const wet = ctx.createGain();wet.gain.value = .55;reverb.connect(wet).connect(master);
    return {master, reverb};
  }

  function create() {
    let ctx = null, kit = null, out = null, current = null, volume = .5, duckK = 1;
    const loadVolume = () => {try {const v = localStorage.getItem('haarklous-music-volume-v1');if (v !== null && v !== '') volume = Math.max(0, Math.min(1, +v));} catch {}};
    loadVolume();
    const lanes = {};
    const level = () => volume * .8 * duckK;
    // The record player (issue #116): its own lane into `recOut` (not the soundtrack's master), which the game routes through
    // the room (volume by distance, pan, walls); a small room reverb of its own.
    let rec = null, recOut = null, recVerb = null;
    function attach(c) {
      if (ctx || !c) return;ctx = c;kit = makeKit(ctx);out = chain(ctx, level());
      recOut = ctx.createGain();recVerb = ctx.createConvolver();
      {const len = Math.floor(ctx.sampleRate * 1.1), ir = ctx.createBuffer(2, len, ctx.sampleRate);for (let ch = 0; ch < 2; ch++) {const d = ir.getChannelData(ch);for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3) * (i < 300 ? i / 300 : 1);}recVerb.buffer = ir;const wet = ctx.createGain();wet.gain.value = .35;recVerb.connect(wet).connect(recOut);}
      setInterval(tick, 60);const want = current;current = undefined;play(want);
    }
    // Put a record on: `pos` = seconds into it (it loops); a negative pos = seconds until the music starts, with the needle's
    // thump and crackle from `needle` seconds before that. The music starts on a bar line, so every player is in step.
    function recordPlay(name, pos, needle = 1.4) {
      if (!ctx || !TRACKS[name]) return false;
      recordStop(.08);
      const def = TRACKS[name], beat = 60 / def.bpm, barLen = beat * def.beats, len = def.bars * barLen, now = ctx.currentTime;
      const bus = {dry: ctx.createGain(), wet: ctx.createGain()};bus.dry.connect(recOut);bus.wet.connect(recVerb);
      let bar = 0, startT = now - pos;
      if (pos >= 0) {const p = pos % len;bar = Math.ceil(p / barLen - 1e-6);startT = now + bar * barLen - p;bar %= def.bars;}
      else {const rnd = mulberry32(7), from = Math.max(now, startT - needle);if (startT - needle >= now - .05) kit.kick(bus, from + .02, .18);for (let t = from; t < startT; t += .5) kit.crackle(bus, t, .5, rnd, 1.6);}
      rec = {name, def, bus, bar, nextT: startT, barLen};return true;
    }
    function recordStop(fadeS = .35) {
      if (!rec || !ctx) {rec = null;return;}
      const r = rec, now = ctx.currentTime;rec = null;
      for (const g of [r.bus.dry.gain, r.bus.wet.gain]) {g.cancelScheduledValues(now);g.setValueAtTime(g.value, now);g.linearRampToValueAtTime(0, now + fadeS);}
      setTimeout(() => {try {r.bus.dry.disconnect();r.bus.wet.disconnect();} catch {}}, (fadeS + 3) * 1000);
    }
    // The soundtrack steps back (0..1) while a record or the TV is heard.
    function duck(k) {k = Math.max(0, Math.min(1, k));if (Math.abs(k - duckK) < .01) return;duckK = k;if (out) out.master.gain.setTargetAtTime(level(), ctx.currentTime, .4);}
    function lane(name) {
      if (!lanes[name]) {const dry = ctx.createGain(), wet = ctx.createGain();dry.gain.value = 0;wet.gain.value = 0;dry.connect(out.master);wet.connect(out.reverb);lanes[name] = {name, def: TRACKS[name], bus: {dry, wet}, bar: 0, nextT: 0, active: false, until: 0};}
      return lanes[name];
    }
    function fade(L, to, dur) {const now = ctx.currentTime;for (const g of [L.bus.dry.gain, L.bus.wet.gain]) {g.cancelScheduledValues(now);g.setValueAtTime(g.value, now);g.linearRampToValueAtTime(to, now + dur);}}
    // Crossfade to a track (null = silence). A track that comes back continues where it left off.
    function play(name) {
      if (name !== null && !TRACKS[name]) name = null;
      if (name === current) return;current = name;if (!ctx) return;
      for (const L of Object.values(lanes)) if (L.name !== name && L.active && !L.until) {fade(L, 0, 2.5);L.until = ctx.currentTime + 2.6;}
      if (name) {const L = lane(name);if (!L.active) {L.active = true;L.nextT = ctx.currentTime + .12;}L.until = 0;fade(L, 1, L.bar === 0 && L.nextT > ctx.currentTime ? 1.2 : 2.5);}
    }
    function tick() {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      for (const L of Object.values(lanes)) {
        if (!L.active) continue;
        if (L.until && now > L.until) {L.active = false;L.until = 0;continue;}
        const beat = 60 / L.def.bpm, barLen = beat * L.def.beats;
        if (L.nextT < now) L.nextT = now + .05;
        while (L.nextT < now + 1.2) {L.def.render(kit, L.bus, L.bar, L.nextT, beat, barSeed(L.name, L.bar));L.nextT += barLen;L.bar = (L.bar + 1) % L.def.bars;}
      }
      // The record keeps its own clock: bars missed while the tab slept are skipped, not squeezed in.
      if (rec) {
        while (rec.nextT < now) {rec.nextT += rec.barLen;rec.bar = (rec.bar + 1) % rec.def.bars;}
        while (rec.nextT < now + 1.2) {rec.def.render(kit, rec.bus, rec.bar, rec.nextT, 60 / rec.def.bpm, barSeed(rec.name, rec.bar));rec.nextT += rec.barLen;rec.bar = (rec.bar + 1) % rec.def.bars;}
      }
    }
    function setVolume(v) {
      volume = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;try {localStorage.setItem('haarklous-music-volume-v1', String(volume));} catch {}
      if (out) out.master.gain.setTargetAtTime(level(), ctx.currentTime, .1);
    }
    // Where the current track is: bar, seconds into the loop, loop length.
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('haarklous-progress', () => {loadVolume();if (out) out.master.gain.setTargetAtTime(level(), ctx.currentTime, .1);});
    function position() {const L = current && lanes[current];if (!L) return null;const i = info[current];return {track: current, title: i.title, bar: L.bar, seconds: L.bar * i.seconds / i.bars, length: i.seconds};}
    return {attach, play, setVolume, position, recordPlay, recordStop, duck, get volume() {return volume;}, get current() {return current;}, tracks: info, records: RECORDS,
      get context() {return ctx;}, get recordOutput() {return recOut;}, get record() {return rec ? rec.name : null;}, get ducked() {return duckK;}};
  }

  // Renders a track without the game (tests / previews): every bar is scheduled up front on an offline context.
  // (Offline cost grows with the number of queued notes, so render long tracks in segments with startBar.)
  function renderOffline(name, seconds, sampleRate = 44100, startBar = 0) {
    const c = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate), kit = makeKit(c), out = chain(c, .8);
    const bus = {dry: c.createGain(), wet: c.createGain()};bus.dry.connect(out.master);bus.wet.connect(out.reverb);
    const def = TRACKS[name], beat = 60 / def.bpm, barLen = beat * def.beats;
    for (let t = .05, bar = startBar % def.bars; t < seconds; t += barLen, bar = (bar + 1) % def.bars) def.render(kit, bus, bar, t, beat, barSeed(name, bar));
    return c.startRendering();
  }
  return {create, tracks: info, records: RECORDS, renderOffline};
});
