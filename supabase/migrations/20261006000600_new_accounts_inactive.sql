-- New accounts start inactive.
--
-- Public sign-up is off in the Supabase dashboard (BUILD_SPEC 3), but if it is
-- ever switched on by mistake, a self-registered account must not be able to
-- read anything. RLS already blocks inactive profiles everywhere, so an account
-- only works once an admin has activated it: the invite action activates the
-- account it creates, scripts/create-dev-users.mts activates the test
-- accounts, and Kenneth's first admin is activated by the SQL line in README.md.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role, active)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name', 'inspector', false);
  return new;
end;
$$;

alter table public.profiles alter column active set default false;

-- Accounts that existed before the profiles table (migration 000300 backfilled
-- them as active) become inactive too: blocked until an admin activates them.
-- This migration ships with the initial schema, before any real account has
-- been set up, so no working inspector is affected.
update public.profiles set active = false where role = 'inspector' and active;
