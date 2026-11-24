/* Friends (issue #115): add friends by their player name, see who is online and in which lobby, invite a friend to your
 * lobby or join theirs. Needs an account (game-account.js) and the online game: the list lives on the server
 * (cloud/src/friends.js, one WebSocket per logged-in game; the socket is also how friends see that you are online).
 *
 * Pure parts (Node-tested in tests/friends.test.cjs):
 *   GameFriends.where(friend) -> 'Online · lobby ABCD · 3/12 players' …      GameFriends.badge(state) -> requests + invites
 *   GameFriends.rows(state, {inLobby}) -> the panel's rows [{key, kind, item, actions: [{op, label, danger?}]}]
 *   GameFriends.OSK, GameFriends.osk({r, c, text}, 'up'|'down'|'left'|'right'|'press'|'delete') -> the on-screen keyboard
 * GameFriends.create({root, button, account, notice, onGo(code, name), toAccount(), sound()}) -> {open(), close(), isOpen,
 *   input(input), lobby(code, n, max), userChanged(), hasInvite, state, status, send(m)}
 *   The panel (#friends, over the pause menu) and the toasts (#friendToast) are made here; so is their CSS.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameFriends = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const ONLINE = 'https://haarklous-online.server-smoke.workers.dev';
  // The controller's keyboard: letters (names are matched without regard to case), digits and the signs names use.
  const OSK = [
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'],
    ['U', 'V', 'W', 'X', 'Y', 'Z', 'Æ', 'Ø', 'Å', '-'],
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['space', '#', '.', '_', "'", 'É', 'Ü', 'del', 'ok', 'ok']
  ];
  const KEY_LABEL = {space: '␣ space', del: '⌫', ok: '✓ Send'}, MAX_TEXT = 30;
  // max: the longest text; plain: a post, not a name (a capital only first and after a full stop).
  function osk(k, action, max = MAX_TEXT, plain = false) {
    const R = OSK.length, C = OSK[0].length;let {r = 0, c = 0, text = ''} = k;
    if (action === 'up') r = (r + R - 1) % R;else if (action === 'down') r = (r + 1) % R;
    else if (action === 'left') c = (c + C - 1) % C;else if (action === 'right') c = (c + 1) % C;
    else if (action === 'delete') text = text.slice(0, -1);
    else if (action === 'press') {
      const key = OSK[r][c];
      if (key === 'del') text = text.slice(0, -1);
      else if (key !== 'ok' && text.length < max) {
        const ch = key === 'space' ? ' ' : key;
        // Like a name: a capital letter first and after a space, small letters after that.
        text += (plain ? !text.length || /[.!?] $/.test(text) : !text.length || text.endsWith(' ')) ? ch : ch.toLowerCase();
      }
    }
    return {...k, r, c, text};
  }
  function where(f) {
    if (!f.online) return 'Offline';
    if (f.here) return 'Online · in your lobby';
    if (!f.playing) return 'Online';
    if (!f.lobby) return 'Online · playing (invite only)';
    if (f.n >= f.max) return `Online · lobby ${f.lobby} · full (${f.n}/${f.max})`;
    return `Online · lobby ${f.lobby} · ${f.n}/${f.max} players`;
  }
  const badge = st => st ? st.incoming.length + st.invites.filter(i => i.left > 0).length : 0;
  function rows(st, {inLobby = false} = {}) {
    if (!st) return [];
    const out = [{key: 'add', kind: 'add', actions: [{op: 'type', label: '⌨ On-screen keyboard'}, {op: 'send', label: 'Send request'}]},
      {key: 'joinable', kind: 'joinable', actions: [{op: 'joinable', label: st.me.joinable ? 'Turn off' : 'Turn on'}]}];
    for (const i of st.invites) if (i.left > 0) out.push({key: `inv:${i.id}`, kind: 'invite', item: i, actions: [{op: 'yes', label: 'Join'}, {op: 'no', label: 'No thanks'}]});
    for (const p of st.incoming) out.push({key: `req:${p.id}`, kind: 'request', item: p, actions: [{op: 'accept', label: 'Accept'}, {op: 'decline', label: 'Decline'}]});
    for (const f of st.friends) {
      const a = [];
      if (f.online && f.lobby && !f.here && f.n < f.max) a.push({op: 'join', label: 'Join'});
      if (inLobby && f.online && !f.here) a.push({op: 'invite', label: 'Invite'});
      a.push({op: 'remove', label: 'Remove', danger: true});
      out.push({key: `fr:${f.id}`, kind: 'friend', item: f, actions: a});
    }
    for (const p of st.outgoing) out.push({key: `out:${p.id}`, kind: 'sent', item: p, actions: [{op: 'cancel', label: 'Cancel'}]});
    return out;
  }

  const CSS = `
#friends{z-index:7}#friends .panel{width:min(700px,calc(100% - 32px));background:#11161c}
#friends .fr-me{margin:4px 0 10px}#friends .fr-me b{color:#ffd166}
#friends h3{margin:16px 0 4px;font-size:15px}#friends h3 small{font-weight:400;opacity:.7;margin-left:6px}
#friends .fr-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;margin:5px 0;border-radius:10px;background:#ffffff0d;border:2px solid transparent}
#friends .fr-row.sel{border-color:#ffd166;background:#ffd1661a}
#friends .fr-row.invite{background:#5be37d1f}
#friends .fr-who{flex:1;min-width:200px;display:grid;gap:1px}#friends .fr-who small{opacity:.75;font-size:12.5px}#friends .fr-who .tag{opacity:.55;font-weight:400;margin-left:4px}
#friends .fr-acts{display:flex;gap:6px;flex-wrap:wrap}
#friends .panel .fr-acts button,#friends .fr-acts button{margin:0;padding:6px 12px;font-size:14px}
#friends .fr-acts button.on{outline:3px solid #fff;outline-offset:2px}
#friends .fr-acts button.danger{background:#e98b73}
#friends .fr-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#ffffff38;margin-right:7px;vertical-align:1px}#friends .fr-dot.on{background:#5be37d;box-shadow:0 0 6px #5be37d}
#friends form.fr-row label{flex:1;min-width:220px;margin:0}
#friends .fr-name{font:inherit;font-size:16px;padding:6px 8px;border-radius:6px;border:1px solid #ffffff44;background:#0b0f14;color:inherit}
#friends .fr-osk{flex-basis:100%;display:grid;grid-template-columns:repeat(10,1fr);gap:4px;margin-top:4px}
#friends .fr-osk span{display:grid;place-items:center;height:34px;border-radius:6px;background:#ffffff14;font:700 15px ui-monospace,Consolas,monospace;cursor:pointer;user-select:none}
#friends .fr-osk span.wide{grid-column:span 2}#friends .fr-osk span.sel{background:#ffd166;color:#111}
#friends .fr-osk small{grid-column:1/-1;opacity:.7;text-align:center}
#friends .fr-msg{min-height:1.4em;color:#ffd166;opacity:1;font-size:13.5px}
.fr-badge{display:inline-block;min-width:20px;padding:1px 6px;margin-left:8px;border-radius:10px;background:#e5484d;color:#fff;font-size:12px;line-height:18px;text-align:center}
#friendToast{position:absolute;right:18px;top:110px;z-index:9;display:flex;flex-direction:column;gap:8px;pointer-events:none;width:min(340px,70%)}
#friendToast div{background:#0b0f14ee;border:1px solid #ffd16699;border-radius:12px;padding:10px 14px;box-shadow:0 6px 20px #0007;animation:frIn .25s ease-out}
#friendToast div.invite{border-color:#5be37d;border-width:2px}
#friendToast b{display:block;font-size:15px}#friendToast small{opacity:.8}
@keyframes frIn{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const mmss = ms => {const s = Math.max(0, Math.ceil(ms / 1000));return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;};

  function create({root, button, account, notice = () => {}, onGo = () => {}, toAccount = () => {}, sound = () => {}, onPost = () => {}}) {
    const style = document.createElement('style');style.textContent = CSS;document.head.append(style);
    const toasts = document.createElement('div');toasts.id = 'friendToast';root.append(toasts);
    const panel = document.createElement('section');panel.id = 'friends';panel.className = 'overlay';panel.hidden = true;root.append(panel);
    panel.innerHTML = `<div class="panel"><span class="eyebrow">FRIENDS</span><h2>Friends</h2><p class="small fr-me"></p>
      <form class="fr-row fr-add" data-key="add" autocomplete="off"><label>Add a friend <input class="fr-name" maxlength="${MAX_TEXT}" placeholder="Their player name (or name#1234)" spellcheck="false"></label>
        <div class="fr-acts"></div><div class="fr-osk" hidden></div></form>
      <div class="fr-rows"></div><p class="fr-msg" role="status" aria-live="polite"></p>
      <p class="small">Controller: ↑↓ choose · ←→ choose a button · ✕ do it · ○ back · Keyboard: arrows, Space, C or Esc back · or use the mouse</p>
      <button type="button" class="fr-close">Close</button></div>`;
    const $ = s => panel.querySelector(s), form = $('.fr-add'), field = $('.fr-name'), list = $('.fr-rows'), me = $('.fr-me'), msgEl = $('.fr-msg'), oskEl = $('.fr-osk');
    let ws = null, status = 'off', retry = 0, timer = null, uid = null, st = null, stAt = 0, lobbyNow = {code: null, n: 0, max: 12}, sentLobby = '';
    const ui = {sel: 0, act: 0, osk: null, msg: '', confirm: null, stickY: false, stickX: false, sig: ''};
    const live = () => st ? {...st, invites: st.invites.map(i => ({...i, left: i.left - (performance.now() - stAt)}))} : null;
    const allRows = () => rows(live(), {inLobby: !!lobbyNow.code});

    // ---------- connection ----------
    const url = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/friends/ws`;
    function connect() {
      clearTimeout(timer);timer = null;
      if (!account.available || !account.user || typeof WebSocket === 'undefined') {status = 'off';render();return;}
      status = 'connecting';let sock;try {sock = new WebSocket(url());} catch {status = 'down';later();return;}
      ws = sock;sentLobby = '';
      sock.onopen = () => {if (ws !== sock) return;status = 'on';retry = 0;reportLobby();render();};
      sock.onmessage = e => {if (ws !== sock || e.data === 'pong') return;let m;try {m = JSON.parse(e.data);} catch {return;}handle(m);};
      sock.onclose = () => {if (ws !== sock) return;ws = null;status = 'down';render();later();};
      sock.onerror = () => {};
    }
    function later() {clearTimeout(timer);if (account.user) timer = setTimeout(connect, Math.min(60000, 2000 * 2 ** retry++));}
    function shut() {clearTimeout(timer);timer = null;if (ws) {const s = ws;ws = null;try {s.close(1000);} catch {}}status = 'off';}
    // Cloudflare answers 'ping' itself; it tells the server the game is still open.
    setInterval(() => {if (ws && ws.readyState === 1) ws.send('ping');}, 25000);
    // Closing the game says goodbye at once, so friends see you go offline straight away.
    window.addEventListener('pagehide', e => {if (!e.persisted && ws) {const s = ws;ws = null;try {s.close(1000, 'bye');} catch {}}});
    function send(m) {if (ws && ws.readyState === 1) {ws.send(JSON.stringify(m));return true;}ui.msg = 'No connection to the friends server – trying again…';render();return false;}
    function reportLobby() {
      const s = JSON.stringify(lobbyNow);if (s === sentLobby || !ws || ws.readyState !== 1) return;
      sentLobby = s;ws.send(JSON.stringify({t: 'lobby', ...lobbyNow}));
    }
    function handle(m) {
      if (m.t === 'state') {st = m;stAt = performance.now();render();}
      else if (m.t === 'toast') toast(m);
      else if (m.t === 'answer') {
        if (m.why) ui.msg = m.why;
        if (m.ok && m.op === 'add') {field.value = '';if (ui.osk) ui.osk = null;}
        if (m.go) onGo(m.go, m.name || 'your friend');
        else if (!m.ok && panel.hidden && m.why) notice(m.why, 4);
        render();
      }
    }

    // ---------- toasts ----------
    function toast(m) {
      const f = m.from || {}, n = esc(f.name);
      const t = {request: [`👋 ${n} wants to be your friend`, 'Pause (Options / Esc) → Friends (L1 / N)', 9],
        accepted: [`🤝 ${n} accepted – you are friends now`, '', 6],
        invite: [`🎮 ${n} invites you to their lobby`, 'Options / Esc, then ✕ / Space to join', 20],
        no: [`${n} cannot come right now`, '', 5],
        post: [`📝 ${n} posted in the feed`, 'Pause (Options / Esc) → Feed (R3 / O)', 6],
        online: [`<span style="color:#5be37d">●</span> ${n} is online`, '', 5]}[m.kind];
      if (!t) return;
      if (m.kind === 'post') onPost(f);
      sound(m.kind);
      // With the list open the news goes in its message line (the list itself shows the request or the invite).
      if (!panel.hidden) {const d = document.createElement('div');d.innerHTML = t[0];ui.msg = d.textContent;render();return;}
      const el = document.createElement('div');if (m.kind === 'invite') el.className = 'invite';
      el.innerHTML = `<b>${t[0]}</b>${t[1] ? `<small>${t[1]}</small>` : ''}`;toasts.prepend(el);
      while (toasts.children.length > 3) toasts.lastChild.remove();
      setTimeout(() => el.remove(), t[2] * 1000);
    }

    // ---------- panel ----------
    function render() {
      if (button) {
        const n = badge(live()), on = st ? st.friends.filter(f => f.online).length : 0;
        button.innerHTML = `Friends${st && st.friends.length ? ` (${on} online)` : ''}${n ? `<span class="fr-badge" title="requests and invites">${n}</span>` : ''}`;
      }
      if (panel.hidden) return;
      const ready = !!(st && account.user);
      me.innerHTML = !account.available ? `Friends work in the online game (<b>${ONLINE}</b>) with an account. This copy of the game is offline.` :
        !account.user ? 'Friends need an account: log in or create one (it is free) under <b>Account</b> in the pause menu. Then you add friends by their player name, see who is online, invite them to your lobby and join theirs.' :
        !st ? (status === 'down' ? 'No connection to the friends server – trying again…' : 'Connecting to the friends server…') :
        `You are <b>${esc(st.me.name)}</b> <span style="opacity:.6">#${esc(st.me.tag)}</span> – friends add you with this name. The number only matters when several players have the same name.`;
      form.hidden = !ready;
      const rs = ready ? allRows() : [{key: 'account', kind: 'account', actions: account.available && !account.user ? [{op: 'account', label: 'Go to Account'}] : []}];
      ui.sel = Math.max(0, Math.min(ui.sel, rs.length - 1));const sel = rs[ui.sel];
      ui.act = sel ? Math.max(0, Math.min(ui.act, sel.actions.length - 1)) : 0;
      const btn = (r, a, j) => `<button type="button" data-key="${esc(r.key)}" data-op="${a.op}" class="${r === sel && j === ui.act && !ui.osk ? 'on' : ''}${a.danger ? ' danger' : ''}">${ui.confirm === r.key && a.op === 'remove' ? 'Sure? Remove' : a.label}</button>`;
      const acts = r => `<div class="fr-acts">${r.actions.map((a, j) => btn(r, a, j)).join('')}</div>`;
      // The add row is kept (it holds the text field); only its buttons and the keyboard are redrawn.
      form.classList.toggle('sel', !!sel && sel.key === 'add');
      if (ready) form.querySelector('.fr-acts').outerHTML = acts(rs[0]);
      oskEl.hidden = !ui.osk;
      if (ui.osk) oskEl.innerHTML = OSK.map((row, r) => row.map((k, c) => (c > 0 && row[c - 1] === k) ? '' :
        `<span data-r="${r}" data-c="${c}" class="${row[c + 1] === k ? 'wide' : ''}${ui.osk.r === r && (ui.osk.c === c || (row[ui.osk.c] === k)) ? ' sel' : ''}">${KEY_LABEL[k] || k}</span>`).join('')).join('') +
        '<small>✕ type · □ delete · △ send · ○ close the keyboard · or type on a keyboard</small>';
      let h = '';
      if (ready) {
        const joinable = rs[1], v = live();
        h += `<div class="fr-row${sel === joinable ? ' sel' : ''}" data-key="joinable"><div class="fr-who"><b>Friends can join my lobby: ${st.me.joinable ? 'on' : 'off'}</b><small>${st.me.joinable ? 'Your friends see your lobby and can join it without an invite.' : 'Friends join you only when you invite them.'}</small></div>${acts(joinable)}</div>`;
        const group = (title, kind, fn) => {const g = rs.filter(r => r.kind === kind);if (g.length) h += (title ? `<h3>${title}</h3>` : '') + g.map(r => `<div class="fr-row ${kind}${r === sel ? ' sel' : ''}" data-key="${esc(r.key)}">${fn(r.item)}${acts(r)}</div>`).join('');};
        const who = (p, line) => `<div class="fr-who"><b>${esc(p.name)}<span class="tag">#${esc(p.tag)}</span></b><small>${line}</small></div>`;
        group('Invites', 'invite', i => who(i, `Invites you to lobby ${esc(i.code)} · <span data-left="${esc(i.id)}">${mmss(i.left)}</span> left`));
        group(`Friend requests <small>(${v.incoming.length})</small>`, 'request', p => who(p, 'Wants to be your friend'));
        h += `<h3>Your friends <small>(${st.friends.filter(f => f.online).length} online of ${st.friends.length})</small></h3>`;
        if (!st.friends.length) h += '<p class="small">No friends yet: type a friend’s player name above and send a request.</p>';
        group('', 'friend', f => `<div class="fr-who"><b><i class="fr-dot${f.online ? ' on' : ''}"></i>${esc(f.name)}<span class="tag">#${esc(f.tag)}</span></b><small>${esc(where(f))}</small></div>`);
        group('Sent requests', 'sent', p => who(p, 'Waiting for an answer'));
      } else if (rs[0].actions.length) h += `<div class="fr-row sel" data-key="account">${acts(rs[0])}</div>`;
      list.innerHTML = h;
      if (msgEl.textContent !== ui.msg) {msgEl.textContent = ui.msg;clearTimeout(render.fade);if (ui.msg) render.fade = setTimeout(() => {ui.msg = '';msgEl.textContent = '';}, 8000);}
      const s = panel.querySelector('.fr-row.sel');if (s && s.scrollIntoView) s.scrollIntoView({block: 'nearest'});
    }
    // The invites' clocks tick without redrawing the panel (a redraw under the mouse could swallow a click).
    setInterval(() => {
      if (panel.hidden || !st) return;
      for (const i of live().invites) {const el = panel.querySelector(`[data-left="${CSS_ESC(i.id)}"]`);if (el) el.textContent = mmss(i.left);}
      if (st.invites.some(i => i.left - (performance.now() - stAt) <= 0 && i.left > -1500)) render();
    }, 1000);
    const CSS_ESC = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));

    function perform(key, op) {
      const id = key.includes(':') ? key.slice(key.indexOf(':') + 1) : '';
      if (op !== 'remove') ui.confirm = null;
      if (op === 'account') {close();toAccount();return;}
      if (op === 'type') {ui.osk = ui.osk ? null : {r: 0, c: 0};render();return;}
      if (op === 'send') {const name = field.value.trim();if (!name) {ui.msg = 'Type your friend’s player name first.';render();return;}if (send({t: 'add', name})) {ui.msg = 'Wait…';render();}return;}
      if (op === 'joinable') {send({t: 'joinable', on: !st.me.joinable});return;}
      if (op === 'yes' || op === 'no') {send({t: 'reply', id, yes: op === 'yes'});return;}
      if (op === 'remove' && ui.confirm !== key) {ui.confirm = key;const f = st.friends.find(x => x.id === id);ui.msg = `Press Remove again to remove ${f ? f.name : 'this friend'} from your friends.`;render();return;}
      if (op === 'remove') ui.confirm = null;
      if (['accept', 'decline', 'cancel', 'invite', 'join', 'remove'].includes(op)) {if (send({t: op, id}) && (op === 'join' || op === 'invite')) {ui.msg = 'Wait…';render();}}
    }
    panel.addEventListener('click', e => {
      const k = e.target.closest('[data-r]');
      if (k && ui.osk) {ui.osk = {...ui.osk, r: +k.dataset.r, c: +k.dataset.c};oskKey('press');return;}
      const b = e.target.closest('button');if (!b) return;
      if (b.classList.contains('fr-close')) {close();return;}
      const key = b.dataset.key || (b.closest('[data-key]') || {}).dataset?.key;if (!key || !b.dataset.op) return;
      if (b.type === 'submit') e.preventDefault();
      const i = allRows().findIndex(r => r.key === key);if (i >= 0) {ui.sel = i;ui.act = Math.max(0, allRows()[i].actions.findIndex(a => a.op === b.dataset.op));}
      perform(key, b.dataset.op);
    });
    form.addEventListener('submit', e => {e.preventDefault();perform('add', 'send');});
    field.addEventListener('focus', () => {ui.sel = 0;render();});
    function oskKey(action) {
      const o = osk({...ui.osk, text: field.value}, action);
      ui.osk = {r: o.r, c: o.c};
      if (action === 'press' && OSK[o.r][o.c] === 'ok') {perform('add', 'send');return;}
      field.value = o.text;render();
    }
    function input(inp) {
      const p = inp.pressed, x = inp.move.x, y = inp.move.y;
      const dir = (name, axis, neg, latch) => p.has(name) || (neg ? axis < -.5 : axis > .5) && !ui[latch];
      const up = dir('up', y, true, 'stickY'), down = dir('down', y, false, 'stickY'), left = dir('left', x, true, 'stickX'), right = dir('right', x, false, 'stickX');
      ui.stickY = Math.abs(y) > .5;ui.stickX = Math.abs(x) > .5;
      if (ui.osk) {
        if (up) oskKey('up');if (down) oskKey('down');if (left) oskKey('left');if (right) oskKey('right');
        if (p.has('cross')) oskKey('press');if (p.has('square') || p.has('delete')) oskKey('delete');
        if (p.has('triangle')) perform('add', 'send');if (p.has('circle')) {ui.osk = null;render();}
        return;
      }
      const rs = st && account.user ? allRows() : [];let moved = false;
      if (up && ui.sel > 0) {ui.sel--;ui.act = 0;moved = true;}
      if (down && ui.sel < rs.length - 1) {ui.sel++;ui.act = 0;moved = true;}
      if (left) {ui.act = Math.max(0, ui.act - 1);moved = true;}
      if (right) {ui.act++;moved = true;}
      if (moved) {ui.confirm = null;render();}
      if (p.has('cross')) {
        const r = st && account.user ? rs[ui.sel] : {key: 'account', actions: account.available && !account.user ? [{op: 'account'}] : []};
        const a = r && r.actions[Math.min(ui.act, r.actions.length - 1)];if (a) perform(r.key, a.op);
      } else if (p.has('circle')) close();
    }
    function open() {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      panel.hidden = false;ui.msg = '';ui.confirm = null;ui.osk = null;toasts.replaceChildren();
      // An invite waiting is the first thing chosen (✕ joins), else a friend request (✕ accepts).
      const rs = allRows(), i = rs.findIndex(r => r.kind === 'invite'), q = rs.findIndex(r => r.kind === 'request');ui.sel = i >= 0 ? i : q >= 0 ? q : 0;ui.act = 0;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({t: 'state'}));
      render();
    }
    function close() {panel.hidden = true;ui.osk = null;field.blur();}
    panel.querySelector('.fr-close').onclick = close;
    render();
    return {
      open, close, input, send, render,
      get isOpen() {return !panel.hidden;}, get state() {return st;}, get status() {return status;}, get hasInvite() {const v = live();return !!v && v.invites.some(i => i.left > 0);},
      lobby(code, n, max) {lobbyNow = {code: code || null, n: code ? n : 0, max: max || 12};reportLobby();if (!panel.hidden) render();},
      userChanged() {
        const id = account.user ? String(account.user.id || account.user.email || account.user.name) : null;
        if (id === uid && (ws || timer || !id)) {render();return;}
        uid = id;shut();st = null;ui.msg = '';if (id) connect();render();
      }
    };
  }
  return {OSK, osk, where, rows, badge, create};
});
