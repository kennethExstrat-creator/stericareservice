-- A UID for every user (Kenneth, 8 October 2026: "can u give UID to each
-- user?"). He chose an automatic number, given when a user is created, in
-- order, never reused and never changed, and shown on the Users screen only
-- (Admin > Users: a UID column, the user dialogs and the search). Not on
-- inspections or reports, and not for signing in: people sign in with their
-- email, as before.
--
-- profiles.uid is 'SC-' and the number, zero-padded to at least four digits
-- and never cut short: SC-0001 ... SC-9999, then SC-10000 (profile_uid(), as
-- inspection_ref() writes INS-2026-0001). The rules, each enforced in one
-- place:
--
--   1. Every new profile draws the next number, whatever the inserter
--      sent: the auth trigger handle_new_auth_user() (every account,
--      whoever creates it), the service role, the SQL editor. A number is
--      handed out once, and never again, also after its profile is
--      deleted or its insert rolled back.                        trigger set_uid
--   2. Nobody changes a uid through the API, the service role included
--      (42501). Only the database owner can, deliberately.        trigger guard (profiles_guard)
--   3. One profile per number, and one spelling per number.       index profiles_uid_key, check profiles_uid_format
--
-- No API role holds any privilege on the sequence profile_uid_seq: set_uid
-- draws as the owner (security definer), so nobody can draw, skip or reset a
-- number. Users and admins read uid wherever they read the profile now (row
-- level security is unchanged, and the table's SELECT covers the column);
-- there is no new way to write it.
--
-- The profiles already there are numbered here, once, oldest first
-- (created_at, then id for two created at the same instant). Migration
-- 20261007191137 filled its new columns without an UPDATE, as generated
-- columns that the table rewrite computes; that does not apply here: a
-- generated column is computed from its own row alone, and a profile's
-- number depends on the profiles created before it. So one UPDATE numbers
-- them, with the set_updated_at trigger switched off for it. The DO block is
-- one statement and keeps the table locked until it ends, so no other write
-- ever meets the switched-off trigger. updated_at stays as it was: an account
-- waiting for activation still reads as untouched (accountStatus() in
-- lib/auth/users.ts), and an invite's compare-and-set on updated_at still
-- holds. The other triggers run as for any change by the owner, and change
-- nothing here. Profiles have no audit trail, so no audit row is written.
--
-- Until a project has this migration, the Users screen works without UIDs:
-- lib/auth/users.ts reads the list again without the column.
--
-- Idempotent: running it again changes nothing.

-- Numbers ---------------------------------------------------------------------

create sequence if not exists public.profile_uid_seq as bigint;

comment on sequence public.profile_uid_seq is
  'The numbers of the users'' UIDs (profiles.uid). Drawn only by the trigger set_uid; no API role may use it.';

-- 'SC-0042': SC- and the number, padded to four digits; it keeps growing
-- past 9999 (SC-10000) and is never cut short.
create or replace function public.profile_uid(seq bigint)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'SC-' || lpad(seq::text, greatest(4, length(seq::text)), '0');
$$;

comment on function public.profile_uid(bigint) is
  'A user''s UID from its number: SC- and the number, zero-padded to at least four digits (SC-0042, SC-10000).';

-- The column, and the profiles already there -----------------------------------

alter table public.profiles add column if not exists uid text;

comment on column public.profiles.uid is
  'The user''s UID, e.g. SC-0042: given by the database when the profile is created, in order. It never changes and is never given to anyone else. Shown on the Users screen.';

do $$
declare
  handed_out bigint;
  numbered bigint;
begin
  if not exists (select 1 from public.profiles p where p.uid is null) then
    return;
  end if;
  -- Numbers already drawn (none, the first time) stay drawn.
  select case when s.is_called then s.last_value else s.last_value - 1 end
    into handed_out
    from public.profile_uid_seq s;

  alter table public.profiles disable trigger set_updated_at;
  with oldest_first as (
    select p.id, handed_out + row_number() over (order by p.created_at, p.id) as seq
      from public.profiles p
     where p.uid is null
  )
  update public.profiles p
     set uid = public.profile_uid(oldest_first.seq)
    from oldest_first
   where p.id = oldest_first.id;
  get diagnostics numbered = row_count;
  alter table public.profiles enable trigger set_updated_at;

  -- The next profile gets the number after the last one given here.
  perform setval('public.profile_uid_seq', handed_out + numbered);
end;
$$;

alter table public.profiles alter column uid set not null;

-- Rule 3.
create unique index if not exists profiles_uid_key on public.profiles (uid);

-- The one spelling of each number from 1: four digits with leading zeros up
-- to SC-9999, then the digits alone (SC-10000). It also holds when a repair
-- writes with the triggers switched off.
alter table public.profiles drop constraint if exists profiles_uid_format;
alter table public.profiles add constraint profiles_uid_format
  check (uid ~ '^SC-(000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3,})$');

-- Rule 1: new profiles --------------------------------------------------------

-- Replaces whatever the inserter sent. Security definer: the sequence is the
-- owner's alone.
create or replace function public.profiles_assign_uid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.uid := public.profile_uid(nextval('public.profile_uid_seq'));
  return new;
end;
$$;

-- BEFORE triggers fire in name order: after guard and org_guard, so an insert
-- they refuse draws no number. A number drawn for an insert that fails later
-- or is rolled back leaves a gap; it is never handed out again.
create or replace trigger set_uid before insert on public.profiles
  for each row execute function public.profiles_assign_uid();

-- Rule 2: the profiles guard ----------------------------------------------------

-- The guard of 20261007170000 (its latest text; nothing after it restates
-- it), every rule unchanged, with the uid rule added first: it binds the
-- service role too, which the rules for signed-in users leave alone.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trusted constant boolean := current_user not in ('authenticated', 'anon');
begin
  if tg_op in ('INSERT', 'UPDATE') then
    new.full_name := nullif(btrim(new.full_name), '');
  end if;

  -- A user's UID is given once (trigger set_uid). Every API role is refused,
  -- the service role included; only the database owner can renumber.
  if tg_op = 'UPDATE' and new.uid is distinct from old.uid
    and current_user in ('authenticated', 'anon', 'service_role') then
    raise exception 'a user''s UID never changes' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and not trusted then
    if new.email is distinct from old.email then
      raise exception 'email follows the sign-in email in Supabase Auth'
        using errcode = '42501';
    end if;
    if (new.role, new.active, new.is_lead, new.lead_id)
      is distinct from (old.role, old.active, old.is_lead, old.lead_id)
      and not public.is_admin() then
      raise exception 'only an admin can change role, active, is_lead or lead_id' using errcode = '42501';
    end if;
    if new.signature_path is distinct from old.signature_path
      and old.id is distinct from (select auth.uid()) then
      raise exception 'only the user can change their signature' using errcode = '42501';
    end if;
    -- Rule 6, when an admin changes who someone is or who leads them.
    if (new.role, new.active, new.is_lead, new.lead_id)
        is distinct from (old.role, old.active, old.is_lead, old.lead_id)
      and new.active and new.role = 'inspector' and not new.is_lead and new.lead_id is null then
      raise exception 'an active inspector needs a lead inspector' using errcode = '23514';
    end if;
  end if;

  -- Whoever asks, the app keeps at least one active admin. The lock serialises
  -- concurrent demotions so two admins cannot remove each other at once.
  if tg_op <> 'INSERT' and old.role = 'admin' and old.active
    and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    perform pg_advisory_xact_lock(hashtext('public.profiles last active admin'));
    if not exists (
      select 1 from public.profiles p
      where p.role = 'admin' and p.active and p.id <> old.id
    ) then
      raise exception 'cannot remove the last active admin' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Privileges ----------------------------------------------------------------------

-- Supabase grants every API role all privileges on a new sequence; none of
-- them may draw, skip or reset a number.
revoke all on sequence public.profile_uid_seq from public, anon, authenticated, service_role;

-- A pure formatter. Signed-in users never need it: set_uid and the numbering
-- above run as the owner.
revoke all on function public.profile_uid(bigint) from public, anon, authenticated;
grant execute on function public.profile_uid(bigint) to service_role;

-- Trigger functions fire without EXECUTE; nobody calls them directly.
revoke all on function public.profiles_assign_uid() from public, anon, authenticated;

-- PostgREST reads the new column at once.
notify pgrst, 'reload schema';
