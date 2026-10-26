-- A capture save that writes audit rows in the same transaction (Kenneth, 26
-- October 2026: a Dimension P/F set by hand "with comment recorded and audit
-- logged (due to special action by inspector)", and a Dimension spec changed
-- for the inspection, by hand or read from a document: "the specification
-- should be adjustable, manually or AI auto").
--
-- saveCaptureData works out, from the data it read and the data it saves,
-- which P/F were set by hand, changed or given back, and which specs were
-- set, changed or given back to the template's, and passes them here as
-- events (pass_fail_changed, spec_changed). The data and its audit rows are
-- written together or not at all: the save itself is public.save_inspection()
-- (migration 20261007190000, unchanged), and the events are inserted after it
-- in the same transaction, only when it wrote. A save with no events keeps
-- calling save_inspection().
-- The browser never names the events: the server action does, and only the
-- secret key may call this function.
--
-- Idempotent: running it again changes nothing.

create or replace function public.save_inspection_with_events(
  inspection_id uuid,
  actor_id uuid,
  base_updated_at timestamptz,
  data jsonb,
  mirrored_columns jsonb default '{}',
  events jsonb default '[]'
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  event jsonb;
  saved timestamptz;
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'only the app saves inspections for inspectors' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(save_inspection_with_events.events, '[]')) <> 'array' then
    raise exception 'events is a list' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(save_inspection_with_events.events, '[]')) > 200 then
    raise exception 'a save records at most 200 events' using errcode = '22023';
  end if;
  for event in select value from jsonb_array_elements(coalesce(save_inspection_with_events.events, '[]')) loop
    if jsonb_typeof(event) is distinct from 'object'
      or coalesce(event->>'action', '') not in ('pass_fail_changed', 'spec_changed')
      or jsonb_typeof(event->'changes') is distinct from 'object' then
      raise exception 'a save records only pass_fail_changed and spec_changed events, each with its changes' using errcode = '22023';
    end if;
    if pg_column_size(event->'changes') > 8192 then
      raise exception 'an event records at most 8 kB of changes' using errcode = '22023';
    end if;
  end loop;

  saved := public.save_inspection(
    save_inspection_with_events.inspection_id,
    save_inspection_with_events.actor_id,
    save_inspection_with_events.base_updated_at,
    save_inspection_with_events.data,
    coalesce(save_inspection_with_events.mirrored_columns, '{}')
  );
  if saved is null then
    return null;
  end if;

  insert into public.audit_log (inspection_id, actor_id, action, changes)
  select save_inspection_with_events.inspection_id,
         save_inspection_with_events.actor_id,
         e.value->>'action',
         e.value->'changes'
    from jsonb_array_elements(coalesce(save_inspection_with_events.events, '[]')) with ordinality as e(value, position)
   order by e.position;
  return saved;
end;
$$;

-- The secret key only: signed-in users and anon get nothing (Supabase grants
-- EXECUTE on new functions to both by default).
revoke all on function public.save_inspection_with_events(uuid, uuid, timestamptz, jsonb, jsonb, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_inspection_with_events(uuid, uuid, timestamptz, jsonb, jsonb, jsonb)
to service_role;

-- PostgREST reads the new function at once.
notify pgrst, 'reload schema';
