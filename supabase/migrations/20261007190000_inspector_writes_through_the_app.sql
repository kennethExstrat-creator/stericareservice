-- An inspector's inspection changes only through the app, and an inspector
-- records only the app's own events (final audit, 7 October 2026: security
-- SEC-02 and SEC-03, data M3).
--
-- Before: row level security let an inspector insert their own draft from
-- any active template and update every column of it while it was a draft or
-- reopened, and the guard let them submit it. The app's own checks (the zod
-- schemas, each module's validation, BUILD_SPEC 6.2 "errors block submit",
-- the columns computed from the data, the template the app chooses) run in
-- its Server Actions only. So an inspector's session token, which the
-- browser holds, and the publishable key were enough to skip all of them
-- through the Data API: save data no module accepts, write their own
-- suggested and final result, PO and lots, move the inspection to another
-- client or manufacturer, and submit with errors. And log_inspection_event()
-- took any event from the owner, on approved inspections too, of any size.
--
-- Now:
--
-- 1. Only admins insert and update inspections through the Data API. The
--    guard refuses everyone else with 42501, after the rules that say more
--    (a draft that skips to approved is still 23514, report_url still
--    "only an admin can set report_url"), and row level security refuses
--    them too. Admins keep every direct write they had: approve, reopen,
--    module overrides, report_url, the defect label mapping.
--
-- 2. The app creates, saves and submits an inspector's inspection with the
--    secret key, through three functions only the service role may call:
--
--      create_inspection(actor_id, template_id, manufacturer_id, client_id, data, mirrored_columns)
--      save_inspection(inspection_id, actor_id, base_updated_at, data, mirrored_columns)
--      submit_inspection(inspection_id, actor_id, base_updated_at, mirrored_columns)
--
--    The Server Actions createInspection, saveCaptureData and
--    submitInspection call them once they have checked the session,
--    validated the input with zod and applied the capture rules; the
--    functions trust them for that, and check again what the database knows
--    (section 2 below).
--
-- 3. log_inspection_event(): an inspector, a lead inspector included,
--    records only the events the app records for them (photo.deleted,
--    file.deleted, started_from_previous), on an inspection they may still
--    change, with at most 8 kB of changes. Admins and the service role
--    record as before.
--
-- Apply it once the app calls these functions: from then on, an app that
-- still writes an inspector's inspection with the inspector's own session is
-- refused.
--
-- Idempotent: running it again changes nothing.

-- 1. Who writes inspections directly -----------------------------------------

-- The status flow and column rules of 20261006000700, unchanged, with one
-- rule added at the end of the insert and the update branch: a signed-in user
-- who is not an admin never writes an inspection directly. Admins, the
-- service role and the database owner are not affected.
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
      -- The reasons a request would be wrong anyway come first, so a refusal
      -- says what was wrong with it.
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
      -- The app chooses the template and fills in the data
      -- (public.create_inspection()). Refused before a reference number is
      -- drawn.
      raise exception 'inspectors create inspections through the app' using errcode = '42501';
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

  -- The data, the columns computed from it and the submit go through the
  -- app's checks (public.save_inspection(), public.submit_inspection()).
  if not admin then
    raise exception 'inspectors save and submit inspections through the app' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Only admins insert. The app creates an inspector's draft as the service
-- role (public.create_inspection()), which row level security does not apply to.
drop policy if exists inspections_insert on public.inspections;
create policy inspections_insert on public.inspections
  for insert to authenticated
  with check ((select public.is_admin()));

-- Only admins update. The owner still reaches their own draft or reopened
-- inspection, so that the guard, which runs before this check, refuses them
-- with its reason (42501) rather than an update that silently matches
-- nothing; the check refuses them as well, whatever the guard says.
drop policy if exists inspections_update on public.inspections;
create policy inspections_update on public.inspections
  for update to authenticated
  using (
    (select public.is_admin())
    or (
      inspector_id = (select auth.uid())
      and status in ('draft', 'reopened')
      and (select public.is_active())
    )
  )
  with check ((select public.is_admin()));

