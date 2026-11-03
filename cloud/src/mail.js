/* Account emails (issue #55): "confirm your email" after sign-up and "reset your password" from the pause menu.
 * Sent through Brevo's HTTP API (https://developers.brevo.com/reference/sendtransacemail): Brevo sends from one checked sender
 * address to anyone without a domain of our own (Resend and most others only send to your own address until you own a domain).
 * Set up by the user with scripts/set-mail-secret.mjs: Cloudflare secrets BREVO_API_KEY and MAIL_FROM (the sender address,
 * checked in Brevo). Without them the game says that email is not set up yet, and accounts work as before.
 * mailReady(env) -> boolean · message(kind, {name, url, minutes}) -> {subject, text, html} (pure)
 * sendMail(env, {to, name, kind, url, minutes}, fetchImpl = fetch) -> resolves when Brevo has taken the email, throws if not.
 */
export const LINK_MINUTES = 60;// both links work for one hour; the reset link only once
export const mailReady = env => !!(env && env.BREVO_API_KEY && env.MAIL_FROM);

const escape = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const TEXTS = {
  verify: {subject: 'Confirm your email for Haarklous online', button: 'Confirm my email',
    lead: 'Thanks for making an account in Haarklous online. Open this link to confirm that this email address is yours:'},
  reset: {subject: 'Reset your Haarklous online password', button: 'Choose a new password',
    lead: 'Someone (we hope you) asked to reset the password of your Haarklous online account. Open this link to choose a new one:'}
};

export function message(kind, {name, url, minutes = LINK_MINUTES}) {
  const t = TEXTS[kind];if (!t) throw new Error(`Unknown email kind: ${kind}`);
  const hello = `Hi ${String(name || '').trim() || 'player'},`;
  const after = kind === 'reset' ? `The link works once, for ${minutes} minutes. If you did not ask for this, ignore this email: your password stays the same.`
    : `The link works for ${minutes} minutes. If it has run out, log in and press "Send the email again" in the pause menu. If you did not make this account, ignore this email.`;
  const text = `${hello}\n\n${t.lead}\n${url}\n\n${after}\n\nHaarklous online – https://haarklous-online.server-smoke.workers.dev`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1d2430;max-width:520px">
<p>${escape(hello)}</p><p>${escape(t.lead)}</p>
<p><a href="${escape(url)}" style="display:inline-block;background:#2f6fd6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escape(t.button)}</a></p>
<p style="font-size:13px;color:#555">Or copy this link into the browser:<br>${escape(url)}</p>
<p style="font-size:13px;color:#555">${escape(after)}</p>
<p style="font-size:13px;color:#555">Haarklous online</p></div>`;
  return {subject: t.subject, text, html};
}

export async function sendMail(env, {to, name, kind, url, minutes}, fetchImpl = fetch) {
  if (!mailReady(env)) throw new Error('Email is not set up on this server');
  const m = message(kind, {name, url, minutes});
  const r = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json'},
    body: JSON.stringify({sender: {name: 'Haarklous online', email: env.MAIL_FROM}, to: [{email: to, ...(name ? {name: String(name).slice(0, 70)} : {})}],
      subject: m.subject, textContent: m.text, htmlContent: m.html, tags: [`account-${kind}`]})
  });
  if (!r.ok) {let why = '';try {why = (await r.json()).message || '';} catch {}throw new Error(`Brevo answered ${r.status}${why ? ': ' + why : ''}`);}
}
