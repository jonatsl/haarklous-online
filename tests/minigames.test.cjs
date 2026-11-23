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

// Disc golf online (issue #148): st.dg, joining a round, the shared card, away and the round's winner.
test('disc golf online: st.dg survives the trip and bad data is dropped', () => {
  const {dgEncode, dgDecode} = globalThis.GameMinigames;
  const st = JSON.parse(JSON.stringify(dgEncode({c: 1, r: 1700000000123.4, h: 2, w: 0, n: 2, d: 41.6, l: {x: 1.234, y: 2.5, z: -3.333}, s: [3, 4, 0, 0], th: [7, 1700000005000.2, 1, 2, 3, 10.123, 2, -5, .3, 0]})));
  const d = dgDecode(st);
  assert.equal(d.c, 1);assert.equal(d.r, 1700000000123);assert.equal(d.h, 2);assert.equal(d.d, 42);assert.deepEqual(d.l, [1.23, 2.5, -3.33]);assert.deepEqual(d.s, [3, 4, 0, 0]);
  assert.equal(d.th[0], 7);assert.equal(d.th[1], 1700000005000);assert.equal(d.th[5], 10.12);
  assert.equal(dgDecode(null), null);assert.equal(dgDecode({s: 'x'}), null);assert.equal(dgDecode({c: 0, h: 9, s: [0, 0]}), null, 'hole outside the card');
  assert.equal(dgDecode({c: 0, h: 0, s: [0], th: [1, 2]}).th, undefined, 'a short throw is ignored');
});

test('disc golf online: you join the earliest round still played on that course', () => {
  const {dgEncode, dgJoinable} = globalThis.GameMinigames;
  const p = (id, name, c, r, w = 0) => ({id, name, slot: id, dg: dgEncode({c, r, h: 0, w, n: 0, d: 50, s: [0, 0]})});
  assert.equal(dgJoinable([], 0), null);
  assert.equal(dgJoinable([p(2, 'Ola', 1, 100)], 0), null, 'another course');
  assert.equal(dgJoinable([p(2, 'Ola', 0, 100, 2)], 0), null, 'only finished players: a new round');
  assert.deepEqual(dgJoinable([p(5, 'Kari', 0, 300), p(2, 'Ola', 0, 100), p(3, 'Per', 0, 100, 2)], 0), {r: 100, names: ['Ola', 'Per']});
});

test('disc golf online: the card has everyone in the round, leader first, and shows who is away', () => {
  const {dgEncode, dgCard, dgAway} = globalThis.GameMinigames, pars = [3, 3, 4];
  const dg = (o) => dgEncode({c: 0, r: 100, w: 0, n: 0, d: 0, ...o});
  const me = {id: 1, name: 'You', slot: -1, dg: dg({h: 1, n: 1, d: 20, s: [4, 0, 0]})};
  const peers = [{id: 2, name: 'Ola', slot: 2, dg: dg({h: 1, n: 1, d: 35, s: [3, 0, 0]})}, {id: 3, name: 'Kari', slot: 3, dg: dg({h: 1, n: 0, d: 60, s: [0, 0, 0]})},
    {id: 4, name: 'Other round', slot: 4, dg: dgEncode({c: 0, r: 999, h: 0, w: 0, n: 0, d: 0, s: [2, 0, 0]})}];
  const card = dgCard(me, peers, pars);
  assert.deepEqual(card.map(r => r.name), ['Ola', 'Kari', 'You']);// E after a hole, E (nothing played), +1
  assert.deepEqual(card.map(r => r.rel), [0, 0, 1]);assert.equal(card.find(r => r.me).total, 4);
  assert.equal(dgAway(card, 1), 3, 'Kari is still on the tee, furthest away');
  // Kari has left (not sent any more): the card is rebuilt from the others; Ola is away.
  const card2 = dgCard(me, peers.slice(0, 1), pars);assert.equal(card2.length, 2);assert.equal(dgAway(card2, 1), 2);
  assert.equal(dgAway(dgCard(me, [], pars), 1), null, 'alone: nobody is marked');
});

test('disc golf online: the winner is decided when nobody plays the round any more', () => {
  const {dgEncode, dgCard, dgWinner} = globalThis.GameMinigames, pars = [3, 3];
  const row = (id, s, w = 2) => ({id, name: 'P' + id, slot: id, dg: dgEncode({c: 0, r: 5, h: 1, w, n: 0, d: 0, s})});
  const me = row(1, [3, 3]);
  assert.equal(dgWinner(dgCard(me, [row(2, [3, 4], 0)], pars)), null, 'someone is still playing');
  assert.equal(dgWinner(dgCard(me, [row(2, [3, 4])], pars)), 1);
  assert.equal(dgWinner(dgCard(me, [row(2, [3, 3])], pars)), null, 'a tie: no winner');
  assert.equal(dgWinner(dgCard(me, [row(2, [0, 2])], pars)), null, 'only one full card');
});
