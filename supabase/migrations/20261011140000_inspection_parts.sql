-- PO parts (docs/DATABASE.md, "PO parts"; Kenneth, 11 October 2026): one
-- inspection can cover several purchase orders. Each PO is a part: an
-- inspections row with its own PO, lots, sizes, sampling, tests and result,
-- so the AQL stays per PO as the inspector sampled it. The first part
-- (group_id null) stands for the inspection; every other part names it in
-- group_id. The parts share Source Documents, are submitted, approved and
-- reopened together, and go out in one report. Written by the app with the
-- secret key (lib/inspections/parts-server.ts). Idempotent.
alter table public.inspections
  add column if not exists group_id uuid references public.inspections (id) on delete set null;

alter table public.inspections drop constraint if exists inspections_group_not_self;
alter table public.inspections add constraint inspections_group_not_self check (group_id is distinct from id);

create index if not exists inspections_group_id_idx on public.inspections (group_id);
