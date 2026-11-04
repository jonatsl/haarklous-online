/* Let the Worker send account emails (issue #55: confirm your email, forgot password) through Brevo. Run from cloud/
 * (after `npm install` and `npx wrangler login`):   node scripts/set-mail-secret.mjs
 * Before: make a free Brevo account (https://www.brevo.com), add and confirm a sender address under Senders, domains, IPs →
 * Senders (no own domain needed), and make an API key under SMTP & API → API keys.
 * This asks for the key (not shown while you type) and the sender address, checks both with Brevo, and stores them as the
 * Cloudflare secrets BREVO_API_KEY and MAIL_FROM. Then deploy:  npx wrangler deploy
 */
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';

const WRANGLER = 'node_modules/wrangler/bin/wrangler.js';
function ask(question, hidden) {
  return new Promise(resolve => {
    const rl = createInterface({input: process.stdin, output: process.stdout, terminal: true});
    if (hidden) rl._writeToOutput = s => {if (s.startsWith(question)) process.stdout.write(s);};
    rl.question(question, a => {rl.close();if (hidden) process.stdout.write('\n');resolve(a.trim());});
  });
}

const key = process.env.BREVO_API_KEY || await ask('Brevo API key (xkeysib-…): ', true);
const from = (process.env.MAIL_FROM || await ask('Sender address (the one you confirmed in Brevo): ')).toLowerCase();
if (!/^xkeysib-/.test(key)) {console.error('That does not look like a Brevo API key (it starts with xkeysib-).');process.exit(1);}

const r = await fetch('https://api.brevo.com/v3/senders', {headers: {'api-key': key, accept: 'application/json'}});
if (!r.ok) {console.error(`Brevo did not accept the key (${r.status}).`);process.exit(1);}
const sender = ((await r.json()).senders || []).find(s => String(s.email).toLowerCase() === from);
if (!sender) {console.error(`${from} is not a sender in this Brevo account. Add it under Senders and confirm it first.`);process.exit(1);}
if (sender.active === false) {console.error(`${from} is not confirmed in Brevo yet (open the email Brevo sent to it).`);process.exit(1);}
console.log(`Brevo: the key works and ${from} may send.`);

for (const [name, value] of [['BREVO_API_KEY', key], ['MAIL_FROM', from]]) {
  try {execFileSync(process.execPath, [WRANGLER, 'secret', 'put', name], {input: value, stdio: ['pipe', 'pipe', 'pipe']});}
  catch (e) {console.error(`wrangler secret put ${name} failed:\n${String(e.stderr || e.message).replace(key, '***')}`);process.exit(1);}
  console.log(`Cloudflare secret ${name} set.`);
}
console.log('Done. The live game can send account emails now (a secret takes effect at once; deploy if you changed code too).');
