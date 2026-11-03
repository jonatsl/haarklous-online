/* Player accounts: Better Auth (email + password) with the tables in Supabase Postgres (schema game_auth, see ../sql/accounts.sql).
 * Routes: POST /api/auth/sign-up/email {name, email, password, callbackURL} · POST /api/auth/sign-in/email {email, password}
 *         GET /api/auth/get-session · POST /api/auth/sign-out   (session in an HttpOnly cookie on this host)
 * Email (issue #55, only when mail.js is set up): sign-up sends a "confirm your email" link (GET /api/auth/verify-email, then
 *         back to the game at the callbackURL); POST /api/auth/send-verification-email {email, callbackURL} sends it again;
 *         POST /api/auth/request-password-reset {email, redirectTo} sends a reset link, which opens the game with ?token=…, and
 *         POST /api/auth/reset-password {newPassword, token} sets the new password (once, within an hour) and logs out everywhere.
 * accountFeatures(env) -> {email} tells the game whether those emails can be sent (GET /api/account-features).
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
import {LINK_MINUTES, mailReady, sendMail} from './mail.js';

const BCRYPT_COST = 10;

export const accountFeatures = env => ({email: mailReady(env)});

function makeAuth(env, request, pool, ctx) {
  const origin = new URL(request.url).origin, mail = mailReady(env);
  // The emails go out after the answer (ctx.waitUntil): no waiting for Brevo, and sign-up's transaction is not held open.
  const send = kind => ({user, url}) => sendMail(env, {to: user.email, name: user.name, kind, url});
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
      },
      // A forgotten password: the link works once, for an hour, and the new password logs the account out everywhere.
      ...(mail ? {sendResetPassword: send('reset')} : {}),
      resetPasswordTokenExpiresIn: LINK_MINUTES * 60,
      revokeSessionsOnPasswordReset: true
    },
    // Confirming the email is asked for, not required: you can play and save before you have confirmed it.
    ...(mail ? {emailVerification: {sendOnSignUp: true, sendVerificationEmail: send('verify'), expiresIn: LINK_MINUTES * 60, autoSignInAfterVerification: true}} : {}),
    session: {expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24},
    rateLimit: {enabled: true, window: 60, max: 30},
    advanced: {backgroundTasks: {handler: p => ctx.waitUntil(p)}}
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
  try {return await makeAuth(env, request, pool, ctx).handler(request);}
  finally {ctx.waitUntil(pool.end().catch(() => {}));}
}

export async function sessionUser(request, env, ctx) {
  const dev = devUser(request, env);if (dev) return dev;
  if (!env.HYPERDRIVE || !env.BETTER_AUTH_SECRET) return null;
  const pool = new pg.Pool({connectionString: env.HYPERDRIVE.connectionString, max: 1});
  try {const s = await makeAuth(env, request, pool, ctx).api.getSession({headers: request.headers});return s && s.user ? s.user : null;}
  finally {ctx.waitUntil(pool.end().catch(() => {}));}
}
