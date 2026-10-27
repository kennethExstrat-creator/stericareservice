-- Roles and permissions (Kenneth, 27 October 2026: "build permission and
-- module on off for each role", app sections and actions, with custom roles
-- too).
--
-- A role is a name, what its people see (access) and what they may do
-- (permissions). Every profile has one (profiles.role_id).
--
--   1. access: 'own' (their own inspections, like an inspector), 'team' (their
--      team's too, like a lead inspector) or 'all' (every inspection, like an
--      admin). profiles.role and profiles.is_lead follow the role's access,
--      so the row level security that reads them is unchanged: access is the
--      data boundary it has always been.
--   2. permissions: the screens and actions a role switches on (the keys in
--      the check below, lib/auth/permissions.ts names them). Within what its
--      access lets someone see, the database refuses what a role does not
--      allow: managing manufacturers, clients (and their logos) and defect
--      codes; creating inspections, deleting drafts, approving or reopening,
--      switching inspection steps on or off; acting on Steri-AI second
--      opinions; reading Steri-AI's costs. The app checks every permission on
--      the server as well (the screens, the Steri-AI calls, exports).
--   3. Three built-in roles come with the app: Admin (every permission; its
--      name, access and permissions never change), Lead Inspector ('team')
--      and Inspector ('own'), whose switches an admin may change. They are
--      never deleted or renamed. Custom roles are added, renamed and deleted
--      freely; one that people still have is not deleted, and what it sees
--      does not change while anyone has it.
--   4. Users and roles are managed by people with the built-in Admin role
--      only (is_full_admin): nobody can give themselves more than they have.
--      The app keeps at least one active person with the Admin role.
--   5. A write that sets role and is_lead without role_id (code from before
--      roles) moves the person to the built-in role for that level; one that
--      sets role_id gives role and is_lead its access. Nothing else is
--      changed for the writer: a lead_id the access does not allow is refused
--      by the team rules, as before.
--
-- Today's behaviour is unchanged: everyone gets the built-in role for what
-- they are, and the built-in roles allow what each could do before.

-- 1. Roles ---------------------------------------------------------------------

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  -- 'admin', 'lead' or 'inspector' for the roles that come with the app.
  built_in text unique,
  name text not null,
  description text,
  access text not null,
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_built_in_kind check (built_in in ('admin', 'lead', 'inspector')),
  constraint roles_access_kind check (access in ('own', 'team', 'all')),
  constraint roles_name_length check (char_length(name) between 1 and 60),
  constraint roles_description_length check (description is null or char_length(description) <= 300),
  constraint roles_known_permissions check (
    permissions <@ array[
      'dashboard', 'manufacturers', 'clients', 'defects', 'general_settings', 'ai_settings',
      'create_inspections', 'delete_drafts', 'approve_inspections', 'switch_steps',
      'export_reports', 'ai_reading', 'ai_summary', 'ai_second_opinion'
    ]::text[]
  )
);

-- One name once, whatever its case.
create unique index roles_name_key on public.roles (lower(name));

comment on table public.roles is
  'Who sees what and may do what: built-in Admin, Lead Inspector and Inspector, and the custom roles admins add.';

create trigger set_updated_at before insert or update on public.roles
  for each row execute function public.set_updated_at();

create function public.roles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.built_in is not null then
      raise exception 'a built-in role is never deleted' using errcode = '42501';
    end if;
    -- A role people still have: the foreign key on profiles.role_id refuses it.
    return old;
  end if;

  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.description := nullif(btrim(new.description), '');
  -- Each permission once, in a fixed order, so equal roles compare equal.
  new.permissions := array(select distinct unnest(new.permissions) order by 1);

  if tg_op = 'INSERT' then
    if new.built_in is not null and current_user in ('authenticated', 'anon') then
      raise exception 'the built-in roles come with the app' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.built_in is distinct from old.built_in then
    raise exception 'a role never becomes or stops being built in' using errcode = '42501';
  end if;
  if old.built_in is not null and (new.name, new.access) is distinct from (old.name, old.access) then
    raise exception 'the built-in roles keep their name and what they see' using errcode = '42501';
  end if;
  if old.built_in = 'admin' and new.permissions is distinct from old.permissions then
    raise exception 'the Admin role has every permission' using errcode = '42501';
  end if;
  if new.access is distinct from old.access
    and exists (select 1 from public.profiles p where p.role_id = old.id) then
    raise exception 'move its people to another role before changing what it sees' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard before insert or update or delete on public.roles
  for each row execute function public.roles_guard();

