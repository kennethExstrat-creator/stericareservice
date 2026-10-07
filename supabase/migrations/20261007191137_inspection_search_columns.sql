-- The inspections list searches by carton number, and by lot number in any
-- case (BUILD_SPEC 10: "Search by ref, PO, lot or carton").
--
-- Two columns the database keeps from the row itself, for the list's search
-- (listSearchFilter() in lib/inspections/query.ts):
--
-- - carton_numbers: every carton number sampled in Finished Goods Sampling
--   Information (data.modules.carton_sampling, every size), each once, in
--   ascending order. Blank cells, and anything that is not a whole number
--   from 1 up, are left out.
-- - lot_numbers_upper: lot_numbers (which the app copies from order_lots on
--   every save) in capitals, each once. Lots are printed in capitals but
--   stored as typed, and an iPad keyboard capitalises only the first letter
--   ('Lt081315'), so the search compares capitals with capitals.
--
-- The trigger below sets both on every insert, and on every update that
-- writes the data, the lots or the columns themselves, from the row's own
-- values. So they always match the data, whatever wrote it (autosave,
-- submit, an admin's edit, a script), and no caller can set them to anything
-- else. A stored generated column would do the same, but PL/pgSQL hands a
-- BEFORE trigger null for it in NEW: inspections_guard() would then take
-- every update of an approved inspection (its report link) for a change and
-- refuse it.
--
-- The inspections already there get their values once, here: the columns
-- are added as generated columns, which the table rewrite computes for every
-- row without firing a row trigger, then turned into plain columns that keep
-- those values (drop expression). An UPDATE would have moved updated_at,
-- which turns the next autosave of every open draft into a conflict, and
-- inspections_guard() refuses any change to an approved inspection.
--
-- Until a project has this migration the list searches as before it (refs,
-- POs, and lots as typed or in capitals): lib/inspections/query.ts.
--
-- Idempotent: running it again changes nothing.

create or replace function public.inspection_carton_numbers(data jsonb)
returns integer[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- Lax mode and silent: a size, list or cell of an unexpected shape adds
  -- nothing instead of failing the save.
  select coalesce(array_agg(distinct carton order by carton), '{}')
    from (
      select value::integer as carton
        from jsonb_path_query(
               data,
               '$.modules.carton_sampling.sizes.*.cartonNumbers[*] ? (@.type() == "number" && @ >= 1 && @ <= 2147483647 && @ == @.floor())',
               silent => true
             ) as found (value)
    ) as cartons
$$;

comment on function public.inspection_carton_numbers(jsonb) is
  'Every whole carton number from 1 up in the data''s Finished Goods Sampling grid (carton_sampling, all sizes), each once, in order. Sets inspections.carton_numbers.';

create or replace function public.upper_lot_numbers(lots text[])
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(distinct upper(lot) order by upper(lot)), '{}')
    from unnest(lots) as lot
   where lot is not null
$$;

comment on function public.upper_lot_numbers(text[]) is
  'The lot numbers in capitals, each once, in order. Sets inspections.lot_numbers_upper.';

-- Added generated, so the rewrite fills them for every inspection, then plain.
alter table public.inspections
  add column if not exists carton_numbers integer[]
    generated always as (public.inspection_carton_numbers(data)) stored,
  add column if not exists lot_numbers_upper text[]
    generated always as (public.upper_lot_numbers(lot_numbers)) stored;

alter table public.inspections
  alter column carton_numbers drop expression if exists,
  alter column lot_numbers_upper drop expression if exists;

alter table public.inspections
  alter column carton_numbers set default '{}',
  alter column carton_numbers set not null,
  alter column lot_numbers_upper set default '{}',
  alter column lot_numbers_upper set not null;

comment on column public.inspections.carton_numbers is
  'Carton numbers sampled (data.modules.carton_sampling), for search. Set by the search_columns trigger; never written by the app.';
comment on column public.inspections.lot_numbers_upper is
  'lot_numbers in capitals, for a search that ignores case. Set by the search_columns trigger; never written by the app.';

create or replace function public.inspections_search_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.carton_numbers := public.inspection_carton_numbers(new.data);
  new.lot_numbers_upper := public.upper_lot_numbers(new.lot_numbers);
  return new;
end;
$$;

-- BEFORE triggers of one kind fire in name order: this one after guard and
-- lock_columns, which compare an approved inspection with what the caller
-- sent. An update that writes none of these columns (a status change, a
-- report link) leaves them as they are.
create or replace trigger search_columns
  before insert or update of data, lot_numbers, carton_numbers, lot_numbers_upper
  on public.inspections
  for each row execute function public.inspections_search_columns();

-- Like lot_numbers: for a search by lot or carton on its own.
create index if not exists inspections_carton_numbers_idx
  on public.inspections using gin (carton_numbers);
create index if not exists inspections_lot_numbers_upper_idx
  on public.inspections using gin (lot_numbers_upper);

-- The trigger runs them as whoever writes the row.
revoke execute on function
  public.inspection_carton_numbers(jsonb),
  public.upper_lot_numbers(text[])
from public, anon;

grant execute on function
  public.inspection_carton_numbers(jsonb),
  public.upper_lot_numbers(text[])
to authenticated, service_role;

-- Trigger functions fire without EXECUTE; nobody calls them directly.
revoke all on function public.inspections_search_columns() from public, anon, authenticated;
