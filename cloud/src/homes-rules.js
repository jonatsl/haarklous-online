/* The rules for owning a flat (issue #106), kept apart from the server plumbing so the Node tests can run them.
 * The flats and their prices are the game's own list (homes-data.js, made by tools/make-homes.cjs).
 * rows = the list of owners as stored: [{id (flat), uid (account), name, price, at}]
 *   listing(rows)                 -> {homes: [{id, name}]}                     what everybody may see
 *   mine(rows, uid)               -> the flat id this account owns, or null
 *   buy(rows, {id, uid, name})    -> {ok: true, row} | {ok: false, status, error, why}
 *   sell(rows, {uid})             -> {ok: true, id, refund} | {ok: false, status, error, why}
 * One flat has one owner, and one account owns one flat at a time.
 */
import HOMES from '../../homes-data.js';

export const CATALOG = new Map(HOMES.map(h => [h.id, h]));
export const SELL_BACK = .8;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export const listing = rows => ({homes: rows.map(r => ({id: r.id, name: r.name}))});
export const mine = (rows, uid) => {const r = rows.find(r => r.uid === uid);return r ? r.id : null;};
export const refundOf = price => Math.round(price * SELL_BACK / 100) * 100;

export function buy(rows, {id, uid, name}) {
  const home = CATALOG.get(String(id));
  if (!home) return {ok: false, status: 404, error: 'unknown', why: 'There is no such flat.'};
  if (!uid) return {ok: false, status: 401, error: 'login', why: 'Log in first: a flat belongs to your account.'};
  const taken = rows.find(r => r.id === home.id);
  if (taken) return taken.uid === uid ? {ok: false, status: 409, error: 'yours', why: 'This flat is yours already.'} : {ok: false, status: 409, error: 'taken', why: `${taken.name} owns this flat.`, name: taken.name};
  const has = rows.find(r => r.uid === uid);
  if (has) return {ok: false, status: 409, error: 'has-one', why: 'You own a flat already – sell it first.', id: has.id};
  return {ok: true, row: {id: home.id, uid: String(uid), name: clean(name, 24) || 'Player', price: home.price}};
}

export function sell(rows, {uid}) {
  if (!uid) return {ok: false, status: 401, error: 'login', why: 'Log in first.'};
  const r = rows.find(r => r.uid === uid);
  if (!r) return {ok: false, status: 409, error: 'none', why: 'You do not own a flat.'};
  return {ok: true, id: r.id, refund: refundOf(r.price)};
}
