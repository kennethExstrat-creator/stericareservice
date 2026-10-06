-- Row level security and privileges. Grants are explicit instead of relying on
-- Supabase's default privileges: anon gets nothing, authenticated gets the
-- statements its policies allow (RLS filters the rows), service_role gets all
-- except changing or removing audit rows. Policies apply to `authenticated`
-- only, and every one requires an active profile, so a deactivated user reads
-- and writes nothing.

alter table public.profiles enable row level security;
alter table public.manufacturers enable row level security;
alter table public.clients enable row level security;
alter table public.defect_codes enable row level security;
alter table public.templates enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_photos enable row level security;
alter table public.inspection_files enable row level security;
alter table public.ai_reviews enable row level security;
alter table public.ai_review_actions enable row level security;
alter table public.audit_log enable row level security;

-- Table privileges -----------------------------------------------------------

revoke all on table
  public.profiles, public.manufacturers, public.clients, public.defect_codes,
  public.templates, public.inspections, public.inspection_photos,
  public.inspection_files, public.ai_reviews, public.ai_review_actions,
  public.audit_log
from anon, authenticated, service_role;

grant all on table
  public.profiles, public.manufacturers, public.clients, public.defect_codes,
  public.templates, public.inspections, public.inspection_photos,
  public.inspection_files, public.ai_reviews, public.ai_review_actions
to service_role;
-- The audit trail is append-only: server code reads it and adds to it
-- (preferably through log_inspection_event()), but never changes or deletes
-- rows. Cascades from a deleted inspection run as the owner.
grant select, insert on table public.audit_log to service_role;

-- Profiles are created by the auth.users trigger, never by users.
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table
  public.manufacturers, public.clients, public.defect_codes, public.templates,
  public.inspections, public.inspection_photos, public.inspection_files,
  public.ai_reviews, public.ai_review_actions
to authenticated;
-- Written only by triggers and log_inspection_event().
grant select on table public.audit_log to authenticated;

revoke all on sequence public.inspection_ref_seq, public.audit_log_id_seq
from anon, authenticated;
-- The ref_no default draws from the sequence as the inserting user.
grant usage on sequence public.inspection_ref_seq to authenticated;
grant all on sequence public.inspection_ref_seq, public.audit_log_id_seq to service_role;

-- Function privileges --------------------------------------------------------

-- Called by policies, column defaults and check constraints as the user.
revoke all on function
  public.is_active(),
  public.is_admin(),
  public.my_profile_status(),
  public.can_read_inspection(uuid),
  public.can_edit_inspection(uuid),
  public.storage_folder_uuid(text),
  public.storage_inspection_id(text),
  public.inspection_ref(timestamptz, bigint),
  public.log_inspection_event(uuid, text, jsonb)
from public, anon;

grant execute on function
  public.is_active(),
  public.is_admin(),
  public.my_profile_status(),
  public.can_read_inspection(uuid),
  public.can_edit_inspection(uuid),
  public.storage_folder_uuid(text),
  public.storage_inspection_id(text),
  public.inspection_ref(timestamptz, bigint),
  public.log_inspection_event(uuid, text, jsonb)
to authenticated, service_role;

-- Trigger functions fire without EXECUTE; nobody calls them directly.
revoke all on function
  public.set_updated_at(),
  public.forbid_changes(),
  public.handle_new_auth_user(),
  public.handle_auth_email_change(),
  public.profiles_guard(),
  public.templates_guard(),
  public.inspections_guard(),
  public.inspection_media_guard(),
  public.audit_inspection()
from public, anon, authenticated;

-- Profiles -------------------------------------------------------------------

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    (id = (select auth.uid()) and (select public.is_active()))
    or (select public.is_admin())
  );

-- Users edit their own full_name and signature_path; admins edit role, active
-- and full_name. public.profiles_guard() enforces the columns.
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    (id = (select auth.uid()) and (select public.is_active()))
    or (select public.is_admin())
  )
  with check (
    (id = (select auth.uid()) and (select public.is_active()))
    or (select public.is_admin())
  );

-- Reference tables: read for active users, write for admins -----------------

create policy manufacturers_select on public.manufacturers
  for select to authenticated using ((select public.is_active()));
create policy manufacturers_insert on public.manufacturers
  for insert to authenticated with check ((select public.is_admin()));
