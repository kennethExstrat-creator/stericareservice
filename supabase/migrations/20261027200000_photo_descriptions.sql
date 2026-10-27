-- Steri-AI describes the report's photos (docs/AI.md, "Describing photos";
-- docs/DATABASE.md). Kenneth, 27 October 2026, of Section 06's four photos
-- all captioned "Product Defects": "the template design i gave to you did list
-- out the defect type, such as pinhole, palm etc. Please loop in AI to
-- identify properly rather than squeezing in all photos without analyzing".
--
-- inspection_photos.ai_description: what Steri-AI says the photo shows, as
-- the export carries it (photos[].description: text, kind, defect, location,
-- clarity; lib/schemas/export.ts), a JSON object of at most 2 kB.
-- ai_described_at: when Steri-AI looked at the photo. A description is always
-- dated; a date without a description means Steri-AI could not tell what the
-- photo shows, so the Report page does not ask again by itself. A caption, the
-- inspector's own text, stays in `caption` and wins in the report: these
-- columns are captions only and never change a result.
--
-- description_guard (inspection_photos_description_guard(), a trigger
-- function no API role may execute) refuses both columns on a signed-in
-- user's own insert or update, as reading_guard does for inspection_files'
-- reading (migration 20261026120000): the app writes them with the secret key
-- once it has checked that the caller may change the inspection's photos. A
-- trigger of its own, so inspection_media_guard stays as it is: it still keeps
-- an approved inspection's photos read-only, these columns included.
--
-- ai_usage takes the descriptions' Claude calls as the job photo_description
-- (one row per batch of photos, item_count the photos sent):
-- ai_usage_feature_check is dropped and added again with the six jobs.
-- Idempotent. Its version follows 20261027163000, the newest applied.

alter table public.inspection_photos
  add column if not exists ai_description jsonb check (
    ai_description is null or (jsonb_typeof(ai_description) = 'object' and octet_length(ai_description::text) <= 2048)
  ),
  add column if not exists ai_described_at timestamptz;

alter table public.inspection_photos drop constraint if exists inspection_photos_ai_description_dated;
alter table public.inspection_photos add constraint inspection_photos_ai_description_dated
  check (ai_description is null or ai_described_at is not null);

create or replace function public.inspection_photos_description_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (case tg_op
        when 'INSERT' then new.ai_description is not null or new.ai_described_at is not null
        else new.ai_description is distinct from old.ai_description
          or new.ai_described_at is distinct from old.ai_described_at
      end) then
    raise exception 'inspection_photos: Steri-AI''s description is recorded by the app'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- A trigger function: no API role calls it.
revoke all on function public.inspection_photos_description_guard() from public, anon, authenticated;

drop trigger if exists description_guard on public.inspection_photos;
create trigger description_guard before insert or update on public.inspection_photos
  for each row execute function public.inspection_photos_description_guard();

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (
  feature in (
    'new_inspection_read', 'source_document_read', 'media_sort', 'second_opinion', 'inspection_summary', 'photo_description'
  )
);