insert into public.roles (built_in, name, description, access, permissions) values
  ('admin', 'Admin', 'Everything, including users and roles.', 'all', array[
    'dashboard', 'manufacturers', 'clients', 'defects', 'general_settings', 'ai_settings',
    'create_inspections', 'delete_drafts', 'approve_inspections', 'switch_steps',
    'export_reports', 'ai_reading', 'ai_summary', 'ai_second_opinion'
  ]),
  ('lead', 'Lead Inspector', 'Inspects, and sees the inspections of their team.', 'team', array[
    'create_inspections', 'delete_drafts', 'export_reports', 'ai_reading', 'ai_summary'
  ]),
  ('inspector', 'Inspector', 'Inspects, and sees their own inspections.', 'own', array[
    'create_inspections', 'delete_drafts', 'export_reports', 'ai_reading', 'ai_summary'
  ]);

-- 2. Everyone's role -------------------------------------------------------------

alter table public.profiles
  add column role_id uuid references public.roles (id) on delete restrict;

create index profiles_role_id_idx on public.profiles (role_id);

comment on column public.profiles.role_id is
  'The person''s role (public.roles); role and is_lead follow its access.';

-- Helpers ------------------------------------------------------------------------

create function public.builtin_role_id(kind text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id from public.roles r where r.built_in = kind;
$$;

-- An active person with the built-in Admin role: manages users and roles.
create function public.is_full_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
     where p.id = (select auth.uid()) and p.active and r.built_in = 'admin'
  );
$$;

-- Whether the caller's role allows `permission`; the Admin role allows everything.
create function public.has_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
     where p.id = (select auth.uid())
       and p.active
       and (r.built_in = 'admin' or has_permission.permission = any (r.permissions))
  );
$$;

-- The caller's own role, for the session (lib/auth/session.ts). No row when the
-- user has no profile.
create function public.my_role()
returns table (id uuid, name text, built_in text, access text, permissions text[])
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, r.built_in, r.access, r.permissions
    from public.profiles p
    join public.roles r on r.id = p.role_id
   where p.id = (select auth.uid());
$$;

-- 3. The profiles guard ----------------------------------------------------------

