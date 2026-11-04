/* Player accounts (optional): log in with email and password. The game's Cloudflare Worker runs Better Auth with the accounts
 * in Supabase (cloud/src/auth.js); the session is an HttpOnly cookie on that host, so accounts work only in the online version
 * (https://haarklous-online.server-smoke.workers.dev, or `npx wrangler dev` on localhost). Playing needs no account.
 * When you are logged in, your account name is your name in the lobbies.
 * Email (issue #55, when the server can send it, see cloud/src/mail.js): sign-up sends a "confirm your email" link, and
 * "Forgot password?" sends a reset link. Both links open the game again (?verified=1 or ?reset=1&token=…), see link().
 *
 * GameAccount.check({mode, name, email, password, again}) -> error text | ''   (pure, Node-tested; mode 'signup' | 'login' | 'forgot' | 'reset')
 * GameAccount.available(location) -> true when the page is served by the Worker itself   (pure)
 * GameAccount.link(search) -> what an email link brought (pure): {kind: 'verified'|'reset', token?, error?} or null
 * GameAccount.create({onChange, timeoutMs = 20000}) -> {user, busy, available, email (can the server send email?), load(),
 *   signUp(name, email, password), logIn(email, password), logOut(), forgot(email), resetPassword(token, password, again), confirmAgain()}
 *   They resolve to an error text, or '' when it worked.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameAccount = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const ONLINE = 'https://haarklous-online.server-smoke.workers.dev';
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function check({mode, name, email, password, again}) {
    if (mode === 'signup' && !String(name || '').trim()) return 'Choose a player name.';
    if (mode === 'signup' && String(name).trim().length > 24) return 'The name can be at most 24 characters.';
    if (mode !== 'reset' && !EMAIL.test(String(email || '').trim())) return 'Type a valid email address.';
    if (mode === 'forgot') return '';
    if (!password) return mode === 'reset' ? 'Type a new password.' : 'Type your password.';
    const fresh = mode === 'signup' || mode === 'reset';
    if (fresh && password.length < 8) return 'The password needs at least 8 characters.';
    if (fresh && new TextEncoder().encode(password).length > 72) return 'The password can be at most 72 characters.';
    if (mode === 'reset' && again !== password) return 'The two passwords are not the same.';
    return '';
  }
  // The game's own address an email link comes back to: ?verified=1 (confirmed; Better Auth adds &error=… if the link was bad)
  // or ?reset=1&token=… (choose a new password; &error=INVALID_TOKEN if the link has run out or was used).
  const VERIFIED = '/?verified=1', RESET = '/?reset=1';
  function link(search) {
    const q = new URLSearchParams(search || ''), error = q.get('error') || undefined;
    if (q.get('verified') === '1') return {kind: 'verified', ...(error ? {error} : {})};
    if (q.get('reset') === '1') return error || !q.get('token') ? {kind: 'reset', error: error || 'INVALID_TOKEN'} : {kind: 'reset', token: q.get('token')};
    return null;
  }
  const available = loc => (loc.protocol === 'https:' && /workers\.dev$/.test(loc.hostname)) || /^(localhost|127\.0\.0\.1)$/.test(loc.hostname);
  // Better Auth's error codes in plain words.
  const WORDS = {
    INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
    USER_ALREADY_EXISTS: 'There is already an account with that email – log in instead.',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'There is already an account with that email – log in instead.',
    PASSWORD_TOO_SHORT: 'The password needs at least 8 characters.',
    PASSWORD_TOO_LONG: 'The password can be at most 72 characters.',
    INVALID_EMAIL: 'Type a valid email address.',
    INVALID_TOKEN: 'This link has run out or was used already – ask for a new one.',
    TOKEN_EXPIRED: 'This link has run out – ask for a new one.',
    USER_NOT_FOUND: 'There is no account for this link any more.',
    EMAIL_ALREADY_VERIFIED: 'Your email is confirmed already.',
    RESET_PASSWORD_DISABLED: 'This server cannot send emails yet, so a password cannot be reset.',
    VERIFICATION_EMAIL_NOT_ENABLED: 'This server cannot send emails yet.'
  };
  function create({onChange, timeoutMs = 20000} = {}) {
    let user = null, busy = false, email = false;
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
      get user() {return user;}, get busy() {return busy;}, get email() {return email;}, available: ok, onlineUrl: ONLINE,
      load: () => run(async () => {
        const j = await call('get-session');user = j && j.user ? j.user : null;
        try {const f = await fetch('/api/account-features', {credentials: 'same-origin'});email = f.ok && !!(await f.json()).email;} catch {email = false;}
      }),
      signUp: (name, email, password) => run(async () => {
        const err = check({mode: 'signup', name, email, password});if (err) throw new Error(err);
        user = (await call('sign-up/email', {name: name.trim(), email: email.trim(), password, callbackURL: VERIFIED})).user;
      }),
      logIn: (email, password) => run(async () => {
        const err = check({mode: 'login', email, password});if (err) throw new Error(err);
        user = (await call('sign-in/email', {email: email.trim(), password, rememberMe: true})).user;
      }),
      logOut: () => run(async () => {await call('sign-out', {});user = null;}),
      // The answer is the same whether or not there is an account with that email (nobody can test addresses with it).
      forgot: address => run(async () => {
        const err = check({mode: 'forgot', email: address});if (err) throw new Error(err);
        await call('request-password-reset', {email: address.trim(), redirectTo: RESET});
      }),
      resetPassword: (token, password, again) => run(async () => {
        const err = check({mode: 'reset', password, again});if (err) throw new Error(err);
        await call('reset-password', {newPassword: password, token});user = null;// every session of the account is logged out
      }),
      confirmAgain: () => run(async () => {if (user) await call('send-verification-email', {email: user.email, callbackURL: VERIFIED});})
    };
  }
  return {check, available, link, create};
});
