// Friends (issue #115): the server's rules and lists (cloud/src/friends-rules.js, on Node's own SQLite like the Durable Object's)
// and the game's panel model (game-friends.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
globalThis.window = globalThis;
const GF = require('../game-friends.js');
const load = () => import(pathToFileURL(path.join(__dirname, '..', 'cloud', 'src', 'friends-rules.js')).href);

// A store with a clock and a presence table we control: online = {uid: {lobby, n, max}}.
async function world() {
  const R = await load(), d = new DatabaseSync(':memory:');
  for (const s of R.SCHEMA) d.exec(s);
  const db = {all: (q, ...a) => d.prepare(q).all(...a).map(r => ({...r})), run: (q, ...a) => {d.prepare(q).run(...a);}};
  const w = {R, t: 1e12, online: {}};
  w.f = R.createFriends(db, {presence: uid => w.online[uid] || null, now: () => w.t});
  w.join = (uid, name, lobby = 'ABCD', n = 1) => {w.online[uid] = {lobby, n, max: 12};return w.f.register(uid, name);};
  w.leave = uid => {delete w.online[uid];w.f.seen(uid);};
  w.friends = uid => w.f.state(uid).friends.map(f => f.name);
  return w;
}
const befriend = (w, a, b, nb) => {const r = w.f.add(a, nb);assert.ok(r.answer.ok, r.answer.why);const s = w.f.accept(b, a);assert.ok(s.answer.ok, s.answer.why);};

test('names: cleaned like the lobby, parsed with or without the number, numbers stable and unique per name', async () => {
  const {cleanName, parseTarget, tagFor} = await load();
  assert.equal(cleanName('  Kari \n  Nordmann<b> '), 'Kari Nordmannb');
  assert.equal(cleanName('x'.repeat(40)).length, 24);
  assert.deepEqual(parseTarget('Kari'), {name: 'Kari', tag: null});
  assert.deepEqual(parseTarget(' kari #4821 '), {name: 'kari', tag: '4821'});
  assert.deepEqual(parseTarget('Kari#4821'), {name: 'Kari', tag: '4821'});
  assert.deepEqual(parseTarget('Kari #48'), {name: 'Kari #48', tag: null});
  assert.equal(tagFor('abc', new Set()), tagFor('abc', new Set()));
  const t = tagFor('abc', new Set());assert.match(t, /^\d{4}$/);
  assert.notEqual(tagFor('abc', new Set([t])), t);
  const w = await world();
  w.join('u1', 'Kari');w.join('u2', 'kari');w.join('u3', 'KARI');
  const tags = ['u1', 'u2', 'u3'].map(u => w.f.state(u).me.tag);
  assert.equal(new Set(tags).size, 3, 'three Karis, three numbers');
  w.join('u1', 'Kari');assert.equal(w.f.state('u1').me.tag, tags[0], 'the number stays');
});

