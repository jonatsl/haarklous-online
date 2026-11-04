// Badges and the photo hunt (issue #58): when a photo counts, the best scores, and which badges the saved state gives.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../game-badges.js');

// A camera at `cam` looking along +x (no tilt), vertical field of view fovY, aspect 16:9: the projection the game gets from three.js.
function shot(cam, fovY = 70, blocked = () => false) {
  const t = Math.tan(fovY * Math.PI / 360), aspect = 16 / 9;
  return {cam, fovY, blocked, ndc: p => {const f = p.x - cam.x, r = p.z - cam.z, u = p.y - cam.y;return f <= 0 ? {x: 0, y: 0, z: 2} : {x: r / (f * t * aspect), y: u / (f * t), z: .5};}};
}
const spot = {id: 'photo-hodet', name: 'HODET N.N.', size: 7, r: 3, maxDist: 60, at: {x: 30, y: 3.5, z: 0}};

test('a photo counts when the place is in the picture, big enough and nothing is in the way', () => {
  assert.equal(B.judge(spot, shot({x: 0, y: 1.6, z: 0})).ok, true);
  assert.equal(B.judge(spot, shot({x: -40, y: 1.6, z: 0})).why, 'far', '70 m away');
  assert.equal(B.judge(spot, shot({x: 0, y: 1.6, z: 40})).why, 'frame', 'aimed beside it');
  assert.equal(B.judge(spot, shot({x: 60, y: 1.6, z: 0})).why, 'frame', 'behind you');
  assert.equal(B.judge(spot, shot({x: -25, y: 1.6, z: 0})).why, 'small', '55 m: too small without zoom');
  assert.equal(B.judge(spot, shot({x: -25, y: 1.6, z: 0}, 70 / 3)).ok, true, 'zoomed in 3× it fills the frame');
  assert.equal(B.judge(spot, shot({x: 0, y: 1.6, z: 0}, 70, () => true)).why, 'blocked');
});

test('every photo hunt place has a name, a hint, a size and a distance', () => {
  assert.ok(B.SPOTS.length >= 8);
  for (const s of B.SPOTS) {assert.ok(s.id.startsWith('photo-') && s.name && s.hint.length > 20 && s.size > 0 && s.maxDist > s.r && s.kr > 0, s.id);}
  for (const name of ['Torshovoksen', 'HODET N.N.', 'Deichman Grünerløkka', 'Klatreverket Torshov', 'Muselunden']) assert.ok(B.SPOTS.some(s => s.name === name), name);
  assert.ok(B.SPOTS.some(s => /catacomb/.test(s.hint)), 'one in the catacomb');
  // From the place's own size limit: at its greatest distance it can still be big enough when zoomed in 4×.
  for (const s of B.SPOTS) assert.ok(s.size / (2 * s.maxDist * Math.tan(70 / 4 * Math.PI / 360)) >= .15, `${s.id} can be photographed from maxDist`);
});

test('best scores: holes in one, rounds, wins, the mission time and the closest landing', () => {
  const R = {};
  B.record(R, 'disc-hole', {course: 'Torshovdalen', strokes: 1, par: 3});B.record(R, 'disc-hole', {course: 'Torshovdalen', strokes: 3, par: 3});
  assert.equal(R.aces, 1);
  assert.equal(B.record(R, 'disc-round', {course: 'Torshovdalen', total: 7, par: 6, holes: 2}).best, true);
  assert.equal(B.record(R, 'disc-round', {course: 'Torshovdalen', total: 8, par: 6, holes: 2}).best, false);
  assert.deepEqual(R.disc.Torshovdalen, {rounds: 2, par: 6, holes: 2, best: 7});
  B.record(R, 'petanque', {won: false, you: 9, npc: 13});B.record(R, 'petanque', {won: true, you: 13, npc: 11});
  assert.deepEqual(R.petanque, {lost: 1, won: 1, best: {you: 13, npc: 11}});
  B.record(R, 'mission', {success: false});B.record(R, 'mission', {success: true, time: 312.44});B.record(R, 'mission', {success: true, time: 400});
  assert.deepEqual(R.mission, {failed: 1, done: 2, best: 312.4});
  B.record(R, 'skydive', {landing: 'crash', dist: 2});B.record(R, 'skydive', {landing: 'hard', dist: 14.26});B.record(R, 'skydive', {landing: 'soft', dist: 30});
  assert.deepEqual(R.skydive, {jumps: 3, soft: 1, best: 14.3}, 'a crash does not count as a landing on target');
  B.record(R, 'paintball', {won: true});B.record(R, 'paintball', {won: false});B.record(R, 'mark', {id: 'fire'});
  assert.deepEqual(R.paintball, {played: 2, won: 1});assert.deepEqual(R.marks, {fire: 1});
});

test('badges come from the best scores and the other saved states', () => {
  const none = {records: {}, gym: {}, kayak: {}, route: {}, got: {}};
  assert.deepEqual(B.BADGES.filter(b => b.test(none)).map(b => b.id), []);
  const all = {records: {aces: 1, mission: {done: 1}, disc: {'Muselunden DiscGolfPark': {holes: 12}}, petanque: {won: 1}, paintball: {won: 1}, skydive: {best: 9.5},
    pingpong: {won: 1}, marks: {catacomb: 1, moby: 1, fire: 1, airborne: 1}},
    gym: {ticks: {a: 'flash'}, brattkort: true}, kayak: {0: 400}, route: {best: 600}, got: Object.fromEntries(B.SPOTS.map(s => [s.id, {}])),
    // Kiwi Storgata (issue #65): all five regulars helped, all four powers learned.
    storgata: {q: Object.fromEntries(['kjell', 'bente', 'tore', 'mona', 'even'].map(id => [id, {s: 'done'}])), powers: {levitate: 1, blink: 1, gust: 1, orb: 1}}};
  assert.deepEqual(B.BADGES.filter(b => !b.test(all)).map(b => b.id), []);
  const near = {...none, records: {skydive: {best: B.TARGET_R + .1}, disc: {'Muselunden DiscGolfPark': {holes: 11}}}};
  assert.deepEqual(B.BADGES.filter(b => b.test(near)).map(b => b.id), [], 'just outside the target, one hole short');
  assert.equal(new Set([...B.BADGES, ...B.SPOTS].map(b => b.id)).size, B.BADGES.length + B.SPOTS.length, 'ids are unique');
  for (const b of B.BADGES) assert.ok(b.kr > 0 && b.icon && b.how.length > 10, b.id);
});

test('a door counts from the front, not from along the wall', () => {
  const door = {id: 'photo-home', name: 'Door', size: 7, r: 1, maxDist: 40, at: {x: 0, y: 2.5, z: 0}, face: {x: -1, z: 0}};
  assert.equal(B.judge(door, shot({x: -18, y: 1.6, z: 3})).ok, true, 'in front');
  const along = {...door, face: {x: 0, z: 1}};
  assert.equal(B.judge(along, shot({x: -18, y: 1.6, z: 3})).why, 'side', 'from along the wall');
});
