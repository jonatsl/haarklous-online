// KIWI Storgata (issue #65): the shop in the Gamle Oslo patch, the regulars' quests, Sopp-Sigvald's lessons, the magic powers,
// saving and joining the state, and the server accepting it as part of an account's progress.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
globalThis.window = globalThis;
const SG = require('../game-storgata.js');
const GM = require('../game-magic.js');
const GP = require('../game-progress.js');
const District = require('../district.js');
require('../game-shops.js');
const S = globalThis.GameShops;

const say = (st, who, ctx) => SG.talk(st, who, ctx);
const opt = (view, act) => view.options.find(o => o.act === act);

test('a regular offers a task, and it is done only when you bring what was asked (bottles, food)', () => {
  const st = SG.fresh();
  let v = say(st, 'kjell', {pant: 0});
  assert.ok(v.lines.length >= 2, 'the first meeting starts with an introduction');
  const r = SG.perform(st, 'kjell', opt(v, 'accept'), {}, 1000);
  assert.equal(r.accepted, 'kjell');assert.equal(SG.status(st, 'kjell'), 'active');
  assert.equal(opt(say(st, 'kjell', {pant: 9}), 'complete'), undefined, 'nine bottles are not enough');
  assert.equal(SG.perform(st, 'kjell', {act: 'complete', quest: 'kjell'}, {pant: 9}).error, 'not ready');
  v = say(st, 'kjell', {pant: 12});
  const done = SG.perform(st, 'kjell', opt(v, 'complete'), {pant: 12}, 2000);
  assert.deepEqual(done.reward, {item: 'kvikklunsj', takePant: 10});
  assert.equal(SG.status(st, 'kjell'), 'done');assert.equal(SG.trust(st), 1);
  assert.equal(SG.perform(st, 'kjell', {act: 'accept', quest: 'kjell'}).error, 'taken', 'a finished task cannot be taken again');
  // Tore wants a hot coffee and a hot dog from the counter.
  SG.perform(st, 'tore', opt(say(st, 'tore', {}), 'accept'));
  assert.match(say(st, 'tore', {bag: {kaffekopp: 1}}).lines.at(-1).en, /hot dog/);
  assert.match(SG.goal(st, 'tore', {bag: {polse: 1}}).en, /coffee/);
  const t = SG.perform(st, 'tore', opt(say(st, 'tore', {bag: {kaffekopp: 1, polse: 2}}), 'complete'), {bag: {kaffekopp: 1, polse: 2}});
  assert.deepEqual(t.reward, {item: 'solo', takeItems: ['kaffekopp', 'polse']});assert.equal(SG.trust(st), 2);
});

test('finding things, the note for Rolf and the photo of Grønland kirke', () => {
  const st = SG.fresh();
  assert.equal(SG.pick(st, 'harmonica'), null, 'nothing can be picked before the task is taken');
  SG.perform(st, 'bente', {act: 'accept', quest: 'bente'});
  const p = SG.pick(st, 'harmonica');assert.equal(p.ready, true);assert.equal(SG.status(st, 'bente'), 'ready');
  assert.equal(SG.pick(st, 'harmonica'), null, 'only once');
  assert.deepEqual(SG.perform(st, 'bente', opt(say(st, 'bente', {}), 'complete')).reward, {kr: 100});
  // Mona's note: Rolf only takes it while the task is on; then Mona thanks you.
  assert.equal(opt(say(st, 'rolf', {}), 'deliver'), undefined);
  SG.perform(st, 'mona', {act: 'accept', quest: 'mona'});
  assert.match(SG.goal(st, 'mona').en, /Rolf/);
  const d = SG.perform(st, 'rolf', opt(say(st, 'rolf', {}), 'deliver'));assert.equal(d.delivered, true);assert.equal(SG.status(st, 'mona'), 'ready');
  assert.deepEqual(SG.perform(st, 'mona', opt(say(st, 'mona', {}), 'complete')).reward, {kr: 80});
  // Even's photo.
  assert.equal(SG.photo(st, 'gronland'), null);
  SG.perform(st, 'even', {act: 'accept', quest: 'even'});assert.equal(SG.photo(st, 'gronland'), 'even');
  assert.deepEqual(SG.perform(st, 'even', opt(say(st, 'even', {}), 'complete')).reward, {kr: 120});
  assert.equal(SG.trust(st), 3);
});

