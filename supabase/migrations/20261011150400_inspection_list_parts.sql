-- The inspections list across PO parts (docs/DATABASE.md, "PO parts";
-- Kenneth, 11 October 2026): one row per inspection, its first part (group_id
-- null), found when any of its parts matches the search, and filtered by the
-- inspection's status, which sums its parts.
--
-- Computed columns: PostgREST reads a function of an inspections row as a
-- column of that row, in a filter as anywhere else (`parts_po_nos.imatch.…`
-- is Postgres's attribute notation for parts_po_nos(inspections)). Each holds
-- the row's own value and those of the parts that name it in group_id: on a
-- first part, every part of the inspection; on any other part, its own.
-- listSearchFilter() and listInspections() in lib/inspections/query.ts filter
-- the first parts with them.
--
-- SECURITY INVOKER, like the list's own query: the parts are read under the
-- caller's Row Level Security, so a search never finds an inspection through
-- a part its reader may not see. (A part is made for the inspection's own
-- inspector and inspector_id never changes, so a reader sees all of an
-- inspection's parts or none.)
--
-- Until a project has this migration the list finds an inspection by its
-- first part only, and filters by the first part's status
-- (lib/inspections/query.ts).
--
-- Idempotent: running it again changes nothing.

-- One per line, the first part first: the list's search text never holds a
-- line break (normaliseSearchText), so a match never runs from one part into
-- the next.
create or replace function public.parts_ref_nos(inspection public.inspections)
returns text
language sql
stable
set search_path = ''
as $$
  select concat_ws(E'\n', inspection.ref_no, (
    select string_agg(part.ref_no, E'\n' order by part.created_at, part.id)
      from public.inspections as part
     where part.group_id = inspection.id
  ))
$$;

comment on function public.parts_ref_nos(public.inspections) is
  'The reference numbers of this inspection row and of the parts that name it in group_id, one per line, for the list''s search.';

create or replace function public.parts_po_nos(inspection public.inspections)
returns text
language sql
stable
set search_path = ''
as $$
  select concat_ws(E'\n', inspection.po_no, (
    select string_agg(part.po_no, E'\n' order by part.created_at, part.id)
      from public.inspections as part
     where part.group_id = inspection.id
  ))
$$;

comment on function public.parts_po_nos(public.inspections) is
  'The PO numbers of this inspection row and of the parts that name it in group_id, one per line, for the list''s search.';

create or replace function public.parts_lot_numbers(inspection public.inspections)
returns text[]
language sql
stable
set search_path = ''
as $$
  select inspection.lot_numbers || array(
    select lot
      from public.inspections as part, unnest(part.lot_numbers) as lot
     where part.group_id = inspection.id
  )
$$;

comment on function public.parts_lot_numbers(public.inspections) is
  'lot_numbers of this inspection row and of the parts that name it in group_id, for the list''s search.';

create or replace function public.parts_lot_numbers_upper(inspection public.inspections)
returns text[]
language sql
stable
set search_path = ''
as $$
  select inspection.lot_numbers_upper || array(
    select lot
      from public.inspections as part, unnest(part.lot_numbers_upper) as lot
     where part.group_id = inspection.id
  )
$$;

comment on function public.parts_lot_numbers_upper(public.inspections) is
  'lot_numbers_upper of this inspection row and of the parts that name it in group_id, for the list''s search.';

create or replace function public.parts_carton_numbers(inspection public.inspections)
returns integer[]
language sql
stable
set search_path = ''
as $$
  select inspection.carton_numbers || array(
    select carton
      from public.inspections as part, unnest(part.carton_numbers) as carton
     where part.group_id = inspection.id
  )
$$;

comment on function public.parts_carton_numbers(public.inspections) is
  'carton_numbers of this inspection row and of the parts that name it in group_id, for the list''s search.';

-- The parts move together; when they differ, the least advanced stands for
-- the inspection: draft, then reopened (back with its inspector), submitted,
-- approved. The same order as STATUS_PROGRESS in lib/inspections/part-summary.ts.
create or replace function public.parts_status(inspection public.inspections)
returns public.inspection_status
language sql
stable
set search_path = ''
as $$
  select parts.status
    from (
      select inspection.status
      union all
      select part.status from public.inspections as part where part.group_id = inspection.id
    ) as parts (status)
   order by array_position('{draft,reopened,submitted,approved}'::public.inspection_status[], parts.status)
   limit 1
$$;

comment on function public.parts_status(public.inspections) is
  'The least advanced status of this inspection row and of the parts that name it in group_id (draft, reopened, submitted, approved), for the list''s status filter.';

revoke execute on function
  public.parts_ref_nos(public.inspections),
  public.parts_po_nos(public.inspections),
  public.parts_lot_numbers(public.inspections),
  public.parts_lot_numbers_upper(public.inspections),
  public.parts_carton_numbers(public.inspections),
  public.parts_status(public.inspections)
from public, anon;

grant execute on function
  public.parts_ref_nos(public.inspections),
  public.parts_po_nos(public.inspections),
  public.parts_lot_numbers(public.inspections),
  public.parts_lot_numbers_upper(public.inspections),
  public.parts_carton_numbers(public.inspections),
  public.parts_status(public.inspections)
to authenticated, service_role;