test('request, accept, both see each other online with the lobby; remove', async () => {
  const w = await world();
  w.join('k', 'Kari', 'KARI');w.join('o', 'Ola', 'OLAA');
  const r = w.f.add('k', 'ola');
  assert.ok(r.answer.ok);assert.match(r.answer.why, /sent to Ola #\d{4}/);
  assert.deepEqual(r.changed.sort(), ['k', 'o']);
  assert.deepEqual(r.send, [{uid: 'o', msg: {t: 'toast', kind: 'request', from: {id: 'k', name: 'Kari', tag: w.f.state('k').me.tag}}}]);
  assert.deepEqual(w.f.state('k').outgoing.map(p => p.name), ['Ola']);
  assert.deepEqual(w.f.state('o').incoming.map(p => p.name), ['Kari']);
  assert.match(w.f.add('k', 'Ola').answer.why, /asked .* already/);
  const a = w.f.accept('o', 'k');assert.ok(a.answer.ok);assert.equal(a.send[0].msg.kind, 'accepted');
  assert.deepEqual(w.friends('k'), ['Ola']);assert.deepEqual(w.friends('o'), ['Kari']);
  assert.equal(w.f.state('o').incoming.length, 0);assert.equal(w.f.state('k').outgoing.length, 0);
  const seen = w.f.state('k').friends[0];
  assert.deepEqual({online: seen.online, lobby: seen.lobby, n: seen.n, max: seen.max, here: seen.here}, {online: true, lobby: 'OLAA', n: 1, max: 12, here: false});
  assert.match(w.f.add('k', 'Ola').answer.why, /your friend already/);
  w.leave('o');assert.equal(w.f.state('k').friends[0].online, false);assert.equal(w.f.state('k').friends[0].lobby, null);
  const rm = w.f.remove('k', 'o');assert.ok(rm.answer.ok);assert.deepEqual(w.friends('k'), []);assert.deepEqual(w.friends('o'), []);
  assert.equal(w.f.remove('k', 'o').answer.ok, false);
});

test('asking back when they asked you first makes you friends; decline waits a day; cancel', async () => {
  const w = await world();
  w.join('k', 'Kari');w.join('o', 'Ola');w.join('p', 'Per');
  w.f.add('k', 'Ola');const back = w.f.add('o', 'Kari');assert.ok(back.answer.ok);assert.match(back.answer.why, /friends now/);
  assert.deepEqual(w.friends('o'), ['Kari']);
  w.f.add('p', 'Kari');const d = w.f.decline('k', 'p');assert.ok(d.answer.ok);assert.equal(w.f.state('p').outgoing.length, 0);
  assert.match(w.f.add('p', 'Kari').answer.why, /said no – you can ask again tomorrow/);
  w.t += 24 * 3600e3 + 1;assert.ok(w.f.add('p', 'Kari').answer.ok, 'a day later');
  assert.ok(w.f.cancel('p', 'k').answer.ok);assert.equal(w.f.state('k').incoming.length, 0);
  assert.equal(w.f.cancel('p', 'k').answer.ok, false);assert.equal(w.f.accept('k', 'p').answer.ok, false);
});

test('unknown names, yourself, two players with one name, and no email or id beyond the opaque key', async () => {
  const w = await world();
  w.join('k', 'Kari');w.join('k2', 'Kari');w.join('o', 'Ola');
  const none = w.f.add('o', 'Nobody').answer;assert.equal(none.ok, false);assert.match(none.why, /no player called Nobody/);
  assert.equal(w.f.add('o', 'Ola').answer.why, 'That is you.');
  assert.match(w.f.add('o', 'Kari').answer.why, /More than one player is called Kari: add their number/);
  const tag2 = w.f.state('k2').me.tag, r = w.f.add('o', `Kari#${tag2}`);
  assert.ok(r.answer.ok);assert.deepEqual(w.f.state('k2').incoming.map(p => p.id), ['o']);assert.equal(w.f.state('k').incoming.length, 0);
  // One of two Karis adding "Kari" means the other one.
  w.join('x', 'Xena');assert.ok(w.f.add('k', 'kari').answer.ok);assert.deepEqual(w.f.state('k2').incoming.map(p => p.id).sort(), ['k', 'o']);
  assert.ok(!JSON.stringify(w.f.state('o')).includes('@'), 'no email anywhere');
  assert.equal(w.f.add('o', '   ').answer.why, 'Type a player name.');
});

test('limits: tries per hour, requests waiting, number of friends', async () => {
  const w = await world(), {LIMITS} = w.R;
  w.join('s', 'Spammer');
  for (let i = 0; i < LIMITS.addsPerHour; i++) w.f.add('s', `Ghost${i}`);
  w.join('real', 'Real');assert.match(w.f.add('s', 'Real').answer.why, /a lot of friend requests in one hour/);
  w.t += 3600e3 + 1;assert.ok(w.f.add('s', 'Real').answer.ok, 'an hour later');
  const v = await world();v.join('a', 'Asker');
  for (let i = 0; i <= LIMITS.outgoing; i++) v.join(`p${i}`, `Person${i}`);
  for (let i = 0; i < LIMITS.outgoing; i++) {v.t += 4 * 60e3;assert.ok(v.f.add('a', `Person${i}`).answer.ok);}
  assert.match(v.f.add('a', `Person${LIMITS.outgoing}`).answer.why, /requests waiting for an answer – cancel some first/);
  const z = await world();z.join('pop', 'Popular');
  for (let i = 0; i < LIMITS.incoming; i++) {z.join(`f${i}`, `Fan${i}`);assert.ok(z.f.add(`f${i}`, 'Popular').answer.ok);}
  z.join('late', 'Late');assert.match(z.f.add('late', 'Popular').answer.why, /too many requests waiting/);
  for (let i = 0; i < LIMITS.incoming; i++) z.f.accept('pop', `f${i}`);
  for (let i = 0; i < LIMITS.friends - LIMITS.incoming; i++) {z.join(`g${i}`, `Gal${i}`);z.f.add(`g${i}`, 'Popular');z.f.accept('pop', `g${i}`);}
  assert.equal(z.f.state('pop').friends.length, LIMITS.friends);
  assert.match(z.f.add('late', 'Popular').answer.why, /as many friends as the game allows/);
  assert.match(z.f.add('pop', 'Late').answer.why, /You have 100 friends/);
});

test('invite: only friends, only online, only from a lobby; accepting goes to that lobby; run out, left, full', async () => {
  const w = await world();
  w.join('k', 'Kari', 'KARI', 2);w.join('o', 'Ola', 'OLAA');w.join('p', 'Per', 'PERR');
  befriend(w, 'k', 'o', 'Ola');
  assert.equal(w.f.invite('k', 'p').answer.why, 'You can only invite friends.');
  const inv = w.f.invite('k', 'o');assert.ok(inv.answer.ok);
  assert.deepEqual(inv.send, [{uid: 'o', msg: {t: 'toast', kind: 'invite', from: {id: 'k', name: 'Kari', tag: w.f.state('k').me.tag}, code: 'KARI'}}]);
  const st = w.f.state('o').invites;assert.equal(st.length, 1);assert.equal(st[0].code, 'KARI');assert.equal(st[0].left, 120e3);
  assert.match(w.f.invite('k', 'o').answer.why, /a moment ago/);
  const yes = w.f.reply('o', 'k', true);assert.ok(yes.answer.ok);assert.equal(yes.answer.go, 'KARI');assert.equal(yes.answer.name, 'Kari');
  assert.equal(w.f.state('o').invites.length, 0, 'used up');
  // Ola is now in Kari's lobby.
  w.online.o.lobby = 'KARI';assert.match(w.f.invite('k', 'o').answer.why, /in your lobby already/);
  assert.equal(w.f.state('k').friends[0].here, true);
  // Declining tells the inviter.
  w.online.o.lobby = 'OLAA';w.t += 20e3;w.f.invite('k', 'o');const no = w.f.reply('o', 'k', false);
  assert.ok(no.answer.ok);assert.equal(no.send[0].msg.kind, 'no');
  // Run out after two minutes.
  w.t += 20e3;w.f.invite('k', 'o');w.t += 120e3 + 1;assert.match(w.f.reply('o', 'k', true).answer.why, /run out/);
  // Kari moved on before Ola answered; Kari's lobby filled up; Kari went offline.
  w.f.invite('k', 'o');w.online.k.lobby = 'ZZZZ';assert.match(w.f.reply('o', 'k', true).answer.why, /has left that lobby/);
  w.t += 20e3;w.f.invite('k', 'o');w.online.k.n = 12;assert.match(w.f.reply('o', 'k', true).answer.why, /lobby is full \(12 players\)/);
  w.online.k.n = 2;assert.match(w.f.invite('o', 'k').answer.why, /Invite sent/);w.leave('o');assert.match(w.f.reply('k', 'o', true).answer.why, /gone offline/);
  assert.match(w.f.invite('k', 'o').answer.why, /Ola is offline/);
  w.join('o', 'Ola', null);delete w.online.k;assert.match(w.f.invite('k', 'o').answer.why, /not in a lobby/);
});

test('join a friend: friends can join unless they turned it off; offline, no lobby, full, already there', async () => {
  const w = await world();
  w.join('k', 'Kari', 'KARI', 3);w.join('o', 'Ola', 'OLAA');w.join('p', 'Per', 'PERR');
  befriend(w, 'o', 'k', 'Kari');
  assert.equal(w.f.join('p', 'k').answer.why, 'You can only join friends.');
  const j = w.f.join('o', 'k');assert.ok(j.answer.ok);assert.equal(j.answer.go, 'KARI');
  const off = w.f.setJoinable('k', false);assert.ok(off.answer.ok);assert.ok(off.changed.includes('o'), 'friends see the change');
  assert.match(w.f.join('o', 'k').answer.why, /by invite only/);
  const seen = w.f.state('o').friends[0];assert.equal(seen.playing, true);assert.equal(seen.lobby, null, 'the code is hidden');
  assert.equal(w.f.state('k').me.joinable, false);
  w.f.setJoinable('k', true);w.online.k.n = 12;assert.match(w.f.join('o', 'k').answer.why, /full \(12 players\)/);
  w.online.k.n = 3;w.online.o.lobby = 'KARI';assert.match(w.f.join('o', 'k').answer.why, /in Kari’s lobby already/);
  w.online.k.lobby = null;assert.match(w.f.join('o', 'k').answer.why, /not in a lobby/);
  w.leave('k');assert.match(w.f.join('o', 'k').answer.why, /Kari is offline/);
});

test('a renamed account keeps its friends; friends are listed online first', async () => {
  const w = await world();
  w.join('k', 'Kari');w.join('o', 'Ola');w.join('a', 'Anne');
  befriend(w, 'k', 'o', 'Ola');befriend(w, 'k', 'a', 'Anne');
  w.leave('a');assert.deepEqual(w.friends('k'), ['Ola', 'Anne']);
  const r = w.f.register('o', 'Ola Nordmann');assert.ok(r.changed.includes('k'));
  assert.deepEqual(w.friends('k'), ['Ola Nordmann', 'Anne']);
  w.t += 10e3;assert.equal(w.f.register('o', 'Ola Nordmann').fresh, false, 'a quick reconnect is not "came online"');
  w.t += 5 * 60e3;assert.equal(w.f.register('o', 'Ola Nordmann').fresh, true);
});

test('the game\'s panel: rows, actions and the on-screen keyboard', () => {
  const st = {me: {id: 'k', name: 'Kari', tag: '4821', joinable: true},
    friends: [{id: 'o', name: 'Ola', tag: '1111', online: true, playing: true, here: false, joinable: true, lobby: 'OLAA', n: 3, max: 12},
      {id: 'f', name: 'Full', tag: '2222', online: true, playing: true, here: false, joinable: true, lobby: 'FULL', n: 12, max: 12},
      {id: 'h', name: 'Here', tag: '3333', online: true, playing: true, here: true, joinable: true, lobby: 'KARI', n: 2, max: 12},
      {id: 'c', name: 'Closed', tag: '4444', online: true, playing: true, here: false, joinable: false, lobby: null, n: 0, max: 0},
      {id: 'x', name: 'Away', tag: '5555', online: false, playing: false, here: false, joinable: true, lobby: null, n: 0, max: 0}],
    incoming: [{id: 'p', name: 'Per', tag: '6666'}], outgoing: [{id: 'q', name: 'Q', tag: '7777'}], invites: [{id: 'o', name: 'Ola', tag: '1111', code: 'OLAA', left: 60e3}]};
  const rows = GF.rows(st, {inLobby: true});
  const acts = key => rows.find(r => r.key === key).actions.map(a => a.op);
  assert.deepEqual(rows.map(r => r.key), ['add', 'joinable', 'inv:o', 'req:p', 'fr:o', 'fr:f', 'fr:h', 'fr:c', 'fr:x', 'out:q']);
  assert.deepEqual(acts('inv:o'), ['yes', 'no']);
  assert.deepEqual(acts('req:p'), ['accept', 'decline']);
  assert.deepEqual(acts('fr:o'), ['join', 'invite', 'remove']);
  assert.deepEqual(acts('fr:f'), ['invite', 'remove'], 'a full lobby has no Join');
  assert.deepEqual(acts('fr:h'), ['remove'], 'in your lobby already');
  assert.deepEqual(acts('fr:c'), ['invite', 'remove'], 'invite only');
  assert.deepEqual(acts('fr:x'), ['remove'], 'offline');
  assert.deepEqual(acts('out:q'), ['cancel']);
  assert.match(GF.where(st.friends[0]), /lobby OLAA · 3\/12/);assert.match(GF.where(st.friends[1]), /full/);
  assert.match(GF.where(st.friends[2]), /in your lobby/);assert.match(GF.where(st.friends[3]), /invite only/);assert.equal(GF.where(st.friends[4]), 'Offline');
  assert.equal(GF.badge(st), 2, 'one request and one invite');
  // Not in a lobby: nobody to invite.
  assert.deepEqual(GF.rows(st, {inLobby: false}).find(r => r.key === 'fr:o').actions.map(a => a.op), ['join', 'remove']);
  // The on-screen keyboard: moving wraps, keys type, the name is capitalised like a name.
  let k = {r: 0, c: 0, text: ''};
  k = GF.osk(k, 'left');assert.equal(GF.OSK[k.r][k.c], 'J');
  k = GF.osk(k, 'right');k = GF.osk(k, 'press');k = GF.osk({...k, c: 1}, 'press');assert.equal(k.text, 'Ab');
  k = GF.osk(k, 'delete');assert.equal(k.text, 'A');
  k = GF.osk({...k, r: GF.OSK.length - 1, c: 0}, 'press');assert.equal(k.text, 'A ');
  const hash = GF.OSK[GF.OSK.length - 1].indexOf('#');k = GF.osk({...k, c: hash}, 'press');assert.equal(k.text, 'A #');
  k = GF.osk({...k, r: 0, c: 0, text: 'x'.repeat(30)}, 'press');assert.equal(k.text.length, 30, 'no longer than the field');
  k = GF.osk({r: GF.OSK.length - 1, c: 0}, 'down');assert.equal(k.r, 0);
  assert.equal(GF.OSK.every(r => r.length === GF.OSK[0].length), true, 'a straight grid');
});
