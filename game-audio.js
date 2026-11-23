/* Procedural game audio (Web Audio API, no sound files).
 * Ambience: birds (more near trees and in the park), wind (stronger outdoors and up high), traffic hum and passing cars
 * near streets, indoor room tone, a fridge hum in the kitchen, echo in stairwells.
 * Interaction sounds: footsteps per surface, doors, drinks, camera shutter, disc golf chains, boules, excavator.
 * Engines: inline-four motorcycle (CBF600), four-cylinder car, diesel excavator with hydraulics, helicopter (rotor slap
 * and turbine), light-aircraft piston engine and propeller, FPV drone motors.
 * GameAudio.create() -> {resume(), ambience(state), footstep(surface, inStair), sfx(name, opts), engine(kind), hydraulics(), water(level), siren(level, pan), rush(level) (the wind at a jump plane's open door)}
 *   sfx opts: gain, reverb, pan (-1 left … 1 right: a sound from somewhere, e.g. a prop hunt whistle)
 *   output: the node every other sound in the game connects to (music, the catacomb, the flat's record and TV, the mission)
 *   ondevicechange: set by the game; called when a sound device was connected or removed (for a notice)
 * Steady sound (issue #150): one context with a large output buffer ('playback'), one master limiter, at most MAX_VOICES
 * one-shot sounds at once (the oldest gives way), engines glide (smoother when the frame rate is low) and only write a value
 * that changed, nothing non-finite reaches an AudioParam, and the sound starts again by itself after the browser or a
 * device change paused it.
 */
