-- Defect marks on a photo (Kenneth, 27 October 2026: "in the preview of the
-- photos, add in tools to mark defect (red circle), with the red circle being
-- able to drag, inrease and decrease size. Once a defect marker is added, the
-- photo is auto sort to defect category."). The red circles an inspector
-- draws on a Media photo's preview on Source Documents are kept with the
-- photo, carried by the export (photos[].markers) and drawn on the report's
-- photos (docs/AI.md, "Auto-Sort (Media)"; lib/schemas/photo-markers.ts).
--
-- inspection_photos.markers: a JSON array of at most 20 circles, each
-- {"x": …, "y": …, "r": …} and nothing else: x and y the centre as a fraction
-- of the image's width and height (0 to 1), r the radius as a fraction of the
-- image's shorter side (0 to 1). [] for a photo with none, which is every
-- photo there before this.
--
-- Who writes it: whoever may change the photo, by the rules already there
-- (inspection_photos_update and the media guard): the inspector while the
-- inspection is a draft or reopened, admins until it is approved; the photos
-- of an approved inspection stay read-only but for the report choice, the
-- marks included. No guard changes here. The Server Action savePhotoMarkers
-- writes the marks through the user's own session, and the photo's width
-- and height with them where the row has none (the preview's natural size).
--
-- photo_markers_valid(): the shape, for the check; immutable, called as
-- whoever writes the row, so authenticated and service_role may execute it.
--
-- Idempotent: running it again changes nothing.

create or replace function public.photo_markers_valid(markers jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  marker jsonb;
  part text;
begin
  -- One test per IF: SQL does not promise to evaluate OR left to right, and
  -- the length of anything but an array, or the keys of anything but an
  -- object, would raise instead of failing the check.
  if markers is null or jsonb_typeof(markers) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(markers) > 20 then
    return false;
  end if;
  for marker in select value from jsonb_array_elements(markers) loop
    if jsonb_typeof(marker) <> 'object' then
      return false;
    end if;
    -- x, y and r, and nothing else.
    if (select count(*) from jsonb_object_keys(marker)) <> 3 then
      return false;
    end if;
    foreach part in array array['x', 'y', 'r'] loop
      if jsonb_typeof(marker -> part) is distinct from 'number' then
        return false;
      end if;
      if (marker ->> part)::numeric < 0 or (marker ->> part)::numeric > 1 then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

comment on function public.photo_markers_valid(jsonb) is
  'True for a JSON array of at most 20 defect marks, each {x, y, r} with every value a number from 0 to 1. Checks inspection_photos.markers.';

-- Called by the check as whoever writes the row.
revoke execute on function public.photo_markers_valid(jsonb) from public, anon;
grant execute on function public.photo_markers_valid(jsonb) to authenticated, service_role;

alter table public.inspection_photos
  add column if not exists markers jsonb not null default '[]'::jsonb;

alter table public.inspection_photos drop constraint if exists inspection_photos_markers_shape;
alter table public.inspection_photos
  add constraint inspection_photos_markers_shape check (public.photo_markers_valid(markers));

comment on column public.inspection_photos.markers is
  'Defect marks drawn on the photo: an array of at most 20 {x, y, r}, x and y the centre as fractions of the width and height, r the radius as a fraction of the shorter side (lib/schemas/photo-markers.ts).';
