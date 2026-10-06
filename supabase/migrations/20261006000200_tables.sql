-- Phase 1 tables (BUILD_SPEC 5). Deleting a parent never deletes records
-- silently: reference rows and profiles are restricted, and only an
-- inspection's own evidence (photos, files, reviews, audit) goes with it.

-- People ---------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Copied from auth.users and kept in sync, so admin lists need no Auth API call.
  email text,
  full_name text,
  role public.user_role not null default 'inspector',
  active boolean not null default true,
  -- Object name in the signatures bucket, inside the user's own folder.
  signature_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_signature_in_own_folder
    check (signature_path like id::text || '/_%')
);

-- Reference data -------------------------------------------------------------

create table public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  factory_name text,
  address text,
  country text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per factory: a company can have several plants.
create unique index manufacturers_name_factory_key
  on public.manufacturers (lower(name), lower(coalesce(factory_name, '')));

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  -- Object name in the client-logos bucket.
  logo_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index clients_name_key on public.clients (lower(name));

-- Severity is not stored here: it belongs to the template (BUILD_SPEC 4.2).
create table public.defect_codes (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (btrim(name) <> ''),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z][A-Z0-9_]*$'),
  version integer not null default 1 check (version >= 1),
  extends_code text check (extends_code ~ '^[A-Z][A-Z0-9_]*$'),
  product_type public.product_type not null,
  standard public.standard_code not null,
  client_id uuid references public.clients (id) on delete restrict,
  manufacturer_id uuid references public.manufacturers (id) on delete restrict,
  status public.template_status not null default 'draft',
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  -- The definition with inheritance applied: what capture screens render.
  resolved jsonb check (jsonb_typeof(resolved) = 'object'),
  -- Object name in the template-sources bucket (the original form or report).
  source_file_path text,
  coverage_confirmed_by uuid references public.profiles (id) on delete restrict,
  coverage_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint templates_code_version_key unique (code, version),
  constraint templates_extends_other check (extends_code <> code)
);

-- One active version per code: activating a new version retires the old one first.
create unique index templates_one_active_version
  on public.templates (code) where status = 'active';
create index templates_client_id_idx on public.templates (client_id);
create index templates_manufacturer_id_idx on public.templates (manufacturer_id);
create index templates_coverage_confirmed_by_idx on public.templates (coverage_confirmed_by);

-- Inspections ----------------------------------------------------------------

create sequence public.inspection_ref_seq as bigint;

create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  -- Drawn by this default; the guard trigger rejects a value from anywhere else.
  ref_no text not null unique
    default public.inspection_ref(now(), nextval('public.inspection_ref_seq')),
  -- The exact template version the inspection started with. It never changes.
  template_id uuid not null references public.templates (id) on delete restrict,
  client_id uuid references public.clients (id) on delete restrict,
  manufacturer_id uuid references public.manufacturers (id) on delete restrict,
  po_no text,
  product_name text,
  -- Copied from data.modules.order_lots so lots are searchable.
  lot_numbers text[] not null default '{}',
  inspection_date date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  inspector_id uuid not null default auth.uid()
    references public.profiles (id) on delete restrict,
  status public.inspection_status not null default 'draft',
  data jsonb not null default '{"modules": {}, "custom": {}}',
  -- Modules switched off for this inspection: { <module_key>: { reason, by, at } }.
  module_overrides jsonb not null default '{}' check (jsonb_typeof(module_overrides) = 'object'),
  suggested_result public.inspection_result,
  result public.inspection_result,
  remarks text,
  submitted_at timestamptz,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  report_url text check (report_url ~* '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspections_data_shape check (
    jsonb_typeof(data) = 'object'
    and jsonb_typeof(data -> 'modules') = 'object'
    and jsonb_typeof(data -> 'custom') = 'object'
  )
);

create index inspections_template_id_idx on public.inspections (template_id);
create index inspections_client_id_idx on public.inspections (client_id);
create index inspections_manufacturer_id_idx on public.inspections (manufacturer_id);
create index inspections_inspector_id_idx on public.inspections (inspector_id);
create index inspections_approved_by_idx on public.inspections (approved_by);
create index inspections_status_idx on public.inspections (status);
create index inspections_inspection_date_idx on public.inspections (inspection_date);
create index inspections_po_no_idx on public.inspections (po_no);
create index inspections_lot_numbers_idx on public.inspections using gin (lot_numbers);

