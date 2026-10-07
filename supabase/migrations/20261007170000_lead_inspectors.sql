-- Lead inspectors and their teams (Kenneth, 7 October 2026: "inspector level
-- can be inspector or lead inspector, while inspector must be assigned to be
-- managed under a lead inspector, where the lead inspector can see all the on
-- going or done inspection in the table").
--
-- Roles stay public.user_role ('inspector', 'admin'). Two columns on profiles:
--
--   is_lead   a lead inspector: an inspector who also reads their team's inspections
--   lead_id   the lead inspector who manages this inspector, which makes them their team
--
-- The rules, each enforced in one place:
--
--   1. Admins are neither lead inspectors nor in a team.         check profiles_admin_outside_teams
--   2. A lead inspector has no lead inspector of their own.      check profiles_lead_has_no_lead
--   3. Nobody is their own lead inspector.                        check profiles_lead_not_self
--   4. A lead_id names an active lead inspector, from the moment
--      it is set (every role).                                    trigger org_guard
--   5. Someone who leads a team stays an active lead inspector:
--      demoting them, making them an admin or deactivating them
--      is refused while anyone is in their team (every role).
--      Deleting them is refused by the foreign key.               trigger org_guard
--   6. An active inspector who is not a lead works in a lead
--      inspector's team: checked whenever an admin changes
--      someone's role, level, lead or activation.                 trigger guard (profiles_guard)
--   7. Only admins change is_lead and lead_id.                    trigger guard (profiles_guard)
--
-- Rows stay as they are until someone changes who leads whom, so nothing that
-- exists breaks: inspectors without a lead (inspector@test.local, accounts
-- made before this migration) keep working, and the Users screen lists them
-- as "No lead inspector" for an admin to fix. Rule 6 binds signed-in users
-- only, like the other admin-only rules: the service role and the database
-- owner may leave an inspector without a lead for now (test setup, scripts
-- such as seed:dev-users, repairs). Rules 1 to 5 bind every role, like the
-- last-admin rule.
--
-- Rules 4 and 5 hold under concurrent changes: assigning someone locks their
-- lead's row (for share) until the end of the transaction, so a demotion of
-- that lead waits for it and then counts the new team member; a demotion that
-- went first is seen by the assignment, which then refuses.
--
-- Visibility (row level security, read-only). An active lead inspector reads
-- the inspections of their team, meaning the inspectors whose lead_id is
-- theirs now, in every status, with what the review screen reads for them:
-- photos, files, AI reviews and the decisions on them, audit rows, the
-- Storage objects in inspection-photos and inspection-files (signed URLs are
-- made with the user's own client), and their team's profiles (names in the
-- list). These are extra SELECT policies beside the existing ones, so admins
-- and inspectors keep exactly what they had, and a lead gets no insert,
-- update or delete on their team's rows: only the owner and admins edit, only
-- admins approve and reopen, and log_inspection_event() still asks
-- can_read_inspection(), which a lead does not pass for a team inspection. A
-- lead's own inspections work like any inspector's. An inspector moved to
-- another team leaves the old lead's view at once; a deactivated lead sees
-- nothing at all.
--
-- my_profile_status() also returns is_lead and lead_id, so the session knows
-- the level without another read (it is dropped and created again: its
-- result type changes).
--
-- Idempotent: running it again changes nothing.

-- Columns --------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_lead boolean not null default false,
  add column if not exists lead_id uuid references public.profiles (id) on delete restrict;

comment on column public.profiles.is_lead is
  'A lead inspector: an inspector who also reads the inspections of their team (the inspectors whose lead_id is theirs).';
comment on column public.profiles.lead_id is
  'The lead inspector who manages this inspector. Null for admins, lead inspectors, and inspectors not yet assigned.';

create index if not exists profiles_lead_id_idx on public.profiles (lead_id);

-- Rules 1 to 3: on the row itself. They also hold while the guards are
-- switched off for a repair.
alter table public.profiles drop constraint if exists profiles_admin_outside_teams;
alter table public.profiles add constraint profiles_admin_outside_teams
  check (role = 'inspector' or (not is_lead and lead_id is null));

alter table public.profiles drop constraint if exists profiles_lead_has_no_lead;
alter table public.profiles add constraint profiles_lead_has_no_lead
  check (not (is_lead and lead_id is not null));

alter table public.profiles drop constraint if exists profiles_lead_not_self;
alter table public.profiles add constraint profiles_lead_not_self
  check (lead_id <> id);

-- Caller helpers -------------------------------------------------------------

-- True for an active lead inspector.
create or replace function public.is_lead()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'inspector' and p.is_lead
  );
$$;

-- The inspectors the signed-in user leads now: their team. Empty unless the
-- caller is an active lead inspector. The one definition of a team; the
-- helpers below and the policies use it.
create or replace function public.my_team()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(member.id order by member.id), '{}')
    from public.profiles member
    join public.profiles lead on lead.id = member.lead_id
   where lead.id = (select auth.uid())
     and lead.active and lead.role = 'inspector' and lead.is_lead;
$$;