-- The guard of 20261008140000 (its latest text), every rule kept, with:
-- the role sync first (rule 1 and 5), role_id among what only an admin
-- changes, and "admin" meaning the built-in Admin role for managing people
-- and for the last active admin (rule 4).
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trusted constant boolean := current_user not in ('authenticated', 'anon');
  admin_role constant uuid := public.builtin_role_id('admin');
  role_access text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    new.full_name := nullif(btrim(new.full_name), '');

    if (tg_op = 'INSERT' and new.role_id is not null)
      or (tg_op = 'UPDATE' and new.role_id is distinct from old.role_id) then
      -- A role given: role and is_lead follow its access.
      select r.access into role_access from public.roles r where r.id = new.role_id;
      if role_access is not null then
        new.role := case role_access when 'all' then 'admin' else 'inspector' end;
        new.is_lead := role_access = 'team';
      end if;
    elsif (tg_op = 'INSERT' or (new.role, new.is_lead) is distinct from (old.role, old.is_lead))
      and not (new.role = 'admin' and new.is_lead) then
      -- No role given (sign-up, or code from before roles): the built-in role for
      -- what was written. An admin marked as a lead is left for the team rules
      -- to refuse.
      new.role_id := public.builtin_role_id(
        case when new.role = 'admin' then 'admin' when new.is_lead then 'lead' else 'inspector' end
      );
    end if;
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
    if (new.role_id, new.role, new.active, new.is_lead, new.lead_id)
      is distinct from (old.role_id, old.role, old.active, old.is_lead, old.lead_id)
      and not public.is_full_admin() then
      raise exception 'only an admin can change role, active, is_lead or lead_id' using errcode = '42501';
    end if;
    if new.signature_path is distinct from old.signature_path
      and old.id is distinct from (select auth.uid()) then
      raise exception 'only the user can change their signature' using errcode = '42501';
    end if;
    -- Rule 6, when an admin changes who someone is or who leads them.
    if (new.role_id, new.role, new.active, new.is_lead, new.lead_id)
        is distinct from (old.role_id, old.role, old.active, old.is_lead, old.lead_id)
      and new.active and new.role = 'inspector' and not new.is_lead and new.lead_id is null then
      raise exception 'an active inspector needs a lead inspector' using errcode = '23514';
    end if;
  end if;

  -- Whoever asks, the app keeps at least one active person with the Admin
  -- role. The lock serialises concurrent changes so two admins cannot remove
  -- each other at once.
  if tg_op <> 'INSERT' and old.role_id = admin_role and old.active
    and (tg_op = 'DELETE' or new.role_id is distinct from admin_role or not new.active) then
    perform pg_advisory_xact_lock(hashtext('public.profiles last active admin'));
    if not exists (
      select 1 from public.profiles p
      where p.role_id = admin_role and p.active and p.id <> old.id
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

-- Existing people: the built-in role for what they are, without moving
-- updated_at (an untouched inactive account reads as pending).
alter table public.profiles disable trigger set_updated_at;
update public.profiles
   set role_id = public.builtin_role_id(
     case when role = 'admin' then 'admin' when is_lead then 'lead' else 'inspector' end
   )
 where role_id is null;
alter table public.profiles enable trigger set_updated_at;

alter table public.profiles alter column role_id set not null;

-- 4. Row level security ----------------------------------------------------------

alter table public.roles enable row level security;

create policy roles_select on public.roles
  for select to authenticated using ((select public.is_active()));
create policy roles_insert on public.roles
  for insert to authenticated with check ((select public.is_full_admin()));
create policy roles_update on public.roles
  for update to authenticated
  using ((select public.is_full_admin())) with check ((select public.is_full_admin()));
create policy roles_delete on public.roles
  for delete to authenticated using ((select public.is_full_admin()));

-- People change their own profile; only the Admin role changes anyone else's.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    (id = (select auth.uid()) and (select public.is_active()))
    or (select public.is_full_admin())
  )
  with check (
    (id = (select auth.uid()) and (select public.is_active()))
    or (select public.is_full_admin())
  );

-- Reference data: the role's switch for each screen.
drop policy if exists manufacturers_insert on public.manufacturers;
drop policy if exists manufacturers_update on public.manufacturers;
drop policy if exists manufacturers_delete on public.manufacturers;
create policy manufacturers_insert on public.manufacturers
  for insert to authenticated with check ((select public.has_permission('manufacturers')));
create policy manufacturers_update on public.manufacturers
  for update to authenticated
  using ((select public.has_permission('manufacturers')))
  with check ((select public.has_permission('manufacturers')));
create policy manufacturers_delete on public.manufacturers
  for delete to authenticated using ((select public.has_permission('manufacturers')));

drop policy if exists clients_insert on public.clients;
drop policy if exists clients_update on public.clients;
drop policy if exists clients_delete on public.clients;
create policy clients_insert on public.clients
  for insert to authenticated with check ((select public.has_permission('clients')));
create policy clients_update on public.clients
  for update to authenticated
  using ((select public.has_permission('clients')))
  with check ((select public.has_permission('clients')));
create policy clients_delete on public.clients
  for delete to authenticated using ((select public.has_permission('clients')));

drop policy if exists defect_codes_insert on public.defect_codes;
drop policy if exists defect_codes_update on public.defect_codes;
drop policy if exists defect_codes_delete on public.defect_codes;
create policy defect_codes_insert on public.defect_codes
  for insert to authenticated with check ((select public.has_permission('defects')));
create policy defect_codes_update on public.defect_codes
  for update to authenticated
  using ((select public.has_permission('defects')))
  with check ((select public.has_permission('defects')));
create policy defect_codes_delete on public.defect_codes
  for delete to authenticated using ((select public.has_permission('defects')));

