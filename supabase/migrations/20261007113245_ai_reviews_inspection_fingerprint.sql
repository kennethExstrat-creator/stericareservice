-- AI second opinions keyed to the inspection's content (BUILD_SPEC 9.2: "a
-- new review is kept for each version of the inspection").
--
-- inspection_updated_at keys a review to the save it reviewed, but approving
-- an inspection, reopening it or storing its report link saves the row too
-- (set_updated_at), so the review panel called an opinion out of date when
-- nothing it reviewed had changed. inspection_fingerprint is the SHA-256, in
-- lowercase hex, of what a review depends on: the inspection's data, module
-- overrides, final result, remark and template version, and its files (id,
-- module, kind): inspectionFingerprint() in lib/inspections/ai/fingerprint.ts.
-- The app compares it; a review stored without one (before this migration)
-- is still compared by inspection_updated_at.
--
-- Like the other version keys it never changes once stored, and the
-- one-pending-review rule (20261006175715) follows it: one pending review per
-- inspection and content; rows without a fingerprint keep one per save.
--
-- Idempotent: running it again changes nothing.

alter table public.ai_reviews add column if not exists inspection_fingerprint text;

comment on column public.ai_reviews.inspection_fingerprint is
  'SHA-256 (lowercase hex) of the inspection content the review is about: data, module overrides, result, remarks, template version and files. Null for reviews stored before it existed.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ai_reviews'::regclass
       and conname = 'ai_reviews_inspection_fingerprint_format'
  ) then
    alter table public.ai_reviews
      add constraint ai_reviews_inspection_fingerprint_format
      check (inspection_fingerprint ~ '^[0-9a-f]{64}$');
  end if;
end
$$;

create or replace trigger lock_columns before update on public.ai_reviews
  for each row execute function public.forbid_changes(
    'inspection_id', 'inspection_updated_at', 'inspection_fingerprint'
  );

-- One pending review per inspection and content; reviews without a
-- fingerprint keep the rule per save. A new pending row always carries a
-- fingerprint, so the second index only holds rows from before.
create unique index if not exists ai_reviews_one_pending_per_content
  on public.ai_reviews (inspection_id, inspection_fingerprint)
  where status = 'pending' and inspection_fingerprint is not null;

drop index if exists public.ai_reviews_one_pending_per_version;
create unique index ai_reviews_one_pending_per_version
  on public.ai_reviews (inspection_id, inspection_updated_at)
  where status = 'pending' and inspection_fingerprint is null;