test('Sopp-Sigvald teaches a power after each mushroom hunt, lesson k when k regulars trust you', () => {
  const st = SG.fresh();
  let v = say(st, 'sigvald', {seed: 3});
  assert.equal(opt(v, 'accept'), undefined, 'no lesson without trust');assert.match(v.lines.at(-1).en, /Trust: 0 of 1/);
  assert.equal(SG.perform(st, 'sigvald', {act: 'accept', quest: 'w1'}).error, 'trust');
  st.q.kjell = {s: 'done', at: 1};
  v = say(st, 'sigvald', {});assert.equal(opt(v, 'accept').quest, 'w1');
  SG.perform(st, 'sigvald', opt(v, 'accept'));
  for (const id of ['dalen-1', 'dalen-2']) assert.equal(SG.pick(st, id).ready, false);
  assert.match(SG.goal(st, 'w1').en, /2 of 3/);
  assert.equal(SG.pick(st, 'dalen-3').ready, true);
  const r = SG.perform(st, 'sigvald', opt(say(st, 'sigvald', {}), 'complete'));
  assert.equal(r.reward.teach, 'levitate');assert.ok(st.powers.levitate);
  // The next lesson waits for a second regular; the last one needs four.
  assert.equal(opt(say(st, 'sigvald', {}), 'accept'), undefined);
  st.q.bente = {s: 'done', at: 1};assert.equal(opt(say(st, 'sigvald', {}), 'accept').quest, 'w2');
  assert.deepEqual(SG.QUESTS.filter(q => q.teach).map(q => [q.trust, q.teach]), [[1, 'levitate'], [2, 'blink'], [3, 'gust'], [4, 'orb']]);
  // Mushrooms found before the task was taken (progress from another PC) make it ready at once.
  st.q.w2 = undefined;delete st.q.w2;['elva-1', 'elva-2', 'elva-3'].forEach(id => {st.got[id] = 1;});
  SG.perform(st, 'sigvald', {act: 'accept', quest: 'w2'});assert.equal(SG.status(st, 'w2'), 'ready');
});

test('every person, task and find fits together, and every line has Norwegian and English', () => {
  for (const q of SG.QUESTS) assert.ok(SG.PEOPLE[q.who], q.id);
  for (const p of SG.PICKUPS) assert.ok(SG.QUESTS.find(q => q.id === p.quest), p.id);
  for (const q of SG.QUESTS.filter(q => q.kind === 'find')) assert.ok(SG.pickupsOf(q.id).length >= 1, q.id);
  // Walk every state of every quest and check the lines.
  const states = ['none', 'active', 'ready', 'done'];
  for (const who of Object.keys(SG.PEOPLE)) for (const s of states) for (const trust of [0, 5]) {
    const st = SG.fresh();for (const id of SG.REGULARS.slice(0, trust)) st.q[id] = {s: 'done', at: 1};
    for (const q of SG.QUESTS) if (q.who === who && s !== 'none') st.q[q.id] = {s, at: 1};
    if (who === 'rolf' && s !== 'none') st.q.mona = {s, at: 1};
    const v = SG.talk(st, who, {pant: 3, bag: {}, seed: 5});
    assert.ok(v.lines.length && v.options.length, `${who} ${s}`);
    for (const l of [...v.lines, ...v.options]) assert.ok(l.no && l.en && l.no.length > 2 && l.en.length > 2, `${who} ${s}: ${JSON.stringify(l)}`);
    assert.equal(v.options.at(-1).act, 'bye', 'you can always leave');
  }
});

