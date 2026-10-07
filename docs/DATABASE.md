# Database

Supabase Postgres 17 with Auth, Storage and row level security (BUILD_SPEC 3, 4.2, 5, 8.1, 9 and 11).

| Path | What |
|---|---|
| `supabase/migrations/` | The schema, in migrations applied in filename order |
| `supabase/seed.sql` | Reference data: manufacturers, the SAFEDON_EG client, defect codes. No users, safe to rerun |
| `lib/supabase/database.types.ts` | Generated types (`Database`, `Tables<>`, `TablesInsert<>`, `TablesUpdate<>`, `Enums<>`, `Constants`) |
| `tests/db/` | RLS and rule tests that run the migrations in PGlite, no Docker needed |

## Migrations

| File | Contents |
|---|---|
| `20261006000100_enums_and_helpers.sql` | Enum types; pure helpers: `set_updated_at()`, `forbid_changes()`, `storage_folder_uuid()`, `storage_inspection_id()`, `inspection_ref()` |
| `20261006000200_tables.sql` | The eleven tables, sequence, indexes, timestamp triggers, locked columns |
| `20261006000300_access_and_guards.sql` | Caller helpers, auth.users to profiles sync, guard triggers, audit trail, `log_inspection_event()` |
| `20261006000400_rls_and_grants.sql` | RLS on every table, explicit grants, policies |
| `20261006000500_storage.sql` | The five private buckets and their policies |
| `20261006000600_new_accounts_inactive.sql` | New accounts start inactive: `handle_new_auth_user()` inserts `active = false`, the column default is `false`, and inspector profiles that existed before become inactive |
| `20261006000700_review_fixes.sql` | Fixes from the review: the insert guard draws `ref_no`; an inspection's id never changes and a deleted inspection's id is never reused; `delete_test_inspection()` for end-to-end teardown. It also restates, unchanged, the rules that went into 100 to 500 after the first push (strict storage object names, read-only evidence of approved inspections, the service role's limits) |
| `20261006175715_ai_reviews_one_pending_per_version.sql` | One pending AI second opinion per inspection version at a time: closes pending duplicates from before it (keeping the oldest), then the partial unique index `ai_reviews_one_pending_per_version` on `(inspection_id, inspection_updated_at)` where `status = 'pending'`. Two requests at the same moment both pass the app's own check; the database refuses the second row (23505), which `startAiReview` (`lib/inspections/ai/review-runner.ts`) answers as "A second opinion of this version is being written." Done and failed reviews are not limited. Applied live on 7 October 2026 |
| `20261007113245_ai_reviews_inspection_fingerprint.sql` | AI reviews keyed to the inspection's content (see `ai_reviews` below): the column `ai_reviews.inspection_fingerprint` (lowercase hex SHA-256, locked once stored), `ai_reviews_one_pending_per_content` on `(inspection_id, inspection_fingerprint)` for pending rows with a fingerprint, and `ai_reviews_one_pending_per_version` narrowed to pending rows without one. Idempotent. Until a project has run it, the app stores reviews without the column and compares them by save |
| `20261007151500_delete_draft_inspection.sql` | The inspections list's Delete: `delete_draft_inspection(inspection_id)` deletes a draft that was never submitted, the caller's own or, for an admin, anyone's, with its photos, files and AI reviews, and answers the Storage object names for the app to remove; `audit_inspection()` restated so that the record of such a deletion keeps what went with it (see [Audit log](#audit-log)). Idempotent. Applied live on 7 October 2026 |
| `20261007170000_lead_inspectors.sql` | Lead inspectors and their teams (see [Lead inspectors and teams](#lead-inspectors-and-teams)): `profiles.is_lead` and `profiles.lead_id`, the check constraints and the `org_guard` trigger for the team rules, `profiles_guard()` restated with the lead rules, the helpers `is_lead()`, `my_team()`, `leads()`, `leads_inspection()` and `leads_ai_review()`, `my_profile_status()` with `is_lead` and `lead_id` (dropped and created again: its result changes), and read-only SELECT policies for leads on their team's inspections, photos, files, AI reviews and decisions, audit rows, Storage objects and profiles. Idempotent. Applied live on 7 October 2026 |
| `20261007190000_inspector_writes_through_the_app.sql` | Inspectors write through the app (final audit SEC-02, SEC-03 and M3; see [Inspectors write through the app](#inspectors-write-through-the-app)): `inspections_insert` and the check of `inspections_update` become admin-only, `inspections_guard()` restated with a last rule that refuses a signed-in non-admin's insert or update (`42501`), the service-role-only functions `create_inspection()`, `save_inspection()` and `submit_inspection()` the Server Actions call with the secret key, and `log_inspection_event()` restated so an inspector records only `photo.deleted`, `file.deleted` and `started_from_previous`, on their own draft or reopened inspection, with at most 8 kB of changes. Idempotent. Apply it together with the app that calls the functions (`lib/inspections/writes.ts`). Applied live on 7 October 2026 |
| `20261007191137_inspection_search_columns.sql` | The list's search by carton number and by lot number in any case (BUILD_SPEC 10; see [Search columns](#search-columns)): the columns `inspections.carton_numbers` and `inspections.lot_numbers_upper` with GIN indexes, the helpers `inspection_carton_numbers(jsonb)` and `upper_lot_numbers(text[])`, and the trigger `search_columns` that sets both from the row on every insert and every update of the data or the lots. The inspections already there get their values without a save (`updated_at` stays). Idempotent. Until a project has it, the list searches refs, POs, and lots as typed or in capitals (`lib/inspections/query.ts`). Applied live on 7 October 2026 |
| `20261007193000_admins_delete_drafts_only.sql` | Admins delete drafts only, in the database too (final audit, data D1; see [Who can do what](#who-can-do-what)): drops the policy `inspections_delete`, so no signed-in user deletes an inspection directly (a delete through the Data API matches no row, without an error) and `delete_draft_inspection()` is their only delete. The service role keeps its maintenance deletes, and end-to-end teardown `delete_test_inspection()`. Idempotent. The app never deletes an inspection directly, so it can be applied at any time. Applied live on 7 October 2026 |

Applied migrations never change: `supabase db push` skips every migration a project has already run, so a change to the schema goes in a new file. Every statement in 700 is idempotent, and 700 gives the same schema whichever text of 100 to 500 a project ran. It re-adds three check constraints (signature paths, audit rows without an inspection, the `ref_no` format), so it stops, changing nothing, if an existing row breaks one of them.

## Tables

Every table has `created_at` and `updated_at`. One trigger, `set_updated_at()`, sets both; callers cannot backdate either. Primary keys are `uuid` (`gen_random_uuid()`), except `defect_codes` (`code`) and `audit_log` (bigint identity).

| Table | Notes |
|---|---|
| `profiles` | One per auth user (`id` = `auth.users.id`), created by a trigger as an inactive inspector (see [New accounts](#new-accounts)). **Addition to BUILD_SPEC 5: `email`**, copied from `auth.users` and kept in sync by trigger, so admin lists need no Auth API call. `full_name` comes from the invite metadata; empty names are stored as null. `signature_path` must be inside the user's own folder (`<user_id>/...`). **Additions for lead inspectors: `is_lead`** (a lead inspector, `false` by default) **and `lead_id`** (the lead inspector who manages this inspector, null by default; restricted on delete), see [Lead inspectors and teams](#lead-inspectors-and-teams). |
| `manufacturers` | One row per factory: unique on name plus factory name, ignoring case. |
| `clients` | Unique name, ignoring case. `logo_path` points into `client-logos`. |
| `defect_codes` | Canonical codes (`^[a-z][a-z0-9_]*$`). A code never changes once created (templates and inspection data refer to it by value); deactivate instead. Severity lives in the template. |
| `templates` | Unique `(code, version)`; at most one `active` version per code. Codes are `^[A-Z][A-Z0-9_]*$` (`STD_EG`). Frozen once used, see below. |
| `inspections` | `ref_no` (assigned on insert, see [Reference numbers](#reference-numbers)), `inspector_id` (defaults to the caller), `status` (`draft`), `data` (`{"modules": {}, "custom": {}}`), `module_overrides` (`{}`, keyed by module: `{ reason, by, at }`), `lot_numbers` (`{}`) and `inspection_date` (today in Malaysia) all have defaults. `report_url` must be `http(s)://`. The `id` never changes, and the id of a deleted inspection is never used again. **Additions for the list's search: `carton_numbers` and `lot_numbers_upper`**, which a trigger keeps from the data and the lots (see [Search columns](#search-columns)). |
| `inspection_photos` | `storage_path` and `thumb_path` are object names in `inspection-photos`, and must sit in the inspection's folder. `created_by` is always the uploader. |
| `inspection_files` | Lab reports and certificates in `inspection-files`, same folder rule. |
| `ai_reviews` | One per request for a second opinion, keyed to the version of the inspection it reviewed: its content (`inspection_fingerprint`, a SHA-256 of the data, module overrides, result, remarks, template version and files, from `inspectionFingerprint()` in `lib/inspections/ai/fingerprint.ts`; null for reviews stored before migration `20261007113245`) and the save it was read at (`inspection_updated_at`). Approving, reopening or storing the report link saves the inspection but leaves its content, so the review stays current; a review without a fingerprint compares by save. `inspection_id`, `inspection_updated_at` and `inspection_fingerprint` never change. At most one `pending` review per inspection and version: `ai_reviews_one_pending_per_content`, and `ai_reviews_one_pending_per_version` for rows without a fingerprint. `confidence` is 0 to 1. `findings` and `questions` are JSON arrays. |
| `ai_review_actions` | An admin's `agree`, `disagree` (a note is required) or `fixed` on one finding, always in their own name. |
| `audit_log` | Append-only. Written by triggers and `log_inspection_event()`; signed-in users cannot insert directly, the service role can only read and add rows, and no role can change a row. |

On delete: `profiles` follow their auth user (cascade). Everything that points at a profile, a template, a client or a manufacturer is restricted, so records are never lost by deleting a person or a reference row: deactivate users instead. An inspection's photos, files, AI reviews and audit rows are deleted with it, and a `deleted` audit row records the deletion.

## Who can do what

All policies are for the `authenticated` role, and every one requires an active profile. `anon` has no privileges on any table or function.

| | Inspector | Lead inspector | Admin |
|---|---|---|---|
| Profiles | Read own; change `full_name` and `signature_path` | As an inspector, and read their team's profiles | Read all; change anyone's `role`, `active`, `is_lead`, `lead_id`, `full_name` |
| Manufacturers, clients, defect codes, templates | Read | Read | Read and write |
| Inspections | Read own. Create own drafts, save them while `draft` or `reopened`, and submit them, only through the app ([Inspectors write through the app](#inspectors-write-through-the-app)): no insert or update with their own session (`42501`). Delete own drafts that were never submitted, only through `delete_draft_inspection()` (the list's Delete) | As an inspector for their own; read their team's, every status, and change none of them | Read, create and edit all; approve, reopen, switch modules off, set `report_url`. Delete anyone's drafts that were never submitted, only through `delete_draft_inspection()` (the list's Delete): a delete with their own session matches no row, a draft's included (migration `20261007193000`) |
| Photos and files | Read those of own inspections; add, change, remove while the inspection is editable | As an inspector for their own; read their team's | Read all. On any inspection that is not approved: add, change, remove, and choose report photos (`include_in_report`). On an approved one: only `include_in_report` |
| AI reviews | Read those of own inspections | Read those of own and their team's inspections | Read and write |
| AI review actions | Nothing | Read those on their team's inspections | Read and write, in their own name |
| Audit log | Read rows of own inspections | Read rows of own and their team's inspections | Read all |
| `log_inspection_event()` | `photo.deleted`, `file.deleted` and `started_from_previous`, on own inspections while `draft` or `reopened`, at most 8 kB of changes | As an inspector, on own inspections (not their team's) | Any event, on any inspection |

A lead inspector is an inspector (`role = 'inspector'`) with `is_lead`; their team is everyone whose `lead_id` is theirs now. Inactive users (`profiles.active = false`: new accounts nobody has activated yet, and deactivated users), admins and leads included, read and write nothing. `my_profile_status()` is their only window: it returns their `active` flag, `role`, `is_lead` and `lead_id` so the app can explain the block.

Rules RLS cannot express are enforced by triggers, for every role:

- Nobody changes `profiles.id`, `inspections.id`, `ref_no`, `inspector_id` or `template_id` (an inspection keeps its template version), a photo's or file's inspection or uploader, or an audit row.
- A signed-in user who is not an admin never inserts or updates an inspection (`42501`): the app writes an inspector's inspection with the secret key, once its own checks have passed ([Inspectors write through the app](#inspectors-write-through-the-app)).
- The photos and files of an approved inspection are read-only, except `include_in_report`.
- The id of a deleted inspection is never used again (`23505`): Storage may still hold files in its folders, and the storage policies trust the folder id.
- `inspections.carton_numbers` and `lot_numbers_upper` always match the row's data and lots: the trigger `search_columns` sets them whenever either is written and replaces whatever a caller sends ([Search columns](#search-columns)).
- `profiles.email` only changes through Supabase Auth; the sync trigger copies it. Only admins change `role`, `active`, `is_lead` and `lead_id`; only the user changes their signature.
- The last active admin cannot be demoted, deactivated or deleted, whoever asks (the SQL editor included).
- The team rules in [Lead inspectors and teams](#lead-inspectors-and-teams).
- `submitted_at`, `approved_by` and `approved_at` are set by the database, never by callers.
- Only admins set `report_url`, switch modules off (`module_overrides`, BUILD_SPEC 4.4) or pick report photos.
- Once an inspection uses a template version, its `code`, `version`, `extends_code`, scope (`product_type`, `standard`, `client_id`, `manufacturer_id`), `definition` and `resolved` are frozen. Its status can still change, except back to `draft`. Edits go into a new version. Inspectors can only start from an `active` template, so they cannot freeze an admin's draft.

### Lead inspectors and teams

Kenneth, 7 October 2026: an inspector is either an inspector or a lead inspector; every inspector is managed by a lead inspector, who sees all of their team's inspections, ongoing or done. Migration `20261007170000` keeps the two roles (`inspector`, `admin`) and adds `profiles.is_lead` and `profiles.lead_id`. The app's half of the rules, in plain words, is `lib/auth/org.ts`; change both together.

| Rule | Where | Who it binds |
|---|---|---|
| 1. Admins are neither lead inspectors nor in a team | check `profiles_admin_outside_teams`, trigger `org_guard` | Everyone |
| 2. A lead inspector has no lead of their own | check `profiles_lead_has_no_lead`, trigger `org_guard` | Everyone |
| 3. Nobody is their own lead | check `profiles_lead_not_self`, trigger `org_guard` | Everyone |
| 4. A `lead_id` names an active lead inspector, from the moment it is set | trigger `org_guard` | Everyone |
| 5. Someone who leads a team stays an active lead inspector: demoting them, making them an admin or deactivating them is refused while anyone (active or not) has their `lead_id`; deleting them is refused by the foreign key | trigger `org_guard`, foreign key (restrict) | Everyone |
| 6. An active inspector who is not a lead has a lead: checked whenever an admin changes someone's role, level, lead or activation | trigger `guard` (`profiles_guard()`) | Signed-in users |
| 7. Only admins change `is_lead` and `lead_id` | trigger `guard` | Signed-in users |

All are `23514` (rule 7: `42501`), with these messages, which the Users screen turns into plain words (`describeProfileError()` in `lib/auth/users.ts`): `nobody is their own lead inspector`, `an admin is not a lead inspector and is in no team`, `a lead inspector has no lead inspector of their own`, `the lead inspector must be an active lead inspector`, `this lead inspector still leads N inspector(s): assign them to another lead inspector first`, `an active inspector needs a lead inspector`.

- **Existing rows stay as they are.** The triggers look at a row only when who leads whom changes (`role`, `active`, `is_lead` or `lead_id`), so an inspector from before teams (such as `inspector@test.local`) still signs in, renames themselves and signs, and an admin can still deactivate them. The Users screen lists every active inspector in no team as "No lead inspector" until an admin chooses one.
- **Rule 6 binds signed-in admins only**, like the other admin-only rules: the service role and the database owner may leave an inspector without a lead for now (the e2e helpers that activate throwaway inspectors, `seed:dev-users`, repairs). Rules 1 to 5 bind every role, like the last-admin rule.
- **Concurrency.** Setting a `lead_id` locks the lead's row (`for share`) until the end of the transaction, and rule 5 runs once the lead's own row is locked: a demotion waits for an assignment in flight and then counts the new member; an assignment that comes second sees the demotion and refuses. PGlite has one connection, so this is not exercised by the tests.
- **Visibility.** `my_team()` returns the ids of the inspectors the caller leads now (empty unless they are an active lead inspector); the read policies `*_select_team` use it: `inspections_select_team`, `inspection_photos_select_team`, `inspection_files_select_team`, `ai_reviews_select_team`, `ai_review_actions_select_team`, `audit_log_select_team` (deletion records stay admin-only), `profiles_select_team`, and `inspection_media_select_team` on `storage.objects` (signed URLs for photos and lab reports work for leads). They are SELECT policies beside the existing ones, so admins and inspectors keep exactly what they had and a lead gets no insert, update or delete on their team's rows; `log_inspection_event()` still asks `can_read_inspection()` (owner or admin). A team member moved to another lead leaves the old lead's view at once; a deactivated team member's inspections stay visible to their lead; a deactivated lead sees nothing.
- **Helpers** (security definer, `search_path` pinned, callable by signed-in users because the policies call them): `is_lead()`, `my_team()`, `leads(inspector)`, `leads_inspection(inspection_id)`, `leads_ai_review(ai_review_id)`. They only answer about the caller's own team.

### New accounts

Every new auth user gets an inactive inspector profile (migration 600), whatever created it: an admin's invite, the dashboard's Add user, or a public sign-up if that is ever switched on (BUILD_SPEC 3: no public sign-up). The role never comes from user metadata, which users can edit. The invite action activates the account it creates, with the secret key; an admin activates any other account; Kenneth activates himself with the [first-admin line](#first-admin).

### Inspectors write through the app

The app's checks run in its Server Actions only: the zod schemas, each module's validation, "errors block submit" (BUILD_SPEC 6.2), the columns computed from the data, the template the app chooses. So an inspector's own session may not write an inspection at all (final audit, 7 October 2026: before migration `20261007190000`, an inspector with their session token and the publishable key could save data no module accepts, write their own results, PO and lots, move the inspection to another client or manufacturer, and submit with errors). Once a Server Action has checked the session and the input, it writes with the secret key, for the signed-in user (`lib/inspections/writes.ts`, `lib/offline/supabase-transport.ts`):

| Function | Called by | Answers |
|---|---|---|
| `create_inspection(actor_id, template_id, manufacturer_id, client_id, data, mirrored_columns)` | `createInspection` | The new draft's id; its inspector is the actor |
| `save_inspection(inspection_id, actor_id, base_updated_at, data, mirrored_columns)` | `saveCaptureData` (autosave) | The new `updated_at`, or null when nothing was written: gone, not the actor's, not `draft` or `reopened`, or no longer at `base_updated_at`. The app then reads the row with the user's session to say which |
| `submit_inspection(inspection_id, actor_id, base_updated_at, mirrored_columns)` | `submitInspection` | The new `updated_at`, or null when it is gone or no longer at `base_updated_at`. `42501` for someone who is neither its inspector nor an admin, `23514` for anything but a draft or reopened inspection |

- Only the service role may call them (and the database owner); they are security invoker and also refuse `authenticated` and `anon` themselves.
- They check what the database knows, as the guard does for a signed-in user: the actor's profile is active (`42501` "the account is not active"); saving and submitting, the actor is the inspection's inspector or an admin and it is a draft or reopened; creating, an inspector starts from an active template (`23514`), an admin from any.
- `mirrored_columns` holds only the columns that repeat the data (`lib/inspections/capture/mirror.ts`): `po_no`, `product_name`, `lot_numbers`, `inspection_date`, `remarks`, `result`, `suggested_result` (`22023` for anything else). A key left out keeps its value; on create, the column default. The client, manufacturer, template, status, module overrides and `report_url` never change this way.
- Saving and submitting are a compare-and-set on `updated_at` under a row lock, as the autosave expects (docs/OFFLINE.md).
- The write is made as the actor: while it runs, `auth.uid()` answers `actor_id` (the claims get their id as `sub`; the role stays `service_role`), so the audit trail reads "Created" and "Submitted" by the inspector, as before. The claims are put back before the function returns.
- Admins keep their direct writes with their own session: approve, reopen, module overrides, `report_url`, the defect label mapping (`lib/admin/defects.ts`).
- Without the secret key, or on a project that has not run the migration (PostgREST answers `PGRST202`), the app writes with the user's own session as before: an admin's write goes through, an inspector's is refused once the migration has run.

### Status flow

```
draft ──submit──▶ submitted ──approve──▶ approved (read-only except report_url)
                     │  ▲
                reopen  submit
                     ▼  │
                   reopened
```

| Change | Who | Set automatically |
|---|---|---|
| `draft` to `submitted`, `reopened` to `submitted` | The inspector who owns it, through the app (`submit_inspection()`), or an admin | `submitted_at` |
| `submitted` to `approved` | Admin | `approved_by`, `approved_at` |
| `submitted` to `reopened` | Admin | |

Every other change of status is rejected. New inspections always start as `draft`. Signed-in users, admins included, delete only a draft that was never submitted, through `delete_draft_inspection()`. Submitted and reopened inspections are deleted only for maintenance, with the secret key or as the database owner. An approved inspection cannot be deleted through the API, the service role included, so its audit history stays. Only the database owner can delete one (below), and end-to-end tests remove those of test accounts through [`delete_test_inspection()`](#end-to-end-test-cleanup).

### Service role and the database owner

The guards check end users, who reach the database as `authenticated` or `anon`. Every other role acts with admin rights but stays bound by the status flow, the locked columns, the last-admin rule and the read-only photos and files of approved inspections:

- `service_role` (the secret key, server code only): bypasses RLS like an admin, follows the status flow, and is recorded with `actor_id` null and `approved_by` null, except through `create_inspection()` and `submit_inspection()`, which record the user the app acts for. It reads and adds audit rows but cannot change or delete them, and it cannot delete an approved inspection. For maintenance it deletes drafts, submitted and reopened inspections directly, which no signed-in user may; the app never does. It cannot call `delete_draft_inspection()`, which needs a signed-in user. It alone calls the write functions of [Inspectors write through the app](#inspectors-write-through-the-app).
- `postgres` (migrations, the SQL editor): the same, except that it owns the tables and may delete an approved inspection, deliberately. To repair data outside the rules, disable the table's `guard` or `lock_columns` trigger inside a transaction (`alter table public.inspections disable trigger guard`), fix, re-enable it, commit. `ref_no` must still have the `INS-<year>-<number>` form.

### End-to-end test cleanup

End-to-end tests run against a shared project and delete what they create (`e2e/README.md`), approved inspections included. They call `delete_test_inspection(inspection_id)` with the secret key (`supabase.rpc("delete_test_inspection", { inspection_id })`). Only the service role may call it, and it only deletes the inspections of test accounts: an inspector whose email ends in `@test.local`, which no real mailbox can have. Anything else raises `42501`; an id that does not exist returns `false`. The inspection's photos, files, AI reviews and audit rows go with it, and a `deleted` audit row with no actor records the deletion. Remove its Storage files through the Storage API first. Once a throwaway account's inspections are gone, the account itself can be deleted, unless it deleted an inspection itself (the list's Delete): the record of that deletion names it as the actor and is never removed, so such an account can only be deactivated. Let `inspector@test.local` make those deletions.

### Audit log

A trigger records, for every inspection, `created` (ref_no, status, template, inspector), each `status_changed` (`{ from, to }`) and `deleted` (a row with `inspection_id` null that keeps the id, ref_no and status, visible to admins only). A deletion through `delete_draft_inspection()` (the list's Delete) also keeps the draft's `inspector_id`, `template_id`, `client_id`, `manufacturer_id`, `po_no`, `inspection_date`, the number of `photos` and `files`, and `via: "delete_draft_inspection"`. The actor is `auth.uid()`: null for the service role and the database owner, and the user the app acts for in `create_inspection()` and `submit_inspection()`.

Server actions record everything else with `log_inspection_event(inspection_id, action, changes)`, for example `module_override`, `ai_report.sent` or `ai_review.requested`. It returns the new row's id, names the caller as the actor, and refuses the three actions the trigger owns and a null `inspection_id` (`22004`). The service role records any event on any inspection, an admin any event on an inspection they can read. Anyone else (inspectors, lead inspectors included) records only what the app records for them, `photo.deleted`, `file.deleted` and `started_from_previous`, on their own inspection while it is a draft or reopened (`42501` otherwise), with at most 8 kB of changes (`22023`). Actions match `^[a-z][a-z0-9_.]*$`; `changes` is a JSON object.

### Reference numbers

`ref_no` is `INS-<year>-<number>`: the creation year in Malaysia (Asia/Kuala_Lumpur), then a sequence number padded to four digits that keeps growing past 9999 (`INS-2027-10000`). The insert guard draws the number from the sequence. The column default `''` is only a placeholder that lets callers leave `ref_no` out: an insert that supplies any other value is rejected, the service role included. A number freed by a deletion or a rollback is never handed out again. A check constraint keeps the format even when the guard is switched off for a repair.

### Search columns

The inspections list searches by ref, PO, lot or carton number (BUILD_SPEC 10; `listSearchFilter()` in `lib/inspections/query.ts`). Migration `20261007191137` adds two columns the database keeps from the row itself, so that the list finds a carton number, and a lot in any case:

| Column | Holds | Computed by |
|---|---|---|
| `carton_numbers` (`integer[]`) | Every carton number sampled in Finished Goods Sampling Information (`data.modules.carton_sampling`, every size): whole numbers from 1, each once, in order. Blank cells, and anything that is not a whole number from 1 up, are left out | `inspection_carton_numbers(jsonb)` |
| `lot_numbers_upper` (`text[]`) | `lot_numbers` in capitals, each once, in order. Lots are printed in capitals but stored as typed, and an iPad keyboard capitalises only the first letter (`Lt081315`) | `upper_lot_numbers(text[])` |

- The trigger `search_columns` (`inspections_search_columns()`) sets both on every insert, and on every update that writes `data`, `lot_numbers` or the two columns, from the row's own values. So they always match the data, whatever wrote it (autosave, submit, an admin's edit, a script), and no caller can set them to anything else. An update that writes none of those (a status change, the report link) leaves them as they are. It fires after `guard` and `lock_columns` (BEFORE triggers fire in name order), which compare an approved inspection with what the caller sent.
- Both are not null with default `{}`, and have GIN indexes (`inspections_carton_numbers_idx`, `inspections_lot_numbers_upper_idx`). The app only filters on them, in the list's search, and never writes them.
- The helpers are immutable, and `authenticated` and `service_role` may execute them: the trigger runs them as whoever writes the row.
- The inspections already there get their values when the migration runs, without a save: the columns are added as generated columns, which the table rewrite fills, then made plain. `updated_at` stays, so open drafts keep autosaving without a conflict, and approved inspections are untouched.
- Until a project has the migration, the list searches refs, POs, and lots as typed or in capitals (`inspectionSearchFilter()` in `lib/inspections/postgrest.ts`), and says so in the server log.

## Storage

All buckets are private. Show files through signed URLs. Paths below are object names inside the bucket, which is what the `*_path` columns store.

| Bucket | Object names | Limit | Types | Read | Write |
|---|---|---|---|---|---|
| `inspection-photos` | `<inspection_id>/<uuid>.jpg`, thumbnails `<inspection_id>/thumbs/<uuid>.jpg` | 25 MiB | JPEG, PNG, WebP, HEIC, HEIF | Whoever can read the inspection (the owner, their lead inspector, admins) | Admins; the owner while draft or reopened |
| `inspection-files` | `<inspection_id>/<uuid>.<ext>` | 50 MiB | PDF and the image types above | Whoever can read the inspection (the owner, their lead inspector, admins) | Admins; the owner while draft or reopened |
| `signatures` | `<user_id>/<file>` | 1 MiB | PNG, JPEG, WebP | The user; admins | The user only |
| `client-logos` | Free, e.g. `<client_id>.png` | 2 MiB | PNG, JPEG, WebP (no SVG: it can carry script) | Active users | Admins |
| `template-sources` | Free, e.g. `<code>/v<version>/<file>` | 50 MiB | PDF, Excel, Word, JPEG, PNG, WebP, HEIC, HEIF | Active users | Admins |

In `inspection-photos`, `inspection-files` and `signatures`, an object name must be `<lowercase uuid>/<segment>[/<segment>...]`: each segment made of ASCII letters, digits, `.`, `_` and `-`, and none of them `.` or `..` (`storage_folder_uuid()` parses it). supabase-js puts stored names into request URLs unencoded, where `..`, `%2e%2e`, a backslash or an empty segment would lead into another folder, so every other name is denied, admins included: an upload fails the policy and a stored one stays invisible, never with a cast error that breaks the query. The `storage_path`, `thumb_path` and `signature_path` columns follow the same rule (`23514`). The Storage API enforces size and type; the policies decide who.

The policies trust the folder id, and the database deletes rows, not Storage objects: that is why an inspection's id never changes and the id of a deleted inspection is never reused.

## Applying to the hosted project

```sh
npx supabase login
npx supabase link --project-ref <project-ref>   # Dashboard > Project Settings > General
npx supabase db push --dry-run                  # see what would run
npx supabase db push --include-seed             # migrations, then supabase/seed.sql
```

Later migrations: `npm run db:push` (that is, `supabase db push`). Add `--include-seed` again whenever the seed changes; it skips rows that already exist.

### First admin

Kenneth adds himself in the dashboard (Authentication > Users > Add user, auto-confirm). The trigger gives him an inactive inspector profile, like every new account; one line in the SQL editor makes him an active admin:

```sql
update public.profiles set role = 'admin', active = true where email = '<his email>';
```

An account created before the migrations ran gets the same inactive profile from the migrations, so the same line works. After that, admins invite everyone else from the app.

### Test users

`seed.sql` creates no users, so it is safe for production. The local test users of BUILD_SPEC 11 (`inspector@test.local`, `admin@test.local`) are created later by a script through the Auth admin API, which fires the same profile trigger; the script then sets each role and activates both.

## Regenerating types

```sh
npm run db:types   # supabase gen types typescript --linked --schema public
```

Supabase CLI 2.119 writes the file unformatted when `oxfmt` is not installed. To get the committed formatting (the typegen's own settings), format it with:

```sh
printf '{ "semi": false, "printWidth": 80 }' > /tmp/oxfmt-typegen.json
npx --yes oxfmt@0.72.0 -c /tmp/oxfmt-typegen.json lib/supabase/database.types.ts
```

When the CLI generates through the Management API instead of a direct connection, it may add an `__InternalSupabase` block with the PostgREST version. Keep it; supabase-js reads it.

## Tests

```sh
npx vitest run tests/db   # also part of npm test
```

How they work:

- [PGlite](https://pglite.dev) runs real Postgres compiled to WebAssembly inside the test process. Each test file builds a fresh database in about a second.
- `tests/db/supabase-shim.sql` first recreates what the migrations use from a hosted project, with Supabase's definitions: the `anon`, `authenticated` and `service_role` roles (not superusers; `service_role` has BYPASSRLS), `auth.users`, `auth.uid()`, `auth.role()`, `auth.jwt()` and `auth.email()` reading the request claims, `storage.buckets` and `storage.objects` with RLS on, `storage.foldername()`, `filename()` and `extension()`, and Supabase's default privileges on schema `public`.
- The migrations and the seed then run as `supabase_migrations`, a stand-in for Supabase's `postgres` role: not a superuser, BYPASSRLS, full access to `auth.users`, allowed to create policies on `storage.objects`. A migration that only works as a superuser fails here.
- `tests/db/harness.ts` runs SQL as a user, as `anon`, as `service_role` or as the owner, each in its own transaction, by setting `role` and `request.jwt.claims` the way PostgREST and the Storage API do at the start of every request. Auth users are inserted the way Supabase Auth inserts them, so the profile trigger fires as it would in production.
- `schema.test.ts` fails when a table lacks RLS or a policy, when `anon` can reach anything, when a foreign key lacks an index, when running 700 a second time on a project that has run up to it, or 151500, 170000, 190000 or 193000 a second time on top of all of them, would change any definition, when a policy lets a signed-in user delete an inspection, or when anyone but the service role can call the write functions. `shim.test.ts` pins the shim's own behaviour.
- `inspector-writes.test.ts` covers [Inspectors write through the app](#inspectors-write-through-the-app) and what an inspector may record with `log_inspection_event()`. The other suites create, save and submit an inspector's inspection the way the app does (`createInspection()`, `saveInspection()`, `submitInspection()` and `setStatus()` in `fixtures.ts`).
- `delete-draft-inspection.test.ts` covers the list's Delete, the only delete a signed-in user has; `rls-admin.test.ts` shows an admin's own delete removing nothing and the service role's maintenance delete.
- The [search columns](#search-columns) are tested the same way, with the conditions `listSearchFilter()` adds, in `lib/inspections/search-migration.test.ts`.

What the shim cannot prove:

- That the hosted `postgres` role may do what the migrations need (triggers on `auth.users`, policies on `storage.objects`, inserts into `storage.buckets`). Supabase supports all three today; `supabase db push --dry-run` and the first push are the real check.
- Anything outside Postgres: Storage API limits, signed URLs and its own checks; PostgREST's HTTP status codes and schema cache; Auth sign-in, invites, bans and token expiry.
- That Supabase's `auth` and `storage` schemas stay as modelled. The shim holds only the columns and functions the migrations use.
- Concurrency: PGlite has a single connection, so the lock that stops two admins demoting each other at once is not exercised.
- Version differences: PGlite 0.5.8 is Postgres 18.3; Supabase runs 17. The suite also passes on PGlite 0.3 (Postgres 17.5). One assertion accepts both codes that the two versions use for a restricted delete (`23503`, `23001`).

## Notes for app code

- Errors: `42501` means not allowed (RLS or a guard; PostgREST answers 403), `23514` means a rule or an invalid status change, `23505` a duplicate (or the id of a deleted inspection), `23503` or `23001` a row still in use.
- An inspector's inspection is created, saved and submitted with the secret key through `create_inspection()`, `save_inspection()` and `submit_inspection()`, after the Server Action's checks (`lib/inspections/writes.ts`, `lib/offline/supabase-transport.ts`), never with the inspector's own session (`42501`). Admins insert inspections without `ref_no`, `status`, `inspector_id` or the automatic timestamps, and approve or reopen with a plain update (`{ status: "approved" }`); the database checks the transition, sets the timestamps and writes the audit row.
- `my_profile_status()` returns an array; call it with `.maybeSingle()`. A new account that has not been activated answers `active: false`, exactly like a deactivated one. It also answers `is_lead` and `lead_id`; on a project without migration `20261007170000` those are missing, and `lib/auth/session.ts` reads that as not a lead.
- Lead inspectors: put someone in a team with `{ lead_id }`, make them a lead with `{ is_lead: true, lead_id: null }`, an admin with `{ role: 'admin', is_lead: false, lead_id: null }` (`placementFor()` in `lib/auth/org.ts`), in one update. Move a lead's team before demoting or deactivating them. To delete throwaway accounts, delete (or move) the team members before their lead.
- Screens that show other people's inspections (admins all, a lead their team's) can name the inspector through the `inspector:profiles!inspections_inspector_id_fkey(...)` embed: a lead reads their team's profiles. `seesTeamInspections(user)` in `lib/auth/org.ts` says when to show the column.
- The invite action calls `auth.admin.inviteUserByEmail()`, then sets `active = true` on the new profile with the secret key.
- Name objects `<id>/<uuid>.<ext>` (thumbnails `<id>/thumbs/<uuid>.jpg`) with a lowercase uuid, as `crypto.randomUUID()` returns; other names are denied.
- Delete an inspection as the signed-in user with `supabase.rpc("delete_draft_inspection", { inspection_id })` (`deleteDraftInspection()` in `lib/inspections/delete.ts`). `.from("inspections").delete()` with a user's own session matches no row, for admins too, and answers no error.
- Deleting an inspection deletes its photo and file rows but not the objects in Storage. `delete_draft_inspection()` answers their names, and the list's Delete removes them through the Storage API once the row is gone; teardown with the secret key removes them first. Leftovers stay out of every user's reach, because the id is never reused.
- Never send an inspection `id` in an update: it cannot change (`42501`).
- Deactivate users rather than delete them. Deleting an auth user who appears in any record (an inspection, a photo or file, an approval, an audit row, an AI decision, a template's coverage check) fails by design.
- To activate a new template version, retire the active one first: one active version per code.
- Inspectors cannot write `ai_reviews`. A review triggered by an inspector's submit is stored by server code with the service role.
- The Supabase Security Advisor lists the public security definer helpers (`is_admin()`, `is_lead()`, `my_team()` and the others) as callable by signed-in users. That is intended: the policies call them, and they only reveal the caller's own rights and team.
