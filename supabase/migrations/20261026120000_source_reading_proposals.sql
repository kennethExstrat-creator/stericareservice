-- Steri-AI's reading of a Source Document outlives the screen that asked for
-- it (docs/AI.md, "Source Documents"; Kenneth, 26 October 2026: "why is the
-- sampling plan not filled by AI?"). A reading takes about ten seconds and
-- its proposals went only to the capture screen that started it: an
-- inspector who opened another page meanwhile lost them, and the file,
-- marked read, was never read again. The proposals are now kept with the
-- file, and the capture screen fills them into the empty fields the next time
-- the inspection opens, then records when it did, so they go in once.
--
-- ai_proposals: what the reading proposes for the inspection's steps, as
-- readSourceFile answers it (a JSON object keyed by module key). ai_filled_at:
-- when a capture screen put them into the inspection's data; null while they
-- wait. Like ai_status, ai_read_at and ai_summary (migration 20261009150000),
-- they are written by the app with the secret key once it has checked that
-- the caller may edit the inspection. reading_guard now holds that for all
-- five: a signed-in user's own request may not set or change them. Idempotent.
alter table public.inspection_files
  add column if not exists ai_proposals jsonb
    check (ai_proposals is null or jsonb_typeof(ai_proposals) = 'object'),
  add column if not exists ai_filled_at timestamptz;

create or replace function public.inspection_files_reading_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (case tg_op
        when 'INSERT' then
          new.ai_status is not null or new.ai_read_at is not null or new.ai_summary is not null
          or new.ai_proposals is not null or new.ai_filled_at is not null
        else
          new.ai_status is distinct from old.ai_status
          or new.ai_read_at is distinct from old.ai_read_at
          or new.ai_summary is distinct from old.ai_summary
          or new.ai_proposals is distinct from old.ai_proposals
          or new.ai_filled_at is distinct from old.ai_filled_at
      end) then
    raise exception 'inspection_files: Steri-AI''s reading is recorded by the app'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- A trigger function: no API role calls it.
revoke all on function public.inspection_files_reading_guard() from public, anon, authenticated;

drop trigger if exists reading_guard on public.inspection_files;
create trigger reading_guard before insert or update on public.inspection_files
  for each row execute function public.inspection_files_reading_guard();
