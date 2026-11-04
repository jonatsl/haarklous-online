const test = require('node:test');
const assert = require('node:assert/strict');
// cloud/ is an ES module package; the Worker's mail.js is pure apart from fetch, which the test passes in.
const load = () => import('../cloud/src/mail.js');

test('account emails are only sent when the server has a Brevo key and a sender (issue #55)', async () => {
  const M = await load();
  assert.equal(M.mailReady({}), false);
  assert.equal(M.mailReady({BREVO_API_KEY: 'xkeysib-1'}), false);
  assert.equal(M.mailReady({BREVO_API_KEY: 'xkeysib-1', MAIL_FROM: 'game@example.com'}), true);
  await assert.rejects(M.sendMail({}, {to: 'a@b.no', kind: 'reset', url: 'https://x/y'}, async () => assert.fail('no call without a key')), /not set up/);
});

test('the two emails say what the link does and how long it works, with the name and link escaped in HTML', async () => {
  const M = await load();
  const r = M.message('reset', {name: 'Jo <b>', url: 'https://h/api/auth/reset-password/T?callbackURL=%2F%3Freset%3D1&x=1'});
  assert.match(r.subject, /password/i);assert.match(r.text, /works once, for 60 minutes/);
  assert.match(r.text, /reset-password\/T\?callbackURL=/);
  assert.match(r.html, /Jo &lt;b&gt;/);assert.match(r.html, /&amp;x=1/);assert.doesNotMatch(r.html, /<b>,/);
  const v = M.message('verify', {name: '', url: 'https://h/api/auth/verify-email?token=J'});
  assert.match(v.subject, /confirm/i);assert.match(v.text, /Hi player,/);assert.match(v.text, /Send the email again/);
  assert.throws(() => M.message('spam', {url: 'x'}), /Unknown/);
});

test('sendMail posts the email to Brevo with the key, and a refusal throws', async () => {
  const M = await load(), env = {BREVO_API_KEY: 'xkeysib-1', MAIL_FROM: 'game@example.com'};let seen;
  await M.sendMail(env, {to: 'a@b.no', name: 'Jo', kind: 'verify', url: 'https://h/v'}, async (url, opt) => {seen = {url, opt};return {ok: true, status: 201, json: async () => ({messageId: 'm'})};});
  assert.equal(seen.url, 'https://api.brevo.com/v3/smtp/email');assert.equal(seen.opt.headers['api-key'], 'xkeysib-1');
  const body = JSON.parse(seen.opt.body);
  assert.deepEqual(body.sender, {name: 'Haarklous online', email: 'game@example.com'});assert.deepEqual(body.to, [{email: 'a@b.no', name: 'Jo'}]);
  assert.match(body.htmlContent, /https:\/\/h\/v/);assert.match(body.textContent, /https:\/\/h\/v/);
  await assert.rejects(M.sendMail(env, {to: 'a@b.no', kind: 'reset', url: 'u'}, async () => ({ok: false, status: 401, json: async () => ({message: 'Key not found'})})), /401: Key not found/);
});
