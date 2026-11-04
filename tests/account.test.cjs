const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../game-account.js');

test('the account form is checked before anything is sent', () => {
  const ok = {mode: 'signup', name: 'Jonathan', email: 'a@b.no', password: 'longenough'};
  assert.equal(A.check(ok), '');
  assert.match(A.check({...ok, name: '  '}), /player name/);
  assert.match(A.check({...ok, name: 'x'.repeat(25)}), /24/);
  assert.match(A.check({...ok, email: 'not-an-email'}), /email/);
  assert.match(A.check({...ok, password: 'short'}), /8 characters/);
  assert.match(A.check({...ok, password: 'æ'.repeat(37)}), /72/);// 74 bytes: bcrypt reads only 72
  assert.equal(A.check({mode: 'login', email: 'a@b.no', password: 'x'}), '');// old passwords are not judged at login
  assert.match(A.check({mode: 'login', email: 'a@b.no', password: ''}), /password/);
});

test('accounts are offered only where the Worker serves the page', () => {
  assert.equal(A.available({protocol: 'https:', hostname: 'haarklous-online.server-smoke.workers.dev'}), true);
  assert.equal(A.available({protocol: 'http:', hostname: 'localhost'}), true);
  assert.equal(A.available({protocol: 'file:', hostname: ''}), false);
  assert.equal(A.available({protocol: 'https:', hostname: 'example.com'}), false);
});

test('log in, wrong password and log out talk to Better Auth and keep the user', async () => {
  const calls = [];
  globalThis.location = {protocol: 'http:', hostname: 'localhost'};
  globalThis.fetch = async (url, opt = {}) => {
    calls.push([url, opt.method || 'GET', opt.body && JSON.parse(opt.body)]);
    const reply = (status, body) => ({ok: status < 400, status, json: async () => body});
    if (url.endsWith('get-session')) return reply(200, null);
    if (url.endsWith('sign-in/email')) return opt.body.includes('right-pass') ? reply(200, {user: {name: 'Jonathan', email: 'a@b.no'}}) : reply(401, {code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password'});
    if (url.endsWith('sign-up/email')) return reply(422, {code: 'USER_ALREADY_EXISTS', message: 'User already exists'});
    if (url.endsWith('sign-out')) return reply(200, {success: true});
    return reply(404, {});
  };
  try {
    let changes = 0;const acct = A.create({onChange: () => changes++});
    assert.equal(acct.available, true);
    assert.equal(await acct.load(), '');assert.equal(acct.user, null);
    assert.equal(await acct.logIn('a@b.no', 'wrong-pass'), 'Wrong email or password.');assert.equal(acct.user, null);
    assert.equal(await acct.logIn(' a@b.no ', 'right-pass'), '');assert.equal(acct.user.name, 'Jonathan');
    assert.deepEqual(calls.at(-1), ['/api/auth/sign-in/email', 'POST', {email: 'a@b.no', password: 'right-pass', rememberMe: true}]);
    assert.match(await acct.signUp('Jonathan', 'a@b.no', 'longenough'), /already an account/);
    assert.equal(await acct.logOut(), '');assert.equal(acct.user, null);
    assert.equal(await acct.signUp('', 'a@b.no', 'longenough'), 'Choose a player name.');
    assert.equal(calls.filter(c => c[0].endsWith('sign-up/email')).length, 1);// a bad form is never sent
    assert.ok(changes >= 10);assert.equal(acct.busy, false);
  } finally {delete globalThis.location;delete globalThis.fetch;}
});

test('a server that never answers: the form gives up and says so, instead of "Wait…" for ever', async () => {
  globalThis.location = {protocol: 'http:', hostname: 'localhost'};
  globalThis.fetch = (url, opt = {}) => new Promise((res, rej) => opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), {name: 'AbortError'}))));
  try {
    const acct = A.create({timeoutMs: 50});
    assert.match(await acct.signUp('Jonathan', 'a@b.no', 'longenough'), /did not answer/);
    assert.equal(acct.busy, false);assert.equal(acct.user, null);
  } finally {delete globalThis.location;delete globalThis.fetch;}
});

