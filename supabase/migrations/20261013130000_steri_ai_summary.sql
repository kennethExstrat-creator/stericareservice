-- Steri-AI Summary (docs/AI.md, "Steri-AI Summary"; docs/DATABASE.md), 12 October 2026.
-- The inspector's Steri-AI Summary button on the Conclusion drafts the
-- Inspection Summary; Steri-AI writes text only and never changes a result.
--
-- ai_settings gains the summary's own Claude model (summary_model; null means
-- AI_SUMMARY_MODEL, else the app's DEFAULT_SUMMARY_MODEL) and the house style
-- an admin sets in Steri-AI Settings > Inspection Settings (summary_style, a
-- JSON object read by SummaryStyleSchema in lib/schemas/summary-style.ts; null
-- means DEFAULT_SUMMARY_STYLE). Like the rest of the row, only the service
-- role reads or writes them, after the app has checked for an active admin.
--
-- ai_usage takes the summary's Claude calls as the job inspection_summary:
-- one row per call, item_count 1 for a draft and 0 for its check retry.
-- ai_usage_by_inspection stays as it is (summaries count in its calls and
-- cost): a column for them would change its return type.
--
-- Idempotent. Its version follows 20261013120000, which is dated a day ahead.

alter table public.ai_settings
  add column if not exists summary_model text check (
    summary_model is null or (char_length(summary_model) <= 100 and summary_model ~ '^claude-[a-z0-9][a-z0-9.:@_-]*$')
  ),
  add column if not exists summary_style jsonb check (
    summary_style is null or (jsonb_typeof(summary_style) = 'object' and octet_length(summary_style::text) <= 16384)
  );

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (
  feature in ('new_inspection_read', 'source_document_read', 'media_sort', 'second_opinion', 'inspection_summary')
);
