/* Friends (issue #115): the rules and the stored lists, kept apart from the Cloudflare plumbing (friends.js) so the Node tests
 * can run them on Node's own SQLite (tests/friends.test.cjs).
 *
 * Who is who: a friend is found by the account name (the name in the lobbies) plus a 4-digit number, e.g. "Kari #4821".
 * Account names are not unique (Better Auth's `name`), so the number tells two Karis apart. The number is given here the
 * first time an account opens the game with the friends list and stays as long as the name does. Typing the name alone is
 * enough while only one player has that name. Nobody ever sees another player's email or account id other than as an
 * opaque key.
 *
 * createFriends(db, {presence, now}) -> the friends store
 *   db       = {all(sql, ...args) -> rows, run(sql, ...args)}   (a Durable Object's SQLite, or node:sqlite in the tests)
 *   presence = uid -> null (offline) | {lobby: 'ABCD' | null, n, max}   (from the open WebSockets, see friends.js)
 * Every action returns {answer: {ok, why, go?, name?}, changed: [uid] (send them a fresh state), send: [{uid, msg}] (toasts)}.
 *   register(uid, name) -> {fresh, changed}   when a game connects (fresh = not seen in the last 2 minutes)
 *   state(uid)                                 what the player's Friends panel shows
 *   add(uid, text) · accept(uid, id) · decline(uid, id) · cancel(uid, id) · remove(uid, id)
 *   invite(uid, id) · reply(uid, id, yes) · join(uid, id) · setJoinable(uid, on) · seen(uid) · onlineFriends(uid)
 */
export const LIMITS = {friends: 100, outgoing: 20, incoming: 50, addsPerHour: 20, name: 24};
export const INVITE_MS = 2 * 60e3, INVITE_AGAIN_MS = 15e3, DECLINE_MS = 24 * 3600e3, ONLINE_MS = 150e3, BACK_MS = 2 * 60e3;
export const CODE = /^[A-HJ-NP-Z2-9]{4}$/;

export const SCHEMA = [
  'create table if not exists users (uid text primary key, name text not null, lname text not null, tag text not null, joinable integer not null default 1, seen integer not null default 0)',
  'create unique index if not exists users_name_tag on users (lname, tag)',
  // A friendship is stored both ways (a -> b and b -> a), so "my friends" is one lookup.
  'create table if not exists friends (a text not null, b text not null, at integer not null, primary key (a, b))',
  'create table if not exists requests (src text not null, dst text not null, at integer not null, primary key (src, dst))',
  'create index if not exists requests_dst on requests (dst)',
  'create table if not exists declined (src text not null, dst text not null, at integer not null, primary key (src, dst))',
  'create table if not exists invites (src text not null, dst text not null, code text not null, at integer not null, primary key (src, dst))',
  'create table if not exists adds (uid text not null, at integer not null)',
  'create index if not exists adds_uid on adds (uid, at)'
];

