-- Enum types and the pure helper functions the tables use (BUILD_SPEC 5).
-- Everything here lives in public; Supabase owns the auth and storage schemas.

create type public.user_role as enum ('inspector', 'admin');
create type public.template_status as enum ('draft', 'active', 'retired');
create type public.product_type as enum ('examination', 'surgical');
create type public.standard_code as enum (
  'EN455', 'ASTM_D6319', 'ASTM_D3578', 'ASTM_D3577', 'custom'
);
create type public.inspection_status as enum ('draft', 'submitted', 'approved', 'reopened');
-- Suggested and final results, on inspections and on ai_reviews.
create type public.inspection_result as enum ('pass', 'fail', 'hold');
create type public.ai_review_status as enum ('pending', 'done', 'failed');
create type public.ai_review_action as enum ('agree', 'disagree', 'fixed');
create type public.inspection_file_kind as enum ('lab_report', 'certificate', 'other');

-- Shared by every table: created_at is fixed at insert, updated_at follows
-- every write. Callers cannot set either.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Locks the columns named in the trigger arguments for every role. Repairs
-- happen with the trigger disabled, never through the API.
create function public.forbid_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_row constant jsonb := to_jsonb(old);
  new_row constant jsonb := to_jsonb(new);
  col text;
begin
  foreach col in array tg_argv loop
    if not new_row ? col then
      raise exception 'forbid_changes: %.% does not exist', tg_table_name, col;
    end if;
    if new_row -> col is distinct from old_row -> col then
      raise exception '%.% cannot change', tg_table_name, col
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

-- The folder id of an object name that lives in a uuid folder: an inspection
-- in inspection-photos and inspection-files, a user in signatures. The parse
-- is strict on purpose. supabase-js puts a stored name into the request URL
-- unencoded, and URL parsing turns '..', '%2e%2e', '\' and dots split by a tab
-- or newline into a step up into another folder. So a name counts only as
-- '<lowercase uuid>/<segment>[/<segment>...]', each segment made of ASCII
-- letters, digits, '.', '_' and '-', and none made of dots alone. Anything
-- else yields null instead of a cast error, so a malformed name fails a
-- policy or a check without breaking the query around it.
create function public.storage_folder_uuid(object_name text)
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

-- Object names in the inspection buckets: '<inspection_id>/<file>', and
-- thumbnails '<inspection_id>/thumbs/<file>'.
create function public.storage_inspection_id(object_name text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select public.storage_folder_uuid(object_name);
$$;

-- 'INS-2026-0001': the creation year in Malaysia, where SteriCare works, then
-- the sequence number padded to four digits (it keeps growing past 9999).
create function public.inspection_ref(created timestamptz, seq bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select 'INS-'
    || to_char(created at time zone 'Asia/Kuala_Lumpur', 'YYYY')
    || '-'
    || lpad(seq::text, greatest(4, length(seq::text)), '0');
$$;
