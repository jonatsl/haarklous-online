/* The feed (issue #184): posts with a text and, if you like, one picture, seen by the one who wrote them and by their
 * friends. The rules and the stored posts, kept apart from the Cloudflare plumbing (friends.js) so the Node tests can run
 * them on Node's own SQLite (tests/feed.test.cjs). The posts live in the Friends object's database, beside the `users` and
 * `friends` tables of friends-rules.js: "my friends' posts" is one lookup.
 *
 * createFeed(db, {now}) -> the feed        db = {all(sql, ...args) -> rows, run(sql, ...args)}
 *   post(uid, text, img)        -> {ok, why, id, to: [the friends' ids]}     img = the JPEG's bytes (Uint8Array) or null
 *   list(uid, {before, limit})  -> {posts: [{id, by: {id, name, tag}, mine, text, at, img, likes, liked}], more}   newest first
 *   image(uid, id)              -> the picture's bytes, or null (not there, or not yours to see)
 *   remove(uid, id)             -> {ok, why}     your own posts only
 *   like(uid, id, on)           -> {ok, why, likes, liked}
 * Who sees a post: its writer, and whoever is the writer's friend at the moment of looking. No longer friends: no longer seen.
 */
export const FEED = {text: 280, imgBytes: 300000, perDay: 40, keep: 200, page: 15};
export const FEED_SCHEMA = [
  'create table if not exists posts (id integer primary key autoincrement, uid text not null, text text not null, at integer not null, img blob)',
  'create index if not exists posts_uid on posts (uid, id)',
  'create table if not exists likes (post integer not null, uid text not null, primary key (post, uid))'
];
// A post's text: no control characters (a line break stays), no long runs of empty lines, at most FEED.text characters.
export const cleanText = s => String(s ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, FEED.text);
export const isJpeg = b => !!b && b.length > 100 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export function createFeed(db, {now = () => Date.now()} = {}) {
  const one = (q, ...a) => db.all(q, ...a)[0] || null, no = why => ({ok: false, why});
  const SEES = '(p.uid = ? or p.uid in (select b from friends where a = ?))';
  function post(uid, text, img = null) {
    const me = one('select uid from users where uid = ?', uid);if (!me) return no('Log in first.');
    text = cleanText(text);
    if (img && !isJpeg(img)) return no('That is not a JPEG picture.');
    if (img && img.length > FEED.imgBytes) return no('The picture is too large.');
    if (!text && !img) return no('Write something, or choose a picture.');
    const t = now();
    if (Number(one('select count(*) as n from posts where uid = ? and at > ?', uid, t - 24 * 3600e3).n) >= FEED.perDay) return no(`That is ${FEED.perDay} posts in a day. Try again tomorrow.`);
    db.run('insert into posts (uid, text, at, img) values (?, ?, ?, ?)', uid, text, t, img || null);
    const id = Number(one('select max(id) as id from posts where uid = ?', uid).id);
    // Only the newest FEED.keep posts of each player are kept.
    const old = db.all('select id from posts where uid = ? order by id desc limit -1 offset ?', uid, FEED.keep).map(r => r.id);
    for (const o of old) {db.run('delete from likes where post = ?', o);db.run('delete from posts where id = ?', o);}
    return {ok: true, id, to: db.all('select b from friends where a = ?', uid).map(r => r.b)};
  }
  function list(uid, {before = 0, limit = FEED.page} = {}) {
    const n = Math.max(1, Math.min(40, limit | 0 || FEED.page)), b = Number(before) > 0 ? Number(before) : 9e15;
    const rows = db.all(`select p.id, p.uid, p.text, p.at, (p.img is not null) as img, u.name, u.tag,
        (select count(*) from likes l where l.post = p.id) as likes, (select count(*) from likes l where l.post = p.id and l.uid = ?) as liked
      from posts p join users u on u.uid = p.uid where p.id < ? and ${SEES} order by p.id desc limit ?`, uid, b, uid, uid, n + 1);
    return {posts: rows.slice(0, n).map(r => ({id: Number(r.id), by: {id: r.uid, name: r.name, tag: r.tag}, mine: r.uid === uid, text: r.text, at: Number(r.at), img: !!r.img, likes: Number(r.likes), liked: !!r.liked})), more: rows.length > n};
  }
  const visible = (uid, id) => one(`select p.id, p.uid from posts p where p.id = ? and ${SEES}`, Number(id) || 0, uid, uid);
  function image(uid, id) {
    if (!visible(uid, id)) return null;const r = one('select img from posts where id = ?', Number(id));
    return r && r.img ? new Uint8Array(r.img) : null;
  }
  function remove(uid, id) {
    const p = one('select uid from posts where id = ?', Number(id) || 0);if (!p || p.uid !== uid) return no('That is not your post.');
    db.run('delete from likes where post = ?', Number(id));db.run('delete from posts where id = ?', Number(id));return {ok: true};
  }
  function like(uid, id, on) {
    if (!visible(uid, id)) return no('That post is gone.');
    if (on) db.run('insert or ignore into likes (post, uid) values (?, ?)', Number(id), uid);else db.run('delete from likes where post = ? and uid = ?', Number(id), uid);
    return {ok: true, likes: Number(one('select count(*) as n from likes where post = ?', Number(id)).n), liked: !!on};
  }
  return {post, list, image, remove, like};
}
