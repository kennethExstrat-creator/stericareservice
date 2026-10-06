-- Caller helpers for the policies, the auth.users -> profiles sync, guard
-- triggers for what RLS cannot express (columns, status transitions) and the
-- automatic audit trail. 20261006000600 replaces handle_new_auth_user() and
-- inspections_guard().
--
-- Trust model of the guards: end users reach the database as the API roles
-- `authenticated` and `anon` and are checked against their profile. Every
-- other role (service_role, the owner running migrations and the SQL editor,
-- code inside security definer functions) acts with admin rights, still bound
-- by the status transitions, the locked columns and the rule that an approved
-- inspection is read-only, its photos and files included. Like an admin, the
-- service role cannot delete an approved inspection; only the owner can.

-- Caller helpers -------------------------------------------------------------

-- True when the signed-in user has an active profile.
create function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.active from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

-- True for an active admin. A deactivated admin is not an admin.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'admin'
  );
$$;

-- The caller's own active flag and role, readable even when deactivated, so
-- the app can tell a blocked user why. No row when the user has no profile.
create function public.my_profile_status()
returns table (active boolean, role public.user_role)
language sql
stable
security definer
set search_path = ''
as $$
  select p.active, p.role from public.profiles p where p.id = (select auth.uid());
$$;

-- Admins read every inspection; an active inspector reads their own.
create function public.can_read_inspection(inspection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.inspections i
    where i.id = can_read_inspection.inspection_id
      and (
        (i.inspector_id = (select auth.uid()) and (select public.is_active()))
        or (select public.is_admin())
      )
  );
$$;

-- Who may add, change or remove an inspection's photos and files: nobody once
-- it is approved (approved is read-only); until then admins, and the owner
-- while it is a draft or reopened.
create function public.can_edit_inspection(inspection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.inspections i
    where i.id = can_edit_inspection.inspection_id
      and i.status <> 'approved'
      and (
        (
          i.inspector_id = (select auth.uid())
          and i.status in ('draft', 'reopened')
          and (select public.is_active())
        )
        or (select public.is_admin())
      )
  );
$$;

-- Profiles -------------------------------------------------------------------

-- Every new auth user starts as an inspector. The role never comes from user
-- metadata, which users can edit themselves; an admin promotes them later.
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name', 'inspector');
  return new;
end;
$$;

create function public.handle_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create function public.profiles_guard()
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
    if (new.role, new.active) is distinct from (old.role, old.active)
      and not public.is_admin() then
      raise exception 'only an admin can change role or active' using errcode = '42501';
    end if;
    if new.signature_path is distinct from old.signature_path
      and old.id is distinct from (select auth.uid()) then
      raise exception 'only the user can change their signature' using errcode = '42501';
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

create trigger guard before insert or update or delete on public.profiles
  for each row execute function public.profiles_guard();

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_auth_email_change();

-- Users created before this migration (for example in the dashboard) get a
-- profile too, inactive like every new account (20261006000600).
insert into public.profiles (id, email, full_name, role, active)
select u.id, u.email, u.raw_user_meta_data ->> 'full_name', 'inspector', false
from auth.users u
on conflict (id) do nothing;

-- Templates ------------------------------------------------------------------

-- Once an inspection uses a template version, its content is frozen: an edit
-- is a new version (BUILD_SPEC 4.2 rule 8). Status can still move on, for
-- example to retired. Security definer so the check sees every inspection.
create function public.templates_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
      (new.code, new.version, new.extends_code, new.product_type, new.standard,
       new.client_id, new.manufacturer_id, new.definition, new.resolved)
      is distinct from
      (old.code, old.version, old.extends_code, old.product_type, old.standard,
       old.client_id, old.manufacturer_id, old.definition, old.resolved)
      or (new.status = 'draft' and old.status <> 'draft')
    )
    and exists (select 1 from public.inspections i where i.template_id = old.id) then
    raise exception 'template % version % is in use: create a new version instead',
      old.code, old.version
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard before update on public.templates
  for each row execute function public.templates_guard();

-- Inspections ----------------------------------------------------------------

-- Status flow: draft -> submitted -> approved, and submitted -> reopened ->
-- submitted. Owners submit; admins approve, reopen, switch modules off and set
-- report_url. Approved is read-only except report_url. The timestamps and the
-- approver are set here, never by callers.
create function public.inspections_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  api_user constant boolean := current_user in ('authenticated', 'anon');
  admin constant boolean := not api_user or public.is_admin();
  drawn text;
