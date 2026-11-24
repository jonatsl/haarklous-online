// The feed (issue #184): the server's rules (cloud/src/feed-rules.js beside friends-rules.js, on Node's own SQLite like the
// Durable Object's) and the game's panel model (game-feed.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
globalThis.window = globalThis;
const GF = require('../game-friends.js');
const FD = require('../game-feed.js');
const load = f => import(pathToFileURL(path.join(__dirname, '..', 'cloud', 'src', f)).href);

// Kari (k) and Ola (o) are friends; Per (p) is nobody's friend.
async function world() {
  const R = await load('friends-rules.js'), F = await load('feed-rules.js'), d = new DatabaseSync(':memory:');
  for (const s of [...R.SCHEMA, ...F.FEED_SCHEMA]) d.exec(s);
  const db = {all: (q, ...a) => d.prepare(q).all(...a).map(r => ({...r})), run: (q, ...a) => {d.prepare(q).run(...a);}};
  const w = {F, t: 1e12};w.friends = R.createFriends(db, {now: () => w.t});w.feed = F.createFeed(db, {now: () => w.t});
  w.friends.register('k', 'Kari');w.friends.register('o', 'Ola');w.friends.register('p', 'Per');
  assert.ok(w.friends.add('k', 'Ola').answer.ok);assert.ok(w.friends.accept('o', 'k').answer.ok);
  return w;
}
const jpeg = n => {const b = new Uint8Array(n);b[0] = 0xff;b[1] = 0xd8;b[2] = 0xff;return b;};

test('a post is seen by its writer and by the writer\'s friends, nobody else', async () => {
  const w = await world(), f = w.feed;
  const r = f.post('k', '  Hei fra Torshov!\r\n\r\n\r\n\r\nSe her.  ', jpeg(5000));assert.ok(r.ok, r.why);assert.deepEqual(r.to, ['o']);
  w.t += 60e3;assert.ok(f.post('o', 'Fin tur i dag').ok);assert.ok(f.post('p', 'Per alene').ok);
  const mine = f.list('k').posts;assert.deepEqual(mine.map(p => p.text), ['Fin tur i dag', 'Hei fra Torshov!\n\nSe her.']);
  assert.deepEqual(mine.map(p => [p.by.name, p.mine, p.img]), [['Ola', false, false], ['Kari', true, true]]);assert.match(mine[1].by.tag, /^\d{4}$/);
  assert.deepEqual(f.list('o').posts.map(p => p.by.name), ['Ola', 'Kari']);assert.deepEqual(f.list('p').posts.map(p => p.text), ['Per alene']);
  // The picture: for the writer and the friend, not for a stranger.
  assert.equal(f.image('k', r.id).length, 5000);assert.equal(f.image('o', r.id).length, 5000);assert.equal(f.image('p', r.id), null);assert.equal(f.image('k', 999), null);
  // No longer friends: no longer seen.
  assert.ok(w.friends.remove('k', 'o').answer.ok);assert.deepEqual(f.list('o').posts.map(p => p.by.name), ['Ola']);assert.equal(f.image('o', r.id), null);
});

test('what a post may be: a text or a JPEG, not too long, not too large, not too many a day', async () => {
  const w = await world(), f = w.feed, L = w.F.FEED;
  assert.equal(f.post('k', '   ').ok, false);assert.equal(f.post('nobody', 'hei').ok, false);
  assert.equal(f.post('k', '', new Uint8Array(500)).ok, false, 'not a JPEG');assert.equal(f.post('k', '', jpeg(L.imgBytes + 1)).ok, false);
  assert.ok(f.post('k', '', jpeg(2000)).ok, 'a picture alone is a post');
  assert.ok(f.post('k', 'x'.repeat(1000)).ok);assert.equal(f.list('k').posts[0].text.length, L.text);
  assert.equal(w.F.cleanText('a\u0000b\tc'), 'abc');
  for (let i = 2; i < L.perDay; i++) assert.ok(f.post('k', `nr ${i}`).ok);
  const full = f.post('k', 'one too many');assert.equal(full.ok, false);assert.match(full.why, /Try again tomorrow/);
  w.t += 25 * 3600e3;assert.ok(f.post('k', 'a new day').ok);
  // Pages: newest first, `more` while older ones are left.
  const a = f.list('k', {limit: 10});assert.equal(a.posts.length, 10);assert.equal(a.more, true);assert.equal(a.posts[0].text, 'a new day');
  const b = f.list('k', {before: a.posts[9].id, limit: 100});assert.equal(b.posts.length, L.perDay + 1 - 10);assert.equal(b.more, false);assert.ok(b.posts[0].id < a.posts[9].id);
});

test('likes and deleting', async () => {
  const w = await world(), f = w.feed, id = f.post('k', 'Liker du denne?').id;
  assert.deepEqual(f.like('o', id, true), {ok: true, likes: 1, liked: true});f.like('o', id, true);f.like('k', id, true);
  assert.deepEqual(f.list('k').posts.map(p => [p.likes, p.liked]), [[2, true]]);assert.equal(f.like('o', id, false).likes, 1);
  assert.equal(f.like('p', id, true).ok, false, 'a stranger cannot like what they cannot see');
  assert.equal(f.remove('o', id).ok, false);assert.equal(f.list('k').posts.length, 1);
  assert.ok(f.remove('k', id).ok);assert.equal(f.list('o').posts.length, 0);assert.equal(f.like('o', id, true).ok, false);
});

test('the panel: its rows, the time since a post, the size of a posted picture, a post typed with the controller', () => {
  const R = FD.rows({posts: [{id: 2, mine: true, liked: true, likes: 3}, {id: 1, mine: false, liked: false, likes: 0}], more: true});
  assert.deepEqual(R.map(r => r.kind), ['new', 'post', 'post', 'more']);
  assert.deepEqual(R[0].actions.map(a => a.op), ['write', 'album', 'file', 'post']);
  assert.deepEqual(R[1].actions.map(a => [a.op, a.label]), [['like', '♥ 3'], ['del', 'Delete']]);assert.deepEqual(R[2].actions.map(a => [a.op, a.label]), [['like', '♡']]);
  assert.equal(FD.ago(20e3), 'now');assert.equal(FD.ago(5 * 60e3), '5 min');assert.equal(FD.ago(3 * 3600e3), '3 h');assert.equal(FD.ago(2 * 86400e3), '2 d');assert.equal(FD.ago(30 * 86400e3), null);
  assert.deepEqual(FD.fit(1920, 1080, 960), {w: 960, h: 540});assert.deepEqual(FD.fit(600, 800, 960), {w: 600, h: 800});
  // The on-screen keyboard: a name gets a capital after every space, a post only at its start and after a full stop.
  let k = {r: 0, c: 0, text: ''};const type = (r, c, plain) => {k = GF.osk({...k, r, c}, 'press', 280, plain);};
  type(0, 7, true);type(0, 4, true);type(0, 8, true);type(4, 0, true);type(0, 0, true);type(4, 2, true);type(4, 0, true);type(0, 1, true);
  assert.equal(k.text, 'Hei a. B');
  k = {r: 0, c: 0, text: ''};type(0, 0);type(4, 0);type(0, 1);assert.equal(k.text, 'A B');
});
