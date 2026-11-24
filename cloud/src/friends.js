/* Friends (issue #115): one Durable Object for the whole game (class Friends, SQLite storage, binding FRIENDS) keeps who is
 * friends with whom, the requests and the invites (rules in friends-rules.js), and holds one WebSocket per open game of a
 * logged-in player. The socket is the player's presence: open = online, and it says which lobby the game is in.
 *
 * GET /api/friends/ws (WebSocket)   the Worker checks the session and the page's origin, then hands the socket to the object.
 * Game -> server: {t: 'lobby', code | null, n, max} · {t: 'add', name} · {t: 'accept' | 'decline' | 'cancel' | 'remove' |
 *   'invite' | 'join', id} · {t: 'reply', id, yes} · {t: 'joinable', on} · {t: 'state'} · the text 'ping' (answered 'pong'
 *   without waking the object).
 * Server -> game: {t: 'state', me, friends, incoming, outgoing, invites} whenever something in it changes ·
 *   {t: 'answer', op, ok, why, go?, name?} · {t: 'toast', kind: 'request' | 'accepted' | 'invite' | 'no' | 'online', from, code?}
 *
 * Costs (Cloudflare's free plan): sockets use the hibernation API, so an idle socket costs nothing and the game's ping every
 * 25 s is answered by Cloudflare without waking the object. A game that vanished without closing its socket (sleep, lost
 * network) stops counting as online after ONLINE_MS; an alarm once a minute, only while sockets are open, closes such sockets
 * and tells the friends.
 */
import {sessionUser} from './auth.js';
import {CODE, ONLINE_MS, SCHEMA, createFriends} from './friends-rules.js';
import {FEED, FEED_SCHEMA, createFeed} from './feed-rules.js';

export async function handleFriends(request, env, ctx) {
  if (!env.FRIENDS) return Response.json({error: 'Friends are not set up on this server'}, {status: 503});
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', {status: 426});
  // Only the game's own page may open it (a WebSocket is not covered by the browser's same-origin rule).
  const url = new URL(request.url), origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return new Response('Wrong origin', {status: 403});
  let user = null;try {user = await sessionUser(request, env, ctx);} catch {return new Response('The account server did not answer', {status: 503});}
  if (!user) return new Response('Not logged in', {status: 401});
  // The object trusts only what the Worker tells it about who is asking.
  const inner = new Request('https://friends/ws', {headers: {Upgrade: 'websocket', 'X-Uid': String(user.id), 'X-Name': encodeURIComponent(user.name || '')}});
  return env.FRIENDS.get(env.FRIENDS.idFromName('world')).fetch(inner);
}

// The feed (issue #184): /api/feed (GET the posts you may see, POST a new one as JSON {text, img: a JPEG in base64}),
// /api/feed/img/<id> (GET the picture), /api/feed/<id> (DELETE your post), /api/feed/<id>/like (POST {on}).
export async function handleFeed(request, env, ctx) {
  const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
  if (!env.FRIENDS) return json({error: 'The feed is not set up on this server'}, 503);
  const url = new URL(request.url), origin = request.headers.get('Origin');
  // Only the game's own page may write (the session is a cookie).
  if (request.method !== 'GET' && origin && origin !== url.origin) return json({error: 'Wrong origin'}, 403);
  let user = null;try {user = await sessionUser(request, env, ctx);} catch {return json({error: 'The account server did not answer'}, 503);}
  if (!user) return json({error: 'Not logged in'}, 401);
  const len = Number(request.headers.get('Content-Length') || 0);if (len > FEED.imgBytes * 1.4 + 4000) return json({error: 'Too large'}, 413);
  const inner = new Request('https://friends' + url.pathname.replace(/^\/api/, '') + url.search, {method: request.method, headers: {'X-Uid': String(user.id), 'X-Name': encodeURIComponent(user.name || '')}, body: request.method === 'POST' ? await request.text() : undefined});
  return env.FRIENDS.get(env.FRIENDS.idFromName('world')).fetch(inner);
}

const OPS = new Set(['add', 'accept', 'decline', 'cancel', 'remove', 'invite', 'join', 'reply', 'joinable', 'state', 'lobby']);

