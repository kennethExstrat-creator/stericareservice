-- Private storage buckets and their policies (BUILD_SPEC 5 and 8.1). Files are
-- served through signed URLs. Object names, relative to the bucket:
--   inspection-photos  <inspection_id>/<uuid>.jpg, thumbnails <inspection_id>/thumbs/<uuid>.jpg
--   inspection-files   <inspection_id>/<uuid>.<ext>
--   signatures         <user_id>/<file>
--   client-logos       any name, referenced by clients.logo_path
--   template-sources   any name, referenced by templates.source_file_path
-- The Storage API enforces the size and type limits below; the policies decide who.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Photos arrive as JPEG; originals the browser cannot convert (some HEIC) are kept as is.
  ('inspection-photos', 'inspection-photos', false, 26214400,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  -- Lab reports and certificates.
  ('inspection-files', 'inspection-files', false, 52428800,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  -- No SVG: it can carry script.
  ('client-logos', 'client-logos', false, 2097152,
    array['image/png', 'image/jpeg', 'image/webp']),
  ('signatures', 'signatures', false, 1048576,
    array['image/png', 'image/jpeg', 'image/webp']),
  -- The original forms behind a template: Excel, Word, PDF or a photo.
  ('template-sources', 'template-sources', false, 52428800,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
    ])
on conflict (id) do nothing;

-- Inspection photos and files follow the parent inspection --------------------

create policy inspection_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('inspection-photos', 'inspection-files')
    and public.can_read_inspection(public.storage_inspection_id(name))
  );

create policy inspection_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('inspection-photos', 'inspection-files')
    and public.can_edit_inspection(public.storage_inspection_id(name))
  );

create policy inspection_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('inspection-photos', 'inspection-files')
    and public.can_edit_inspection(public.storage_inspection_id(name))
  )
  with check (
    bucket_id in ('inspection-photos', 'inspection-files')
    and public.can_edit_inspection(public.storage_inspection_id(name))
  );

create policy inspection_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('inspection-photos', 'inspection-files')
    and public.can_edit_inspection(public.storage_inspection_id(name))
  );

-- Reference files: read for active users, write for admins -------------------

create policy reference_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('client-logos', 'template-sources')
    and (select public.is_active())
  );

create policy reference_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('client-logos', 'template-sources')
    and (select public.is_admin())
  );

create policy reference_files_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('client-logos', 'template-sources')
    and (select public.is_admin())
  )
  with check (
    bucket_id in ('client-logos', 'template-sources')
    and (select public.is_admin())
  );

create policy reference_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('client-logos', 'template-sources')
    and (select public.is_admin())
  );

-- Signatures: the owner's folder; admins can read every signature -------------

create policy signatures_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'signatures'
    and (
      (
        (storage.foldername(name))[1] = (select auth.uid())::text
        and (select public.is_active())
      )
      or (select public.is_admin())
    )
  );

create policy signatures_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active())
  );

create policy signatures_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active())
  )
  with check (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active())
  );

create policy signatures_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active())
  );
