/* Player accounts (optional): log in with email and password. The game's Cloudflare Worker runs Better Auth with the accounts
 * in Supabase (cloud/src/auth.js); the session is an HttpOnly cookie on that host, so accounts work only in the online version
 * (https://haarklous-online.server-smoke.workers.dev, or `npx wrangler dev` on localhost). Playing needs no account.
 * When you are logged in, your account name is your name in the lobbies.
 *
 * GameAccount.check({mode, name, email, password}) -> error text | ''   (pure, Node-tested; mode 'signup' | 'login')
 * GameAccount.available(location) -> true when the page is served by the Worker itself   (pure)
 * GameAccount.create({onChange, timeoutMs = 20000}) -> {user, busy, available, load(), signUp(name, email, password), logIn(email, password), logOut()}
 *   signUp / logIn / logOut resolve to an error text, or '' when it worked.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameAccount = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const ONLINE = 'https://haarklous-online.server-smoke.workers.dev';
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function check({mode, name, email, password}) {
    if (mode === 'signup' && !String(name || '').trim()) return 'Choose a player name.';
    if (mode === 'signup' && String(name).trim().length > 24) return 'The name can be at most 24 characters.';
    if (!EMAIL.test(String(email || '').trim())) return 'Type a valid email address.';
    if (!password) return 'Type your password.';
    if (mode === 'signup' && password.length < 8) return 'The password needs at least 8 characters.';
    if (mode === 'signup' && new TextEncoder().encode(password).length > 72) return 'The password can be at most 72 characters.';
    return '';
  }
  const available = loc => (loc.protocol === 'https:' && /workers\.dev$/.test(loc.hostname)) || /^(localhost|127\.0\.0\.1)$/.test(loc.hostname);
  // Better Auth's error codes in plain words.
  const WORDS = {
    INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
    USER_ALREADY_EXISTS: 'There is already an account with that email – log in instead.',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'There is already an account with that email – log in instead.',
    PASSWORD_TOO_SHORT: 'The password needs at least 8 characters.',
    PASSWORD_TOO_LONG: 'The password can be at most 72 characters.',
    INVALID_EMAIL: 'Type a valid email address.'
  };
  function create({onChange, timeoutMs = 20000} = {}) {
    let user = null, busy = false;
    const ok = typeof location !== 'undefined' && available(location);
    const changed = () => onChange && onChange();
    async function call(path, body) {
      // Never wait for ever: after 20 s the form says so and can be sent again.
      const stop = new AbortController(), timer = setTimeout(() => stop.abort(), timeoutMs);let r;
      try {
        r = await fetch(`/api/auth/${path}`, body === undefined ? {credentials: 'same-origin', signal: stop.signal} :
          {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: stop.signal});
      } catch (e) {if (stop.signal.aborted) throw new Error('The account server did not answer – try again in a moment.');throw e;}
      finally {clearTimeout(timer);}
      let j = null;try {j = await r.json();} catch {}
      if (r.status === 429) throw new Error('Too many tries – wait a minute and try again.');
      if (!r.ok) throw new Error((j && (WORDS[j.code] || j.message)) || `The account server answered ${r.status}.`);
      return j;
    }
    async function run(fn) {
      if (!ok) return `Accounts work in the online version: ${ONLINE}`;
      busy = true;changed();
      try {await fn();return '';}
      catch (e) {return e instanceof TypeError ? 'No connection to the account server.' : e.message;}
      finally {busy = false;changed();}
    }
    return {
      get user() {return user;}, get busy() {return busy;}, available: ok, onlineUrl: ONLINE,
      load: () => run(async () => {const j = await call('get-session');user = j && j.user ? j.user : null;}),
      signUp: (name, email, password) => run(async () => {
        const err = check({mode: 'signup', name, email, password});if (err) throw new Error(err);
        user = (await call('sign-up/email', {name: name.trim(), email: email.trim(), password})).user;
      }),
      logIn: (email, password) => run(async () => {
        const err = check({mode: 'login', email, password});if (err) throw new Error(err);
        user = (await call('sign-in/email', {email: email.trim(), password, rememberMe: true})).user;
      }),
      logOut: () => run(async () => {await call('sign-out', {});user = null;})
    };
  }
  return {check, available, create};
});