test('forgot password and the new-password form are checked before anything is sent (issue #55)', () => {
  assert.equal(A.check({mode: 'forgot', email: 'a@b.no'}), '');
  assert.match(A.check({mode: 'forgot', email: 'nope'}), /email/);
  assert.equal(A.check({mode: 'reset', password: 'longenough', again: 'longenough'}), '');
  assert.match(A.check({mode: 'reset', password: '', again: ''}), /new password/);
  assert.match(A.check({mode: 'reset', password: 'short', again: 'short'}), /8 characters/);
  assert.match(A.check({mode: 'reset', password: 'longenough', again: 'longenougj'}), /not the same/);
});

test('the email links come back to the game as ?verified=1 or ?reset=1&token=… (issue #55)', () => {
  assert.deepEqual(A.link('?verified=1'), {kind: 'verified'});
  assert.deepEqual(A.link('?verified=1&error=TOKEN_EXPIRED'), {kind: 'verified', error: 'TOKEN_EXPIRED'});
  assert.deepEqual(A.link('?reset=1&token=abc123'), {kind: 'reset', token: 'abc123'});
  assert.deepEqual(A.link('?reset=1&error=INVALID_TOKEN'), {kind: 'reset', error: 'INVALID_TOKEN'});
  assert.deepEqual(A.link('?reset=1'), {kind: 'reset', error: 'INVALID_TOKEN'});
  assert.equal(A.link('?lobby=ABCD'), null);assert.equal(A.link(''), null);
});

test('forgot password, a new password and "send the email again" talk to Better Auth (issue #55)', async () => {
  const calls = [];
  globalThis.location = {protocol: 'http:', hostname: 'localhost'};
  globalThis.fetch = async (url, opt = {}) => {
    calls.push([url, opt.method || 'GET', opt.body && JSON.parse(opt.body)]);
    const reply = (status, body) => ({ok: status < 400, status, json: async () => body});
    if (url === '/api/account-features') return reply(200, {email: true});
    if (url.endsWith('get-session')) return reply(200, {user: {name: 'Jonathan', email: 'a@b.no', emailVerified: false}});
    if (url.endsWith('request-password-reset')) return reply(200, {status: true});
    if (url.endsWith('reset-password')) return JSON.parse(opt.body).token === 'good' ? reply(200, {status: true}) : reply(400, {code: 'INVALID_TOKEN', message: 'Invalid token'});
    if (url.endsWith('send-verification-email')) return reply(200, {status: true});
    if (url.endsWith('sign-up/email')) return reply(200, {user: {name: 'Jonathan', email: 'a@b.no', emailVerified: false}});
    return reply(404, {});
  };
  try {
    const acct = A.create();
    assert.equal(acct.email, false);
    assert.equal(await acct.load(), '');assert.equal(acct.email, true);assert.equal(acct.user.emailVerified, false);
    assert.equal(await acct.confirmAgain(), '');
    assert.deepEqual(calls.at(-1), ['/api/auth/send-verification-email', 'POST', {email: 'a@b.no', callbackURL: '/?verified=1'}]);
    assert.equal(await acct.forgot(' a@b.no '), '');
    assert.deepEqual(calls.at(-1), ['/api/auth/request-password-reset', 'POST', {email: 'a@b.no', redirectTo: '/?reset=1'}]);
    assert.match(await acct.resetPassword('used', 'longenough', 'longenough'), /run out or was used/);
    assert.equal(acct.user.name, 'Jonathan');// a failed reset changes nothing
    assert.equal(await acct.resetPassword('good', 'longenough', 'longenough'), '');
    assert.deepEqual(calls.at(-1), ['/api/auth/reset-password', 'POST', {newPassword: 'longenough', token: 'good'}]);
    assert.equal(acct.user, null);// the new password logs the account out everywhere
    const n = calls.length;assert.match(await acct.resetPassword('good', 'longenough', 'other-one'), /not the same/);assert.equal(calls.length, n);
    assert.equal(await acct.signUp('Jonathan', 'a@b.no', 'longenough'), '');
    assert.equal(calls.at(-1)[2].callbackURL, '/?verified=1');// the confirm link comes back to the game
  } finally {delete globalThis.location;delete globalThis.fetch;}
});
