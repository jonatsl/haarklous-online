const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../game-minigames.js');
const {petanqueNext} = globalThis.GameMinigames;

test('petanque: the side without the point throws until it has no boules, then the holder', () => {
  assert.equal(petanqueNext('you', {you: 2, npc: 1}), 'npc');
  assert.equal(petanqueNext('you', {you: 2, npc: 0}), 'you');
  assert.equal(petanqueNext('npc', {you: 1, npc: 2}), 'you');
  assert.equal(petanqueNext('npc', {you: 0, npc: 0}), null);// the mène is over
});

test('petanque: with no boule left in the court whoever has boules plays on (it used to freeze)', () => {
  assert.equal(petanqueNext(null, {you: 1, npc: 2}), 'you');
  assert.equal(petanqueNext(null, {you: 0, npc: 2}), 'npc');
  assert.equal(petanqueNext(null, {you: 0, npc: 0}), null);
});

// A disc golf round with three.js and a stub canvas (issue #60: walk to the next tee, the course layout for the minimap).
function golf(holes, outline) {
  const warn = console.warn;console.warn = () => {};const T = require('../vendor/three.min.js');console.warn = warn;// its "deprecated build" notice
  globalThis.document = {createElement: () => ({getContext: () => new Proxy({}, {get: () => () => {}})})};
  const lib = new Proxy({mergeStatic() {}}, {get: (o, k) => o[k] || (() => new T.MeshStandardMaterial())});
  const shown = [], toWorld = (x, s) => ({x: s, z: -x}), toLocal = (x, z) => ({x: -z, s: x});// a turned frame: local and world differ
  const mini = globalThis.GameMinigames.create({T, lib, audio: {sfx() {}}, heightAt: () => 10, toWorld, toLocal, data: {discgolf: holes, petanque: {x: 0, s: 0, rot: 0, length: 15, width: 4}}, hud: {discgolf: s => shown.push(s), petanque() {}}});
  return {g: mini.discgolf, shown, toWorld};
}
const HOLES = [{tee: [94.4, 9.8], basket: [162.45, 26.22], par: 3}, {tee: [163.52, 34.14], basket: [125.99, 93.23], par: 3}];
const idle = extra => ({aimYaw: 0, aimPitch: 0, charge: 0, power: 0, release: false, ...extra});

test('disc golf: after a hole you walk to the next tee, and the hole starts when you get there', () => {
  const {g, shown, toWorld} = golf(HOLES);
  const t1 = toWorld(...HOLES[0].tee), t2 = toWorld(...HOLES[1].tee);
  g.start({x: t1.x, z: t1.z, y: 10});
  let L = g.layout();
  assert.equal(L.name, 'Torshovdalen');assert.equal(L.current, 0);assert.equal(L.walking, false);assert.equal(L.lie, null, 'no lie before a throw has landed');
  assert.deepEqual(L.holes.map(h => h.tee), HOLES.map(h => h.tee));assert.equal(L.outline, null);
  // A throw lands 30 m short: the lie shows (in the local frame) with the metres to the basket.
  g.landed = true;const lie = toWorld(130, 18);g.lie = {x: lie.x, z: lie.z, y: 10};
  L = g.layout();assert.ok(Math.abs(L.lie[0] - 130) < 1e-9 && Math.abs(L.lie[1] - 18) < 1e-9);assert.equal(L.distance, Math.round(Math.hypot(162.45 - 130, 26.22 - 18)));
  // Holed: the scorecard waits, then you walk (no teleport any more).
  g.pending = {next: true, t: 0};
  let r = g.update(.016, idle({at: {x: lie.x, z: lie.z, y: 10}}));
  assert.deepEqual(r, {walk: true});L = g.layout();assert.equal(L.walking, true);assert.equal(L.current, 1);assert.equal(L.lie, null);
  assert.equal(shown.at(-1).walk, true);assert.equal(shown.at(-1).hole, 2);
  // Still 20 m away: keep walking; the card counts the metres to the tee.
  r = g.update(.016, idle({at: {x: t2.x + 20, z: t2.z, y: 10}}));assert.deepEqual(r, {walk: true});assert.equal(shown.at(-1).distance, 20);
  // Within 3 m: hole 2 starts on its tee, facing the basket.
  r = g.update(.016, idle({at: {x: t2.x + 2, z: t2.z, y: 10}}));
  assert.ok(r.teleport);assert.ok(Math.abs(r.teleport.x - t2.x) < 1e-9 && Math.abs(r.teleport.z - t2.z) < 1e-9);
  L = g.layout();assert.equal(L.walking, false);assert.equal(L.current, 1);assert.equal(L.lie, null);
  assert.deepEqual(g.update(.016, idle({at: {x: t2.x, z: t2.z, y: 10}})), {lock: true});
});

test('disc golf: □ takes you straight to the next tee, ○ ends the round while you walk', () => {
  let {g, toWorld} = golf(HOLES);
  const t1 = toWorld(...HOLES[0].tee);
  g.start({x: t1.x, z: t1.z, y: 10});g.pending = {next: true, t: 0};g.update(.016, idle({at: {x: t1.x, z: t1.z, y: 10}}));
  const r = g.update(.016, idle({at: {x: t1.x, z: t1.z, y: 10}, skip: true}));assert.ok(r.teleport);assert.equal(g.layout().walking, false);
  ({g} = golf(HOLES));
  g.start({x: t1.x, z: t1.z, y: 10});g.pending = {next: true, t: 0};g.update(.016, idle({at: {x: t1.x, z: t1.z, y: 10}}));
  assert.ok(g.update(.016, idle({cancel: true})).done);assert.equal(g.active, false);assert.equal(g.layout(), null);
});

test('disc golf: holing out on the last hole ends the round as before', () => {
  const {g, toWorld} = golf(HOLES), t2 = toWorld(...HOLES[1].tee);
  g.start({x: t2.x, z: t2.z, y: 10});assert.equal(g.layout().current, 1);
  g.strokes[1] = 3;g.pending = {next: true, t: 0};
  const r = g.update(.016, idle({at: {x: t2.x, z: t2.z, y: 10}}));assert.match(r.done, /Torshovdalen finished: 3 throws/);assert.equal(g.layout(), null);
});
