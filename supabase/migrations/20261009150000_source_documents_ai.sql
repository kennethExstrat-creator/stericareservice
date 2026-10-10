-- Source Documents (docs/AI.md, "Source Documents"): the first step of every
-- inspection, where the inspector uploads every file about it (the handwritten
-- form, the PO, packing lists, photos of labels). They are inspection_files
-- rows with module_key 'source_documents'. The AI reads each one and the
-- capture screen fills the empty fields of the steps after it; these columns
-- record that reading, for the "AI Verified" mark. Written by the app with
-- the secret key after it has checked the caller may edit the inspection.
alter table public.inspection_files
  add column if not exists ai_status text check (ai_status is null or ai_status in ('read', 'failed')),
  add column if not exists ai_read_at timestamptz,
  add column if not exists ai_summary text check (ai_summary is null or char_length(ai_summary) <= 1000);
