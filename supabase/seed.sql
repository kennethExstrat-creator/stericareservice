-- Reference data (BUILD_SPEC 11). Safe for production and safe to run again:
-- every insert skips rows that already exist. No users here: local test users
-- are created through the Auth admin API (docs/DATABASE.md). Templates arrive
-- in Phase 2. Fixed ids let later seeds refer to these rows.

-- Manufacturers: names and factory addresses as printed on the example reports.
insert into public.manufacturers (id, name, factory_name, address, country)
values
  ('10000000-0000-4000-8000-000000000001', 'Hartalega NGC', null,
    'No. 1, Persiaran Tanjung, Kawasan Perindustrian Tanjung, 43900 Sepang, Selangor',
    'Malaysia'),
  ('10000000-0000-4000-8000-000000000002', 'Terang Nusa Sdn. Bhd.', 'TG Factory 40',
    'Lot 67330, Lorong Bougainvillae/KU8, Kawasan Perindustrian Meru Timur, 41050 Klang, Selangor',
    'Malaysia')
on conflict do nothing;

-- The client of SAFEDON_EG: its report carries the Polyco Healthline logo.
insert into public.clients (id, name, notes)
values
  ('20000000-0000-4000-8000-000000000001', 'Polyco Healthline',
    'Client to confirm, BUILD_SPEC section 13')
on conflict do nothing;

-- One master list of defects. Templates map their own labels to these codes
-- and set the severity; the description lists the labels each code maps from.
insert into public.defect_codes (code, name, description)
values
  -- Watertight test: hole locations.
  ('hole_crotch', 'Hole between fingers (crotch)',
    'Watertight test. Report labels: "Between fingers (crotch)" (STD_EG), "Between fingers" (SAFEDON_EG).'),
  ('hole_palm', 'Hole in palm',
    'Watertight test. Report label: "Palm" (STD_EG, SAFEDON_EG).'),
  ('hole_finger', 'Hole in finger',
    'Watertight test. Report label: "Finger" (STD_EG, SAFEDON_EG).'),
  ('hole_cuff', 'Hole in cuff',
    'Watertight test. Report label: "Cuff" (STD_EG, SAFEDON_EG).'),
  ('hole_other', 'Hole, other location',
    'Watertight test. Report label: "Other" (STD_EG, SAFEDON_EG).'),
  ('glove_burst', 'Glove burst',
    'Watertight test. Report label: "Glove burst" (SAFEDON_EG).'),

  -- Visual inspection.
  ('embedded_insect', 'Embedded insect',
    'Visual, critical in both reports. Report label: "Embedded insects" (printed "Embeded Insects").'),
  ('embedded_metal', 'Embedded metal debris',
    'Visual, critical in both reports. Report label: "Embedded metal debris" (printed "Embeded metal debris").'),
  ('thin_crotch_ring', 'Thin ring between fingers (crotch)',
    'Visual. Report labels: "Ring-shaped thin area (crotch)" (STD_EG), "Thin ring between fingers (crotch)" (SAFEDON_EG).'),
  ('thin_crotch_area', 'Thin area between fingers (crotch)',
    'Visual. Report label: "Thin area between fingers (crotch)" (STD_EG, SAFEDON_EG).'),
  ('thin_body_area', 'Thin area on glove body',
    'Visual. Report labels: "Thin area on glove body" (STD_EG), "Thin patch / area (body)" (SAFEDON_EG, printed "Thin batch / area (body)").'),
  ('thin_spot', 'Thin spot on glove body',
    'Visual. Report labels: "Thin spot on glove body" (STD_EG), "Thin spot" (SAFEDON_EG).'),
  ('dirt_nonremovable', 'Non-removable dirt',
    'Visual. Report label: "Non-removable dirt" (STD_EG, SAFEDON_EG).'),
  ('stain', 'Stain',
    'Visual. Report labels: "Oil stain" (STD_EG), "Stain" (SAFEDON_EG).'),
  ('foreign_matter', 'Residue or foreign matter',
    'Visual. Report label: "Residue material / foreign matter" (STD_EG).'),
  ('powder_mark', 'Powder mark',
    'Visual. Report label: "Powder mark" (SAFEDON_EG).'),
  ('bead_blister', 'Bead blister',
    'Visual. Report label: "Bead blister" (SAFEDON_EG).'),
  ('bead_defective', 'Defective bead',
    'Visual. Report labels: "Defective bead" (STD_EG, major), "Defective beads" (STD_EG, minor). The template sets the severity.'),
  ('lump_big', 'Big lump (over 2 mm)',
    'Visual. Report label: "Big Lumps (>2mm)" (STD_EG).'),
  ('lump_small', 'Lump (under 2 mm)',
    'Visual. Report label: "Lumps (<2mm)" (STD_EG, SAFEDON_EG).'),
  ('dirt_small', 'Small dirt or stain',
    'Visual. Report label: "Small dirt / stain" (STD_EG, SAFEDON_EG).'),
  ('sticky_pleats', 'Sticky pleats (under 5 mm)',
    'Visual. Report label: "Sticky pleats (< 5mm)" (STD_EG, SAFEDON_EG).'),
  ('bead_thin', 'Thin bead',
    'Visual. Report label: "Thin bead" (SAFEDON_EG).'),
  ('bead_small_defect', 'Thin bead or small beading defect',
    'Visual. Report label: "Thin bead / small beading defect" (SAFEDON_EG).'),
  ('bead_poor', 'Poor beading',
    'Visual. Report label: "Poor beading" (STD_EG).'),
  ('bead_rolled', 'Rolled bead',
    'Visual. Report label: "Rolled bead" (STD_EG).'),
  -- Printed on neither report: inspectors write them on the onsite forms (SKV,
  -- FM), and they have codes of their own (Kenneth, 12 October 2026).
  ('skin_visual', 'Skin visual defect',
    'Visual. Label: "Skin Visual" (STD_EG, SAFEDON_EG, major): a visual defect of the glove skin, written SKV on the onsite forms. Not printed on the reports.'),
  ('flow_mark', 'Flow mark',
    'Visual. Label: "Flow Mark" (STD_EG, SAFEDON_EG, major), written FM on the onsite forms. Not printed on the reports.'),

  -- Safedon dispensing check (SAFEDON_EG report and Safedon EG onsite form).
  ('no_cuff', 'No cuff',
    'Safedon dispensing. Label: "No cuff". Cuff should ideally be at least 2 cm out.'),
  ('finger_out', 'Finger out',
    'Safedon dispensing. Label: "Finger out". Only the cuff, not a finger, should come out first.'),
  ('multiple_out', 'Multiple gloves out',
    'Safedon dispensing. Label: "Multiple gloves out". Only one glove should come out at a time.'),
  ('stuck', 'Glove stuck',
    'Safedon dispensing. Label: "Glove stuck". Glove could not be dispensed or was very difficult to dispense.'),
  ('sticky', 'Sticky glove',
    'Safedon dispensing. Label: "Sticky glove". Two or more gloves out at once because they stick together.'),
  ('faulty_cuff', 'Faulty cuff',
    'Safedon dispensing. Label: "Faulty cuff". Deformed or misshapen cuff causing a dispensing problem.')
on conflict (code) do nothing;
