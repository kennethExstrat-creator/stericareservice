-- Stand-in for the parts of a hosted Supabase project the migrations touch, so
-- they run unchanged on PGlite. Definitions follow Supabase's own: API roles
-- that are not superusers, service_role with BYPASSRLS, auth.uid() and friends
-- reading the PostgREST claims, storage tables with RLS on, and the default
-- privileges Supabase grants on schema public.
--
-- Migrations run as supabase_migrations, standing in for Supabase's `postgres`
-- role (PGlite's bootstrap superuser already has that name). Like `postgres`
-- on Supabase it is not a superuser: it has BYPASSRLS, full access to
-- auth.users and the storage tables, and may create policies on storage.objects.

-- Roles ------------------------------------------------------------------------

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

create role supabase_auth_admin nologin noinherit createrole;
create role supabase_storage_admin nologin noinherit createrole;

create role supabase_migrations nologin inherit createrole bypassrls;
grant anon, authenticated, service_role to supabase_migrations;
grant supabase_storage_admin to supabase_migrations;

-- Schema public: Supabase's default privileges for objects created by `postgres`.

grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to supabase_migrations;

alter default privileges for role supabase_migrations in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_migrations in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges for role supabase_migrations in schema public
  grant all on sequences to anon, authenticated, service_role;

-- auth -----------------------------------------------------------------------

create schema auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role, supabase_migrations;

set role supabase_auth_admin;

-- The columns Supabase Auth fills when it creates a user.
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text unique default null,
  banned_until timestamptz,
  deleted_at timestamptz,
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false
);

create unique index users_email_partial_key on auth.users (email) where (is_sso_user = false);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role()
returns text
language sql
stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create function auth.email()
returns text
language sql
stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

reset role;

grant all on auth.users to supabase_migrations;

-- storage --------------------------------------------------------------------

create schema storage authorization supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role, supabase_migrations;

set role supabase_storage_admin;

create table storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create unique index bname on storage.buckets using btree (name);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  user_metadata jsonb
);

create unique index bucketid_objname on storage.objects using btree (bucket_id, name);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create function storage.foldername(name text)
returns text[]
language plpgsql
as $function$
declare
_parts text[];
begin
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
end
$function$;

create function storage.filename(name text)
returns text
language plpgsql
as $function$
declare
_parts text[];
begin
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
end
$function$;

create function storage.extension(name text)
returns text
language plpgsql
as $function$
declare
_parts text[];
_filename text;
begin
	select string_to_array(name, '/') into _parts;
	select _parts[array_length(_parts,1)] into _filename;
	return reverse(split_part(reverse(_filename), '.', 1));
end
$function$;

reset role;

-- RLS decides what the API roles see, as on Supabase.
grant all on storage.buckets, storage.objects
  to anon, authenticated, service_role, supabase_migrations;