export class Friends {
  constructor(ctx) {
    this.ctx = ctx;const sql = ctx.storage.sql;
    for (const s of [...SCHEMA, ...FEED_SCHEMA]) sql.exec(s);
    this.core = createFriends({all: (q, ...a) => [...sql.exec(q, ...a)], run: (q, ...a) => {sql.exec(q, ...a);}}, {presence: uid => this.presence(uid)});
    this.feed = createFeed({all: (q, ...a) => [...sql.exec(q, ...a)], run: (q, ...a) => {sql.exec(q, ...a);}});
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.rate = new Map();
  }
  // When did this game last show a sign of life (a message, or a ping answered by Cloudflare)?
  lastSeen(ws) {
    const a = ws.deserializeAttachment() || {}, auto = this.ctx.getWebSocketAutoResponseTimestamp(ws);
    return Math.max(a.at || 0, auto ? auto.getTime() : 0);
  }
  sockets(uid, except) {const t = Date.now();return this.ctx.getWebSockets(uid).filter(ws => ws !== except && !(ws.deserializeAttachment() || {}).left && t - this.lastSeen(ws) < ONLINE_MS);}
  presence(uid, except) {
    const live = this.sockets(uid, except);if (!live.length) return null;
    // Two games open on one account: the one that changed lobby last counts.
    const a = live.map(ws => ws.deserializeAttachment()).sort((x, y) => (y.la || 0) - (x.la || 0))[0];
    return {lobby: a.lobby || null, n: a.n || 0, max: a.max || 12};
  }
  sendTo(uid, msg) {const s = JSON.stringify(msg);for (const ws of this.sockets(uid)) try {ws.send(s);} catch {}}
  apply(r) {
    for (const uid of new Set(r.changed || [])) if (this.sockets(uid).length) this.sendTo(uid, this.core.state(uid));
    for (const {uid, msg} of r.send || []) this.sendTo(uid, msg);
  }
  async alarmSoon() {try {if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60e3);} catch {}}

  async fetch(request) {
    const uid = request.headers.get('X-Uid');if (!uid) return new Response('Bad request', {status: 400});
    const name = decodeURIComponent(request.headers.get('X-Name') || ''), wasOnline = this.sockets(uid).length > 0;
    if (new URL(request.url).pathname.startsWith('/feed')) return this.feedFetch(request, uid, name);
    const [client, ws] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(ws, [uid]);
    ws.serializeAttachment({uid, at: Date.now(), lobby: null, n: 0, max: 12, la: 0});
    const reg = this.core.register(uid, name);
    ws.send(JSON.stringify(this.core.state(uid)));
    const friends = this.core.onlineFriends(uid).filter(id => id !== uid);
    this.apply({changed: wasOnline ? reg.changed.filter(id => id !== uid) : [...reg.changed.filter(id => id !== uid), ...friends]});
    // "Kari is online" – not for a quick reconnect or a second game on the same account.
    if (!wasOnline && reg.fresh) {const me = this.core.user(uid);for (const id of friends) this.sendTo(id, {t: 'toast', kind: 'online', from: {id: uid, name: me.name, tag: me.tag}});}
    await this.alarmSoon();
    return new Response(null, {status: 101, webSocket: client});
  }

  // The feed's requests (see handleFeed). A new post is told to the writer's friends who are online.
  async feedFetch(request, uid, name) {
    const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
    const url = new URL(request.url), path = url.pathname, method = request.method, F = this.feed;
    if (!this.core.user(uid)) this.core.register(uid, name);
    const m = path.match(/^\/feed\/(img\/)?(\d+)(\/like)?$/);
    if (path === '/feed' && method === 'GET') return json({...F.list(uid, {before: Number(url.searchParams.get('before')) || 0}), limits: {text: FEED.text, imgBytes: FEED.imgBytes}});
    if (path === '/feed' && method === 'POST') {
      let b = null;try {b = JSON.parse(await request.text());} catch {}if (!b || typeof b !== 'object') return json({ok: false, why: 'Bad request'}, 400);
      let img = null;if (typeof b.img === 'string' && b.img) {try {img = Uint8Array.from(atob(b.img.replace(/^data:image\/jpeg;base64,/, '')), c => c.charCodeAt(0));} catch {return json({ok: false, why: 'The picture could not be read.'}, 400);}}
      const r = F.post(uid, b.text, img);
      if (r.ok) {const me = this.core.user(uid);for (const id of r.to) this.sendTo(id, {t: 'toast', kind: 'post', from: {id: uid, name: me.name, tag: me.tag}});}
      return json({ok: r.ok, why: r.why, id: r.id}, r.ok ? 200 : 400);
    }
    if (m && m[1] && method === 'GET') {const bytes = F.image(uid, m[2]);return bytes ? new Response(bytes, {headers: {'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400'}}) : new Response('Not found', {status: 404});}
    if (m && !m[1] && !m[3] && method === 'DELETE') {const r = F.remove(uid, m[2]);return json(r, r.ok ? 200 : 403);}
    if (m && m[3] && method === 'POST') {let b = {};try {b = JSON.parse(await request.text()) || {};} catch {}const r = F.like(uid, m[2], !!b.on);return json(r, r.ok ? 200 : 404);}
    return json({error: 'Not found'}, 404);
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 2000) return;
    let m;try {m = JSON.parse(data);} catch {return;}
    if (!m || !OPS.has(m.t)) return;
    const a = ws.deserializeAttachment() || {}, uid = a.uid, t = Date.now();if (!uid) return;
    // At most 40 messages in 10 s from one account (a game sends a few a minute).
    const r = this.rate.get(uid) || {t, n: 0};if (t - r.t > 10e3) {r.t = t;r.n = 0;}r.n++;this.rate.set(uid, r);if (r.n > 40) return;
    a.at = t;
    if (m.t === 'lobby') {
      const code = typeof m.code === 'string' && CODE.test(m.code) ? m.code : null;
      const n = Math.max(0, Math.min(64, m.n | 0)), max = Math.max(1, Math.min(64, m.max | 0 || 12));
      const moved = code !== a.lobby || n !== a.n || max !== a.max;
      Object.assign(a, {lobby: code, n, max, la: moved ? t : a.la});ws.serializeAttachment(a);
      if (moved) this.apply({changed: [uid, ...this.core.onlineFriends(uid)]});
      return;
    }
    ws.serializeAttachment(a);
    if (m.t === 'state') {ws.send(JSON.stringify(this.core.state(uid)));return;}
    const id = String(m.id ?? '').slice(0, 200), c = this.core;
    const res = m.t === 'add' ? c.add(uid, m.name) : m.t === 'reply' ? c.reply(uid, id, !!m.yes) : m.t === 'joinable' ? c.setJoinable(uid, !!m.on) : c[m.t](uid, id);
    try {ws.send(JSON.stringify({t: 'answer', op: m.t, q: m.q, ...res.answer}));} catch {}
    this.apply(res);
  }

  async webSocketClose(ws, code) {this.gone(ws);try {ws.close(code === 1005 ? 1000 : code);} catch {}}
  async webSocketError(ws) {this.gone(ws);}
  gone(ws) {
    const a = ws.deserializeAttachment() || {};if (!a.uid || a.left) return;
    a.left = true;try {ws.serializeAttachment(a);} catch {}
    this.core.seen(a.uid);
    if (!this.sockets(a.uid, ws).length) this.apply({changed: this.core.onlineFriends(a.uid)});
  }
  // Once a minute while games are connected: close the sockets of games that have gone quiet, so they show as offline.
  async alarm() {
    const t = Date.now(), quiet = new Set();
    for (const ws of this.ctx.getWebSockets()) if (t - this.lastSeen(ws) >= ONLINE_MS) {
      const a = ws.deserializeAttachment() || {};if (a.uid && !a.left) {quiet.add(a.uid);a.left = true;try {ws.serializeAttachment(a);} catch {}}
      try {ws.close(4000, 'No sign of life');} catch {}
    }
    for (const uid of quiet) if (!this.sockets(uid).length) {this.core.seen(uid);this.apply({changed: this.core.onlineFriends(uid)});}
    if (this.ctx.getWebSockets().some(ws => !(ws.deserializeAttachment() || {}).left)) await this.ctx.storage.setAlarm(Date.now() + 60e3);
  }
}
