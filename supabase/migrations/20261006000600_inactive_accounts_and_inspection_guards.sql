-- Fixes after review, in their own migration so `supabase db push` brings a
-- database that already ran 20261006000100-500 up to date. The definitions
-- below replace the earlier ones.
--
-- 1. New accounts start inactive. Whatever creates an auth user (an admin's
--    invite, the dashboard's Add user, or a public sign-up if it is ever
--    switched on) gets a profile that reads and writes nothing until it is
--    activated: by the invite action (secret key), by an admin, or, for the
--    first admin, by one line in the SQL editor.
-- 2. ref_no is drawn by the insert guard. The old check rebuilt the expected
--    value from currval(), which is per session, so a caller could resend the
--    number last drawn on its connection, for example one freed by a deletion.
-- 3. The id of a deleted inspection is never used again. The database deletes
--    rows, not Storage objects, and the storage policies trust the folder id,
--    so a new inspection with that id would inherit whatever was left behind.
-- 4. The service role may delete an approved inspection: deliberate cleanup by
--    server code, such as end-to-end test teardown. Signed-in users, admins
--    included, still cannot, and the audit trail records every deletion.

-- These fixes build on the final text of the earlier migrations. A database
-- that ran an earlier draft of them must be reset (supabase db reset) before
-- pushing again, or it would stay without strict storage paths.
do $$
begin
  if to_regprocedure('public.storage_folder_uuid(text)') is null then
    raise exception 'this database ran an earlier draft of migrations 20261006000100-500: reset it, then push again';
  end if;
end;
$$;

-- 1. New accounts start inactive ----------------------------------------------

alter table public.profiles alter column active set default false;

-- Every new auth user starts as an inactive inspector. The role never comes
-- from user metadata, which users can edit themselves.
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

-- 2 and 4. The inspection guard ----------------------------------------------

-- '' is a placeholder that lets callers leave ref_no out; the guard replaces
-- it and rejects any other value. The format check also catches an insert
-- made with the guard disabled.
alter table public.inspections alter column ref_no set default '';
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
    -- A final QC record: no signed-in user deletes it, admins included. Server
    -- code with the secret key and the database owner can, deliberately; the
    -- audit trail keeps the deletion either way.
    if old.status = 'approved' and api_user then
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
    -- Drawn after the checks above. A number lost to a rejected insert or a
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

-- 3. Ids of deleted inspections ----------------------------------------------

-- The 'deleted' audit row keeps the id (changes ->> 'inspection_id').
create index audit_log_deleted_inspection_idx
  on public.audit_log ((changes ->> 'inspection_id'))
  where action = 'deleted';

-- Security definer so the check sees deletion records, which RLS shows to
-- admins only. Applies to every role; a deliberate restore disables it.
create function public.inspections_id_guard()
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

create trigger id_guard before insert on public.inspections
  for each row execute function public.inspections_id_guard();

-- Trigger functions fire without EXECUTE; nobody calls them directly.
revoke all on function public.inspections_id_guard() from public, anon, authenticated;