-- True when the signed-in user is the active lead inspector of `inspector` now.
create or replace function public.leads(inspector uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(leads.inspector = any (public.my_team()), false);
$$;

-- True when the signed-in user leads the inspector of this inspection.
create or replace function public.leads_inspection(inspection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.inspections i
    where i.id = leads_inspection.inspection_id
      and i.inspector_id = any (public.my_team())
  );
$$;

-- True when the signed-in user leads the inspector whose inspection this AI review is about.
create or replace function public.leads_ai_review(ai_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.ai_reviews r
      join public.inspections i on i.id = r.inspection_id
     where r.id = leads_ai_review.ai_review_id
       and i.inspector_id = any (public.my_team())
  );
$$;

-- The caller's own active flag, role, level and lead, readable even when
-- deactivated, so the app can tell a blocked user why. No row when the user
-- has no profile. The result type changes, so it is created again.
drop function if exists public.my_profile_status();
create function public.my_profile_status()
returns table (active boolean, role public.user_role, is_lead boolean, lead_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.active, p.role, p.is_lead, p.lead_id
    from public.profiles p
   where p.id = (select auth.uid());
$$;

revoke all on function
  public.is_lead(),
  public.my_team(),
  public.leads(uuid),
  public.leads_inspection(uuid),
  public.leads_ai_review(uuid),
  public.my_profile_status()
from public, anon;

grant execute on function
  public.is_lead(),
  public.my_team(),
  public.leads(uuid),
  public.leads_inspection(uuid),
  public.leads_ai_review(uuid),
  public.my_profile_status()
to authenticated, service_role;

-- Rules 6 and 7: the profiles guard of 20261006000300, with is_lead and
-- lead_id added to what only admins change, and the lead an inspector needs.
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

-- Rules 1 to 5 for every role. Security definer, so it sees and locks every
-- profile whoever asks. It looks at a row only when who leads whom changes.
create or replace function public.profiles_org_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen record;
  team_size integer;
begin
  if tg_op = 'UPDATE'
    and (new.role, new.active, new.is_lead, new.lead_id)
      is not distinct from (old.role, old.active, old.is_lead, old.lead_id) then
    return new;
  end if;

  if new.lead_id = new.id then
    raise exception 'nobody is their own lead inspector' using errcode = '23514';
  end if;
  if new.role = 'admin' and (new.is_lead or new.lead_id is not null) then
    raise exception 'an admin is not a lead inspector and is in no team' using errcode = '23514';
  end if;
  if new.is_lead and new.lead_id is not null then
    raise exception 'a lead inspector has no lead inspector of their own' using errcode = '23514';
  end if;

  -- Rule 4. Locked until the end of the transaction, so they cannot stop
  -- being a lead in the meantime.
  if new.lead_id is not null and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id) then
    select p.active, p.role, p.is_lead into chosen
      from public.profiles p
     where p.id = new.lead_id
       for share;
    if not found or not (chosen.active and chosen.role = 'inspector' and chosen.is_lead) then
      raise exception 'the lead inspector must be an active lead inspector' using errcode = '23514';
    end if;
  end if;

  -- Rule 5. Runs once this row is locked: assignments still in flight have
  -- finished, and their new team members are counted.
  if tg_op = 'UPDATE' and old.is_lead and old.role = 'inspector'
    and not (new.active and new.role = 'inspector' and new.is_lead) then
    select count(*)::integer into team_size from public.profiles p where p.lead_id = old.id;
    if team_size > 0 then
      raise exception 'this lead inspector still leads % inspector(s): assign them to another lead inspector first', team_size
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_org_guard() from public, anon, authenticated;

-- After guard (names fire in order), so a caller who may not change these
-- columns at all hears that first.
create or replace trigger org_guard before insert or update on public.profiles
  for each row execute function public.profiles_org_guard();

-- Read-only access for lead inspectors -----------------------------------------
-- Extra SELECT policies, OR-ed with the existing ones. (select public.is_lead())
-- is worked out once per statement, so everyone else skips the per-row check.

drop policy if exists profiles_select_team on public.profiles;
create policy profiles_select_team on public.profiles
  for select to authenticated
  using (id = any ((select public.my_team())::uuid[]));

drop policy if exists inspections_select_team on public.inspections;
create policy inspections_select_team on public.inspections
  for select to authenticated
  using (inspector_id = any ((select public.my_team())::uuid[]));

drop policy if exists inspection_photos_select_team on public.inspection_photos;
create policy inspection_photos_select_team on public.inspection_photos
  for select to authenticated
  using ((select public.is_lead()) and public.leads_inspection(inspection_id));

drop policy if exists inspection_files_select_team on public.inspection_files;
create policy inspection_files_select_team on public.inspection_files
  for select to authenticated
  using ((select public.is_lead()) and public.leads_inspection(inspection_id));

drop policy if exists ai_reviews_select_team on public.ai_reviews;
create policy ai_reviews_select_team on public.ai_reviews
  for select to authenticated
  using ((select public.is_lead()) and public.leads_inspection(inspection_id));

drop policy if exists ai_review_actions_select_team on public.ai_review_actions;
create policy ai_review_actions_select_team on public.ai_review_actions
  for select to authenticated
  using ((select public.is_lead()) and public.leads_ai_review(ai_review_id));

-- Deletion records (no inspection) stay admin-only.
drop policy if exists audit_log_select_team on public.audit_log;
create policy audit_log_select_team on public.audit_log
  for select to authenticated
  using ((select public.is_lead()) and public.leads_inspection(inspection_id));

drop policy if exists inspection_media_select_team on storage.objects;
create policy inspection_media_select_team on storage.objects
  for select to authenticated
  using (
    bucket_id in ('inspection-photos', 'inspection-files')
    and (select public.is_lead())
    and public.leads_inspection(public.storage_inspection_id(name))
  );
