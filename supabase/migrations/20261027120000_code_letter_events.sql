-- A Sampling Plan code letter changed is audit logged with its save (Kenneth,
-- 27 October 2026). Auto Calculate fills each size's Code Letter with the
-- lot's ISO 2859-1 letter; the inspector may reduce it, with a reason, and
-- raise it back up to the calculated letter. Asked whether reducing should be
-- audit logged: "yes, reducing code letter go to Audit Log".
--
-- public.save_inspection_with_events() (migration 20261026130000) as it was,
-- taking code_letter_changed besides pass_fail_changed and spec_changed:
-- saveCaptureData works it out from the stored and the saved
-- sampling_plan.sizes[*].codeLetter (lib/inspections/capture/sampling-events.ts).
-- Same signature, same checks, same grants. Until this runs, the function
-- refuses a save with such an event (22023, "a save records only ...",
-- nothing written), and the app saves the data with save_inspection() and
-- records the rows right after it with log_inspection_event()
-- (lib/offline/supabase-transport.ts, refusedEventAction).
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
      or coalesce(event->>'action', '') not in ('pass_fail_changed', 'spec_changed', 'code_letter_changed')
      or jsonb_typeof(event->'changes') is distinct from 'object' then
      raise exception 'a save records only pass_fail_changed, spec_changed and code_letter_changed events, each with its changes'
        using errcode = '22023';
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

-- PostgREST reads the new definition at once.
notify pgrst, 'reload schema';
