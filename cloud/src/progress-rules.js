/* What a save of a player's progress may hold (issue #54; used by progress.js, tested in tests/progress.test.cjs).
 * Any game key that matches KEY is accepted (money, best scores, badges, licences, settings …), so a new kind of saved
 * progress needs no server change as long as its key is 'haarklous-' + lower-case letters, digits and dashes.
 */
export const PHOTO_BYTES = 1500000, VALUE_CHARS = 200000, MAX_KEYS = 40, KEY = /^haarklous-[a-z0-9-]{1,60}$/;

// body = {set: {key: text}, del: [key]} -> {set: [[key, text]], del: [key]} or {error}
export function checkSave(body) {
  const set = body && typeof body.set === 'object' && body.set ? Object.entries(body.set) : [], del = Array.isArray(body && body.del) ? body.del : [];
  if (set.length + del.length > MAX_KEYS) return {error: 'Too many keys'};
  for (const [k, v] of set) if (!KEY.test(k) || typeof v !== 'string' || v.length > VALUE_CHARS) return {error: `Bad value for ${String(k).slice(0, 70)}`};
  for (const k of del) if (typeof k !== 'string' || !KEY.test(k)) return {error: 'Bad key'};
  return {set, del};
}
