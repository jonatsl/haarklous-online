/* Player accounts: Better Auth (email + password) with the tables in Supabase Postgres (schema game_auth, see ../sql/accounts.sql).
 * Routes: POST /api/auth/sign-up/email {name, email, password} · POST /api/auth/sign-in/email {email, password}
 *         GET /api/auth/get-session · POST /api/auth/sign-out   (session in an HttpOnly cookie on this host)
 * Set up by scripts/set-db-secret.mjs: Hyperdrive binding HYPERDRIVE (Supabase as role haarklous_worker), secret BETTER_AUTH_SECRET.
 * Passwords are hashed by Postgres (pgcrypto bcrypt): Better Auth's own scrypt in JavaScript costs more CPU than a Worker may use.
 * Workers cannot keep a database connection between requests, so every request gets its own small pool, closed afterwards
 * (Hyperdrive keeps the real connections to Supabase warm).
 */
import {betterAuth} from 'better-auth';
import pg from 'pg';

const BCRYPT_COST = 10;

export async function handleAuth(request, env, ctx) {
  if (!env.HYPERDRIVE || !env.BETTER_AUTH_SECRET) return Response.json({message: 'Accounts are not set up on this server yet'}, {status: 503});
  const pool = new pg.Pool({connectionString: env.HYPERDRIVE.connectionString, max: 1});
  const origin = new URL(request.url).origin;
  const auth = betterAuth({
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
  try {return await auth.handler(request);}
  finally {ctx.waitUntil(pool.end().catch(() => {}));}
}
