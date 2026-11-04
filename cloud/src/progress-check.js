/* What a save of the game's progress may contain (issue #54; used by progress.js, tested in tests/storgata.test.cjs, issue #65).
 * Any key the game uses (haarklous-…, lower case, digits and dashes) is accepted, so new kinds of progress (e.g. the Storgata
 * quests and magic powers, haarklous-storgata-v1) need no server change; each value is a text of at most VALUE_CHARS.
 * saveParts(body) -> {set: [[key, text]], del: [key]}     checkSave(body) -> null (fine) or the error text for a 400 answer
 */
export const VALUE_CHARS = 200000, MAX_KEYS = 40, KEY = /^haarklous-[a-z0-9-]{1,60}$/;

export function saveParts(body) {
  const set = body && typeof body.set === 'object' && body.set ? Object.entries(body.set) : [], del = Array.isArray(body && body.del) ? body.del : [];
  return {set, del};
}

export function checkSave(body) {
  const {set, del} = saveParts(body);
  if (set.length + del.length > MAX_KEYS) return 'Too many keys';
  for (const [k, v] of set) if (!KEY.test(k) || typeof v !== 'string' || v.length > VALUE_CHARS) return `Bad value for ${String(k).slice(0, 70)}`;
  for (const k of del) if (typeof k !== 'string' || !KEY.test(k)) return 'Bad key';
  return null;
}
