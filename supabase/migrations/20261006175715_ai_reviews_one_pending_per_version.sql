-- One AI second opinion per inspection version at a time (BUILD_SPEC 9.2).
--
-- "Request AI second opinion" looks for a pending review of the version
-- before it inserts one, but two requests at the same moment (two admins, or
-- two tabs) both pass that check, and each review is paid for. This index
-- makes the database refuse the second pending row with a unique violation
-- (23505), which startAiReview (lib/inspections/ai/review-runner.ts) answers
-- as "A second opinion of this version is being written." Done and failed
-- reviews are not limited: every version keeps its history.
--
-- Idempotent: running it again changes nothing.

-- Pending reviews from before the index that would break it (two of one
-- version) keep the oldest; the others are closed as failed, the way the app
-- closes a review that got no answer.
update public.ai_reviews as later
   set status = 'failed',
       summary = 'Stopped: another second opinion of this version was already being written.'
 where later.status = 'pending'
   and exists (
     select 1
       from public.ai_reviews as earlier
      where earlier.inspection_id = later.inspection_id
        and earlier.inspection_updated_at = later.inspection_updated_at
        and earlier.status = 'pending'
        and (earlier.created_at, earlier.id) < (later.created_at, later.id)
   );

create unique index if not exists ai_reviews_one_pending_per_version
  on public.ai_reviews (inspection_id, inspection_updated_at)
  where status = 'pending';
