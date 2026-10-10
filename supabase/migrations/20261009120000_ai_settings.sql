-- AI settings (docs/AI.md, "AI Settings"): the Anthropic API key and the
-- Claude models an admin chooses in Admin > AI Settings. One row (id = true).
--
-- The key is stored encrypted by the app (AES-256-GCM, lib/ai/secret-box.ts);
-- only its last four characters are kept in the clear, for the screen. A null
-- model means the default (or the AI_REVIEW_MODEL / AI_DOCUMENT_MODEL variable).
--
-- No policy for anon or authenticated: only the service role (the app's
-- secret key, after the app has checked the caller is an active admin) reads
-- or writes the row. Inspectors use the settings through the app, never
-- directly.
create table public.ai_settings (
  id boolean primary key default true check (id),
  anthropic_api_key_encrypted text,
  anthropic_api_key_hint text check (anthropic_api_key_hint is null or char_length(anthropic_api_key_hint) <= 8),
  document_model text check (document_model is null or document_model ~ '^claude-[a-z0-9][a-z0-9.:@_-]*$'),
  review_model text check (review_model is null or review_model ~ '^claude-[a-z0-9][a-z0-9.:@_-]*$'),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before insert or update on public.ai_settings
  for each row execute function public.set_updated_at();

create index ai_settings_updated_by_idx on public.ai_settings (updated_by);

alter table public.ai_settings enable row level security;
revoke all on public.ai_settings from anon, authenticated;
grant select, insert, update, delete on public.ai_settings to service_role;
create policy "Service role manages AI settings" on public.ai_settings
  for all to service_role using (true) with check (true);