test('the saved state is checked, joins with another copy, and counts as progress only after something happened', () => {
  assert.deepEqual(SG.normalize({q: {kjell: {s: 'done', at: 5}, nobody: {s: 'done'}, bente: {s: 'weird'}}, got: {harmonica: 1, x: 1}, powers: {orb: 9, fly: 1}, met: {mona: 1, zed: 1}}),
    {v: 1, q: {kjell: {s: 'done', at: 5}}, got: {harmonica: 1}, powers: {orb: 9}, met: {mona: 1}});
  assert.deepEqual(SG.normalize('junk'), SG.fresh());
  const K = SG.KEY;assert.ok(GP.KEYS.includes(K), 'part of the saved progress');
  assert.equal(GP.hasProgress({[K]: JSON.stringify(SG.fresh())}), false, 'a fresh state is not progress');
  assert.equal(GP.hasProgress({[K]: JSON.stringify({...SG.fresh(), met: {kjell: 1}})}), false, 'only having talked is not progress');
  assert.equal(GP.hasProgress({[K]: JSON.stringify({...SG.fresh(), powers: {levitate: 1}})}), true);
  const account = {[K]: JSON.stringify({v: 1, q: {kjell: {s: 'done', at: 1, done: 2}, w1: {s: 'active', at: 3}}, got: {'dalen-1': 1}, powers: {levitate: 50}, met: {kjell: 1}})};
  const browser = {[K]: JSON.stringify({v: 1, q: {kjell: {s: 'active', at: 9}, bente: {s: 'done', at: 4}, w1: {s: 'ready', at: 8}}, got: {'dalen-2': 1, 'dalen-3': 1}, powers: {levitate: 40, blink: 70}, met: {bente: 1}})};
  for (const mode of ['move', 'sync']) {
    const m = JSON.parse(GP.merge(account, browser, SG.MERGE, mode)[K]);
    assert.deepEqual(m.q, {kjell: {s: 'done', at: 1, done: 2}, w1: {s: 'ready', at: 8}, bente: {s: 'done', at: 4}}, `${mode}: the further step of each task wins`);
    assert.deepEqual(m.got, {'dalen-1': 1, 'dalen-2': 1, 'dalen-3': 1});assert.deepEqual(m.powers, {levitate: 40, blink: 70});assert.deepEqual(m.met, {kjell: 1, bente: 1});
  }
});

test('the server accepts the Storgata state as part of an account\'s progress (cloud/src/progress-check.js)', async () => {
  const C = await import(pathToFileURL(path.join(__dirname, '..', 'cloud', 'src', 'progress-check.js')).href);
  const st = SG.fresh();for (const q of SG.QUESTS) st.q[q.id] = {s: 'done', at: Date.now(), done: Date.now()};for (const p of SG.PICKUPS) st.got[p.id] = 1;for (const id of ['levitate', 'blink', 'gust', 'orb']) st.powers[id] = Date.now();for (const id of Object.keys(SG.PEOPLE)) st.met[id] = 1;
  const set = Object.fromEntries(GP.KEYS.map(k => [k, k === SG.KEY ? JSON.stringify(st) : '{}']));
  assert.equal(C.checkSave({set, del: []}), null, 'every key the game saves, the Storgata state included');
  assert.ok(JSON.stringify(st).length < C.VALUE_CHARS / 50, 'the whole state is small');
  assert.equal(C.checkSave({set: {'haarklous-storgata-v1': 5}}), 'Bad value for haarklous-storgata-v1');
  assert.equal(C.checkSave({set: {'other-key': '{}'}}), 'Bad value for other-key');
  assert.equal(C.checkSave({set: {}, del: ['haarklous-storgata-v1']}), null);
  assert.equal(C.checkSave({set: Object.fromEntries(Array.from({length: 41}, (_, i) => [`haarklous-k${i}`, '1']))}), 'Too many keys');
  assert.deepEqual(C.saveParts({set: 'x', del: 'y'}), {set: [], del: []});
});

