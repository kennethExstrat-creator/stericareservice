# Database

Supabase Postgres 17 with Auth, Storage and row level security (BUILD_SPEC 3, 4.2, 5, 8.1, 9 and 11).

| Path | What |
|---|---|
| `supabase/migrations/` | The schema, in five migrations applied in filename order |
| `supabase/seed.sql` | Reference data: manufacturers, the SAFEDON_EG client, defect codes. No users, safe to rerun |
| `lib/supabase/database.types.ts` | Generated types (`Database`, `Tables<>`, `TablesInsert<>`, `TablesUpdate<>`, `Enums<>`, `Constants`) |
| `tests/db/` | RLS and rule tests that run the migrations in PGlite, no Docker needed |

## Migrations

| File | Contents |
|---|---|
| `20261006000100_enums_and_helpers.sql` | Enum types; pure helpers: `set_updated_at()`, `forbid_changes()`, `storage_inspection_id()`, `inspection_ref()` |
| `20261006000200_tables.sql` | The eleven tables, sequence, indexes, timestamp triggers, locked columns |
| `20261006000300_access_and_guards.sql` | Caller helpers, auth.users to profiles sync, guard triggers, audit trail, `log_inspection_event()` |
| `20261006000400_rls_and_grants.sql` | RLS on every table, explicit grants, policies |
| `20261006000500_storage.sql` | The five private buckets and their policies |

## Tables

Every table has `created_at` and `updated_at`. One trigger, `set_updated_at()`, sets both; callers cannot backdate either. Primary keys are `uuid` (`gen_random_uuid()`), except `defect_codes` (`code`) and `audit_log` (bigint identity).

| Table | Notes |
|---|---|
| `profiles` | One per auth user (`id` = `auth.users.id`). **Addition to BUILD_SPEC 5: `email`**, copied from `auth.users` and kept in sync by trigger, so admin lists need no Auth API call. `full_name` comes from the invite metadata; empty names are stored as null. `signature_path` must be inside the user's own folder (`<user_id>/...`). |
| `manufacturers` | One row per factory: unique on name plus factory name, ignoring case. |
| `clients` | Unique name, ignoring case. `logo_path` points into `client-logos`. |
| `defect_codes` | Canonical codes (`^[a-z][a-z0-9_]*$`). A code never changes once created (templates and inspection data refer to it by value); deactivate instead. Severity lives in the template. |
| `templates` | Unique `(code, version)`; at most one `active` version per code. Codes are `^[A-Z][A-Z0-9_]*$` (`STD_EG`). Frozen once used, see below. |
| `inspections` | `ref_no`, `inspector_id` (defaults to the caller), `status` (`draft`), `data` (`{"modules": {}, "custom": {}}`), `module_overrides` (`{}`, keyed by module: `{ reason, by, at }`), `lot_numbers` (`{}`) and `inspection_date` (today in Malaysia) all have defaults. `report_url` must be `http(s)://`. |
| `inspection_photos` | `storage_path` and `thumb_path` are object names in `inspection-photos`, and must sit in the inspection's folder. `created_by` is always the uploader. |
| `inspection_files` | Lab reports and certificates in `inspection-files`, same folder rule. |
| `ai_reviews` | One per reviewed version of an inspection (`inspection_updated_at`). `confidence` is 0 to 1. `findings` and `questions` are JSON arrays. |
| `ai_review_actions` | An admin's `agree`, `disagree` (a note is required) or `fixed` on one finding, always in their own name. |
| `audit_log` | Append-only. Written by triggers and `log_inspection_event()`; signed-in users cannot insert directly, and no role can change a row. |

On delete: `profiles` follow their auth user (cascade). Everything that points at a profile, a template, a client or a manufacturer is restricted, so records are never lost by deleting a person or a reference row: deactivate users instead. An inspection's photos, files, AI reviews and audit rows are deleted with it.

## Who can do what

All policies are for the `authenticated` role, and every one requires an active profile. `anon` has no privileges on any table or function.