-- 2. The app's writes for an inspector ---------------------------------------
--
-- What the functions check, whoever the app acts for:
--
-- - The caller is the service role (or the owner); the API roles are refused
--   even if they were ever granted EXECUTE, because a function that makes
--   auth.uid() answer someone else must not be theirs to call.
-- - actor_id, the signed-in user the app acts for, has an active profile
--   (42501 "the account is not active").
-- - Saving and submitting: the actor is the inspection's inspector or an
--   admin, and the inspection is a draft or reopened. Creating: the draft is
--   the actor's own, and an inspector starts from an active template (23514
--   "inspections start from an active template"), an admin from any.
-- - mirrored_columns holds only the columns that repeat the data for lists
--   and search, as lib/inspections/capture/mirror.ts computes them: po_no,
--   product_name, lot_numbers, inspection_date, remarks, result and
--   suggested_result (22023 for any other key). A key left out keeps its
--   value (on create: the column default). The client, manufacturer,
--   template, status, module overrides and report_url are never among them.
-- - Saving and submitting are a compare-and-set on updated_at, the autosave's
--   version (docs/OFFLINE.md): they write only while the row is still at
--   base_updated_at, under a row lock.
--
-- The write is made as the actor: while it runs, auth.uid() answers actor_id
-- (request.jwt.claims gets their id as "sub"; the role stays the service
-- role), so the audit trail names them, "created" and "status_changed" by
-- the inspector exactly as when they wrote the row themselves. The claims
-- are put back before the function returns.
--
-- Security invoker: they run as the service role, which row level security
-- does not apply to and the guard treats like an admin. That is why they
-- check the actor themselves.

-- A draft for the actor, as the app's createInspection starts it. Answers its id.
create or replace function public.create_inspection(
  actor_id uuid,
  template_id uuid,
  manufacturer_id uuid,
  client_id uuid default null,
  data jsonb default '{"modules": {}, "custom": {}}',
  mirrored_columns jsonb default '{}'
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  claims constant text := current_setting('request.jwt.claims', true);
  claim_sub constant text := current_setting('request.jwt.claim.sub', true);
  actor_active boolean;
  actor_role public.user_role;
  next public.inspections;
  created uuid;
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'only the app creates inspections for inspectors' using errcode = '42501';
  end if;
  if coalesce(create_inspection.mirrored_columns, '{}')
    - array['po_no', 'product_name', 'lot_numbers', 'inspection_date', 'remarks', 'result', 'suggested_result']
    <> '{}' then
    raise exception 'mirrored_columns holds only po_no, product_name, lot_numbers, inspection_date, remarks, result and suggested_result'
      using errcode = '22023';
  end if;

  select p.active, p.role into actor_active, actor_role
    from public.profiles p
   where p.id = create_inspection.actor_id;
  if not coalesce(actor_active, false) then
    raise exception 'the account is not active' using errcode = '42501';
  end if;
  -- A draft template is still being edited; using it would freeze it.
  if actor_role <> 'admin' and not exists (
    select 1 from public.templates t
     where t.id = create_inspection.template_id and t.status = 'active'
  ) then
    raise exception 'inspections start from an active template' using errcode = '23514';
  end if;

  next := jsonb_populate_record(null::public.inspections, coalesce(create_inspection.mirrored_columns, '{}'));
  perform set_config('request.jwt.claims',
    (coalesce(nullif(claims, '')::jsonb, '{}') || jsonb_build_object('sub', create_inspection.actor_id))::text, true);
  perform set_config('request.jwt.claim.sub', create_inspection.actor_id::text, true);
  insert into public.inspections as i (
    template_id, client_id, manufacturer_id, inspector_id, data,
    po_no, product_name, lot_numbers, inspection_date, remarks, result, suggested_result
  ) values (
    create_inspection.template_id,
    create_inspection.client_id,
    create_inspection.manufacturer_id,
    create_inspection.actor_id,
    coalesce(create_inspection.data, '{"modules": {}, "custom": {}}'),
    next.po_no,
    next.product_name,
    -- The column defaults, for the keys left out.
    coalesce(next.lot_numbers, '{}'),
    coalesce(next.inspection_date, (now() at time zone 'Asia/Kuala_Lumpur')::date),
    next.remarks,
    next.result,
    next.suggested_result
  )
  returning i.id into created;
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(claim_sub, ''), true);
  return created;