test('magic: learning, choosing, mana and cooldowns', () => {
  const m = new GM.Magic();
  assert.equal(m.cast('blink').why, 'unknown');assert.equal(m.selected, null);
  m.learn('levitate');m.learn('blink');assert.equal(m.selected, 'blink', 'a new power is chosen');
  assert.equal(m.select(1), 'levitate');assert.equal(m.select(1), 'blink');assert.equal(m.select(-1), 'levitate');
  const r = m.cast('blink');assert.ok(r.ok);assert.equal(m.mana, GM.MAX_MANA - 30);
  assert.equal(m.cast('blink').why, 'cooldown');
  m.tick(3.01);assert.equal(m.can('blink'), null, 'ready again after its 3 s');
  m.mana = 20;assert.equal(m.cast('blink').why, 'mana');
  // Mana refills by itself after a short rest.
  m.mana = 100;m.tick(3.1);assert.ok(m.cast('blink').ok);m.tick(.5);assert.equal(m.mana, 70, 'not at once');m.tick(1);assert.ok(m.mana > 70 && m.mana < 90, String(m.mana));
  // Levitation drains mana while it lasts and stops when the mana is gone.
  m.mana = 10;assert.ok(m.cast('levitate').ok);assert.ok(m.levitating);
  let ev = [];for (let i = 0; i < 20 && !ev.length; i++) ev = m.tick(.1);
  assert.deepEqual(ev, [{kind: 'empty', id: 'levitate'}]);assert.equal(m.levitating, false);
  // The light orb: on and off with the same button.
  m.learn('orb');m.mana = 100;m.tick(2);assert.equal(m.cast('orb').on, true);assert.equal(m.orb, true);
  m.tick(1.1);assert.equal(m.cast('orb').on, false);assert.equal(m.orb, false);
  assert.deepEqual(GM.POWERS.map(p => p.key), ['1', '2', '3', '4']);
});

test('levitation rises to 3.2 m (less under a ceiling), and then you sink slowly and land', () => {
  let s = {y: 0, v: 0}, top = 0;
  for (let i = 0; i < 300; i++) {s = GM.levitate(s, 1 / 60, {hold: true});top = Math.max(top, s.y);}
  assert.ok(top <= 3.2 + 1e-9 && top > 3.1, String(top));
  let c = {y: 0, v: 0};for (let i = 0; i < 300; i++) c = GM.levitate(c, 1 / 60, {hold: true, head: 1.2});assert.ok(c.y <= 1.2 + 1e-9, 'never through a ceiling');
  let t = 0, fastest = 0;while (s.y > 0 && t < 10) {s = GM.levitate(s, 1 / 60, {hold: false});fastest = Math.min(fastest, s.v);t += 1 / 60;}
  assert.equal(s.floating, false);assert.ok(fastest >= -1.3 - 1e-9, String(fastest));assert.ok(t > 2.2, `a slow sink (${t.toFixed(1)} s)`);
});

test('blink stops in front of a wall or a drop, and goes the whole way when it is clear', () => {
  const flat = () => 0;
  const free = GM.blinkTarget({x: 0, z: 0, y: 0}, {x: 0, z: -2}, 8, flat);assert.ok(Math.abs(free.d - 8) < 1e-6 && Math.abs(free.z + 8) < 1e-6, JSON.stringify(free));
  const wall = GM.blinkTarget({x: 0, z: 0, y: 0}, {x: 1, z: 0}, 8, p => p.x > 5 ? null : 0);assert.ok(wall.d <= 5 && wall.d > 4.7, JSON.stringify(wall));
  // A step up a kerb is fine; the test function gives the new floor height.
  const kerb = GM.blinkTarget({x: 0, z: 0, y: 0}, {x: 1, z: 0}, 4, (p, y) => p.x > 2 ? (Math.abs(.15 - y) < .3 ? .15 : null) : 0);assert.equal(kerb.y, .15);
  const blocked = GM.blinkTarget({x: 0, z: 0, y: 0}, {x: 1, z: 0}, 8, () => null);assert.equal(blocked.d, 0);
});