(function (root, factory) {
  root.GameAudio = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function create() {
    let ctx = null, bus, master, dry, reverbSend, convolver, noiseBuf, amb = null;
    const rand = (a, b) => a + Math.random() * (b - a);
    const fin = (v, d = 0) => Number.isFinite(v) ? v : d;// nothing non-finite ever goes to an AudioParam
    function init() {
      if (ctx) return true;
      const AC = window.AudioContext || window.webkitAudioContext;if (!AC) return false;
      // 'playback' = a larger output buffer: a slow frame on a busy PC no longer starves the sound card (crackle, drop-outs).
      try {ctx = new AC({latencyHint: 'playback'});} catch {try {ctx = new AC();} catch {return false;}}
      // One output for everything: bus -> limiter -> speakers. The limiter only works near full scale (no pumping); the
      // bus gain cancels the compressor's built-in make-up gain (about +1.7 dB with these settings), so the level is as before.
      const lim = ctx.createDynamicsCompressor();lim.threshold.value = -3;lim.knee.value = 0;lim.ratio.value = 20;lim.attack.value = .003;lim.release.value = .25;
      bus = ctx.createGain();bus.gain.value = .82;bus.connect(lim).connect(ctx.destination);
      master = ctx.createGain();master.gain.value = .8;master.connect(bus);
      dry = ctx.createGain();dry.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);const d = noiseBuf.getChannelData(0);for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // Stairwell/indoor echo: a generated decaying impulse response.
      convolver = ctx.createConvolver();const len = ctx.sampleRate * 1.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {const ch = ir.getChannelData(c);for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 400 ? i / 400 : 1);}
      convolver.buffer = ir;reverbSend = ctx.createGain();reverbSend.gain.value = 0;reverbSend.connect(convolver);convolver.connect(master);
      startAmbience();watch();return true;
    }
    // ---------- Keeping the sound on ----------
    // The browser can pause the context (no click yet, a hidden tab, a device change); every way back calls wake().
    let wakeMs = -1e9, restarting = false, devTimer = 0;
    function wake(force) {
      if (!ctx || ctx.state === 'running' || ctx.state === 'closed' || restarting) return;
      const ms = performance.now();if (!force && ms - wakeMs < 250) return;wakeMs = ms;
      try {const r = ctx.resume();if (r && r.catch) r.catch(() => {});} catch {}
    }
    function resume() {if (!init()) return;wake();}
    // A sound device came or went (a PS4 controller on USB has its own speaker; a Bluetooth headset changes to its
    // hands-free mode when a microphone opens): stop and start the output, so it opens again on the device Windows uses now.
    function restart() {
      if (!ctx || ctx.state !== 'running' || restarting) return;restarting = true;
      ctx.suspend().then(() => ctx.resume()).catch(() => {}).then(() => {restarting = false;if (ctx.state !== 'running') wake(true);});
    }
    function watch() {
      ctx.onstatechange = () => {if (ctx.state !== 'running') wake(true);};
      if (ctx.addEventListener) ctx.addEventListener('error', restart);// the output device failed (newer browsers)
      document.addEventListener('visibilitychange', () => {if (!document.hidden) wake(true);});
      for (const e of ['focus', 'pageshow', 'gamepadconnected']) window.addEventListener(e, () => wake(true));
      for (const e of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(e, () => wake(true), {capture: true, passive: true});
      const md = navigator.mediaDevices;
      if (md && md.addEventListener) md.addEventListener('devicechange', () => {clearTimeout(devTimer);devTimer = setTimeout(() => {restart();if (api.ondevicechange) try {api.ondevicechange();} catch {}}, 1200);});
    }
    const now = () => ctx.currentTime;
    function noise(loop = true) {const s = ctx.createBufferSource();s.buffer = noiseBuf;s.loop = loop;s.loopStart = Math.random();return s;}
    function out(node, reverb = 0) {node.connect(dry);if (reverb) {const g = ctx.createGain();g.gain.value = reverb;node.connect(g);g.connect(reverbSend);}return node;}
    function env(gainNode, t, peak, attack, decay) {peak = fin(peak);gainNode.gain.setValueAtTime(0, t);gainNode.gain.linearRampToValueAtTime(peak, t + attack);gainNode.gain.exponentialRampToValueAtTime(.0001, t + attack + decay);}
    // Glide a parameter to v; skipped when v is not finite or (nearly) the value it already glides to, so a sound that
    // is updated every frame does not pile up automation events.
    function glide(param, v, t, tau) {
      if (!Number.isFinite(v)) return;const last = param._to;
      if (last !== undefined && Math.abs(v - last) <= 1e-4 + Math.abs(last) * 2e-3) return;
      param._to = v;param.setTargetAtTime(v, t, tau);
    }
    // One-shot sounds are voices with their own gain. When more than MAX_VOICES play at once, the oldest fades out in
    // 30 ms and its sources stop (a storm of paintballs or footsteps cannot overload the sound).
    const MAX_VOICES = 40, voices = [];
    function voice(pan, verb = 0) {
      const g = ctx.createGain(), V = {g, w: null, p: null, src: [], end: 0};
      if (pan != null && ctx.createStereoPanner) {const P = ctx.createStereoPanner();P.pan.value = Math.max(-1, Math.min(1, fin(pan)));g.connect(P);out(P, verb);V.p = P;}
      else g.connect(dry);
      return V;
    }
    // Into a voice: dry, plus `reverb` of it to the echo (with a pan, the panner already has the voice's echo).
    function vsend(V, node, reverb = 0) {
      node.connect(V.g);if (V.p || !reverb) return node;
      if (!V.w) {V.w = ctx.createGain();V.w.connect(reverbSend);}
      const r = ctx.createGain();r.gain.value = reverb;node.connect(r);r.connect(V.w);return node;
    }
    function play(V, src, at, end) {src.start(at);src.stop(end);V.src.push(src);if (end > V.end) V.end = end;}
    function commit(V) {
      const t = now();for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < t) voices.splice(i, 1);
      voices.push(V);
      while (voices.length > MAX_VOICES) {
        const old = voices.shift();
        for (const g of [old.g, old.w]) if (g) {const p = g.gain;p.cancelScheduledValues(t);p.setValueAtTime(p.value, t);p.linearRampToValueAtTime(0, t + .03);}
        for (const s of old.src) try {s.stop(t + .04);} catch {}
      }
    }

    // ---------- Ambience ----------
    function startAmbience() {
      const wind = noise(), windF = ctx.createBiquadFilter(), windG = ctx.createGain();windF.type = 'lowpass';windF.frequency.value = 420;windG.gain.value = 0;wind.connect(windF).connect(windG);out(windG);wind.start();
      const traffic = noise(), trafF = ctx.createBiquadFilter(), trafG = ctx.createGain();trafF.type = 'lowpass';trafF.frequency.value = 260;trafG.gain.value = 0;traffic.connect(trafF).connect(trafG);out(trafG);traffic.start();
      const room = noise(), roomF = ctx.createBiquadFilter(), roomG = ctx.createGain();roomF.type = 'lowpass';roomF.frequency.value = 140;roomG.gain.value = 0;room.connect(roomF).connect(roomG);out(roomG);room.start();
      const hum = ctx.createOscillator(), humG = ctx.createGain();hum.frequency.value = 100;hum.type = 'sine';humG.gain.value = 0;hum.connect(humG);out(humG);hum.start();
      // Rain (real weather, issue #23): a soft hiss, louder in heavier rain, muffled indoors.
      const rain = noise(), rainF = ctx.createBiquadFilter(), rainG = ctx.createGain();rainF.type = 'bandpass';rainF.frequency.value = 2600;rainF.Q.value = .5;rainG.gain.value = 0;rain.connect(rainF).connect(rainG);out(rainG);rain.start();
      amb = {windG, windF, trafG, roomG, humG, rainG, rainF, state: {indoor: 0, green: .5, traffic: 0, height: 0, stair: false, kitchen: false, rain: 0, windSpeed: 4}, birdTimer: 0, carTimer: 3, last: now()};
      setInterval(tickAmbience, 120);// a timer, not the frame loop: the ambience goes on at any frame rate
    }
    function ambience(state) {if (amb) Object.assign(amb.state, state);}
    function tickAmbience() {
      if (!amb || ctx.state !== 'running') return;
      const s = amb.state, t = now(), dt = Math.min(.5, t - amb.last);amb.last = t;const outdoors = 1 - s.indoor;
      const set = (param, v) => glide(param, v, t, .4);
      const windK = Math.min(2.2, .45 + (s.windSpeed || 0) / 7);// the real wind speed (m/s) makes the wind louder or quieter
      set(amb.windG.gain, ((.012 + .03 * Math.min(1, s.height / 12)) * outdoors + .004 * s.indoor) * windK);
      set(amb.rainG.gain, (s.rain || 0) * (.05 * outdoors + .012 * s.indoor));glide(amb.rainF.frequency, s.indoor > .5 ? 900 : 2600, t, .3);
      amb.windF.frequency.setTargetAtTime(300 + 260 * (.5 + .5 * Math.sin(t * .23)) + 200 * Math.sin(t * .071), t, .8);
      const tr = Math.max(0, 1 - s.traffic / 70);set(amb.trafG.gain, (.012 + .05 * tr * tr) * (outdoors + .25 * s.indoor));
      set(amb.roomG.gain, .03 * s.indoor);set(amb.humG.gain, s.kitchen ? .006 : 0);
      glide(reverbSend.gain, s.stair ? .6 : s.indoor * .12, t, .3);
      // Birds: more frequent near trees and in the park, rare indoors.
      amb.birdTimer -= dt;
      // Indoors only an occasional faint, muffled call through the windows.
      if (amb.birdTimer <= 0) {amb.birdTimer = rand(2.5, 9) / (.4 + s.green * .9);if (Math.random() < outdoors * .85 + .12 * s.indoor) bird(outdoors * (.3 + s.green * .5) + .025 * s.indoor, s.indoor > .5);}
      // Campfire crackles (see fire()).
      if (fireState.gain > .02 && Math.random() < .1 + fireState.level * .08) crackle(fireState.gain);
      amb.carTimer -= dt;
      if (amb.carTimer <= 0) {amb.carTimer = rand(3, 12);if (tr > .15 && outdoors > .3) passingCar(tr * outdoors);}
    }
    function bird(level, muffled = false) {
      const t = now() + .05, V = voice(), pan = ctx.createStereoPanner();pan.pan.value = rand(-.9, .9);const g = ctx.createGain();g.gain.value = fin(level) * rand(.05, .12);
      if (muffled) {const lp = ctx.createBiquadFilter();lp.type = 'lowpass';lp.frequency.value = 1400;pan.connect(lp).connect(g);vsend(V, g);} else {pan.connect(g);vsend(V, g, .15);}
      const species = Math.floor(Math.random() * 4);
      if (species === 0) {// great tit "ti-ta ti-ta"
        for (let i = 0; i < 4; i++) {const o = ctx.createOscillator(), e = ctx.createGain(), f = i % 2 ? 4200 : 5600, at = t + i * .16;o.frequency.setValueAtTime(f, at);o.frequency.exponentialRampToValueAtTime(f * .85, at + .08);o.connect(e).connect(pan);env(e, at, 1, .01, .09);play(V, o, at, at + .12);}
      } else if (species === 1) {// blackbird warble
        let at = t;for (let i = 0; i < 6; i++) {const o = ctx.createOscillator(), e = ctx.createGain(), f = rand(1600, 3200), d = rand(.08, .2);o.frequency.setValueAtTime(f, at);o.frequency.exponentialRampToValueAtTime(f * rand(.7, 1.4), at + d);o.connect(e).connect(pan);env(e, at, 1, .02, d);play(V, o, at, at + d + .05);at += d * rand(.9, 1.3);}
      } else if (species === 2) {// sparrow chirps
        for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {const o = ctx.createOscillator(), e = ctx.createGain(), at = t + i * rand(.12, .25), f = rand(3500, 4800);o.type = 'triangle';o.frequency.setValueAtTime(f, at);o.frequency.linearRampToValueAtTime(f * 1.2, at + .03);o.frequency.linearRampToValueAtTime(f * .8, at + .06);o.connect(e).connect(pan);env(e, at, 1, .005, .06);play(V, o, at, at + .09);}
      } else {// magpie chatter: harsh noise bursts
        for (let i = 0; i < 5; i++) {const n = noise(false), f = ctx.createBiquadFilter(), e = ctx.createGain(), at = t + i * .09;f.type = 'bandpass';f.frequency.value = rand(1800, 2600);f.Q.value = 3;n.connect(f).connect(e).connect(pan);env(e, at, 1.6, .004, .06);play(V, n, at, at + .08);}
      }
      commit(V);
    }
    // Campfire: a soft roar plus random crackles, louder for a bigger fire and closer to it. fire(level 0..6, gain 0..1)
    let fireNode = null;const fireState = {level: 0, gain: 0};
    function fire(level, gain) {
      if (!ctx || ctx.state !== 'running') return;
      if (!fireNode) {const n = noise(), lp = ctx.createBiquadFilter(), g = ctx.createGain();lp.type = 'lowpass';lp.frequency.value = 500;g.gain.value = 0;n.connect(lp).connect(g);out(g);n.start();fireNode = {g, lp};}
      level = fin(level);gain = fin(gain);fireState.level = level;fireState.gain = gain;const t = now();glide(fireNode.g.gain, .05 * gain * Math.min(1.4, level / 3), t, .3);glide(fireNode.lp.frequency, 320 + level * 110, t, .3);
    }
    function crackle(gain) {
      const t = now() + Math.random() * .1, V = voice();
      for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) {const s = noise(false), f = ctx.createBiquadFilter(), e = ctx.createGain(), at = t + i * rand(.01, .05);f.type = 'bandpass';f.frequency.value = rand(1800, 5200);f.Q.value = 2;s.connect(f).connect(e);vsend(V, e);env(e, at, rand(.08, .3) * gain, .001, rand(.02, .07));play(V, s, at, at + .12);}
      commit(V);
    }
    function passingCar(level) {
      const t = now(), V = voice(), n = noise(false), f = ctx.createBiquadFilter(), g = ctx.createGain(), pan = ctx.createStereoPanner();f.type = 'lowpass';f.frequency.setValueAtTime(300, t);f.frequency.linearRampToValueAtTime(900, t + 1.6);f.frequency.linearRampToValueAtTime(250, t + 3.4);
      g.gain.setValueAtTime(0, t);g.gain.linearRampToValueAtTime(.09 * fin(level), t + 1.6);g.gain.linearRampToValueAtTime(0, t + 3.5);pan.pan.setValueAtTime(-.8, t);pan.pan.linearRampToValueAtTime(.8, t + 3.4);
      n.connect(f).connect(g).connect(pan);vsend(V, pan);play(V, n, t, t + 3.6);commit(V);
    }

    // Rushing water (Akerselva): a hiss that rises with the current; water(level 0..1), 0 = silent.
    let waterNode = null;
    function water(level) {
      if (!ctx || ctx.state !== 'running') return;
      if (!waterNode) {const n = noise(), bp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();bp.type = 'highpass';bp.frequency.value = 300;lp.type = 'lowpass';lp.frequency.value = 1200;g.gain.value = 0;n.connect(bp).connect(lp).connect(g);out(g);n.start();waterNode = {g, lp};}
      level = fin(level);const t = now();glide(waterNode.g.gain, .07 * level, t, .3);glide(waterNode.lp.frequency, 900 + level * 2600, t, .3);
    }

    // The wind roaring in at a jump plane's open door (issue #165): a low, gusting rush; rush(level 0..1), 0 = silent.
    let rushNode = null;
    function rush(level) {
      if (!ctx || ctx.state !== 'running') return;
      level = Math.max(0, Math.min(1, fin(level)));
      if (!rushNode) {if (!(level > 0)) return;const n = noise(), bp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();bp.type = 'highpass';bp.frequency.value = 90;lp.type = 'lowpass';lp.frequency.value = 700;g.gain.value = 0;n.connect(bp).connect(lp).connect(g);out(g);n.start();rushNode = {g, lp};}
      const t = now(), gust = .85 + .15 * Math.sin(t * 1.7) * Math.sin(t * .63);glide(rushNode.g.gain, .16 * level * gust, t, .25);glide(rushNode.lp.frequency, 500 + 1500 * level * gust, t, .3);
    }

    // Police siren (issue #140): the two-tone of Norwegian emergency vehicles (about B♭4 / E♭5, 0.6 s each), one voice for the
    // loudest police car with the siren on; siren(level 0..1 by distance, pan -1..1). Farther away it is quieter and duller.
    let sirenNode = null;
    function siren(level, pan = 0) {
      if (!ctx || ctx.state !== 'running') return;
      if (!sirenNode) {
        if (!(level > 0)) return;
        const o = ctx.createOscillator(), o2 = ctx.createOscillator(), m2 = ctx.createGain(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), P = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        o.type = 'sawtooth';o2.type = 'square';m2.gain.value = .3;lp.type = 'lowpass';lp.frequency.value = 2400;g.gain.value = 0;
        o.connect(lp);o2.connect(m2).connect(lp);lp.connect(g);if (P) {g.connect(P);out(P);} else out(g);o.start();o2.start();sirenNode = {o, o2, lp, g, P};
      }
      const t = now(), l = Math.max(0, Math.min(1, fin(level))), f = Math.floor(t / .6) % 2 ? 622 : 466;
      glide(sirenNode.o.frequency, f, t, .012);glide(sirenNode.o2.frequency, f * 1.004, t, .012);
      glide(sirenNode.g.gain, .075 * l, t, .08);glide(sirenNode.lp.frequency, 900 + 2300 * l, t, .1);
      if (sirenNode.P) glide(sirenNode.P.pan, Math.max(-1, Math.min(1, fin(pan))), t, .05);
    }

    // ---------- Footsteps ----------
    const steps = {grass: [700, 1.5, .05, .1], gravel: [3800, 1.2, .1, .07], sand: [1600, 1, .06, .08], asphalt: [2200, 2, .07, .04], wood: [900, 2.5, .09, .05], tile: [3200, 4, .07, .03], stone: [2600, 3.5, .1, .04], metal: [1100, 8, .08, .09], terrain: [900, 1.2, .05, .08]};
    function footstep(surface, inStair = false, softness = 1) {
      if (!ctx || ctx.state !== 'running') return;
      const [freq, q, gain, decay] = steps[surface] || steps.terrain, t = now(), V = voice();softness = fin(softness, 1);
      const n = noise(false), f = ctx.createBiquadFilter(), e = ctx.createGain();f.type = 'bandpass';f.frequency.value = freq * rand(.85, 1.15);f.Q.value = q;n.connect(f).connect(e);vsend(V, e, inStair ? .9 : 0);env(e, t, gain * softness * rand(.8, 1.2), .004, decay);play(V, n, t, t + decay + .05);
      if (surface === 'gravel') for (let i = 1; i < 4; i++) {const n2 = noise(false), f2 = ctx.createBiquadFilter(), e2 = ctx.createGain(), at = t + i * .018;f2.type = 'highpass';f2.frequency.value = 4000;n2.connect(f2).connect(e2);vsend(V, e2);env(e2, at, gain * .6 * softness, .002, .02);play(V, n2, at, at + .04);}
      if (surface === 'wood' || surface === 'stone' || surface === 'tile') {const o = ctx.createOscillator(), e3 = ctx.createGain();o.frequency.value = surface === 'wood' ? 120 : 180;o.connect(e3);vsend(V, e3, inStair ? .9 : 0);env(e3, t, .08 * softness, .003, .07);play(V, o, t, t + .1);}
      commit(V);
    }

    // ---------- One-shot effects ----------
    function sfx(name, opts = {}) {
      if (!ctx || ctx.state !== 'running') return;
      const t = now(), level = fin(opts.gain ?? 1, 1), verb = fin(opts.reverb ?? 0);
      // One voice per effect; from a direction (opts.pan) everything goes through one stereo panner.
      const V = voice(opts.pan, verb), sink = e => vsend(V, e, verb);
      const burst = (freq, q, peak, attack, decay, type = 'bandpass', at = t) => {const n = noise(false), f = ctx.createBiquadFilter(), e = ctx.createGain();f.type = type;f.frequency.value = freq;f.Q.value = q;n.connect(f).connect(e);sink(e);env(e, at, peak * level, attack, decay);play(V, n, at, at + attack + decay + .05);};
      const tone = (f0, f1, peak, attack, decay, type = 'sine', at = t) => {const o = ctx.createOscillator(), e = ctx.createGain();o.type = type;o.frequency.setValueAtTime(f0, at);o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + attack + decay);o.connect(e);sink(e);env(e, at, peak * level, attack, decay);play(V, o, at, at + attack + decay + .05);};
      switch (name) {
        case 'doorOpen': tone(320, 520, .03, .05, .35, 'sawtooth');burst(600, 1, .05, .01, .2);break;
        case 'doorClose': burst(160, .8, .5, .004, .25, 'lowpass');tone(90, 50, .3, .003, .2);break;
        case 'locked': for (let i = 0; i < 3; i++) burst(2600, 6, .12, .002, .05, 'bandpass', t + i * .07);break;
        case 'carDoor': burst(220, .8, .5, .004, .3, 'lowpass');tone(70, 40, .4, .003, .25);break;
        case 'bottleOpen': burst(5000, .7, .25, .01, .35, 'highpass');tone(1800, 1200, .05, .002, .04);break;
        case 'gulp': for (let i = 0; i < 3; i++) tone(160, 90, .25, .02, .12, 'sine', t + .25 + i * .32);break;
        case 'shutter': burst(4000, 2, .3, .001, .03);burst(1500, 2, .2, .001, .05, 'bandpass', t + .07);break;
        case 'beep': tone(2000, 2000, .05, .005, .08, 'square');break;
        case 'ding': tone(1568, 1568, .12, .004, .7, 'sine');tone(1245, 1245, .1, .004, .9, 'sine', t + .28);break;// a lift arriving (Construction City)
        case 'throw': burst(900, .7, .12, .05, .25);break;
        case 'chains': for (let i = 0; i < 9; i++) tone(rand(1200, 4800), rand(1100, 4600), .05, .002, rand(.2, .7), 'triangle', t + i * .025);burst(3000, 1, .2, .002, .2);break;
        case 'thud': burst(260, 1, .25, .003, .12, 'lowpass');break;
        case 'boule': tone(2600, 2500, .25, .001, .25, 'triangle');tone(5200, 5100, .1, .001, .15);burst(3500, 3, .2, .001, .03);break;
        case 'gravel': burst(2500, .8, .15, .01, .18);break;
        case 'click': burst(3000, 5, .15, .001, .02);break;
        case 'scrape': burst(800, .6, .25, .05, .4);break;
        case 'dump': burst(180, .7, .5, .01, .6, 'lowpass');burst(1200, .5, .2, .02, .5);break;
        case 'hit': burst(500, 1, .4, .002, .15, 'lowpass');break;
        case 'cheer': for (let i = 0; i < 6; i++) tone(rand(300, 700), rand(400, 900), .04, .05, .4, 'sawtooth', t + i * .05);break;
        case 'starter': tone(220, 320, .08, .02, .5, 'square');break;
        case 'coin': tone(1320, 1320, .12, .004, .12, 'triangle');tone(1760, 1760, .12, .004, .3, 'triangle', t + .09);break;
        case 'register': tone(2400, 2400, .08, .003, .08, 'square');tone(2400, 2400, .08, .003, .08, 'square', t + .14);burst(260, .8, .4, .004, .2, 'lowpass', t + .35);break;
        case 'alarm': for (let i = 0; i < 6; i++) tone(i % 2 ? 1500 : 1900, i % 2 ? 1500 : 1900, .12, .004, .16, 'square', t + i * .18);break;
        case 'pant': burst(180, .7, .5, .004, .25, 'lowpass');for (let i = 0; i < 4; i++) burst(rand(2000, 4500), 4, .1, .001, .05, 'bandpass', t + .25 + i * .07);tone(880, 880, .05, .004, .12, 'sine', t + .6);break;
        case 'shopDoor': burst(700, .5, .08, .15, .45, 'bandpass');break;
        case 'sniff': burst(3200, .8, .35, .18, .35);burst(5200, 1, .18, .1, .25, 'bandpass', t + .05);break;
        case 'needle': burst(4000, 6, .1, .001, .03);for (let i = 0; i < 4; i++) {tone(62, 48, .55, .01, .16, 'sine', t + .35 + i * .55);tone(58, 44, .35, .01, .14, 'sine', t + .55 + i * .55);}break;
        case 'crash': burst(220, .7, 1, .003, 1.4, 'lowpass');burst(1600, .6, .5, .002, .7);tone(70, 30, .6, .003, .9);for (let i = 0; i < 6; i++) burst(rand(2500, 6000), 3, .15, .001, .08, 'bandpass', t + .1 + i * rand(.05, .14));break;
        case 'arm': tone(880, 880, .05, .005, .07, 'square');tone(1320, 1320, .05, .005, .1, 'square', t + .12);break;
        // Paintball (ported from the Unreal version): the marker's shot, a ball breaking, a bounce, the referee's whistle, an empty hopper.
        case 'pbShot': burst(1400, .9, .35, .001, .05);burst(180, 1, .3, .002, .07, 'lowpass');burst(5000, 2, .06, .01, .09);break;
        case 'pbSplat': burst(700, .8, .3, .001, .08);burst(2200, 1.5, .1, .004, .05);break;
        case 'pbBounce': burst(1800, 3, .15, .001, .03);break;
        case 'whistle': tone(2900, 3000, .12, .02, .5, 'sine');tone(3150, 3100, .06, .02, .5, 'sine');break;
        case 'pistolClick': burst(3000, 5, .15, .001, .02);break;
        // Grünerløkka (issues #44, #45, #47): the librarian's shush, a page, table tennis, the kayak.
        case 'shush': burst(3400, 1.3, .55, .06, 1.1);burst(6200, 1, .18, .08, .9);break;
        case 'pageTurn': burst(2600, .7, .12, .03, .22);burst(5200, 1, .05, .01, .12, 'bandpass', t + .12);break;
        case 'pingHit': tone(1400, 900, .16, .001, .05, 'triangle');burst(2800, 4, .25, .001, .025);break;
        case 'pingBounce': tone(1900, 1500, .14, .001, .04, 'triangle');burst(4200, 5, .12, .001, .015);break;
        case 'splash': burst(500, .6, .55, .01, .7, 'lowpass');for (let i = 0; i < 8; i++) burst(rand(1500, 5000), 1.5, .18, .002, rand(.05, .2), 'bandpass', t + .03 + i * rand(.02, .07));break;
        case 'unlock': tone(1700, 1700, .07, .004, .07, 'square');tone(2300, 2300, .07, .004, .09, 'square', t + .1);burst(1200, 3, .25, .002, .06, 'bandpass', t + .25);break;
        case 'bell': for (let i = 0; i < 2; i++) {tone(3100, 3080, .12, .002, .6, 'sine', t + i * .14);tone(4650, 4600, .05, .002, .4, 'sine', t + i * .14);}break;
        case 'paddle': burst(900, .8, .12, .04, .28);burst(2600, 1.2, .05, .02, .15, 'bandpass', t + .05);break;
        // KIWI Storgata (issue #65): the people, the wizard and the four magic powers.
        case 'hm': tone(180, 150, .05, .03, .25, 'triangle');tone(240, 200, .04, .03, .2, 'triangle', t + .18);break;
        case 'mystic': for (let i = 0; i < 5; i++) tone([523, 659, 784, 988, 1175][i], [523, 659, 784, 988, 1175][i] * 1.01, .05, .02, .55, 'sine', t + i * .09);break;
        case 'quest': tone(660, 660, .08, .01, .18, 'triangle');tone(880, 880, .08, .01, .3, 'triangle', t + .12);break;
        case 'harmonica': for (let i = 0; i < 6; i++) {const f = [392, 440, 494, 440, 392, 523][i];tone(f, f, .06, .03, .22, 'sawtooth', t + i * .2);tone(f * 2, f * 2, .03, .03, .2, 'square', t + i * .2);}break;
        case 'bark': for (let i = 0; i < 2; i++) {tone(520, 260, .16, .005, .09, 'sawtooth', t + i * .22);burst(900, 2, .12, .002, .06, 'bandpass', t + i * .22);}break;
        case 'flap': for (let i = 0; i < 10; i++) burst(rand(700, 1600), 1.2, .09, .004, .05, 'bandpass', t + i * rand(.03, .07));break;
        case 'mushroom': tone(1320, 1980, .07, .005, .25, 'sine');tone(1760, 2640, .05, .005, .3, 'sine', t + .08);break;
        case 'learn': for (let i = 0; i < 8; i++) tone(440 * Math.pow(2, i / 4), 440 * Math.pow(2, i / 4) * 1.02, .06, .02, .6, 'sine', t + i * .07);burst(5000, 1, .08, .3, .8, 'highpass', t + .2);break;
        case 'levitate': tone(300, 620, .07, .2, .7, 'sine');burst(2200, .6, .06, .25, .6, 'bandpass');break;
        case 'land': burst(400, .8, .12, .005, .15, 'lowpass');break;
        // Jumping (issue #144): a short breath and a whoosh at take-off; a thud on landing (gain grows with the fall).
        case 'jump': burst(1400, .9, .05, .02, .16, 'bandpass');burst(700, 1.2, .07, .01, .09, 'bandpass');tone(190, 150, .03, .01, .08, 'triangle');break;
        case 'jumpLand': burst(150, .8, .55, .003, .18, 'lowpass');tone(80, 45, .3, .003, .16);burst(900, .7, .08, .002, .07);break;
        case 'blink': tone(1800, 240, .12, .002, .22, 'sawtooth');burst(4000, 1.5, .18, .002, .18, 'highpass');tone(240, 1600, .08, .005, .18, 'sine', t + .12);break;
        case 'gust': burst(500, .5, .5, .05, .9, 'lowpass');burst(1800, .4, .25, .1, .8, 'bandpass');burst(3600, .6, .1, .05, .5, 'highpass', t + .1);break;
        case 'orbOn': tone(880, 1320, .07, .02, .4, 'sine');tone(1320, 1760, .05, .02, .5, 'sine', t + .1);break;
        case 'orbOff': tone(1320, 660, .05, .01, .3, 'sine');break;
        // Minigolf (issue #114): the putter's click, the ball against a rail, rattling round the rim, dropping in, the loop.
        case 'putt': tone(1050, 900, .18, .001, .05, 'triangle');burst(2400, 3, .22, .001, .025);break;
        case 'golfWall': tone(820, 640, .14, .001, .06, 'square');burst(3200, 4, .14, .001, .02);break;
        case 'golfLip': for (let i = 0; i < 3; i++) tone(1500 - i * 200, 1300 - i * 200, .06, .001, .04, 'triangle', t + i * .05);break;
        case 'golfCup': tone(420, 300, .2, .002, .12, 'triangle');tone(980, 760, .1, .001, .07, 'square', t + .08);burst(1800, 3, .15, .001, .05, 'bandpass', t + .14);tone(330, 260, .18, .002, .18, 'sine', t + .18);break;
        case 'golfLoop': tone(300, 900, .06, .05, .45, 'sine');burst(1200, 1, .05, .1, .35);break;
        case 'noMana': tone(220, 180, .06, .01, .18, 'square');break;
        // Prop hunt (issue #124): a hider's whistle (from where it stands), a taunt, hits, a wrong hit, found, the round's horns.
        case 'phWhistle': tone(1650, 2350, .16, .04, .26, 'sine');tone(2350, 1550, .14, .02, .38, 'sine', t + .34);break;
        case 'phTaunt': if (Math.random() < .5) {tone(784, 770, .16, .01, .22, 'sine');tone(622, 610, .16, .01, .3, 'sine', t + .3);tone(784, 770, .12, .01, .2, 'sine', t + .75);tone(622, 610, .12, .01, .3, 'sine', t + 1.05);}
          else for (let i = 0; i < 3; i++) {tone(520, 300, .14, .005, .1, 'sawtooth', t + i * .18);burst(1400, 2, .08, .003, .06, 'bandpass', t + i * .18);}break;
        case 'phHit': tone(900, 560, .2, .002, .08, 'triangle');burst(2200, 2, .25, .001, .05);break;
        case 'phHurt': burst(420, 1, .35, .002, .14, 'lowpass');tone(320, 180, .12, .002, .12, 'square');break;
        case 'phWrong': tone(190, 150, .14, .005, .3, 'square');burst(700, 1, .2, .002, .12, 'lowpass');break;
        case 'phFound': burst(1300, 1, .35, .001, .08);for (let i = 0; i < 4; i++) tone(880 / (1 + i * .25), 840 / (1 + i * .25), .1, .005, .16, 'triangle', t + .1 + i * .13);break;
        case 'phPoof': burst(900, .6, .3, .01, .28);tone(380, 920, .05, .01, .16, 'sine');break;
        case 'phStart': [392, 523, 659].forEach((f, i) => tone(f, f, .1, .01, .3, 'triangle', t + i * .16));break;
        case 'phGo': tone(1046, 1046, .1, .005, .2, 'square');tone(1568, 1568, .1, .005, .35, 'square', t + .22);break;
        case 'phEnd': [659, 523, 392, 523].forEach((f, i) => tone(f, f, .1, .01, .3, 'triangle', t + i * .2));break;
      }
      if (V.src.length) commit(V);else V.g.disconnect();
    }

    // ---------- Engines ----------
    // Engines are set from the frame loop. pace() is the time since the last set (s): a glide is never shorter than one
    // frame, so at 20 fps or after a hitch the pitch slides instead of jumping in steps (at 60 fps it is as before).
    function pacer() {let last = 0;return () => {const ms = performance.now(), s = last ? Math.min(.3, (ms - last) / 1000) : 0;last = ms;return s;};}
    function engine(kind) {
      if (!init()) return {set() {}, stop() {}};
      if (kind === 'heli') return heliEngine();
      if (kind === 'drone') return droneMotors();
      if (kind === 'emotor') return eMotor();
      const spec = {bike: {cyl: 4, idle: 1300, max: 11500, tone: 1, gain: .22}, car: {cyl: 4, idle: 800, max: 6200, tone: .6, gain: .16}, excavator: {cyl: 4, idle: 900, max: 2100, tone: .45, gain: .2}, plane: {cyl: 4, idle: 700, max: 2750, tone: .85, gain: .22}, diesel: {cyl: 6, idle: 650, max: 2200, tone: .4, gain: .22}}[kind] || {cyl: 4, idle: 800, max: 6200, tone: .6, gain: .16};
      const t = now(), saw = ctx.createOscillator(), sq = ctx.createOscillator(), sub = ctx.createOscillator();saw.type = 'sawtooth';sq.type = 'square';sub.type = 'sine';
      const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);for (let i = 0; i < 1024; i++) {const x = i / 512 - 1;curve[i] = Math.tanh(x * 3);}shaper.curve = curve;
      const lp = ctx.createBiquadFilter();lp.type = 'lowpass';const g = ctx.createGain();g.gain.value = 0;
      const mix = ctx.createGain();mix.gain.value = .5;saw.connect(mix);const sqG = ctx.createGain();sqG.gain.value = .25;sq.connect(sqG).connect(mix);const subG = ctx.createGain();subG.gain.value = .6;sub.connect(subG).connect(mix);
      // Exhaust roughness: noise amplitude-modulated at the firing frequency.
      const n = noise(), nf = ctx.createBiquadFilter(), nG = ctx.createGain(), am = ctx.createGain();nf.type = 'bandpass';nf.frequency.value = 900;nf.Q.value = .7;nG.gain.value = .25;n.connect(nf).connect(am).connect(nG).connect(mix);
      const amOsc = ctx.createOscillator();amOsc.type = 'square';const amDepth = ctx.createGain();amDepth.gain.value = .5;amOsc.connect(amDepth).connect(am.gain);am.gain.value = .5;
      mix.connect(shaper).connect(lp).connect(g);out(g);
      [saw, sq, sub, amOsc].forEach(o => o.start(t));n.start(t);
      let hyd = null;const pace = pacer();
      const api = {
        set(rpm, throttle = 0) {
          const tt = now(), k = pace(), fire = rpm / 60 * spec.cyl / 2, f = Math.max(.03, k), q = Math.max(.05, k);
          glide(saw.frequency, fire, tt, f);glide(sq.frequency, fire * 2.01, tt, f);glide(sub.frequency, fire * .5, tt, f);glide(amOsc.frequency, fire, tt, f);
          glide(lp.frequency, 300 + 2600 * spec.tone * (.25 + .75 * throttle) * Math.min(1, rpm / spec.max + .2), tt, q);
          glide(g.gain, spec.gain * (.35 + .65 * throttle) * (.7 + .3 * rpm / spec.max), tt, q);
        },
        hydraulics(flow) {
          if (!hyd) {const o = ctx.createOscillator(), hg = ctx.createGain(), hn = noise(), hf = ctx.createBiquadFilter();o.type = 'sawtooth';hf.type = 'bandpass';hf.frequency.value = 1400;hf.Q.value = 2;hg.gain.value = 0;o.connect(hg);hn.connect(hf).connect(hg);out(hg);o.start();hn.start();hyd = {o, hn, hg};}
          const tt = now();glide(hyd.o.frequency, 380 + 260 * flow, tt, .05);glide(hyd.hg.gain, .05 * flow, tt, .08);
        },
        // Stop: fade out, then stop every source (the hydraulics' noise too: it used to run on, silent, for ever) and let go.
        stop() {const tt = now();glide(g.gain, 0, tt, .15);if (hyd) glide(hyd.hg.gain, 0, tt, .08);setTimeout(() => {[saw, sq, sub, amOsc, n].forEach(o => {try {o.stop();} catch {}});if (hyd) {try {hyd.o.stop();hyd.hn.stop();} catch {}try {hyd.hg.disconnect();} catch {}}try {g.disconnect();} catch {}}, 900);},
        spec
      };
      return api;
    }
    // Helicopter: main-rotor blade slap (noise, amplitude-modulated at the blade-passing rate), turbine whine, tail-rotor buzz.
    // set(rotor 0..1, load 0..1)
    function heliEngine() {
      const t = now(), n = noise(), bp = ctx.createBiquadFilter(), am = ctx.createGain(), slapG = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
      bp.type = 'bandpass';bp.frequency.value = 260;bp.Q.value = .9;am.gain.value = .35;lfo.type = 'sawtooth';depth.gain.value = .65;lfo.connect(depth).connect(am.gain);
      slapG.gain.value = 0;n.connect(bp).connect(am).connect(slapG);out(slapG, .08);
      const rumble = noise(), rlp = ctx.createBiquadFilter(), rG = ctx.createGain();rlp.type = 'lowpass';rlp.frequency.value = 110;rG.gain.value = 0;rumble.connect(rlp).connect(rG);out(rG);
      const tur = ctx.createOscillator(), tur2 = ctx.createOscillator(), tG = ctx.createGain();tur.type = 'sine';tur2.type = 'triangle';tG.gain.value = 0;tur.connect(tG);tur2.connect(tG);out(tG);
      const tail = ctx.createOscillator(), tlp = ctx.createBiquadFilter(), tailG = ctx.createGain();tail.type = 'sawtooth';tlp.type = 'lowpass';tlp.frequency.value = 420;tailG.gain.value = 0;tail.connect(tlp).connect(tailG);out(tailG);
      [lfo, tur, tur2, tail].forEach(o => o.start(t));n.start(t);rumble.start(t);const pace = pacer();
      return {
        set(rpm, load = 0) {
          const tt = now(), k = pace(), a = Math.max(.1, k), b = Math.max(.2, k), blade = 3 * 6.4 * rpm;
          glide(lfo.frequency, Math.max(.5, blade), tt, a);glide(tail.frequency, 30 + 85 * rpm, tt, a);
          glide(tur.frequency, 500 + 1150 * rpm, tt, b);glide(tur2.frequency, 1000 + 2300 * rpm, tt, b);
          glide(slapG.gain, .32 * rpm * rpm * (.6 + .5 * load), tt, a);glide(rG.gain, .22 * rpm * (.5 + .5 * load), tt, a);
          glide(tG.gain, .012 * rpm, tt, b);glide(tailG.gain, .025 * rpm, tt, a);
        },
        stop() {const tt = now();[slapG, rG, tG, tailG].forEach(g => glide(g.gain, 0, tt, .4));setTimeout(() => {[lfo, tur, tur2, tail, n, rumble].forEach(o => {try {o.stop();} catch {}});[slapG, rG, tG, tailG].forEach(g => {try {g.disconnect();} catch {}});}, 2500);}
      };
    }
    // FPV quad: four slightly detuned motors (whine) plus propeller wash. set(thrust 0..1, level 0..1 = distance from the pilot)
    // E-scooter / e-bike hub motor (issue #57): a soft whine rising with the speed, louder under power, and a little tyre hiss.
    function eMotor() {
      const t = now(), o = ctx.createOscillator(), o2 = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();o.type = 'triangle';o2.type = 'sine';bp.type = 'bandpass';bp.frequency.value = 900;bp.Q.value = 1.2;g.gain.value = 0;
      o.connect(bp);o2.connect(bp);bp.connect(g);out(g);o.start(t);o2.start(t);
      const hiss = noise(), hf = ctx.createBiquadFilter(), hG = ctx.createGain();hf.type = 'highpass';hf.frequency.value = 2500;hG.gain.value = 0;hiss.connect(hf).connect(hG);out(hG);hiss.start(t);
      const pace = pacer();
      return {
        set(level, power = 0) {const tt = now(), k = pace(), l = Math.max(0, Math.min(1.4, level));glide(o.frequency, 180 + 900 * l, tt, Math.max(.05, k));glide(o2.frequency, 360 + 1800 * l, tt, Math.max(.05, k));glide(bp.frequency, 500 + 1400 * l, tt, Math.max(.08, k));glide(g.gain, (.004 + .03 * power) * Math.min(1, l * 3 + .2), tt, Math.max(.06, k));glide(hG.gain, .012 * Math.min(1, l), tt, Math.max(.1, k));},
        stop() {const tt = now();glide(g.gain, 0, tt, .1);glide(hG.gain, 0, tt, .1);setTimeout(() => {try {o.stop();o2.stop();hiss.stop();} catch {}try {g.disconnect();hG.disconnect();} catch {}}, 800);}
      };
    }
    function droneMotors() {
      const t = now(), bp = ctx.createBiquadFilter(), g = ctx.createGain();bp.type = 'bandpass';bp.frequency.value = 1400;bp.Q.value = .5;g.gain.value = 0;bp.connect(g);out(g);
      const motors = [1, 1.013, .987, 1.021].map(k => {const o = ctx.createOscillator();o.type = 'sawtooth';o.connect(bp);o.start(t);return {o, k};});
      const wash = noise(), wf = ctx.createBiquadFilter(), wG = ctx.createGain();wf.type = 'bandpass';wf.frequency.value = 2600;wf.Q.value = .6;wG.gain.value = 0;wash.connect(wf).connect(wG);out(wG);wash.start(t);
      const pace = pacer();
      return {
        set(thrust, level = 1) {const tt = now(), k = pace(), f = Math.max(.04, k), q = Math.max(.05, k);for (let i = 0; i < motors.length; i++) glide(motors[i].o.frequency, (150 + 560 * thrust) * motors[i].k, tt, f);glide(g.gain, (.02 + .07 * thrust) * level, tt, q);glide(wG.gain, .05 * thrust * level, tt, q);},
        stop() {const tt = now();glide(g.gain, 0, tt, .1);glide(wG.gain, 0, tt, .1);setTimeout(() => {motors.forEach(m => {try {m.o.stop();} catch {}});try {wash.stop();} catch {}try {g.disconnect();wG.disconnect();} catch {}}, 800);}
      };
    }
    // Bullet time: the world sounds muffled and low (a low-pass on everything except the music).
    let muffleF = null;
    function muffle(on) {
      if (!init()) return;if (!muffleF) {muffleF = ctx.createBiquadFilter();muffleF.type = 'lowpass';muffleF.frequency.value = 20000;master.disconnect();master.connect(muffleF).connect(bus);}
      muffleF.frequency.setTargetAtTime(on ? 700 : 20000, now(), .25);
    }
    const api = {resume, ambience, footstep, sfx, engine, fire, water, siren, rush, muffle, ondevicechange: null, get context() {return ctx;}, get output() {return bus || null;}};
    return api;
  }
  return {create};
});