begin
  if tg_op = 'DELETE' then
    -- A final QC record: no API role deletes it, the service role included.
    -- Only the database owner can, deliberately, from the SQL editor.
    if old.status = 'approved' and (api_user or current_user = 'service_role') then
      raise exception 'an approved inspection cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- The ref_no default has just called nextval, so currval rebuilds its value;
    -- anything else was supplied by the caller.
    begin
      drawn := public.inspection_ref(now(), currval('public.inspection_ref_seq'));
    exception when object_not_in_prerequisite_state then
      drawn := null;
    end;
    if new.ref_no is distinct from drawn then
      raise exception 'ref_no is assigned by the database' using errcode = '42501';
    end if;
    if new.status <> 'draft' then
      raise exception 'a new inspection starts as a draft' using errcode = '23514';
    end if;
    if new.submitted_at is not null or new.approved_by is not null or new.approved_at is not null then
      raise exception 'submitted_at, approved_by and approved_at are set by the database'
        using errcode = '42501';
    end if;
    if not admin then
      -- RLS rejects this too, but only after this trigger, with a vaguer error.
      if not public.is_active() then
        raise exception 'the account is not active' using errcode = '42501';
      end if;
      if new.report_url is not null then
        raise exception 'only an admin can set report_url' using errcode = '42501';
      end if;
      if new.module_overrides <> '{}' then
        raise exception 'only an admin can switch modules off' using errcode = '42501';
      end if;
      -- A draft template is still being edited; using it would freeze it.
      if not exists (
        select 1 from public.templates t where t.id = new.template_id and t.status = 'active'
      ) then
        raise exception 'inspections start from an active template' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if (new.submitted_at, new.approved_by, new.approved_at)
    is distinct from (old.submitted_at, old.approved_by, old.approved_at) then
    raise exception 'submitted_at, approved_by and approved_at are set by the database'
      using errcode = '42501';
  end if;
  if new.report_url is distinct from old.report_url and not admin then
    raise exception 'only an admin can set report_url' using errcode = '42501';
  end if;
  -- BUILD_SPEC 4.4: switching a module off for one inspection is an admin decision.
  if new.module_overrides is distinct from old.module_overrides and not admin then
    raise exception 'only an admin can switch modules off' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'submitted' and old.status in ('draft', 'reopened') then
      if not admin and old.inspector_id is distinct from uid then
        raise exception 'only the inspector or an admin can submit' using errcode = '42501';
      end if;
      new.submitted_at := now();
    elsif old.status = 'submitted' and new.status in ('approved', 'reopened') then
      if not admin then
        raise exception 'only an admin can % an inspection',
          case new.status when 'approved' then 'approve' else 'reopen' end
          using errcode = '42501';
      end if;
      if new.status = 'approved' then
        new.approved_by := uid;
        new.approved_at := now();
      end if;
    else
      raise exception 'status cannot change from % to %', old.status, new.status
        using errcode = '23514';
    end if;
  elsif old.status = 'approved'
    and to_jsonb(new) - 'report_url' - 'updated_at'
      is distinct from to_jsonb(old) - 'report_url' - 'updated_at' then
    raise exception 'an approved inspection is read-only' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard before insert or update or delete on public.inspections
  for each row execute function public.inspections_guard();

-- Photos and files of an approved inspection are read-only for every role,
-- except which photos go into the report (BUILD_SPEC 5, 8.1 and 9.1). For
-- signed-in users, created_by is always the uploader and only admins choose
-- report photos.
create function public.inspection_media_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent uuid;
begin
  if tg_op = 'INSERT' then
    parent := new.inspection_id;
  else
    parent := old.inspection_id;
  end if;
  -- Read as the caller: admins, the service role and the owner see every
  -- inspection, and RLS keeps inspectors to the ones they may edit anyway.
  -- When the parent itself is being deleted, it is already gone here, so its
  -- evidence goes with it.
  if exists (select 1 from public.inspections i where i.id = parent and i.status = 'approved') then
    if tg_op <> 'UPDATE'
      or to_jsonb(new) - 'include_in_report' - 'updated_at'
        is distinct from to_jsonb(old) - 'include_in_report' - 'updated_at' then
      raise exception 'the photos and files of an approved inspection are read-only'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' and new.created_by is distinct from auth.uid() then
    raise exception '%.created_by must be the signed-in user', tg_table_name
      using errcode = '42501';
  end if;
  -- Nested: PL/pgSQL resolves new.include_in_report when it prepares the
  -- condition, and inspection_files has no such column.
  if tg_table_name = 'inspection_photos' then
    if (case tg_op
          when 'INSERT' then new.include_in_report
          else new.include_in_report is distinct from old.include_in_report
        end)
      and not public.is_admin() then
      raise exception 'only an admin can choose report photos' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard before insert or update or delete on public.inspection_photos
  for each row execute function public.inspection_media_guard();
create trigger guard before insert or update or delete on public.inspection_files
  for each row execute function public.inspection_media_guard();

-- Audit ----------------------------------------------------------------------

-- Every inspection's creation, status change and deletion. The actor is the
-- signed-in user, or null for the service role and the database owner.
create function public.audit_inspection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (inspection_id, actor_id, action, changes)
    values (new.id, auth.uid(), 'created', jsonb_build_object(
      'ref_no', new.ref_no,
      'status', new.status,
      'template_id', new.template_id,
      'inspector_id', new.inspector_id
    ));
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.audit_log (inspection_id, actor_id, action, changes)
      values (new.id, auth.uid(), 'status_changed',
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  else
    -- The inspection's own audit rows go with it; this one keeps the record.
    insert into public.audit_log (inspection_id, actor_id, action, changes)
    values (null, auth.uid(), 'deleted', jsonb_build_object(
      'inspection_id', old.id,
      'ref_no', old.ref_no,
      'status', old.status
    ));
  end if;
  return null;
end;
$$;

create trigger audit after insert or update of status or delete on public.inspections
  for each row execute function public.audit_inspection();

-- For server actions: records an event on an inspection the caller can read
-- (any inspection for the service role) and returns the audit row id. Every
-- event names its inspection.
create function public.log_inspection_event(
  inspection_id uuid,
  action text,
  changes jsonb default '{}'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id bigint;
begin
  if log_inspection_event.inspection_id is null then
    raise exception 'inspection_id is required' using errcode = '22004';
  end if;
  if log_inspection_event.action in ('created', 'status_changed', 'deleted') then
    raise exception 'action % is recorded automatically', log_inspection_event.action
      using errcode = '42501';
  end if;
  if auth.role() is distinct from 'service_role'
    and not public.can_read_inspection(log_inspection_event.inspection_id) then
    raise exception 'inspection % not found', log_inspection_event.inspection_id
      using errcode = '42501';
  end if;
  insert into public.audit_log (inspection_id, actor_id, action, changes)
  values (
    log_inspection_event.inspection_id,
    auth.uid(),
    log_inspection_event.action,
    coalesce(log_inspection_event.changes, '{}')
  )
  returning id into event_id;
  return event_id;
end;
$$;