-- Client logos follow the Clients switch; template sources stay with the Admin role.
drop policy if exists reference_files_insert on storage.objects;
drop policy if exists reference_files_update on storage.objects;
drop policy if exists reference_files_delete on storage.objects;
create policy client_logos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-logos' and (select public.has_permission('clients')));
create policy client_logos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'client-logos' and (select public.has_permission('clients')))
  with check (bucket_id = 'client-logos' and (select public.has_permission('clients')));
create policy client_logos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-logos' and (select public.has_permission('clients')));
create policy template_sources_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'template-sources' and (select public.is_full_admin()));
create policy template_sources_update on storage.objects
  for update to authenticated
  using (bucket_id = 'template-sources' and (select public.is_full_admin()))
  with check (bucket_id = 'template-sources' and (select public.is_full_admin()));
create policy template_sources_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'template-sources' and (select public.is_full_admin()));

-- Steri-AI second opinion: deciding is the role's switch; reading stays as it was.
drop policy if exists ai_reviews_insert on public.ai_reviews;
drop policy if exists ai_reviews_update on public.ai_reviews;
drop policy if exists ai_reviews_delete on public.ai_reviews;
create policy ai_reviews_insert on public.ai_reviews
  for insert to authenticated with check ((select public.has_permission('ai_second_opinion')));
create policy ai_reviews_update on public.ai_reviews
  for update to authenticated
  using ((select public.has_permission('ai_second_opinion')))
  with check ((select public.has_permission('ai_second_opinion')));
create policy ai_reviews_delete on public.ai_reviews
  for delete to authenticated using ((select public.has_permission('ai_second_opinion')));

drop policy if exists ai_review_actions_insert on public.ai_review_actions;
drop policy if exists ai_review_actions_update on public.ai_review_actions;
drop policy if exists ai_review_actions_delete on public.ai_review_actions;
-- In the person's own name only, as before.
create policy ai_review_actions_insert on public.ai_review_actions
  for insert to authenticated
  with check ((select public.has_permission('ai_second_opinion')) and actor_id = (select auth.uid()));
create policy ai_review_actions_update on public.ai_review_actions
  for update to authenticated
  using ((select public.has_permission('ai_second_opinion')))
  with check ((select public.has_permission('ai_second_opinion')) and actor_id = (select auth.uid()));
create policy ai_review_actions_delete on public.ai_review_actions
  for delete to authenticated using ((select public.has_permission('ai_second_opinion')));

-- What Steri-AI costs is part of Steri-AI Settings.
drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage
  for select to authenticated using ((select public.has_permission('ai_settings')));

-- 5. Inspections: the role's actions --------------------------------------------

-- On top of public.inspections_guard (the status flow, who may write what):
-- a signed-in person, or the app acting for one (create_inspection and the
-- other functions make auth.uid() answer the actor), needs the role's switch.
-- The owner and the service role's own maintenance act for nobody and pass.
create function public.inspections_role_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.has_permission('create_inspections') then
      raise exception 'your role cannot create inspections' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not public.has_permission('delete_drafts') then
      raise exception 'your role cannot delete drafts' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.status = 'submitted' and new.status in ('approved', 'reopened')
    and not public.has_permission('approve_inspections') then
    raise exception 'your role cannot approve or reopen inspections' using errcode = '42501';
  end if;
  if new.module_overrides is distinct from old.module_overrides
    and not public.has_permission('switch_steps') then
    raise exception 'your role cannot switch inspection steps on or off' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger role_guard before insert or update or delete on public.inspections
  for each row execute function public.inspections_role_guard();

-- Privileges ---------------------------------------------------------------------

-- Supabase grants every API role everything on a new table: only what the policies need.
revoke all on table public.roles from anon, authenticated, service_role;
grant select, insert, update, delete on table public.roles to authenticated, service_role;

revoke all on function
  public.builtin_role_id(text),
  public.is_full_admin(),
  public.has_permission(text),
  public.my_role()
from public, anon;
grant execute on function
  public.builtin_role_id(text),
  public.is_full_admin(),
  public.has_permission(text),
  public.my_role()
to authenticated, service_role;

-- Trigger functions fire without EXECUTE; nobody calls them directly.
revoke all on function public.roles_guard(), public.inspections_role_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
