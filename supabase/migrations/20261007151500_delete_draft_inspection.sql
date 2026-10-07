-- Deleting a draft from the inspections list (Kenneth, 7 October 2026: "build
-- an action button at end of each row, to delete or to continue").
--
-- The rule: an active user deletes a draft that was never submitted, their
-- own or, as an admin, anyone's. Submitted, reopened and approved
-- inspections stay. The rule is enforced here, where every request meets
-- it; canDeleteInspection() in lib/inspections/delete.ts states the same
-- rule for the list, which only offers Delete where it holds. Change both
-- together.
--
-- Why a function: RLS lets only admins delete inspections (the policy
-- inspections_delete), and an inspector must not get a general delete. This
-- function runs as the owner (security definer), so neither RLS nor the
-- guard's checks on API callers apply inside it: it checks the caller
-- itself, locks the row so a submit cannot slip in between the check and
-- the delete, and deletes in one statement. The inspection's photos, files,
-- AI reviews (with their decisions) and its own audit rows go with it
-- through their foreign keys (on delete cascade); nothing else points at an
-- inspection.
--
-- The record of the deletion: audit_log.inspection_id cascades too, so a
-- row naming the inspection would go with it. The audit trigger already
-- writes the record of every deletion with inspection_id null (the only
-- action allowed without one), the id, ref and status in its changes, and
-- the caller as actor; admins read it. This function adds who owned the
-- draft and what went with it (inspector, template, client, manufacturer,
-- PO, inspection date, number of photos and files), through a setting for
-- this transaction that audit_inspection() merges into that row when it
-- names the inspection being deleted. Deletions made any other way record
-- what they always did.
--
-- Storage: the database deletes rows, not Storage objects (Supabase refuses
-- a direct delete from storage.objects). The function returns the object
-- names of the photo and file rows it deleted; the server action removes
-- them through the Storage API once the row is gone, so no row ever points
-- at a removed file. Anything left behind is out of everyone's reach: the
-- storage policies follow the inspection, and its id is never used again.
--
-- Answers: the deleted draft as { inspection_id, ref_no, photo_paths,
-- file_paths }; null when the inspection does not exist or is not the
-- caller's to see (another inspector's draft reads as missing, as it does
-- through RLS). Raises 42501 for a caller who is not signed in or not active
-- and 23514 for anything but a draft that was never submitted.
--
-- Idempotent: running it again changes nothing.

-- The audit trail, as in 20261006000300, with the deletion record taking the
-- context delete_draft_inspection() leaves for it.
create or replace function public.audit_inspection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  context jsonb;
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
    -- What public.delete_draft_inspection() knows about the draft, for this
    -- inspection only. The id, ref and status always come from the row.
    context := nullif(current_setting('stericare.deleted_inspection', true), '')::jsonb;
    if context is null or context ->> 'inspection_id' is distinct from old.id::text then
      context := '{}';
    end if;
    -- The inspection's own audit rows go with it; this one keeps the record.
    insert into public.audit_log (inspection_id, actor_id, action, changes)
    values (null, auth.uid(), 'deleted', context || jsonb_build_object(
      'inspection_id', old.id,
      'ref_no', old.ref_no,
      'status', old.status
    ));
  end if;
  return null;
end;
$$;

create or replace function public.delete_draft_inspection(inspection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller constant uuid := auth.uid();
  target public.inspections%rowtype;
  photo_paths text[];
  file_paths text[];
  photo_count integer;
  file_count integer;
begin
  if caller is null then
    raise exception 'sign in to delete an inspection' using errcode = '42501';
  end if;
  if not public.is_active() then
    raise exception 'the account is not active' using errcode = '42501';
  end if;

  -- Locked until the end of the transaction: a submit waits, or went first
  -- and is seen here.
  select i.* into target
    from public.inspections i
   where i.id = delete_draft_inspection.inspection_id
     for update;
  if not found
    or (target.inspector_id is distinct from caller and not public.is_admin()) then
    return null;
  end if;

  -- A draft never goes back from submitted (inspections_guard), but a repair
  -- with the guard switched off could put it back: the record decides.
  if target.status <> 'draft'
    or target.submitted_at is not null
    or exists (
      select 1 from public.audit_log a
       where a.inspection_id = target.id
         and a.action = 'status_changed'
         and a.changes ->> 'to' = 'submitted'
    ) then
    raise exception 'only a draft that was never submitted can be deleted: % is %',
      target.ref_no, target.status
      using errcode = '23514';
  end if;

  select coalesce(array_agg(o.name order by o.name), '{}'), count(distinct o.photo_id)::integer
    into photo_paths, photo_count
    from (
      select p.id as photo_id, p.storage_path as name
        from public.inspection_photos p where p.inspection_id = target.id
      union all
      select p.id, p.thumb_path
        from public.inspection_photos p where p.inspection_id = target.id and p.thumb_path is not null
    ) o;
  select coalesce(array_agg(f.storage_path order by f.storage_path), '{}'), count(*)::integer
    into file_paths, file_count
    from public.inspection_files f where f.inspection_id = target.id;

  perform set_config('stericare.deleted_inspection', jsonb_build_object(
    'inspection_id', target.id,
    'inspector_id', target.inspector_id,
    'template_id', target.template_id,
    'client_id', target.client_id,
    'manufacturer_id', target.manufacturer_id,
    'po_no', target.po_no,
    'inspection_date', target.inspection_date,
    'photos', photo_count,
    'files', file_count,
    'via', 'delete_draft_inspection'
  )::text, true);
  delete from public.inspections i where i.id = target.id;
  perform set_config('stericare.deleted_inspection', '', true);

  return jsonb_build_object(
    'inspection_id', target.id,
    'ref_no', target.ref_no,
    'photo_paths', to_jsonb(photo_paths),
    'file_paths', to_jsonb(file_paths)
  );
end;
$$;

-- Signed-in users only: the service role has no user to check, and anon none.
revoke all on function public.delete_draft_inspection(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_draft_inspection(uuid) to authenticated;
