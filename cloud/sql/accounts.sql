-- Player accounts (Better Auth, email + password) in the Supabase project "Haarklous Online" (ref sxhqirmecalxcnyojjki).
-- Apply with:  npx supabase db query --linked --project-ref sxhqirmecalxcnyojjki -f sql/accounts.sql   (from cloud/; safe to run again)
-- The tables live in their own schema, game_auth, which Supabase's public Data API does not expose. The Worker logs in as
-- haarklous_worker (through Cloudflare Hyperdrive), a role that can only use this schema and the bcrypt functions; its
-- password is made by scripts/set-db-secret.mjs and kept only in the Hyperdrive config.

create schema if not exists game_auth;

create table if not exists game_auth."user" (
  id text primary key,
  name text not null,
  email text not null unique,
  "emailVerified" boolean not null default false,
  image text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists game_auth.session (
  id text primary key,
  "expiresAt" timestamptz not null,
  token text not null unique,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references game_auth."user"(id) on delete cascade
);
create index if not exists session_user_idx on game_auth.session ("userId");

create table if not exists game_auth.account (
  id text primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references game_auth."user"(id) on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index if not exists account_user_idx on game_auth.account ("userId");

create table if not exists game_auth.verification (
  id text primary key,
  identifier text not null,
  value text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index if not exists verification_identifier_idx on game_auth.verification (identifier);

-- The Worker's own login role (no password here; see scripts/set-db-secret.mjs).
do $$ begin
  if not exists (select from pg_roles where rolname = 'haarklous_worker') then create role haarklous_worker nologin; end if;
end $$;
alter role haarklous_worker set search_path = game_auth, extensions;
grant usage on schema game_auth to haarklous_worker;
grant select, insert, update, delete on all tables in schema game_auth to haarklous_worker;
grant usage on schema extensions to haarklous_worker;
grant execute on function extensions.crypt(text, text), extensions.gen_salt(text, integer) to haarklous_worker;
