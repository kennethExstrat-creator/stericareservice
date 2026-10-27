-- A phone number for every user, and joining by invitation (Kenneth, 27 October
-- 2026: "User info should be name, phone, email, role, UID"; an invited user
-- "goes to Account Creation page where Name, Email, Phone is being filled in,
-- and then fill in password and confirmation"; "Role is already selected during
-- the invitation by admin").
--
--   1. profiles.phone: the person's phone number as they typed it, on one line,
--      7 to 15 digits with an optional leading + and spaces, brackets or
--      hyphens between them. Null for accounts made before this migration until
--      someone adds it.
--   2. profiles.joined_at: when the person finished creating their account. An
--      invited account is active from the invite on (the admin's decision), but
--      until it has joined the app sends its session to /create-account and
--      the admin's list shows it as Invited. An account made with a password (a
--      script such as create-dev-users, or sign-up should it ever be switched
--      on) has nothing left to set up, so it has joined from the start.
--   3. complete_account(full_name, phone): the one way a signed-in user sets
--      their own name, phone and joined_at together, on the Account Creation
--      page, after the app has set their password.
--   4. joined_at changes only as the owner (complete_account) or with the
--      service role: signed-in users and anon are refused.
--
-- Accounts that already have a password have joined, on the day they were
-- made. One without (an invite nobody has answered) answers it at
-- /create-account.

alter table public.profiles
  add column phone text,
  add column joined_at timestamptz;

alter table public.profiles
  add constraint profiles_phone_format check (
    phone is null
    or (
      phone ~ '^\+?[0-9(][0-9 ()-]*[0-9]$'
      and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 15
      and char_length(phone) <= 32
    )
  );

comment on column public.profiles.phone is
  'The user''s phone number as typed: 7 to 15 digits, an optional leading +, and spaces, brackets or hyphens between them.';
comment on column public.profiles.joined_at is
  'When the user finished creating their account (complete_account); null for an invite not yet answered.';

-- Rule 4 --------------------------------------------------------------------

create function public.profiles_joined_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.joined_at is distinct from old.joined_at and current_user in ('authenticated', 'anon') then
    raise exception 'joined_at is set when the account is created' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger joined_guard before update on public.profiles
  for each row execute function public.profiles_joined_guard();

-- Rule 2 for new accounts: the sign-up trigger of 20261006000600, with joined_at.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role, active, joined_at)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    'inspector',
    false,
    -- An invite makes the auth user without a password.
    case when coalesce(new.encrypted_password, '') <> '' then now() end
  );
  return new;
end;
$$;

-- Rule 3 --------------------------------------------------------------------

create function public.complete_account(p_full_name text, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'sign in to create your account' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null then
    raise exception 'a name is needed' using errcode = '23514';
  end if;
  if nullif(btrim(p_phone), '') is null then
    raise exception 'a phone number is needed' using errcode = '23514';
  end if;

  update public.profiles
     set full_name = p_full_name,
         phone = btrim(p_phone),
         joined_at = coalesce(joined_at, now())
   where id = me
     and active;
  if not found then
    raise exception 'no active account to create' using errcode = '42501';
  end if;
end;
$$;

comment on function public.complete_account(text, text) is
  'The Account Creation page: the signed-in user''s own name and phone, and joined_at once.';

-- Existing accounts ----------------------------------------------------------

-- Without moving updated_at: an inactive account that nobody has handled yet
-- reads as pending while its profile is untouched (lib/auth/users.ts).
alter table public.profiles disable trigger set_updated_at;
update public.profiles p
   set joined_at = p.created_at
  from auth.users u
 where u.id = p.id
   and coalesce(u.encrypted_password, '') <> ''
   and p.joined_at is null;
alter table public.profiles enable trigger set_updated_at;

-- Privileges -----------------------------------------------------------------

revoke all on function public.complete_account(text, text) from public, anon;
grant execute on function public.complete_account(text, text) to authenticated, service_role;

-- Trigger functions fire without EXECUTE; nobody calls them directly.
revoke all on function public.profiles_joined_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