create table public.inspection_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  module_key text,
  -- What the photo shows, e.g. 'size:M/hand:R/defect:thin_spot/box:253'.
  target text,
  -- Object names in the inspection-photos bucket, inside the inspection's folder.
  storage_path text not null unique,
  thumb_path text unique,
  caption text,
  taken_at timestamptz,
  width integer check (width > 0),
  height integer check (height > 0),
  -- The browser could not convert the file, so the original was uploaded.
  flagged boolean not null default false,
  include_in_report boolean not null default false,
  created_by uuid not null default auth.uid()
    references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "is not distinct from": a malformed path parses to null, which must fail.
  constraint inspection_photos_path_in_folder
    check (public.storage_inspection_id(storage_path) is not distinct from inspection_id),
  constraint inspection_photos_thumb_in_folder
    check (
      thumb_path is null
      or public.storage_inspection_id(thumb_path) is not distinct from inspection_id
    )
);

create index inspection_photos_inspection_id_idx
  on public.inspection_photos (inspection_id, module_key);
create index inspection_photos_created_by_idx on public.inspection_photos (created_by);

create table public.inspection_files (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  module_key text,
  kind public.inspection_file_kind not null default 'other',
  -- Object name in the inspection-files bucket, inside the inspection's folder.
  storage_path text not null unique,
  -- File name as uploaded, shown in lists.
  name text not null check (btrim(name) <> ''),
  created_by uuid not null default auth.uid()
    references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspection_files_path_in_folder
    check (public.storage_inspection_id(storage_path) is not distinct from inspection_id)
);

create index inspection_files_inspection_id_idx
  on public.inspection_files (inspection_id, module_key);
create index inspection_files_created_by_idx on public.inspection_files (created_by);

-- AI second opinion (BUILD_SPEC 9.2) -----------------------------------------

create table public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  -- The inspection version reviewed: a new review is kept for each version.
  inspection_updated_at timestamptz not null,
  status public.ai_review_status not null default 'pending',
  model text,
  suggested_result public.inspection_result,
  -- 0 to 1.
  confidence numeric(4, 3) check (confidence between 0 and 1),
  summary text,
  findings jsonb not null default '[]' check (jsonb_typeof(findings) = 'array'),
  questions jsonb not null default '[]' check (jsonb_typeof(questions) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_reviews_inspection_id_idx on public.ai_reviews (inspection_id, created_at);

create table public.ai_review_actions (
  id uuid primary key default gen_random_uuid(),
  ai_review_id uuid not null references public.ai_reviews (id) on delete cascade,
  -- Id of the finding inside ai_reviews.findings.
  finding_id text not null check (btrim(finding_id) <> ''),
  actor_id uuid not null default auth.uid()
    references public.profiles (id) on delete restrict,
  action public.ai_review_action not null,
  note text,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_review_actions_disagree_has_note
    check (action <> 'disagree' or btrim(coalesce(note, '')) <> '')
);

create index ai_review_actions_ai_review_id_idx on public.ai_review_actions (ai_review_id);
create index ai_review_actions_actor_id_idx on public.ai_review_actions (actor_id);

-- Audit ----------------------------------------------------------------------

-- Written only by triggers and public.log_inspection_event(); rows never change.
create table public.audit_log (
  id bigint generated always as identity primary key,
  -- Null when the event outlives its inspection (the deletion itself).
  inspection_id uuid references public.inspections (id) on delete cascade,
  -- Null for the service role and the database owner.
  actor_id uuid references public.profiles (id) on delete restrict,
  action text not null check (action ~ '^[a-z][a-z0-9_.]*$'),
  changes jsonb not null default '{}' check (jsonb_typeof(changes) = 'object'),
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index audit_log_inspection_id_idx on public.audit_log (inspection_id, at);
create index audit_log_actor_id_idx on public.audit_log (actor_id);

-- Timestamps and locked columns ----------------------------------------------

create trigger set_updated_at before insert or update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.manufacturers
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.clients
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.defect_codes
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.templates
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.inspections
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.inspection_photos
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.inspection_files
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.ai_reviews
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.ai_review_actions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before insert or update on public.audit_log
  for each row execute function public.set_updated_at();

-- Template definitions and inspection data refer to defect codes by value.
create trigger lock_columns before update on public.defect_codes
  for each row execute function public.forbid_changes('code');
create trigger lock_columns before update on public.profiles
  for each row execute function public.forbid_changes('id');
create trigger lock_columns before update on public.inspections
  for each row execute function public.forbid_changes('ref_no', 'inspector_id', 'template_id');
create trigger lock_columns before update on public.inspection_photos
  for each row execute function public.forbid_changes('inspection_id', 'created_by');
create trigger lock_columns before update on public.inspection_files
  for each row execute function public.forbid_changes('inspection_id', 'created_by');
create trigger lock_columns before update on public.ai_reviews
  for each row execute function public.forbid_changes('inspection_id', 'inspection_updated_at');
create trigger lock_columns before update on public.ai_review_actions
  for each row execute function public.forbid_changes('ai_review_id', 'finding_id', 'actor_id');
create trigger lock_columns before update on public.audit_log
  for each row execute function public.forbid_changes(
    'inspection_id', 'actor_id', 'action', 'changes', 'at'
  );