| | Inspector | Admin |
|---|---|---|
| Own profile | Read; change `full_name` and `signature_path` | Read all; change anyone's `role`, `active`, `full_name` |
| Manufacturers, clients, defect codes, templates | Read | Read and write |
| Inspections | Read own. Create own, as a draft, from an active template. Edit own while `draft` or `reopened`; submit | Read, create and edit all; approve, reopen, switch modules off, set `report_url`, delete (not approved ones) |
| Photos and files | Read those of own inspections; add, change, remove while the inspection is editable | Everything, on any inspection, including `include_in_report` |
| AI reviews | Read those of own inspections | Read and write |
| AI review actions | Nothing | Read and write, in their own name |
| Audit log | Read rows of own inspections | Read all |
| `log_inspection_event()` | On own inspections | On any inspection |

Deactivated users (`profiles.active = false`), admins included, read and write nothing. `my_profile_status()` is their only window: it returns their `active` flag and `role` so the app can explain the block.

Rules RLS cannot express are enforced by triggers, for every role:

- Nobody changes `profiles.id`, `inspections.ref_no`, `inspector_id` or `template_id` (an inspection keeps its template version), a photo's or file's inspection or uploader, or an audit row.
- `profiles.email` only changes through Supabase Auth; the sync trigger copies it. Only admins change `role` and `active`; only the user changes their signature.
- The last active admin cannot be demoted, deactivated or deleted, whoever asks (the SQL editor included).
- `submitted_at`, `approved_by` and `approved_at` are set by the database, never by callers.
- Only admins set `report_url`, switch modules off (`module_overrides`, BUILD_SPEC 4.4) or pick report photos.
- Once an inspection uses a template version, its `code`, `version`, `extends_code`, scope (`product_type`, `standard`, `client_id`, `manufacturer_id`), `definition` and `resolved` are frozen. Its status can still change, except back to `draft`. Edits go into a new version. Inspectors can only start from an `active` template, so they cannot freeze an admin's draft.

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
| `draft` to `submitted`, `reopened` to `submitted` | The inspector who owns it, or an admin | `submitted_at` |
| `submitted` to `approved` | Admin | `approved_by`, `approved_at` |
| `submitted` to `reopened` | Admin | |

Every other change of status is rejected. New inspections always start as `draft`. Approved inspections cannot be deleted through the API.

### Service role and the database owner

The guards check end users, who reach the database as `authenticated` or `anon`. Every other role acts with admin rights but stays bound by the status flow, the locked columns and the last-admin rule:

- `service_role` (the secret key, server code only): bypasses RLS like an admin, follows the status flow, and is recorded with `actor_id` null and `approved_by` null.
- `postgres` (migrations, the SQL editor): same as the service role. To repair data outside the rules, disable the table's `guard` or `lock_columns` trigger inside a transaction (`alter table public.inspections disable trigger guard`), fix, re-enable it, commit.

### Audit log

A trigger records, for every inspection, `created` (ref_no, status, template, inspector), each `status_changed` (`{ from, to }`) and `deleted` (a row with `inspection_id` null that keeps the id, ref_no and status, visible to admins only). The actor is `auth.uid()`: null for the service role.

Server actions record everything else with `log_inspection_event(inspection_id, action, changes)`, for example `module_override`, `ai_report.sent` or `ai_review.requested`. It checks that the caller can read the inspection (the service role can log on any), returns the new row's id, and refuses the three actions the trigger owns. Actions match `^[a-z][a-z0-9_.]*$`; `changes` is a JSON object.

### Reference numbers

`ref_no` is `INS-<year>-<number>`: the creation year in Malaysia (Asia/Kuala_Lumpur), then a sequence number padded to four digits that keeps growing past 9999 (`INS-2027-10000`). The column default draws it; an insert that supplies its own value is rejected, the service role included.

## Storage

All buckets are private. Show files through signed URLs. Paths below are object names inside the bucket, which is what the `*_path` columns store.