end;
$$;

-- The capture screen's autosave (saveCaptureData): the data and its mirrored
-- columns, at the version the device edited. Answers the new updated_at, or
-- null when nothing was written: the inspection is gone, not the actor's,
-- no longer a draft or reopened, or no longer at base_updated_at. The app
-- then reads the row with the user's own session to tell which.
create or replace function public.save_inspection(
  inspection_id uuid,
  actor_id uuid,
  base_updated_at timestamptz,
  data jsonb,
  mirrored_columns jsonb default '{}'
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  claims constant text := current_setting('request.jwt.claims', true);
  claim_sub constant text := current_setting('request.jwt.claim.sub', true);
  actor_active boolean;
  actor_role public.user_role;
  target public.inspections;
  next public.inspections;
  saved timestamptz;
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'only the app saves inspections for inspectors' using errcode = '42501';
  end if;
  if coalesce(save_inspection.mirrored_columns, '{}')
    - array['po_no', 'product_name', 'lot_numbers', 'inspection_date', 'remarks', 'result', 'suggested_result']
    <> '{}' then
    raise exception 'mirrored_columns holds only po_no, product_name, lot_numbers, inspection_date, remarks, result and suggested_result'
      using errcode = '22023';
  end if;

  select p.active, p.role into actor_active, actor_role
    from public.profiles p
   where p.id = save_inspection.actor_id;
  if not coalesce(actor_active, false) then
    raise exception 'the account is not active' using errcode = '42501';
  end if;

  -- Locked until the end of the transaction: a submit or another save waits.
  select i.* into target
    from public.inspections i
   where i.id = save_inspection.inspection_id
     for update;
  if not found
    or (target.inspector_id is distinct from save_inspection.actor_id and actor_role <> 'admin')
    or target.status not in ('draft', 'reopened')
    or target.updated_at is distinct from save_inspection.base_updated_at then
    return null;
  end if;

  next := jsonb_populate_record(target, coalesce(save_inspection.mirrored_columns, '{}'));
  perform set_config('request.jwt.claims',
    (coalesce(nullif(claims, '')::jsonb, '{}') || jsonb_build_object('sub', save_inspection.actor_id))::text, true);
  perform set_config('request.jwt.claim.sub', save_inspection.actor_id::text, true);
  update public.inspections i
     set data = save_inspection.data,
         po_no = next.po_no,
         product_name = next.product_name,
         lot_numbers = next.lot_numbers,
         inspection_date = next.inspection_date,
         remarks = next.remarks,
         result = next.result,
         suggested_result = next.suggested_result
   where i.id = target.id
  returning i.updated_at into saved;
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(claim_sub, ''), true);
  return saved;
end;
$$;

