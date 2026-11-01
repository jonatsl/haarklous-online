/* Give the Worker its own database login. Run from cloud/ (after `npx supabase login` and `npx wrangler login`):
 *   node scripts/set-db-secret.mjs                 new password for haarklous_worker -> Hyperdrive "haarklous-db" (+ BETTER_AUTH_SECRET the first time)
 *   node scripts/set-db-secret.mjs --auth-secret   also a new BETTER_AUTH_SECRET (logs every player out)
 * A random password is made here; Postgres only ever gets its SCRAM hash, and the password itself is never printed.
 * The Worker reaches Supabase through Cloudflare Hyperdrive (Workers' own sockets do not accept Supabase's self-signed CA).
 * Hyperdrive's query cache is off, so a sign-out or a new password counts at once.
 */
import {randomBytes, pbkdf2Sync, createHmac, createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';

const REF = 'sxhqirmecalxcnyojjki', ROLE = 'haarklous_worker', NAME = 'haarklous-db';
const HOSTS = ['aws-1-eu-west-1.pooler.supabase.com', 'aws-0-eu-west-1.pooler.supabase.com'];
const npx = (args, input) => execFileSync('npx', ['--yes', ...args], {input, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32'}).toString();

function scram(password) {
  const salt = randomBytes(16), salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const hmac = k => createHmac('sha256', salted).update(k).digest();
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${createHash('sha256').update(hmac('Client Key')).digest('base64')}:${hmac('Server Key').toString('base64')}`;
}

const password = randomBytes(24).toString('base64url');
const sqlFile = join(tmpdir(), `haarklous-role-${process.pid}.sql`);
writeFileSync(sqlFile, `alter role ${ROLE} with login password '${scram(password)}';`);
try {npx(['supabase', 'db', 'query', '--linked', '--project-ref', REF, '-f', sqlFile]);} finally {rmSync(sqlFile, {force: true});}
console.log(`New password set for ${ROLE}.`);

// Find the pooler that knows this project and check the login (session mode, port 5432: Hyperdrive does its own pooling).
let host = null;
for (const h of HOSTS) {
  for (let i = 0; i < 6 && !host; i++) {// a new password can take a few seconds to reach the pooler
    const c = new pg.Client({host: h, port: 5432, user: `${ROLE}.${REF}`, password, database: 'postgres', ssl: {rejectUnauthorized: false}});
    try {
      await c.connect();const r = await c.query("select current_user, crypt('x', gen_salt('bf', 4)) is not null as ok, count(*) from \"user\"");
      if (r.rows[0].ok) {host = h;console.log(`Pooler ${h} works (${r.rows[0].current_user}, ${r.rows[0].count} accounts).`);}
    } catch (e) {if (/tenant|not found/i.test(e.message)) break;await new Promise(r => setTimeout(r, 3000));}
    finally {await c.end().catch(() => {});}
  }
  if (host) break;
}
if (!host) {console.error('Could not log in through the Supabase pooler.');process.exit(1);}

const origin = ['--origin-host', host, '--origin-port', '5432', '--database', 'postgres', '--origin-user', `${ROLE}.${REF}`, '--origin-password', password, '--caching-disabled'];
const list = npx(['wrangler', 'hyperdrive', 'list']), found = list.split(/\r?\n/).find(l => l.includes(NAME));
let id = found && (found.match(/[0-9a-f]{32}/) || [])[0];
if (id) npx(['wrangler', 'hyperdrive', 'update', id, ...origin]);
else id = (npx(['wrangler', 'hyperdrive', 'create', NAME, ...origin]).match(/[0-9a-f]{32}/) || [])[0];
if (!id) {console.error('Hyperdrive did not give an id.');process.exit(1);}
console.log(`Hyperdrive ${NAME} (${id}) points at Supabase.`);
const toml = readFileSync('wrangler.toml', 'utf8').replace(/(binding = "HYPERDRIVE"\s*\nid = ")[^"]*(")/, `$1${id}$2`);
writeFileSync('wrangler.toml', toml);

if (process.argv.includes('--auth-secret') || !npx(['wrangler', 'secret', 'list']).includes('BETTER_AUTH_SECRET')) {
  npx(['wrangler', 'secret', 'put', 'BETTER_AUTH_SECRET'], randomBytes(32).toString('base64url'));
  console.log('Cloudflare secret BETTER_AUTH_SECRET set.');
}
console.log('Done. Deploy with:  npx wrangler deploy');
