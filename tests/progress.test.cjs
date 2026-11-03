// Saved progress (issue #54): which values are progress, how a browser's progress joins an account's, what changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../game-progress.js');
const B = require('../game-badges.js');

const memory = (init = {}) => {const m = new Map(Object.entries(init));return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m};};
const W = (money, pant = 0, bag = {}) => JSON.stringify({money, pant, bag});

test('collect takes only the progress keys, apply writes them and removes the rest', () => {
  const s = memory({'haarklous-wallet-v1': W(620), 'haarklous-lobby-code-v1': 'ABCD', 'haarklous-quality': '2', 'haarklous-music-volume-v1': '0.3'});
  assert.deepEqual(P.collect(s), {'haarklous-wallet-v1': W(620), 'haarklous-music-volume-v1': '0.3'});
  P.apply(s, {'haarklous-kayak-v1': '{"0":300}'}, ['haarklous-music-volume-v1']);
  assert.equal(s.getItem('haarklous-wallet-v1'), null, 'not in the data: removed');
  assert.equal(s.getItem('haarklous-music-volume-v1'), '0.3', 'kept on request');
  assert.equal(s.getItem('haarklous-kayak-v1'), '{"0":300}');
  assert.equal(s.getItem('haarklous-lobby-code-v1'), 'ABCD', 'the lobby code and graphics settings are not progress');
  assert.equal(s.getItem('haarklous-quality'), '2');
});

test('a fresh start is not progress; money, bottles, a best time or a badge are', () => {
  assert.equal(P.hasProgress({}), false);
  assert.equal(P.hasProgress({'haarklous-wallet-v1': W(500), 'haarklous-look-sensitivity-v1': '{"pad":2}', 'haarklous-music-volume-v1': '0'}), false);
  assert.equal(P.hasProgress({'haarklous-catacomb-map-v1': btoa('\0\0\0')}), false, 'an empty catacomb map');
  assert.equal(P.hasProgress({'haarklous-route-v1': '{"best":null,"runs":0}'}), false);
  assert.equal(P.hasProgress({'haarklous-wallet-v1': W(500, 2)}), true);
  assert.equal(P.hasProgress({'haarklous-wallet-v1': W(470)}), true);
  assert.equal(P.hasProgress({'haarklous-wallet-v1': W(500, 0, {beer: 1})}), true);
  assert.equal(P.hasProgress({'haarklous-catacomb-map-v1': btoa('\0\x04\0')}), true);
  assert.equal(P.hasProgress({'haarklous-badges-v1': '{"got":{"ace":{"at":1}}}'}), true);
  assert.equal(P.hasProgress({'haarklous-records-v1': '{"aces":1}'}), true);
  assert.deepEqual(P.describe({'haarklous-wallet-v1': W(820), 'haarklous-badges-v1': '{"got":{"a":{},"b":{}}}'}), {money: 820, badges: 2});
});

test('moving a browser into an account adds money, bottles and the bag; the better best times win; settings come along', () => {
  const account = {'haarklous-wallet-v1': W(900, 3, {beer: 2}), 'haarklous-kayak-v1': '{"0":400,"2":200}', 'haarklous-route-v1': '{"best":300,"runs":2}',
    'haarklous-music-volume-v1': '0.8'};
  const browser = {'haarklous-wallet-v1': W(650, 1, {beer: 1, chips: 1}), 'haarklous-kayak-v1': '{"0":350,"1":500}', 'haarklous-route-v1': '{"best":320,"runs":1}',
    'haarklous-music-volume-v1': '0.2', 'haarklous-minimap-v1': 'on'};
  const m = P.merge(account, browser, B.MERGE, 'move');
  assert.deepEqual(JSON.parse(m['haarklous-wallet-v1']), {money: 1550, pant: 4, bag: {beer: 3, chips: 1}});
  assert.deepEqual(JSON.parse(m['haarklous-kayak-v1']), {0: 350, 1: 500, 2: 200});
  assert.deepEqual(JSON.parse(m['haarklous-route-v1']), {best: 300, runs: 3});
  assert.equal(m['haarklous-music-volume-v1'], '0.2', 'the browser you are on keeps its settings');
  assert.equal(m['haarklous-minimap-v1'], 'on');
  assert.deepEqual(P.merge(null, browser, B.MERGE, 'move'), browser, 'an empty account takes the browser as it is');
});