-- Submit (submitInspection), once the app has found no errors in the saved
-- data: the mirrored columns written again from that data, and the status
-- moved to submitted, at the version the app checked. The guard stamps
-- submitted_at and the audit trail names the actor. Answers the new
-- updated_at, or null when the inspection is gone or no longer at
-- base_updated_at (it changed while it was being submitted). Raises 42501
-- for someone who is neither its inspector nor an admin, and 23514 when it
-- is not a draft or reopened.
create or replace function public.submit_inspection(
  inspection_id uuid,
  actor_id uuid,
  base_updated_at timestamptz,
  mirrored_columns jsonb default '{}'
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  claims constant text := current_setting('request.jwt.claims', true);
  claim_sub constant text := current_setting('request.jwt.claim.sub', true);
  actor_active boolean;
  actor_role public.user_role;
  target public.inspections;
  next public.inspections;
  submitted timestamptz;
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'only the app submits inspections for inspectors' using errcode = '42501';
  end if;
  if coalesce(submit_inspection.mirrored_columns, '{}')
    - array['po_no', 'product_name', 'lot_numbers', 'inspection_date', 'remarks', 'result', 'suggested_result']
    <> '{}' then
    raise exception 'mirrored_columns holds only po_no, product_name, lot_numbers, inspection_date, remarks, result and suggested_result'
      using errcode = '22023';
  end if;

  select p.active, p.role into actor_active, actor_role
    from public.profiles p
   where p.id = submit_inspection.actor_id;
  if not coalesce(actor_active, false) then
    raise exception 'the account is not active' using errcode = '42501';
  end if;

  -- Locked until the end of the transaction: a save or another submit waits.
  select i.* into target
    from public.inspections i
   where i.id = submit_inspection.inspection_id
     for update;
  if not found then
    return null;
  end if;
  if target.inspector_id is distinct from submit_inspection.actor_id and actor_role <> 'admin' then
    raise exception 'only the inspector or an admin can submit' using errcode = '42501';
  end if;
  if target.status not in ('draft', 'reopened') then
    raise exception 'status cannot change from % to submitted', target.status using errcode = '23514';
  end if;
  if target.updated_at is distinct from submit_inspection.base_updated_at then
    return null;
  end if;

  next := jsonb_populate_record(target, coalesce(submit_inspection.mirrored_columns, '{}'));
  perform set_config('request.jwt.claims',
    (coalesce(nullif(claims, '')::jsonb, '{}') || jsonb_build_object('sub', submit_inspection.actor_id))::text, true);
  perform set_config('request.jwt.claim.sub', submit_inspection.actor_id::text, true);
  update public.inspections i
     set po_no = next.po_no,
         product_name = next.product_name,
         lot_numbers = next.lot_numbers,
         inspection_date = next.inspection_date,
         remarks = next.remarks,
         result = next.result,
         suggested_result = next.suggested_result,
         status = 'submitted'
   where i.id = target.id
  returning i.updated_at into submitted;
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(claim_sub, ''), true);
  return submitted;
end;
$$;

-- The secret key only: signed-in users and anon get nothing (Supabase grants
-- EXECUTE on new functions to both by default).
revoke all on function
  public.create_inspection(uuid, uuid, uuid, uuid, jsonb, jsonb),
  public.save_inspection(uuid, uuid, timestamptz, jsonb, jsonb),
  public.submit_inspection(uuid, uuid, timestamptz, jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.create_inspection(uuid, uuid, uuid, uuid, jsonb, jsonb),
  public.save_inspection(uuid, uuid, timestamptz, jsonb, jsonb),
  public.submit_inspection(uuid, uuid, timestamptz, jsonb)
to service_role;

-- 3. Events an inspector records ---------------------------------------------

-- For server actions: records an event on an inspection and returns the
-- audit row id. As in 20261006000700, every event names its inspection, the
-- actor is the caller (auth.uid()), and the three actions the audit trigger
-- owns are refused. Who may record what:
--
-- - The service role: any event on any inspection.
-- - An admin: any event on any inspection.
-- - Anyone else, a lead inspector included: what the app records as an
--   inspector, which is a photo or file they deleted and the inspection
--   they started from (lib/inspections/photos/actions.ts,
--   app/(app)/inspections/new/actions.ts), on their own inspection while
--   it is a draft or reopened, with at most 8 kB of changes. Reasons for
--   reopening, module overrides, AI events and the template an admin chose
--   are admins' and the service role's.
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
  if auth.role() is distinct from 'service_role' then
    if not public.can_read_inspection(log_inspection_event.inspection_id) then
      raise exception 'inspection % not found', log_inspection_event.inspection_id
        using errcode = '42501';
    end if;
    if not public.is_admin() then
      if log_inspection_event.action not in ('photo.deleted', 'file.deleted', 'started_from_previous') then
        raise exception 'an inspector cannot record %', log_inspection_event.action
          using errcode = '42501';
      end if;
      if not public.can_edit_inspection(log_inspection_event.inspection_id) then
        raise exception 'inspection % can no longer change', log_inspection_event.inspection_id
          using errcode = '42501';
      end if;
      if pg_column_size(coalesce(log_inspection_event.changes, '{}')) > 8192 then
        raise exception 'an event records at most 8 kB of changes' using errcode = '22023';
      end if;
    end if;
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

-- PostgREST reads the new functions at once.
notify pgrst, 'reload schema';