| Bucket | Object names | Limit | Types | Read | Write |
|---|---|---|---|---|---|
| `inspection-photos` | `<inspection_id>/<uuid>.jpg`, thumbnails `<inspection_id>/thumbs/<uuid>.jpg` | 25 MiB | JPEG, PNG, WebP, HEIC, HEIF | Whoever can read the inspection | Admins; the owner while draft or reopened |
| `inspection-files` | `<inspection_id>/<uuid>.<ext>` | 50 MiB | PDF and the image types above | Whoever can read the inspection | Admins; the owner while draft or reopened |
| `signatures` | `<user_id>/<file>` | 1 MiB | PNG, JPEG, WebP | The user; admins | The user only |
| `client-logos` | Free, e.g. `<client_id>.png` | 2 MiB | PNG, JPEG, WebP (no SVG: it can carry script) | Active users | Admins |
| `template-sources` | Free, e.g. `<code>/v<version>/<file>` | 50 MiB | PDF, Excel, Word, JPEG, PNG, WebP, HEIC, HEIF | Active users | Admins |

A malformed name in the inspection buckets (no leading inspection id) is simply denied; it never raises an error. The Storage API enforces size and type; the policies decide who.

## Applying to the hosted project

```sh
npx supabase login
npx supabase link --project-ref <project-ref>   # Dashboard > Project Settings > General
npx supabase db push --dry-run                  # see what would run
npx supabase db push --include-seed             # migrations, then supabase/seed.sql
```

Later migrations: `npm run db:push` (that is, `supabase db push`). Add `--include-seed` again whenever the seed changes; it skips rows that already exist.

### First admin

Kenneth signs up in the dashboard (Authentication > Users > Add user, auto-confirm). The trigger gives him an inspector profile; one line in the SQL editor makes him admin:

```sql
update public.profiles set role = 'admin' where email = '<his email>';
```

Users created before the migrations ran get their profile from the migration itself. After that, admins invite everyone else from the app.

### Test users

`seed.sql` creates no users, so it is safe for production. The local test users of BUILD_SPEC 11 (`inspector@test.local`, `admin@test.local`) are created later by a script through the Auth admin API, which fires the same profile trigger; the script then promotes the admin.

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
- `schema.test.ts` fails when a table lacks RLS or a policy, when `anon` can reach anything, or when a foreign key lacks an index. `shim.test.ts` pins the shim's own behaviour.

What the shim cannot prove:

- That the hosted `postgres` role may do what the migrations need (triggers on `auth.users`, policies on `storage.objects`, inserts into `storage.buckets`). Supabase supports all three today; `supabase db push --dry-run` and the first push are the real check.
- Anything outside Postgres: Storage API limits, signed URLs and its own checks; PostgREST's HTTP status codes and schema cache; Auth sign-in, invites, bans and token expiry.
- That Supabase's `auth` and `storage` schemas stay as modelled. The shim holds only the columns and functions the migrations use.
- Concurrency: PGlite has a single connection, so the lock that stops two admins demoting each other at once is not exercised.
- Version differences: PGlite 0.5.8 is Postgres 18.3; Supabase runs 17. The suite also passes on PGlite 0.3 (Postgres 17.5). One assertion accepts both codes that the two versions use for a restricted delete (`23503`, `23001`).

## Notes for app code

- Errors: `42501` means not allowed (RLS or a guard; PostgREST answers 403), `23514` means a rule or an invalid status change, `23505` a duplicate, `23503` or `23001` a row still in use.
- Insert inspections without `ref_no`, `status`, `inspector_id` or the automatic timestamps. Change status with a plain update (`{ status: "submitted" }`); the database checks the transition, sets the timestamps and writes the audit row.
- `my_profile_status()` returns an array; call it with `.maybeSingle()`.
- Deleting an inspection deletes its photo and file rows but not the objects in Storage: remove those through the Storage API first.
- Deactivate users rather than delete them. Deleting an auth user who appears in any record (an inspection, a photo or file, an approval, an audit row, an AI decision, a template's coverage check) fails by design.
- To activate a new template version, retire the active one first: one active version per code.
- Inspectors cannot write `ai_reviews`. A review triggered by an inspector's submit is stored by server code with the service role.
- The Supabase Security Advisor lists the public security definer helpers (`is_admin()` and the others) as callable by signed-in users. That is intended: the policies call them, and they only reveal the caller's own rights.
