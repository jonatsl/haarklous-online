/* Who owns which flat (issue #106). One Durable Object for the whole game (class Homes, SQLite storage) keeps the list, so
 * two players can never own the same flat: every request goes through it one at a time.
 * GET  /api/homes            -> {homes: [{id, name}]}                 for everybody (the names on the doors)
 * GET  /api/homes?mine=1     -> the same plus {mine: id | null, name}  for the logged-in player
 * POST /api/homes/buy  {id}  -> {ok: true, id, price, homes, mine}    401 not logged in, 404 no such flat, 409 {error: 'taken' | 'has-one' | 'yours', why}
 * POST /api/homes/sell       -> {ok: true, id, refund, homes, mine}   409 {error: 'none'}
 * The price is paid from the wallet in the game (the wallet lives with the player's progress, like the shops' money).
 */
import {sessionUser} from './auth.js';
import {buy, listing, mine, sell} from './homes-rules.js';

const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});

export async function handleHomes(request, env, ctx) {
  if (!env.HOMES) return json({error: 'Flats are not set up on this server'}, 503);
  const url = new URL(request.url), post = request.method === 'POST';
  if (!post && request.method !== 'GET') return json({error: 'Method not allowed'}, 405);
  const stub = env.HOMES.get(env.HOMES.idFromName('world'));
  let user = null;
  if (post || url.searchParams.get('mine')) {
    try {user = await sessionUser(request, env, ctx);} catch {return json({error: 'The account server did not answer'}, 503);}
    if (post && !user) return json({error: 'login', why: 'Log in first: a flat belongs to your account.'}, 401);
  }
  let id = '';
  if (post) {try {id = String((await request.json()).id ?? '');} catch {id = '';}}
  // The object trusts only what the Worker tells it about who is asking.
  const inner = new Request(`https://homes${url.pathname}`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({op: !post ? 'list' : url.pathname.endsWith('/buy') ? 'buy' : url.pathname.endsWith('/sell') ? 'sell' : '', id, uid: user ? String(user.id) : '', name: user ? user.name : ''})});
  return stub.fetch(inner);
}

export class Homes {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec('create table if not exists homes (id text primary key, uid text not null unique, name text not null, price integer not null, at integer not null)');
  }
  rows() {return [...this.sql.exec('select id, uid, name, price, at from homes order by at')];}
  async fetch(request) {
    let m;try {m = await request.json();} catch {return json({error: 'Bad request'}, 400);}
    const rows = this.rows(), mineOf = r => m.uid ? {mine: mine(r, m.uid), name: m.name || ''} : {};
    if (m.op === 'list') return json({...listing(rows), ...mineOf(rows)});
    if (m.op === 'buy') {
      const r = buy(rows, m);if (!r.ok) return json({...r, ...listing(rows), ...mineOf(rows)}, r.status);
      this.sql.exec('insert into homes (id, uid, name, price, at) values (?, ?, ?, ?, ?)', r.row.id, r.row.uid, r.row.name, r.row.price, Date.now());
      const after = this.rows();return json({ok: true, id: r.row.id, price: r.row.price, ...listing(after), ...mineOf(after)});
    }
    if (m.op === 'sell') {
      const r = sell(rows, m);if (!r.ok) return json({...r, ...listing(rows), ...mineOf(rows)}, r.status);
      this.sql.exec('delete from homes where uid = ?', m.uid);
      const after = this.rows();return json({ok: true, id: r.id, refund: r.refund, ...listing(after), ...mineOf(after)});
    }
    return json({error: 'Not found'}, 404);
  }
}
