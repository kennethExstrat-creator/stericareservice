-- One PO per inspection (Kenneth, 11 October 2026, after speaking to the
-- inspector): each inspection is one purchase order; the forms of other POs
-- are uploaded to their own inspections. Takes PO parts back out of the
-- database: the list's parts_* functions (20261011150400) and
-- inspections.group_id (20261011140000). Parts made meanwhile stand as
-- inspections of their own. Idempotent.
drop function if exists public.parts_ref_nos(public.inspections);
drop function if exists public.parts_po_nos(public.inspections);
drop function if exists public.parts_lot_numbers(public.inspections);
drop function if exists public.parts_lot_numbers_upper(public.inspections);
drop function if exists public.parts_carton_numbers(public.inspections);
drop function if exists public.parts_status(public.inspections);

alter table public.inspections drop constraint if exists inspections_group_not_self;
drop index if exists public.inspections_group_id_idx;
alter table public.inspections drop column if exists group_id;