create policy manufacturers_update on public.manufacturers
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy manufacturers_delete on public.manufacturers
  for delete to authenticated using ((select public.is_admin()));

create policy clients_select on public.clients
  for select to authenticated using ((select public.is_active()));
create policy clients_insert on public.clients
  for insert to authenticated with check ((select public.is_admin()));
create policy clients_update on public.clients
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy clients_delete on public.clients
  for delete to authenticated using ((select public.is_admin()));

create policy defect_codes_select on public.defect_codes
  for select to authenticated using ((select public.is_active()));
create policy defect_codes_insert on public.defect_codes
  for insert to authenticated with check ((select public.is_admin()));
create policy defect_codes_update on public.defect_codes
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy defect_codes_delete on public.defect_codes
  for delete to authenticated using ((select public.is_admin()));

create policy templates_select on public.templates
  for select to authenticated using ((select public.is_active()));
create policy templates_insert on public.templates
  for insert to authenticated with check ((select public.is_admin()));
create policy templates_update on public.templates
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy templates_delete on public.templates
  for delete to authenticated using ((select public.is_admin()));

-- Inspections ----------------------------------------------------------------

create policy inspections_select on public.inspections
  for select to authenticated
  using (
    (select public.is_admin())
    or (inspector_id = (select auth.uid()) and (select public.is_active()))
  );

create policy inspections_insert on public.inspections
  for insert to authenticated
  with check (
    (select public.is_admin())
    or (
      inspector_id = (select auth.uid())
      and status = 'draft'
      and (select public.is_active())
    )
  );

-- Owners edit while draft or reopened (and may submit from there); the status
-- flow itself is enforced by public.inspections_guard().
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
  with check (
    (select public.is_admin())
    or (inspector_id = (select auth.uid()) and (select public.is_active()))
  );

create policy inspections_delete on public.inspections
  for delete to authenticated using ((select public.is_admin()));

-- Photos and files follow the parent inspection ------------------------------

create policy inspection_photos_select on public.inspection_photos
  for select to authenticated using (public.can_read_inspection(inspection_id));
create policy inspection_photos_insert on public.inspection_photos
  for insert to authenticated with check (public.can_edit_inspection(inspection_id));
-- Admins also reach the photos of an approved inspection, where
-- public.inspection_media_guard() lets only include_in_report change.
create policy inspection_photos_update on public.inspection_photos
  for update to authenticated
  using ((select public.is_admin()) or public.can_edit_inspection(inspection_id))
  with check ((select public.is_admin()) or public.can_edit_inspection(inspection_id));
create policy inspection_photos_delete on public.inspection_photos
  for delete to authenticated using (public.can_edit_inspection(inspection_id));

create policy inspection_files_select on public.inspection_files
  for select to authenticated using (public.can_read_inspection(inspection_id));
create policy inspection_files_insert on public.inspection_files
  for insert to authenticated with check (public.can_edit_inspection(inspection_id));
create policy inspection_files_update on public.inspection_files
  for update to authenticated
  using (public.can_edit_inspection(inspection_id))
  with check (public.can_edit_inspection(inspection_id));
create policy inspection_files_delete on public.inspection_files
  for delete to authenticated using (public.can_edit_inspection(inspection_id));

-- AI second opinion: admins decide, inspectors only read their reviews -------

create policy ai_reviews_select on public.ai_reviews
  for select to authenticated using (public.can_read_inspection(inspection_id));
create policy ai_reviews_insert on public.ai_reviews
  for insert to authenticated with check ((select public.is_admin()));
create policy ai_reviews_update on public.ai_reviews
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy ai_reviews_delete on public.ai_reviews
  for delete to authenticated using ((select public.is_admin()));

create policy ai_review_actions_select on public.ai_review_actions
  for select to authenticated using ((select public.is_admin()));
-- An admin records actions in their own name only.
create policy ai_review_actions_insert on public.ai_review_actions
  for insert to authenticated
  with check ((select public.is_admin()) and actor_id = (select auth.uid()));
create policy ai_review_actions_update on public.ai_review_actions
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()) and actor_id = (select auth.uid()));
create policy ai_review_actions_delete on public.ai_review_actions
  for delete to authenticated using ((select public.is_admin()));

-- Audit log: read-only for users. Deletion records (no inspection) are admin-only.

create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select public.is_admin()) or public.can_read_inspection(inspection_id));
