/* The feed (issue #184): write posts, with a picture if you like, for your friends in the game; read theirs, like them.
 * Needs an account (game-account.js) and the online game: the posts live on the server (cloud/src/feed-rules.js, in the
 * Friends object; /api/feed). A post is seen by its writer and by the writer's friends.
 *
 * Pure parts (Node-tested in tests/feed.test.cjs):
 *   GameFeed.ago(ms) -> 'now' · '5 min' · '3 h' · '2 d' · null (older: show the date)
 *   GameFeed.rows({posts, more}) -> the panel's rows [{key, kind: 'new' | 'post' | 'more', item, actions: [{op, label}]}]
 *   GameFeed.fit(w, h, max) -> the size a picture is posted in (at most max on its long side)
 * GameFeed.create({root, button, account, notice, photos() (your album: [{id, data | src, place}]), keyboard (GameFriends:
 *   OSK, osk), sound()}) -> {open(), close(), isOpen, input(input), userChanged(), news(from)}
 *   The panel (#feed, over the pause menu) is made here; so is its CSS.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameFeed = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const MAX_TEXT = 280, IMG_SIDE = 960, IMG_CHARS = 380000;// a JPEG of about 285 kB as base64
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  function ago(ms) {
    if (!(ms >= 0)) return 'now';const m = Math.floor(ms / 60000);
    return m < 1 ? 'now' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : m < 7 * 1440 ? `${Math.floor(m / 1440)} d` : null;
  }
  function fit(w, h, max = IMG_SIDE) {const k = Math.min(1, max / Math.max(w, h, 1));return {w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k))};}
  function rows(st) {
    const list = [{key: 'new', kind: 'new', actions: [{op: 'write', label: 'Write'}, {op: 'album', label: 'Photo from your album'}, {op: 'file', label: 'Picture from this device'}, {op: 'post', label: 'Post'}]}];
    for (const p of (st && st.posts) || []) list.push({key: 'p' + p.id, kind: 'post', item: p, actions: [{op: 'like', label: `${p.liked ? '♥' : '♡'} ${p.likes || ''}`.trim()}, ...(p.mine ? [{op: 'del', label: 'Delete', danger: true}] : [])]});
    if (st && st.more) list.push({key: 'more', kind: 'more', actions: [{op: 'more', label: 'Older posts'}]});
    return list;
  }
  const CSS = `
#feed{z-index:7}#feed .panel{width:min(640px,calc(100% - 32px));background:#11161c}
#feed .fd-me{margin:4px 0 10px}#feed .fd-me b{color:#ffd166}
#feed .fd-row{padding:10px 12px;margin:6px 0;border-radius:10px;background:#ffffff0d;border:2px solid transparent}
#feed .fd-row.sel{border-color:#ffd166;background:#ffffff18}
#feed textarea{width:100%;box-sizing:border-box;min-height:58px;resize:vertical;font:inherit;color:inherit;background:#0b0f14;border:1px solid #ffffff33;border-radius:8px;padding:8px}
#feed .fd-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center}
#feed .fd-acts button{margin:0;padding:6px 12px;font-size:14px;background:#ffffff1a;color:#fff;border:1px solid #ffffff33}#feed .fd-acts button.on{background:#ffd166;color:#111;border-color:#ffd166}#feed .fd-acts button.danger{color:#ff9a8a}#feed .fd-acts button.danger.on{background:#e5484d;color:#fff;border-color:#e5484d}
#feed .fd-count{margin-left:auto;font-size:12px;opacity:.7}
#feed .fd-pick{display:flex;gap:10px;align-items:center;margin-top:8px;font-size:13px}#feed .fd-pick img{max-height:110px;max-width:200px;border-radius:6px}
#feed .fd-post header{display:flex;gap:8px;align-items:baseline}#feed .fd-post header small{opacity:.65}
#feed .fd-post p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.35}
#feed .fd-post img{display:block;max-width:100%;max-height:420px;border-radius:8px;margin:6px 0;background:#0b0f14}
#feed .fd-msg{min-height:1.3em;color:#ffd166;margin:8px 0}
#feed .fd-osk{display:grid;grid-template-columns:repeat(10,1fr);gap:4px;margin-top:8px}
#feed .fd-osk span{padding:7px 0;text-align:center;border-radius:6px;background:#ffffff14;font-weight:600}#feed .fd-osk span.wide{grid-column:span 2}#feed .fd-osk span.sel{background:#ffd166;color:#111}
#feedOpen .fd-badge{display:inline-block;margin-left:6px;padding:0 7px;border-radius:9px;background:#e5484d;color:#fff;font-size:12px}`;
  const KEY_LABEL = {space: '␣ space', del: '⌫', ok: '✓ Done'};

  function create({root, button, account, notice = () => {}, photos = () => [], keyboard = null, sound = () => {}}) {
    const style = document.createElement('style');style.textContent = CSS;document.head.append(style);
    const panel = document.createElement('section');panel.id = 'feed';panel.className = 'overlay';panel.hidden = true;root.append(panel);
    panel.innerHTML = `<div class="panel"><span class="eyebrow">FEED</span><h2>Feed</h2><p class="small fd-me"></p>
      <form class="fd-row fd-new" data-key="new" autocomplete="off"><textarea class="fd-text" maxlength="${MAX_TEXT}" rows="2" placeholder="Write something to your friends…"></textarea>
        <div class="fd-pick" hidden><img alt=""><span></span></div><div class="fd-acts"></div><div class="fd-osk" hidden></div><input class="fd-file" type="file" accept="image/*" hidden></form>
      <p class="fd-msg" role="status" aria-live="polite"></p><div class="fd-list"></div>
      <p class="small">Controller: ↑↓ choose · ←→ choose a button · ✕ do it · ○ back · Keyboard: arrows, Space, C or Esc back · or use the mouse</p>
      <button type="button" class="fd-close">Close</button></div>`;
    const $ = s => panel.querySelector(s), form = $('.fd-new'), field = $('.fd-text'), list = $('.fd-list'), meEl = $('.fd-me'), msgEl = $('.fd-msg'), oskEl = $('.fd-osk'), pickEl = $('.fd-pick'), fileEl = $('.fd-file');
    const st = {posts: [], more: false, loaded: false, busy: false};
    const ui = {sel: 0, act: 0, osk: null, msg: '', confirm: null, stickY: false, stickX: false, fresh: 0};
    let pick = null;// the picture of the post being written: {data (a JPEG data URL), label, album (index in your album) | null}
    const ready = () => account.available && !!account.user;
    const api = (path, opt = {}) => fetch('/api/feed' + path, {credentials: 'same-origin', ...opt}).then(async r => {let b = null;try {b = await r.json();} catch {}return {status: r.status, ok: r.ok, body: b || {}};});

    // ---------- the server ----------
    function load(more = false) {
      if (!ready() || st.busy) return;st.busy = true;
      const before = more && st.posts.length ? st.posts[st.posts.length - 1].id : 0;
      api(before ? `?before=${before}` : '').then(r => {
        st.busy = false;if (!r.ok) {ui.msg = r.status === 401 ? 'Log in to see the feed.' : 'The feed did not answer – try again.';render();return;}
        // Only what the panel needs, in the types it expects.
        const got = (Array.isArray(r.body.posts) ? r.body.posts : []).map(p => ({id: Number(p.id) || 0, by: {name: String((p.by && p.by.name) ?? ''), tag: String((p.by && p.by.tag) ?? '')}, mine: !!p.mine, text: String(p.text ?? ''), at: Number(p.at) || 0, img: !!p.img, likes: Number(p.likes) || 0, liked: !!p.liked}));
        st.posts = more ? [...st.posts, ...got] : got;st.more = !!r.body.more;st.loaded = true;render();
      }).catch(() => {st.busy = false;ui.msg = 'No connection to the feed – try again.';render();});
    }
    function send() {
      const text = field.value.trim();if (!text && !pick) {ui.msg = 'Write something, or choose a picture.';render();return;}
      if (st.busy) return;st.busy = true;ui.msg = 'Posting…';render();
      api('', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, img: pick ? pick.data : null})}).then(r => {
        st.busy = false;
        if (!r.ok || !r.body.ok) {ui.msg = r.body.why || (r.status === 401 ? 'Log in first.' : r.status === 413 ? 'The picture is too large.' : 'The post could not be sent – try again.');render();return;}
        field.value = '';pick = null;ui.osk = null;ui.msg = 'Posted. Your friends can see it now.';sound('post');load();
      }).catch(() => {st.busy = false;ui.msg = 'No connection to the feed – try again.';render();});
    }
    function like(p) {
      const on = !p.liked;p.liked = on;p.likes = Math.max(0, (p.likes || 0) + (on ? 1 : -1));render();
      api(`/${p.id}/like`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({on})}).then(r => {if (r.ok && r.body.ok) {p.likes = r.body.likes;p.liked = r.body.liked;render();}}).catch(() => {});
    }
    function del(p) {
      if (ui.confirm !== p.id) {ui.confirm = p.id;ui.msg = 'Delete this post? Press Delete once more.';render();return;}
      ui.confirm = null;api(`/${p.id}`, {method: 'DELETE'}).then(r => {if (r.ok) {st.posts = st.posts.filter(q => q !== p);ui.msg = 'Deleted.';ui.sel = Math.min(ui.sel, rows(st).length - 1);} else ui.msg = r.body.why || 'Could not delete it.';render();}).catch(() => {ui.msg = 'No connection to the feed – try again.';render();});
    }

    // ---------- the picture: from your album or from this device, made a JPEG of at most IMG_SIDE on its long side ----------
    function toJpeg(src) {
      return new Promise((res, rej) => {
        const im = new Image();im.onerror = () => rej(new Error('load'));
        im.onload = () => {
          try {
            let side = IMG_SIDE, q = .82, data = '';
            for (let k = 0; k < 4; k++) {const s = fit(im.naturalWidth, im.naturalHeight, side), c = document.createElement('canvas');c.width = s.w;c.height = s.h;c.getContext('2d').drawImage(im, 0, 0, s.w, s.h);data = c.toDataURL('image/jpeg', q);if (data.length <= IMG_CHARS) break;side = Math.round(side * .8);q -= .1;}
            if (data.length > IMG_CHARS || !data.startsWith('data:image/jpeg')) rej(new Error('size'));else res(data);
          } catch (e) {rej(e);}
        };
        im.src = src;
      });
    }
    function choose(src, label, album = null) {
      ui.msg = 'Getting the picture ready…';render();
      toJpeg(src).then(data => {pick = {data, label, album};ui.msg = '';render();}).catch(() => {ui.msg = 'That picture could not be used.';render();});
    }
    // Each press takes the next photo of your album, newest first; after the oldest: no picture.
    function nextAlbum() {
      const A = photos() || [];if (!A.length) {ui.msg = 'Your album is empty: take photos with the camera first (D-pad ↑ in the game).';render();return;}
      const i = pick && pick.album !== null ? pick.album - 1 : A.length - 1;
      if (i < 0) {pick = null;ui.msg = 'No picture.';render();return;}
      const p = A[i];choose(p.data || p.src, `Album photo ${i + 1} of ${A.length}${p.place ? ' · ' + p.place : ''}`, i);
    }
    fileEl.addEventListener('change', () => {const f = fileEl.files && fileEl.files[0];fileEl.value = '';if (!f) return;const u = URL.createObjectURL(f);choose(u, f.name.slice(0, 40));setTimeout(() => URL.revokeObjectURL(u), 30000);});

    // ---------- drawing ----------
    function render() {
      if (button) button.innerHTML = `Feed${ui.fresh ? `<span class="fd-badge" title="new posts">${ui.fresh}</span>` : ''}`;
      if (panel.hidden) return;
      meEl.innerHTML = !account.available ? 'The feed works in the online game with an account. This copy of the game is offline.' : !account.user ? 'Log in (in the pause menu) to write posts and to see what your friends post.'
        : `You post as <b>${esc(account.user.name)}</b>. Your posts are seen by you and by your friends in the game (the Friends list).`;
      form.hidden = !ready();
      const R = ready() ? rows(st) : [];ui.sel = Math.max(0, Math.min(R.length - 1, ui.sel));const cur = R[ui.sel];if (cur) ui.act = Math.max(0, Math.min(cur.actions.length - 1, ui.act));
      const acts = (r, i) => r.actions.map((a, k) => `<button type="${a.op === 'post' ? 'submit' : 'button'}" data-op="${a.op}" class="${i === ui.sel && k === ui.act ? 'on' : ''}${a.danger ? ' danger' : ''}">${esc(a.op === 'del' && ui.confirm === (r.item && r.item.id) ? 'Delete – sure?' : a.label)}</button>`).join('');
      form.classList.toggle('sel', ui.sel === 0);
      if (R.length) $('.fd-new .fd-acts').innerHTML = acts(R[0], 0) + `<span class="fd-count">${field.value.length} / ${MAX_TEXT}</span>`;
      pickEl.hidden = !pick;if (pick) {const im = pickEl.querySelector('img');if (im.src !== pick.data) im.src = pick.data;pickEl.querySelector('span').textContent = pick.label;}
      oskEl.hidden = !ui.osk;
      if (ui.osk && keyboard) oskEl.innerHTML = keyboard.OSK.map((row, r) => row.map((k, c) => (c > 0 && row[c - 1] === k) ? '' :
        `<span data-r="${r}" data-c="${c}" class="${row[c + 1] === k ? 'wide' : ''}${ui.osk.r === r && (ui.osk.c === c || (row[ui.osk.c] === k)) ? ' sel' : ''}">${KEY_LABEL[k] || k}</span>`).join('')).join('');
      const t = Date.now();let h = '';
      R.forEach((r, i) => {
        if (r.kind === 'post') {const p = r.item, a = ago(t - p.at);
          h += `<article class="fd-row fd-post${i === ui.sel ? ' sel' : ''}" data-key="${r.key}"><header><b>${esc(p.by.name)}</b><small>#${esc(p.by.tag)} · ${a || new Date(p.at).toLocaleDateString()}</small></header>${p.text ? `<p>${esc(p.text)}</p>` : ''}${p.img ? `<img src="/api/feed/img/${p.id}" alt="picture" loading="lazy">` : ''}<div class="fd-acts">${acts(r, i)}</div></article>`;}
        else if (r.kind === 'more') h += `<div class="fd-row${i === ui.sel ? ' sel' : ''}" data-key="more"><div class="fd-acts">${acts(r, i)}</div></div>`;
      });
      if (ready() && st.loaded && !st.posts.length) h = '<p class="small">Nothing here yet. Write the first post – and add friends (pause menu → Friends) to see theirs.</p>';
      if (list.dataset.sig !== h) {list.innerHTML = h;list.dataset.sig = h;}
      msgEl.textContent = ui.msg;
      const s = ui.sel === 0 ? form : list.querySelector('.fd-row.sel');if (s && s.scrollIntoView && ui.scroll) {ui.scroll = false;s.scrollIntoView({block: 'nearest'});}
    }
    function perform(key, op) {
      const r = rows(st).find(q => q.key === key);if (!r) return;if (op !== 'del') ui.confirm = null;
      if (op === 'write') {if (keyboard) {ui.osk = ui.osk ? null : {r: 0, c: 0, text: field.value};} else field.focus();}
      else if (op === 'album') nextAlbum();
      else if (op === 'file') fileEl.click();
      else if (op === 'post') send();
      else if (op === 'like') like(r.item);
      else if (op === 'del') del(r.item);
      else if (op === 'more') load(true);
      render();
    }
    panel.addEventListener('click', e => {
      const b = e.target.closest('button[data-op]'), row = e.target.closest('[data-key]'), k = e.target.closest('.fd-osk span');
      if (k && ui.osk) {ui.osk.r = +k.dataset.r;ui.osk.c = +k.dataset.c;oskKey('press');return;}
      if (row) {const i = rows(st).findIndex(q => q.key === row.dataset.key);if (i >= 0) ui.sel = i;}
      if (b && row) {e.preventDefault();if (b.dataset.op === 'write') {field.focus();render();} else perform(row.dataset.key, b.dataset.op);}
    });
    form.addEventListener('submit', e => {e.preventDefault();});
    field.addEventListener('input', () => {const c = $('.fd-count');if (c) c.textContent = `${field.value.length} / ${MAX_TEXT}`;});
    field.addEventListener('focus', () => {ui.sel = 0;ui.osk = null;render();});
    function oskKey(action) {
      if (!ui.osk || !keyboard) return;
      if (action === 'press' && keyboard.OSK[ui.osk.r][ui.osk.c] === 'ok') {ui.osk = null;render();return;}
      ui.osk = keyboard.osk({...ui.osk, text: field.value}, action, MAX_TEXT, true);field.value = ui.osk.text;render();
    }
    function input(inp) {
      const p = inp.pressed, x = inp.move.x, y = inp.move.y;
      const dir = (name, axis, neg, latch) => p.has(name) || (neg ? axis < -.5 : axis > .5) && !ui[latch];
      const up = dir('up', y, true, 'stickY'), down = dir('down', y, false, 'stickY'), left = dir('left', x, true, 'stickX'), right = dir('right', x, false, 'stickX');
      ui.stickY = Math.abs(y) > .5;ui.stickX = Math.abs(x) > .5;
      if (ui.osk) {
        if (up) oskKey('up');if (down) oskKey('down');if (left) oskKey('left');if (right) oskKey('right');
        if (p.has('cross')) oskKey('press');if (p.has('square') || p.has('delete')) oskKey('delete');
        if (p.has('triangle') || p.has('circle')) {ui.osk = null;render();}
        return;
      }
      const R = ready() ? rows(st) : [];let moved = false;
      if (up && ui.sel > 0) {ui.sel--;ui.act = 0;moved = true;}
      if (down && ui.sel < R.length - 1) {ui.sel++;ui.act = 0;moved = true;}
      if (left) {ui.act = Math.max(0, ui.act - 1);moved = true;}
      if (right) {ui.act++;moved = true;}
      if (moved) {ui.confirm = null;ui.scroll = true;render();}
      if (p.has('cross')) {const r = R[ui.sel], a = r && r.actions[Math.min(ui.act, r.actions.length - 1)];if (a) perform(r.key, a.op);}
      else if (p.has('circle')) close();
    }
    function open() {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      panel.hidden = false;ui.msg = '';ui.confirm = null;ui.osk = null;ui.sel = 0;ui.act = 0;ui.fresh = 0;list.dataset.sig = '';render();load();
    }
    function close() {panel.hidden = true;ui.osk = null;field.blur();}
    panel.querySelector('.fd-close').onclick = close;
    render();
    return {
      open, close, input, get isOpen() {return !panel.hidden;}, state: st,
      userChanged() {st.posts = [];st.more = false;st.loaded = false;pick = null;field.value = '';ui.fresh = 0;render();if (!panel.hidden) load();},
      // A friend posted (the friends server says so): count it on the button, or show it at once when the feed is open.
      news() {if (panel.hidden) {ui.fresh++;render();} else load();}
    };
  }
  return {ago, fit, rows, create, MAX_TEXT};
});
