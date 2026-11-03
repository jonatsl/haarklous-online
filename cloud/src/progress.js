/* Saved progress for logged-in players (issue #54). Each account has its own Durable Object (class Profile, SQLite storage,
 * keyed by the account id), which keeps the game's progress values (money, bag, best scores, badges, settings …: one text per
 * localStorage key of the game) and the photos (JPEG, at most PHOTO_LIMIT per player). Nobody but the logged-in player reaches it.
 * GET    /api/progress                                  -> {data: {key: text}, at}   (at = time of the last save in ms, 0 = none)
 * PUT    /api/progress  {set: {key: text}, del: [key]}  -> {at}
 * GET    /api/photos                                    -> {photos: [{id, place}], limit}
 * GET    /api/photos/<id>                               -> the JPEG
 * PUT    /api/photos/<id>?place=<text>   (body: JPEG)   -> {count, limit}   409 {error: 'full', limit} when the album is full
 * DELETE /api/photos/<id>                               -> {count, limit}
 */
import {sessionUser} from './auth.js';

export const PHOTO_LIMIT = 60;
const PHOTO_BYTES = 1500000, VALUE_CHARS = 200000, MAX_KEYS = 40, KEY = /^haarklous-[a-z0-9-]{1,60}$/;
const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});

export async function handleProgress(request, env, ctx) {
  if (!env.PROFILE) return json({error: 'Saved progress is not set up on this server'}, 503);
  let user = null;try {user = await sessionUser(request, env, ctx);} catch {return json({error: 'The account server did not answer'}, 503);}
  if (!user) return json({error: 'Not logged in'}, 401);
  return env.PROFILE.get(env.PROFILE.idFromName(`user:${user.id}`)).fetch(request);
}

export class Profile {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec('create table if not exists progress (k text primary key, v text not null, at integer not null)');
    this.sql.exec('create table if not exists photos (id integer primary key, place text, bytes blob not null)');
    this.sql.exec('create table if not exists meta (k text primary key, v integer not null)');
  }
  count() {return this.sql.exec('select count(*) as n from photos').one().n;}
  lastAt() {const r = [...this.sql.exec("select v from meta where k = 'at'")][0];return r ? r.v : 0;}
  async fetch(request) {
    const url = new URL(request.url), method = request.method, path = url.pathname;
    if (path === '/api/progress') {
      if (method === 'GET') {
        const data = {};for (const r of this.sql.exec('select k, v from progress')) data[r.k] = r.v;
        return json({data, at: this.lastAt()});
      }
      if (method === 'PUT') {
        const text = await request.text();if (text.length > 1e6) return json({error: 'Too large'}, 413);
        let body;try {body = JSON.parse(text);} catch {return json({error: 'Bad JSON'}, 400);}
        const set = body && typeof body.set === 'object' && body.set ? Object.entries(body.set) : [], del = Array.isArray(body && body.del) ? body.del : [];
        if (set.length + del.length > MAX_KEYS) return json({error: 'Too many keys'}, 400);
        for (const [k, v] of set) if (!KEY.test(k) || typeof v !== 'string' || v.length > VALUE_CHARS) return json({error: `Bad value for ${String(k).slice(0, 70)}`}, 400);
        for (const k of del) if (typeof k !== 'string' || !KEY.test(k)) return json({error: 'Bad key'}, 400);
        // Every save gets a later time than the one before, so a client can tell whether the account changed since it last saw it.
        const at = Math.max(Date.now(), this.lastAt() + 1);
        for (const [k, v] of set) this.sql.exec('insert into progress (k, v, at) values (?, ?, ?) on conflict(k) do update set v = excluded.v, at = excluded.at', k, v, at);
        for (const k of del) this.sql.exec('delete from progress where k = ?', k);
        if (!set.length && !del.length) return json({at: this.lastAt()});
        this.sql.exec("insert into meta (k, v) values ('at', ?) on conflict(k) do update set v = excluded.v", at);
        return json({at});
      }
      return json({error: 'Method not allowed'}, 405);
    }
    if (path === '/api/photos') {
      if (method !== 'GET') return json({error: 'Method not allowed'}, 405);
      return json({photos: [...this.sql.exec('select id, place from photos order by id')].map(r => ({id: r.id, place: r.place || ''})), limit: PHOTO_LIMIT});
    }
    const m = path.match(/^\/api\/photos\/(\d{1,15})$/);if (!m) return json({error: 'Not found'}, 404);
    const id = +m[1];
    if (method === 'GET') {
      const r = [...this.sql.exec('select bytes from photos where id = ?', id)][0];if (!r) return json({error: 'Not found'}, 404);
      return new Response(r.bytes, {headers: {'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', Vary: 'Cookie'}});
    }
    if (method === 'PUT') {
      const bytes = await request.arrayBuffer(), b = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
      if (bytes.byteLength > PHOTO_BYTES) return json({error: 'The photo is too large'}, 413);
      if (bytes.byteLength < 100 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return json({error: 'Not a JPEG'}, 400);
      const exists = [...this.sql.exec('select id from photos where id = ?', id)].length > 0;
      if (!exists && this.count() >= PHOTO_LIMIT) return json({error: 'full', limit: PHOTO_LIMIT}, 409);
      const place = String(url.searchParams.get('place') || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 80);
      this.sql.exec('insert into photos (id, place, bytes) values (?, ?, ?) on conflict(id) do update set place = excluded.place, bytes = excluded.bytes', id, place, bytes);
      return json({count: this.count(), limit: PHOTO_LIMIT});
    }
    if (method === 'DELETE') {this.sql.exec('delete from photos where id = ?', id);return json({count: this.count(), limit: PHOTO_LIMIT});}
    return json({error: 'Method not allowed'}, 405);
  }
}
