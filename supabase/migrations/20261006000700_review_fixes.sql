-- Fixes from the review of migrations 100 to 600, which are applied and stay
-- as they are. Every statement here is idempotent, and the file brings a
-- project to the same end state whichever text of 100 to 500 it ran: the
-- first push may have predated the review fixes that were later folded into
-- those files (strict storage paths, read-only evidence of approved
-- inspections, the service role's limits). So those rules are stated again
-- here in full, next to what is new:
--
-- 1. Storage object names are parsed strictly (restated).
-- 2. An approved inspection is final, its photos and files included; the
--    service role cannot delete it (restated).
-- 3. ref_no is drawn by the insert guard, not rebuilt from currval() (new).
-- 4. An inspection's id never changes, and the id of a deleted inspection is
--    never used again (new).
-- 5. The audit trail is append-only for server code too (restated).
-- 6. End-to-end tests delete the inspections of test accounts through
--    public.delete_test_inspection() (new).

-- 1. Strict storage object names ---------------------------------------------

-- The folder id of an object name that lives in a uuid folder: an inspection
-- in inspection-photos and inspection-files, a user in signatures. The parse
-- is strict on purpose. supabase-js puts a stored name into the request URL
-- unencoded, and URL parsing turns '..', '%2e%2e', '\' and dots split by a tab
-- or newline into a step up into another folder. So a name counts only as
-- '<lowercase uuid>/<segment>[/<segment>...]', each segment made of ASCII
-- letters, digits, '.', '_' and '-', and none made of dots alone. Anything
-- else yields null instead of a cast error, so a malformed name fails a
-- policy or a check without breaking the query around it.
create or replace function public.storage_folder_uuid(object_name text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[A-Za-z0-9_.-]+)+$'
      and object_name !~ '/\.+(/|$)'
      then split_part(object_name, '/', 1)::uuid
  end;
$$;

revoke all on function public.storage_folder_uuid(text) from public, anon;
grant execute on function public.storage_folder_uuid(text) to authenticated, service_role;

-- Object names in the inspection buckets: '<inspection_id>/<file>', and
-- thumbnails '<inspection_id>/thumbs/<file>'. The storage policies and the
-- path checks on inspection_photos and inspection_files call this one.
create or replace function public.storage_inspection_id(object_name text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select public.storage_folder_uuid(object_name);
$$;

-- "is not distinct from": a malformed path parses to null, which must fail.
alter table public.profiles drop constraint if exists profiles_signature_in_own_folder;
alter table public.profiles add constraint profiles_signature_in_own_folder
  check (
    signature_path is null
    or public.storage_folder_uuid(signature_path) is not distinct from id
  );

-- Signatures: the owner's folder; admins can read every signature.
drop policy if exists signatures_select on storage.objects;
create policy signatures_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'signatures'
    and (
      (
        public.storage_folder_uuid(name) = (select auth.uid())
        and (select public.is_active())
      )
      or (select public.is_admin())
    )
  );

drop policy if exists signatures_insert on storage.objects;
create policy signatures_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'signatures'
    and public.storage_folder_uuid(name) = (select auth.uid())
    and (select public.is_active())
  );

drop policy if exists signatures_update on storage.objects;
create policy signatures_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'signatures'
    and public.storage_folder_uuid(name) = (select auth.uid())
    and (select public.is_active())
  )
  with check (
    bucket_id = 'signatures'
    and public.storage_folder_uuid(name) = (select auth.uid())
    and (select public.is_active())
  );

drop policy if exists signatures_delete on storage.objects;
create policy signatures_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'signatures'
    and public.storage_folder_uuid(name) = (select auth.uid())
    and (select public.is_active())
  );

-- 2 and 3. Approved inspections are final; the guard draws ref_no ------------

-- Who may add, change or remove an inspection's photos and files: nobody once
-- it is approved (approved is read-only); until then admins, and the owner
-- while it is a draft or reopened.
create or replace function public.can_edit_inspection(inspection_id uuid)
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

-- Photos and files of an approved inspection are read-only for every role,
-- except which photos go into the report (BUILD_SPEC 5, 8.1 and 9.1). For
-- signed-in users, created_by is always the uploader and only admins choose
-- report photos.
create or replace function public.inspection_media_guard()
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

create or replace trigger guard before insert or update or delete on public.inspection_photos
  for each row execute function public.inspection_media_guard();
create or replace trigger guard before insert or update or delete on public.inspection_files
  for each row execute function public.inspection_media_guard();

-- Admins also reach the photos of an approved inspection, where
-- public.inspection_media_guard() lets only include_in_report change.
drop policy if exists inspection_photos_update on public.inspection_photos;
create policy inspection_photos_update on public.inspection_photos
  for update to authenticated
  using ((select public.is_admin()) or public.can_edit_inspection(inspection_id))
  with check ((select public.is_admin()) or public.can_edit_inspection(inspection_id));