test('the gust takes what is in its cone, nearest first, weaker far away and off to the side', () => {
  const items = [{id: 'ahead', x: 0, z: -6}, {id: 'far', x: 0, z: -13}, {id: 'side', x: 7, z: -6}, {id: 'behind', x: 0, z: 5}, {id: 'out', x: 0, z: -20}, {id: 'edge', x: 3, z: -6}];
  const hits = GM.gustTargets({x: 0, z: 0}, {x: 0, z: -1}, items, 14, 40);
  assert.deepEqual(hits.map(h => h.item.id), ['ahead', 'edge', 'far']);
  assert.ok(hits[0].k > hits[1].k && hits[0].k > hits[2].k, 'centre and close are strongest');
});

test('Kiwi Storgata is cut into its real building on Storgata (OSM node 3111431401) in the Gamle Oslo patch', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'gamle-oslo-data.js'), 'utf8');
  const saved = globalThis.DISTRICTS;globalThis.DISTRICTS = [];globalThis.atob = globalThis.atob || (s => Buffer.from(s, 'base64').toString('binary'));
  new Function(src)();const d = District.decode(globalThis.DISTRICTS.find(x => x.name === 'gamle-oslo'));globalThis.DISTRICTS = saved;
  const b = d.buildings.find(x => x.id === 'w112233122'), before = b.ring.length;
  const shop = S.SHOPS.find(s => s.id === 'kiwi-storgata');
  assert.equal(S.applyDistrictNotches([d]), 1);
  assert.equal(b.ring.length, before + 4, 'four corners added');assert.equal(shop.bldg, b);
  const nt = shop.local;assert.ok(nt.W >= 12 && nt.W <= 16, `front ${nt.W.toFixed(1)} m`);assert.equal(nt.depth, 10);
  // The real place: the shop's middle is within 12 m of the OSM node (local -1315, 2418), and its front faces Storgata.
  const lat0 = 59.936404, lon0 = 10.776657, node = [(10.753084 - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), -(59.91468 - lat0) * 111320];
  const mid = [nt.P0[0] + nt.u[0] * nt.W / 2 + nt.n[0] * nt.depth / 2, nt.P0[1] + nt.u[1] * nt.W / 2 + nt.n[1] * nt.depth / 2];
  assert.ok(Math.hypot(mid[0] - node[0], mid[1] - node[1]) < 12, `${Math.hypot(mid[0] - node[0], mid[1] - node[1]).toFixed(1)} m from the node`);
  const out = [nt.P0[0] + nt.u[0] * nt.W / 2 - nt.n[0] * 9, nt.P0[1] + nt.u[1] * nt.W / 2 - nt.n[1] * 9];
  const segd = (p, a, q) => {const dx = q[0] - a[0], ds = q[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * ds) / (dx * dx + ds * ds)));return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * ds);};
  let best = 1e9;for (const r of d.roads.filter(r => r.n === 'Storgata')) for (let i = 2; i < r.p.length; i += 2) best = Math.min(best, segd(out, [r.p[i - 2], r.p[i - 1]], [r.p[i], r.p[i + 1]]));
  assert.ok(best < 4, `9 m out from the shop front is Storgata (${best.toFixed(1)} m from its centre line)`);
  // The real opening hours (OSM opening_hours "Mo-Sa 07:00-23:00") and the hot-food counter only here.
  assert.equal(shop.hours, 'Åpent man–lør 07–23');assert.equal(shop.counter, true);assert.equal(shop.jobs, false);
  for (const id of ['kaffekopp', 'polse']) {const p = S.PRODUCTS.find(x => x.id === id);assert.equal(p.where, 'counter');assert.equal(Math.round(S.priceOf(shop, p) * 100) % 100, 90);}
  // The wallet can give bottles away (Kjell-Arne's ten).
  const store = {};globalThis.localStorage = {getItem: k => (k in store ? store[k] : null), setItem: (k, v) => {store[k] = String(v);}};
  const w = S.makeWallet();w.addPant(12);assert.equal(w.takePant(10), true);assert.equal(w.pant, 2);assert.equal(w.takePant(3), false);assert.equal(w.pant, 2);
});
