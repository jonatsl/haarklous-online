/* Player accounts: Better Auth (email + password) with the tables in Supabase Postgres (schema game_auth, see ../sql/accounts.sql).
 * Routes: POST /api/auth/sign-up/email {name, email, password} · POST /api/auth/sign-in/email {email, password}
 *         GET /api/auth/get-session · POST /api/auth/sign-out   (session in an HttpOnly cookie on this host)
 * sessionUser(request, env, ctx) -> the logged-in user {id, name, email} or null (used by the saved progress, progress.js).
 * Set up by scripts/set-db-secret.mjs: Hyperdrive binding HYPERDRIVE (Supabase as role haarklous_worker), secret BETTER_AUTH_SECRET.
 * Passwords are hashed by Postgres (pgcrypto bcrypt): Better Auth's own scrypt in JavaScript costs more CPU than a Worker may use.
 * Workers cannot keep a database connection between requests, so every request gets its own small pool, closed afterwards
 * (Hyperdrive keeps the real connections to Supabase warm).
 * Local tests only: `npx wrangler dev --var DEV_USER:<id>` on localhost makes every request logged in as that id (no database);
 * the live Worker has no DEV_USER.
 */
import {betterAuth} from 'better-auth';
import pg from 'pg';

const BCRYPT_COST = 10;

function makeAuth(env, request, pool) {
  const origin = new URL(request.url).origin;
  return betterAuth({
    appName: 'Haarklous online',
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    database: pool,
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 72,// bcrypt only reads the first 72 bytes
      autoSignIn: true,
      password: {
        hash: async password => (await pool.query('select crypt($1, gen_salt($2, $3)) as h', [password, 'bf', BCRYPT_COST])).rows[0].h,
        verify: async ({hash, password}) => (await pool.query('select crypt($1, $2) = $2 as ok', [password, hash])).rows[0].ok
      }
    },
    session: {expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24},
    rateLimit: {enabled: true, window: 60, max: 30}
  });
}
const devUser = (request, env) => env.DEV_USER && /^(localhost|127\.0\.0\.1)$/.test(new URL(request.url).hostname) ?
  {id: String(env.DEV_USER), name: String(env.DEV_USER), email: `${env.DEV_USER}@localhost`} : null;

export async function handleAuth(request, env, ctx) {
  const dev = devUser(request, env);
  if (dev) return Response.json(new URL(request.url).pathname.endsWith('/sign-out') ? {success: true} : {user: dev, session: {}});
  if (!env.HYPERDRIVE || !env.BETTER_AUTH_SECRET) return Response.json({message: 'Accounts are not set up on this server yet'}, {status: 503});
  // Two connections: sign-up runs in a transaction that holds one, and the password hash (a query) needs the other.
  // With one, every sign-up waited for itself forever (the game said "Wait…").
  const pool = new pg.Pool({connectionString: env.HYPERDRIVE.connectionString, max: 2});
  try {return await makeAuth(env, request, pool).handler(request);}
  finally {ctx.waitUntil(pool.end().catch(() => {}));}
}

export async function sessionUser(request, env, ctx) {
  const dev = devUser(request, env);if (dev) return dev;
  if (!env.HYPERDRIVE || !env.BETTER_AUTH_SECRET) return null;
  const pool = new pg.Pool({connectionString: env.HYPERDRIVE.connectionString, max: 1});
  try {const s = await makeAuth(env, request, pool).api.getSession({headers: request.headers});return s && s.user ? s.user : null;}
  finally {ctx.waitUntil(pool.end().catch(() => {}));}
}
