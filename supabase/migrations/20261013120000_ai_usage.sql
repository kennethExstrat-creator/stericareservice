-- Steri-AI usage and prices (docs/AI.md, "Steri-AI Cost"; docs/DATABASE.md).
-- ai_usage: one row per Claude call the app makes (New Inspection and Source
-- Documents reading, Auto-Sort, the second opinion), with its tokens and its
-- cost in USD at the price list in force when it was made. Only the app writes
-- rows, with the secret key, once the caller was allowed to make the call
-- (lib/ai/usage.ts). Admins read them (the Steri-AI Cost view). Append-only: no
-- role changes or deletes a row. A deleted inspection or person only clears the
-- link, so the spend stays counted.
-- ai_settings gains the price list (prices; null means the app's list,
-- DEFAULT_AI_PRICES) and the second opinion's effort and photos (null means
-- AI_REVIEW_EFFORT / AI_REVIEW_MAX_PHOTOS or their defaults).
-- Idempotent.

alter table public.ai_settings
  add column if not exists prices jsonb check (prices is null or jsonb_typeof(prices) = 'object'),
  add column if not exists review_effort text check (review_effort is null or review_effort in ('low', 'medium', 'high')),
  add column if not exists review_max_photos smallint check (review_max_photos is null or review_max_photos between 0 and 20);

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  feature text not null check (feature in ('new_inspection_read', 'source_document_read', 'media_sort', 'second_opinion')),
  -- The model that answered (a fallback model when one took over), else the model asked for.
  model text not null check (char_length(model) <= 100 and model ~ '^claude-[a-z0-9][a-z0-9.:@_-]*$'),
  -- Null for New Inspection reads (no inspection yet), and once the inspection is deleted.
  inspection_id uuid references public.inspections (id) on delete set null,
  -- Who asked. Null once that person is deleted: a cost record never blocks deleting a user.
  actor_id uuid references public.profiles (id) on delete set null,
  -- Documents read (1), photos and videos sent to Auto-Sort, or reviews (1).
  item_count integer not null default 1 check (item_count between 0 and 1000),
  -- All billed attempts together (several when a server-side fallback answered).
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_write_5m_tokens integer not null default 0 check (cache_write_5m_tokens >= 0),
  cache_write_1h_tokens integer not null default 0 check (cache_write_1h_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  -- ok: an answer. refused or cut_off: an answer that was billed but not usable. failed: no answer came back.
  outcome text not null check (outcome in ('ok', 'refused', 'cut_off', 'failed')),
  -- Why no answer came back: Anthropic's error type, 'timeout', 'connection'.
  error_type text check (error_type is null or char_length(error_type) <= 60),
  -- USD at the price list in force when the call was made; null when the model had no price.
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace trigger set_updated_at before insert or update on public.ai_usage
  for each row execute function public.set_updated_at();
create index if not exists ai_usage_created_at_idx on public.ai_usage (created_at);
create index if not exists ai_usage_inspection_id_idx on public.ai_usage (inspection_id, created_at);
create index if not exists ai_usage_actor_id_idx on public.ai_usage (actor_id);
alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated, service_role;
grant select on table public.ai_usage to authenticated;
-- Server code adds rows and reads them, never changes or deletes one (as audit_log).
grant select, insert on table public.ai_usage to service_role;
drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage for select to authenticated using ((select public.is_admin()));

-- The cost view's reads. Security invoker: RLS decides, so anyone but an active admin gets no rows.
-- since null = all time. Days are Malaysia days.
create or replace function public.ai_usage_summary(since timestamptz default null)
returns table (feature text, model text, calls bigint, failed bigint, unpriced bigint, units bigint,
  input_tokens bigint, output_tokens bigint, cache_write_tokens bigint, cache_read_tokens bigint,
  cost_usd numeric, unlinked_cost_usd numeric)
language sql stable security invoker set search_path = ''
as $$
  select u.feature, u.model, count(*), count(*) filter (where u.outcome <> 'ok'),
         count(*) filter (where u.cost_usd is null), coalesce(sum(u.item_count), 0),
         coalesce(sum(u.input_tokens), 0), coalesce(sum(u.output_tokens), 0),
         coalesce(sum(u.cache_write_5m_tokens + u.cache_write_1h_tokens), 0), coalesce(sum(u.cache_read_tokens), 0),
         coalesce(sum(u.cost_usd), 0), coalesce(sum(u.cost_usd) filter (where u.inspection_id is null), 0)
    from public.ai_usage u
   where since is null or u.created_at >= since
   group by u.feature, u.model;
$$;
create or replace function public.ai_usage_trend(since timestamptz default null, bucket text default 'day')
returns table (bucket_start date, feature text, calls bigint, cost_usd numeric)
language sql stable security invoker set search_path = ''
as $$
  select date_trunc(bucket, u.created_at at time zone 'Asia/Kuala_Lumpur')::date, u.feature, count(*), coalesce(sum(u.cost_usd), 0)
    from public.ai_usage u
   where bucket in ('day', 'month') and (since is null or u.created_at >= since)
   group by 1, 2 order by 1, 2;
$$;
create or replace function public.ai_usage_by_inspection(since timestamptz default null, max_rows integer default 50)
returns table (inspection_id uuid, ref_no text, po_no text, inspection_date date, status public.inspection_status,
  documents bigint, media_items bigint, reviews bigint, calls bigint, cost_usd numeric, inspection_count bigint)
language sql stable security invoker set search_path = ''
as $$
  with spent as (
    select u.inspection_id,
           count(*) filter (where u.feature = 'source_document_read') as documents,
           coalesce(sum(u.item_count) filter (where u.feature = 'media_sort'), 0) as media_items,
           count(*) filter (where u.feature = 'second_opinion') as reviews,
           count(*) as calls, coalesce(sum(u.cost_usd), 0) as cost_usd
      from public.ai_usage u
     where u.inspection_id is not null and (since is null or u.created_at >= since)
     group by u.inspection_id)
  select s.inspection_id, i.ref_no, i.po_no, i.inspection_date, i.status, s.documents, s.media_items, s.reviews,
         s.calls, s.cost_usd, count(*) over ()
    from spent s join public.inspections i on i.id = s.inspection_id
   order by s.cost_usd desc, i.ref_no
   limit greatest(1, least(coalesce(max_rows, 50), 200));
$$;
revoke all on function public.ai_usage_summary(timestamptz), public.ai_usage_trend(timestamptz, text), public.ai_usage_by_inspection(timestamptz, integer) from public, anon;
grant execute on function public.ai_usage_summary(timestamptz), public.ai_usage_trend(timestamptz, text), public.ai_usage_by_inspection(timestamptz, integer) to authenticated, service_role;