// The lobby's own cleaning of names (cloud/src/index.js), plus one space between words.
export const cleanName = s => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name);
export const lname = s => cleanName(s).toLowerCase();
// "Kari", "kari #4821", "Kari#4821" -> {name, tag}
export function parseTarget(text) {
  const s = String(text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40), m = s.match(/^(.*?)\s*#\s*(\d{4})$/);
  return m ? {name: cleanName(m[1]), tag: m[2]} : {name: cleanName(s), tag: null};
}
// The first number tried comes from the account id, so it is the same every time; the next free one if it is taken.
export function tagFor(uid, taken) {
  let h = 2166136261;for (const ch of String(uid)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  let t = 1000 + h % 9000;
  for (let i = 0; i < 9000 && taken.has(String(t)); i++) t = t >= 9999 ? 1000 : t + 1;
  return String(t);
}

export function createFriends(db, {presence = () => null, now = () => Date.now()} = {}) {
  const one = (q, ...a) => db.all(q, ...a)[0] || null;
  const count = (q, ...a) => Number(one(q, ...a).n);
  const user = uid => one('select uid, name, lname, tag, joinable, seen from users where uid = ?', uid);
  const card = u => ({id: u.uid, name: u.name, tag: u.tag});
  const label = u => `${u.name} #${u.tag}`;
  const isFriend = (a, b) => !!one('select 1 as x from friends where a = ? and b = ?', a, b);
  const friendIds = uid => db.all('select b from friends where a = ?', uid).map(r => r.b);
  const nFriends = uid => count('select count(*) as n from friends where a = ?', uid);
  const asked = (src, dst) => one('select at from requests where src = ? and dst = ?', src, dst);
  const ok = (why, {changed = [], send = [], ...more} = {}) => ({answer: {ok: true, why, ...more}, changed, send});
  const no = why => ({answer: {ok: false, why}, changed: [], send: []});
  const onlineFriends = uid => friendIds(uid).filter(id => presence(id));

  function register(uid, name) {
    uid = String(uid);name = cleanName(name) || 'Player';
    const l = name.toLowerCase(), u = user(uid), t = now();
    let tag = u && u.lname === l ? u.tag : null;
    if (!tag) {
      const taken = new Set(db.all('select tag from users where lname = ? and uid != ?', l, uid).map(r => r.tag));
      tag = u && !taken.has(u.tag) ? u.tag : tagFor(uid, taken);
    }
    const renamed = !!u && (u.name !== name || u.tag !== tag);
    if (u) db.run('update users set name = ?, lname = ?, tag = ?, seen = ? where uid = ?', name, l, tag, t, uid);
    else db.run('insert into users (uid, name, lname, tag, joinable, seen) values (?, ?, ?, ?, 1, ?)', uid, name, l, tag, t);
    return {fresh: !u || t - u.seen > BACK_MS, changed: renamed ? [uid, ...friendIds(uid), ...db.all('select src from requests where dst = ? union select dst from requests where src = ?', uid, uid).map(r => r.src)] : [uid]};
  }
  const seen = uid => db.run('update users set seen = ? where uid = ?', now(), String(uid));

  function state(uid) {
    const me = user(uid);if (!me) return null;
    const mine = presence(uid), t = now();
    const friends = db.all('select u.uid, u.name, u.tag, u.joinable from friends f join users u on u.uid = f.b where f.a = ?', uid).map(u => {
      const p = presence(u.uid), here = !!(p && p.lobby && mine && mine.lobby === p.lobby), open = !!(p && p.lobby && (u.joinable || here));
      // A friend who has "friends can join me" off shows as playing, without the lobby code.
      return {...card(u), online: !!p, playing: !!(p && p.lobby), here, joinable: !!u.joinable, lobby: open ? p.lobby : null, n: open ? p.n : 0, max: open ? p.max : 0};
    }).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
    const people = (q, ...a) => db.all(q, ...a).map(r => ({...card(r), at: r.at}));
    return {
      t: 'state', me: {...card(me), joinable: !!me.joinable}, friends,
      incoming: people('select u.uid, u.name, u.tag, r.at from requests r join users u on u.uid = r.src where r.dst = ? order by r.at', uid),
      outgoing: people('select u.uid, u.name, u.tag, r.at from requests r join users u on u.uid = r.dst where r.src = ? order by r.at', uid),
      invites: db.all('select u.uid, u.name, u.tag, i.code, i.at from invites i join users u on u.uid = i.src where i.dst = ? and i.at > ? order by i.at desc', uid, t - INVITE_MS)
        .map(r => ({...card(r), code: r.code, left: r.at + INVITE_MS - t})),
      limits: {friends: LIMITS.friends}
    };
  }

  function befriend(uid, other) {
    const t = now();
    db.run('delete from requests where (src = ? and dst = ?) or (src = ? and dst = ?)', uid, other, other, uid);
    db.run('delete from declined where (src = ? and dst = ?) or (src = ? and dst = ?)', uid, other, other, uid);
    db.run('insert or ignore into friends (a, b, at) values (?, ?, ?)', uid, other, t);
    db.run('insert or ignore into friends (a, b, at) values (?, ?, ?)', other, uid, t);
  }
  function full(uid, o) {
    if (nFriends(uid) >= LIMITS.friends) return `You have ${LIMITS.friends} friends, the most the game allows – remove one first.`;
    if (nFriends(o.uid) >= LIMITS.friends) return `${o.name} has as many friends as the game allows.`;
    return '';
  }

  function add(uid, text) {
    const me = user(uid);if (!me) return no('Log in first.');
    const {name, tag} = parseTarget(text), t = now();
    if (!name) return no('Type a player name.');
    db.run('delete from adds where at < ?', t - 3600e3);
    // Every try counts, found or not, so nobody can try names by the thousand.
    if (count('select count(*) as n from adds where uid = ?', uid) >= LIMITS.addsPerHour) return no('That is a lot of friend requests in one hour – try again later.');
    db.run('insert into adds (uid, at) values (?, ?)', uid, t);
    const l = name.toLowerCase(), found = tag ? db.all('select uid, name, tag from users where lname = ? and tag = ?', l, tag) : db.all('select uid, name, tag from users where lname = ?', l);
    const others = found.filter(u => u.uid !== uid);
    if (!found.length) return no(`There is no player called ${tag ? `${name} #${tag}` : name}. Check the spelling – it is their account name, the name they have in the lobby.`);
    if (!others.length) return no('That is you.');
    if (others.length > 1) return no(`More than one player is called ${name}: add their number too, like ${name}#1234 (they find it at the top of their Friends list).`);
    const o = others[0];
    if (isFriend(uid, o.uid)) return no(`${label(o)} is your friend already.`);
    if (asked(uid, o.uid)) return no(`You have asked ${label(o)} already – waiting for the answer.`);
    if (asked(o.uid, uid)) return accept(uid, o.uid);// they asked you first: now you are friends
    const why = full(uid, o);if (why) return no(why);
    if (count('select count(*) as n from requests where src = ?', uid) >= LIMITS.outgoing) return no(`You have ${LIMITS.outgoing} requests waiting for an answer – cancel some first.`);
    if (count('select count(*) as n from requests where dst = ?', o.uid) >= LIMITS.incoming) return no(`${label(o)} has too many requests waiting – try again later.`);
    const d = one('select at from declined where src = ? and dst = ?', uid, o.uid);
    if (d && t - d.at < DECLINE_MS) return no(`${label(o)} said no – you can ask again tomorrow.`);
    db.run('insert into requests (src, dst, at) values (?, ?, ?)', uid, o.uid, t);
    return ok(`Friend request sent to ${label(o)}.`, {changed: [uid, o.uid], send: [{uid: o.uid, msg: {t: 'toast', kind: 'request', from: card(me)}}]});
  }

  function accept(uid, id) {
    const me = user(uid), o = user(id);
    if (!me || !o || !asked(id, uid)) return no('That request is not there any more.');
    const why = full(uid, o);if (why) return no(why);
    befriend(uid, id);
    return ok(`You and ${o.name} are friends now.`, {changed: [uid, id], send: [{uid: id, msg: {t: 'toast', kind: 'accepted', from: card(me)}}]});
  }
  function decline(uid, id) {
    if (!asked(id, uid)) return no('That request is not there any more.');
    db.run('delete from requests where src = ? and dst = ?', id, uid);
    db.run('insert or replace into declined (src, dst, at) values (?, ?, ?)', id, uid, now());
    return ok('', {changed: [uid, id]});
  }
  function cancel(uid, id) {
    if (!asked(uid, id)) return no('That request is not there any more.');
    db.run('delete from requests where src = ? and dst = ?', uid, id);
    return ok('', {changed: [uid, id]});
  }
  function remove(uid, id) {
    const o = user(id);if (!o || !isFriend(uid, id)) return no('You are not friends.');
    db.run('delete from friends where (a = ? and b = ?) or (a = ? and b = ?)', uid, id, id, uid);
    db.run('delete from invites where (src = ? and dst = ?) or (src = ? and dst = ?)', uid, id, id, uid);
    return ok(`${o.name} is no longer your friend.`, {changed: [uid, id]});
  }

  function invite(uid, id) {
    const me = user(uid), o = user(id);
    if (!me || !o || !isFriend(uid, id)) return no('You can only invite friends.');
    const mine = presence(uid), p = presence(id);
    if (!mine || !mine.lobby) return no('You are not in a lobby (no connection to the lobby server).');
    if (!p) return no(`${o.name} is offline.`);
    if (p.lobby === mine.lobby) return no(`${o.name} is in your lobby already.`);
    if (mine.n >= mine.max) return no(`Your lobby is full (${mine.max} players).`);
    const old = one('select code, at from invites where src = ? and dst = ?', uid, id), t = now();
    if (old && old.code === mine.lobby && t - old.at < INVITE_AGAIN_MS) return no(`You invited ${o.name} a moment ago.`);
    db.run('insert or replace into invites (src, dst, code, at) values (?, ?, ?, ?)', uid, id, mine.lobby, t);
    return ok(`Invite sent to ${o.name}.`, {changed: [id], send: [{uid: id, msg: {t: 'toast', kind: 'invite', from: card(me), code: mine.lobby}}]});
  }
  function reply(uid, id, yes) {
    const t = now(), inv = one('select code, at from invites where src = ? and dst = ?', id, uid), o = user(id), me = user(uid);
    db.run('delete from invites where at < ?', t - INVITE_MS);
    if (!inv || !o || t - inv.at > INVITE_MS) return {...no('This invite has run out – ask for a new one.'), changed: [uid]};
    db.run('delete from invites where src = ? and dst = ?', id, uid);
    if (!yes) return ok('', {changed: [uid], send: [{uid: id, msg: {t: 'toast', kind: 'no', from: card(me)}}]});
    const stale = why => ({...no(why), changed: [uid]});
    if (!isFriend(uid, id)) return stale('You are not friends any more.');
    const p = presence(id), mine = presence(uid);
    if (!p) return stale(`${o.name} has gone offline.`);
    if (p.lobby !== inv.code) return stale(`${o.name} has left that lobby.`);
    if (mine && mine.lobby === inv.code) return stale(`You are in ${o.name}’s lobby already.`);
    if (p.n >= p.max) return stale(`${o.name}’s lobby is full (${p.max} players).`);
    return ok(`Joining ${o.name}’s lobby…`, {go: inv.code, name: o.name, changed: [uid]});
  }
  function join(uid, id) {
    const o = user(id);if (!o || !isFriend(uid, id)) return no('You can only join friends.');
    const p = presence(id), mine = presence(uid);
    if (!p) return no(`${o.name} is offline.`);
    if (!p.lobby) return no(`${o.name} is not in a lobby right now.`);
    if (mine && mine.lobby === p.lobby) return no(`You are in ${o.name}’s lobby already.`);
    if (!o.joinable) return no(`${o.name} lets friends in by invite only – ask them to invite you.`);
    if (p.n >= p.max) return no(`${o.name}’s lobby is full (${p.max} players).`);
    return ok(`Joining ${o.name}’s lobby…`, {go: p.lobby, name: o.name});
  }
  function setJoinable(uid, on) {
    if (!user(uid)) return no('Log in first.');
    db.run('update users set joinable = ? where uid = ?', on ? 1 : 0, uid);
    return ok(on ? 'Friends can join your lobby.' : 'Friends join you only when you invite them.', {changed: [uid, ...onlineFriends(uid)]});
  }
  return {register, seen, state, add, accept, decline, cancel, remove, invite, reply, join, setJoinable, onlineFriends, friendIds, user};
}
