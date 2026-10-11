-- The shortforms inspectors write on their paper forms (docs/AI.md,
-- "Shortforms"): [{ short, meaning, confirmed }], edited in Admin > AI
-- Settings and given to the AI with every document it reads. Null: the
-- app's starting list (DEFAULT_GLOSSARY in lib/schemas/ai-settings.ts).
alter table public.ai_settings
  add column if not exists glossary jsonb check (glossary is null or jsonb_typeof(glossary) = 'array');