-- ref_no: '' is a placeholder that lets callers leave the column out; the
-- insert guard below replaces it and rejects any other value. The old guard
-- rebuilt the expected value from currval(), which is per session, so a
-- caller could resend the number last drawn on its connection, for example
-- one freed by a deletion. The format check also holds when a repair inserts
-- with the guard disabled.
alter table public.inspections alter column ref_no set default '';
alter table public.inspections drop constraint if exists inspections_ref_no_format;
alter table public.inspections add constraint inspections_ref_no_format
  check (ref_no ~ '^INS-[0-9]{4}-[0-9]{4,}$');

-- Status flow: draft -> submitted -> approved, and submitted -> reopened ->
-- submitted. Owners submit; admins approve, reopen, switch modules off and set
-- report_url. Approved is read-only except report_url. The reference number,
-- the timestamps and the approver are set here, never by callers.
create or replace function public.inspections_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid constant uuid := auth.uid();
  api_user constant boolean := current_user in ('authenticated', 'anon');
  admin constant boolean := not api_user or public.is_admin();
begin
  if tg_op = 'DELETE' then
    -- A final QC record: no API role deletes it, the service role included,
    -- and with it goes its audit history. Only the database owner can,
    -- deliberately: from the SQL editor, or for test accounts through
    -- public.delete_test_inspection().
    if old.status = 'approved' and (api_user or current_user = 'service_role') then
      raise exception 'an approved inspection cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.ref_no is distinct from '' then
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
    -- Drawn after the checks above. A number lost to a later failure or a
    -- rollback leaves a gap; it is never handed out again.
    new.ref_no := public.inspection_ref(now(), nextval('public.inspection_ref_seq'));
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

-- 4. Inspection ids ----------------------------------------------------------

-- The storage policies trust the folder id, and the database deletes rows,
-- not Storage objects. So an id is fixed for life (a new id would orphan the
-- files and could take over another folder), and the id of a deleted
-- inspection is never used again: a new inspection with that id would
-- inherit whatever was left in the old folders.
create or replace trigger lock_columns before update on public.inspections
  for each row execute function public.forbid_changes('id', 'ref_no', 'inspector_id', 'template_id');

-- The 'deleted' audit row keeps the id (changes ->> 'inspection_id').
create index if not exists audit_log_deleted_inspection_idx
  on public.audit_log ((changes ->> 'inspection_id'))
  where action = 'deleted';

-- Security definer so the check sees deletion records, which RLS shows to
-- admins only. Applies to every role; a deliberate restore disables it.
create or replace function public.inspections_deleted_id_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.audit_log a
    where a.action = 'deleted' and a.changes ->> 'inspection_id' = new.id::text
  ) then
    raise exception 'inspection id % belonged to a deleted inspection', new.id
      using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function public.inspections_deleted_id_guard() from public, anon, authenticated;

-- Triggers fire in name order: this one before guard, so a refused id draws
-- no reference number.
create or replace trigger deleted_id_guard before insert on public.inspections
  for each row execute function public.inspections_deleted_id_guard();

-- 5. The audit trail is append-only ------------------------------------------

-- Server code reads it and adds to it (preferably through
-- log_inspection_event()), but never changes or deletes rows. Cascades from a
-- deleted inspection run as the owner.
revoke all on table public.audit_log from service_role;
grant select, insert on table public.audit_log to service_role;

-- Null only on the record of a deletion, which outlives its inspection.
alter table public.audit_log drop constraint if exists audit_log_names_inspection;
alter table public.audit_log add constraint audit_log_names_inspection
  check (inspection_id is not null or action = 'deleted');

-- For server actions: records an event on an inspection the caller can read
-- (any inspection for the service role) and returns the audit row id. Every
-- event names its inspection.
create or replace function public.log_inspection_event(
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

-- 6. Cleanup for end-to-end tests --------------------------------------------

-- End-to-end tests run against a shared project and must remove what they
-- create, approved inspections included, which the service role cannot
-- delete. This is their way out, and it works only for the inspections of
-- test accounts: an inspector whose email ends in '@test.local' (the test
-- users of BUILD_SPEC 11 and the e2e throwaway accounts). '.local' is reserved
-- for local networks and is never a real mail domain, so no real record
-- qualifies. Only the service role may call it. It runs as the owner, so the
-- guard lets the delete through; photos, files, AI reviews and audit rows go
-- with the inspection, and a 'deleted' audit row with no actor records it.
-- Storage files are not touched: remove them through the Storage API first.
-- Returns false when the inspection does not exist.
create or replace function public.delete_test_inspection(inspection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  test_account boolean;
begin
  select coalesce(lower(p.email) like '%@test.local', false)
    into test_account
    from public.inspections i
    join public.profiles p on p.id = i.inspector_id
    where i.id = delete_test_inspection.inspection_id;
  if not found then
    return false;
  end if;
  if not test_account then
    raise exception 'inspection % does not belong to a test account',
      delete_test_inspection.inspection_id
      using errcode = '42501';
  end if;
  delete from public.inspections i where i.id = delete_test_inspection.inspection_id;
  return true;
end;
$$;

revoke all on function public.delete_test_inspection(uuid) from public, anon, authenticated;
grant execute on function public.delete_test_inspection(uuid) to service_role;
