-- Manufacturers as brand, company and factory (Kenneth, 27 October 2026:
-- "Brand Name: Top Glove, Company Name: Terang Nusa Sdn Bhd, Factory:
-- TG-F40, Address"; "one brand can have multiple operating company while one
-- company can have multiple Factory").
--
--   1. manufacturer_brands: the brand, e.g. Top Glove.
--   2. manufacturer_companies: an operating company of one brand, e.g.
--      Terang Nusa Sdn. Bhd.
--   3. manufacturers stays one row per factory (factory_name, e.g. TG-F40,
--      with its address and country), now under its company (company_id).
--      Inspections and templates point at it as before, so nothing that
--      refers to a manufacturer changes.
--
-- manufacturers.name repeats the company's name, kept so by triggers, so code
-- written before this migration (selects of manufacturers(name,
-- factory_name)) keeps working. New code reads the company. The column can go
-- once nothing deployed reads it.
--
-- Each existing manufacturer becomes a factory of a company of its name (rows
-- with the same name, ignoring case, share one), and each such company the
-- only company of a brand of the same name, until an admin moves it to its
-- real brand.

-- 1. Brands and companies --------------------------------------------------------

create table public.manufacturer_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index manufacturer_brands_name_key on public.manufacturer_brands (lower(name));

create table public.manufacturer_companies (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.manufacturer_brands (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A company's registered name is its own, whichever brand it trades under.
create unique index manufacturer_companies_name_key on public.manufacturer_companies (lower(name));
create index manufacturer_companies_brand_id_idx on public.manufacturer_companies (brand_id);

create trigger set_updated_at before insert or update on public.manufacturer_brands
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.manufacturer_companies
  for each row execute function public.set_updated_at();

-- 2. Each factory under its company ----------------------------------------------

alter table public.manufacturers
  add column company_id uuid references public.manufacturer_companies (id) on delete restrict;

with names as (
  select distinct on (lower(btrim(name))) btrim(name) as name
    from public.manufacturers
   order by lower(btrim(name)), created_at, id
), brands as (
  insert into public.manufacturer_brands (name)
  select name from names
  returning id, name
)
insert into public.manufacturer_companies (brand_id, name)
select id, name from brands;

update public.manufacturers m
   set company_id = c.id, name = c.name
  from public.manufacturer_companies c
 where lower(c.name) = lower(btrim(m.name));

alter table public.manufacturers alter column company_id set not null;
create index manufacturers_company_id_idx on public.manufacturers (company_id);

-- One row per factory of a company. The name it was unique on is now a copy.
drop index public.manufacturers_name_factory_key;
create unique index manufacturers_company_factory_key
  on public.manufacturers (company_id, lower(coalesce(factory_name, '')));

-- 3. manufacturers.name: the company's name ----------------------------------------

-- New code leaves it out; the trigger below fills it.
alter table public.manufacturers alter column name set default '';

create function public.manufacturer_company_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A missing company_id is refused by its not-null constraint.
  if new.company_id is null then
    return new;
  end if;
  select c.name into new.name from public.manufacturer_companies c where c.id = new.company_id;
  if not found then
    raise foreign_key_violation using
      message = 'insert or update on table "manufacturers" violates foreign key constraint "manufacturers_company_id_fkey"';
  end if;
  return new;
end;
$$;

create trigger company_name before insert or update of company_id, name on public.manufacturers
  for each row execute function public.manufacturer_company_name();

-- As the person renaming the company: the same permission writes both tables.
create function public.manufacturer_company_renamed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.manufacturers set name = new.name
   where company_id = new.id and name is distinct from new.name;
  return null;
end;
$$;

create trigger rename_factories after update of name on public.manufacturer_companies
  for each row execute function public.manufacturer_company_renamed();

-- 4. Row level security: read for active users, written with the Manufacturers switch

alter table public.manufacturer_brands enable row level security;
alter table public.manufacturer_companies enable row level security;

create policy manufacturer_brands_select on public.manufacturer_brands
  for select to authenticated using ((select public.is_active()));
create policy manufacturer_brands_insert on public.manufacturer_brands
  for insert to authenticated with check ((select public.has_permission('manufacturers')));
create policy manufacturer_brands_update on public.manufacturer_brands
  for update to authenticated
  using ((select public.has_permission('manufacturers')))
  with check ((select public.has_permission('manufacturers')));
create policy manufacturer_brands_delete on public.manufacturer_brands
  for delete to authenticated using ((select public.has_permission('manufacturers')));

create policy manufacturer_companies_select on public.manufacturer_companies
  for select to authenticated using ((select public.is_active()));
create policy manufacturer_companies_insert on public.manufacturer_companies
  for insert to authenticated with check ((select public.has_permission('manufacturers')));
create policy manufacturer_companies_update on public.manufacturer_companies
  for update to authenticated
  using ((select public.has_permission('manufacturers')))
  with check ((select public.has_permission('manufacturers')));
create policy manufacturer_companies_delete on public.manufacturer_companies
  for delete to authenticated using ((select public.has_permission('manufacturers')));

-- Privileges ---------------------------------------------------------------------

-- Supabase grants every API role everything on a new table: only what the policies need.
revoke all on table public.manufacturer_brands, public.manufacturer_companies from anon, authenticated, service_role;
grant select, insert, update, delete on table public.manufacturer_brands, public.manufacturer_companies
  to authenticated, service_role;

-- Trigger functions fire without EXECUTE; nobody calls them directly.
revoke all on function public.manufacturer_company_name(), public.manufacturer_company_renamed()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