test('sync keeps the account’s amounts but never loses a badge, a tick or a seen catacomb cell', () => {
  const account = {'haarklous-wallet-v1': W(900), 'haarklous-klatreverket-v1': JSON.stringify({ticks: {r1: 'flash'}, bestHang: 12, tries: {r1: 1}}),
    'haarklous-catacomb-map-v1': btoa('\x01\0'), 'haarklous-badges-v1': JSON.stringify({got: {ace: {at: 5}}})};
  const local = {'haarklous-wallet-v1': W(1200), 'haarklous-klatreverket-v1': JSON.stringify({ticks: {r2: 'sent'}, bestHang: 20, brattkort: true, tries: {r1: 3, r2: 2}}),
    'haarklous-catacomb-map-v1': btoa('\x02\x80\x01'), 'haarklous-badges-v1': JSON.stringify({got: {ace: {at: 3, thumb: 'x'}, kayak: {at: 9}}})};
  const m = P.merge(account, local, B.MERGE, 'sync');
  assert.equal(m['haarklous-wallet-v1'], W(900));
  const k = JSON.parse(m['haarklous-klatreverket-v1']);
  assert.deepEqual(k.ticks, {r1: 'flash', r2: 'sent'});assert.equal(k.bestHang, 20);assert.equal(k.brattkort, true);assert.deepEqual(k.tries, {r1: 3, r2: 2});
  assert.equal(atob(m['haarklous-catacomb-map-v1']), '\x03\x80\x01');
  assert.deepEqual(JSON.parse(m['haarklous-badges-v1']).got, {ace: {at: 3, thumb: 'x'}, kayak: {at: 9}});
});

test('best scores join: counts add up when moving, the better best wins', () => {
  const a = {aces: 1, disc: {Torshovdalen: {best: 7, par: 6, holes: 2, rounds: 3}}, petanque: {won: 2, lost: 1, best: {you: 13, npc: 5}}, mission: {done: 1, best: 200}, marks: {fire: 1}};
  const b = {aces: 2, disc: {Torshovdalen: {best: 6, par: 6, holes: 2, rounds: 1}, 'Muselunden DiscGolfPark': {best: 40, par: 36, holes: 12, rounds: 1}},
    petanque: {won: 1, lost: 0, best: {you: 13, npc: 2}}, mission: {done: 2, best: 150}, skydive: {jumps: 1, soft: 1, best: 8}, marks: {moby: 1}};
  const m = JSON.parse(B.mergeRecords(JSON.stringify(a), JSON.stringify(b), 'move'));
  assert.equal(m.aces, 3);
  assert.deepEqual(m.disc.Torshovdalen, {best: 6, par: 6, holes: 2, rounds: 4});
  assert.equal(m.disc['Muselunden DiscGolfPark'].best, 40);
  assert.deepEqual(m.petanque, {won: 3, lost: 1, best: {you: 13, npc: 2}});
  assert.deepEqual(m.mission, {done: 3, failed: 0, best: 150});
  assert.deepEqual(m.skydive, {jumps: 1, soft: 1, best: 8});
  assert.deepEqual(m.marks, {fire: 1, moby: 1});
  const s = JSON.parse(B.mergeRecords(JSON.stringify(a), JSON.stringify(b), 'sync'));
  assert.equal(s.aces, 2, 'sync: the larger count, not the sum');
});

test('diff finds what changed since the last save', () => {
  const synced = P.hashes({'haarklous-wallet-v1': W(500), 'haarklous-kayak-v1': '{}'});
  assert.deepEqual(P.diff({'haarklous-wallet-v1': W(500), 'haarklous-kayak-v1': '{}'}, synced), {set: {}, del: []});
  assert.deepEqual(P.diff({'haarklous-wallet-v1': W(510)}, synced), {set: {'haarklous-wallet-v1': W(510)}, del: ['haarklous-kayak-v1']});
  assert.deepEqual(P.diff({'haarklous-records-v1': '{}'}, {}), {set: {'haarklous-records-v1': '{}'}, del: []});
  assert.notEqual(P.hash('ab'), P.hash('ba'));
});
