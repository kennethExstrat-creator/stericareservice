# SteriCare Service Platform

SteriCare QC: a web app for iPad and desktop where SteriCare QC inspectors sign in, record
preshipment glove inspections at manufacturer sites and take photos as evidence. It replaces the
Excel reports and Word forms. Every inspection becomes one structured JSON document; separate AI
steps turn it into the client report and give a second opinion (see [docs/AI.md](docs/AI.md)).

The build spec is [docs/BUILD_SPEC.md](docs/BUILD_SPEC.md). The app is built one phase at a time.

## Status

**Phase 1: Foundation.** Design system and `/design` sign-off page, database with Row Level
Security, sign-in and user management, app shell, empty inspections list, AI hand-off layer.

Waiting on:

- **Design sign-off.** Open `/design` at iPad and desktop widths (see below) and approve or
  request changes before Phase 2 builds the capture screens on it.
- **Supabase credentials.** Fill in `.env.local`, apply the migrations, then run the checks under
  [Phase 1 acceptance](#phase-1-acceptance).

## Stack

Next.js 16.3 (App Router, Turbopack) · React 19.2 · TypeScript · Tailwind CSS 4 · shadcn/ui
(Radix) · Supabase (Postgres, Auth, Storage, RLS) via `@supabase/ssr` · zod 4 · Vitest ·
Anthropic SDK (optional AI second opinion on Claude). Hosting: Vercel (later).

## Getting started

Requirements: Node.js 22.18 or newer (the dev-user script uses Node's built-in TypeScript;
the app itself needs 20.9+), npm.

```bash
npm install
npm run dev            # http://localhost:3000
```

`.env.local` already exists with every variable empty (copy of `.env.example`). The app runs
without Supabase: `/login` shows a setup notice and `/design` works.

### Design sign-off

```bash
npm run dev
# open http://localhost:3000/design
```

Check it at iPad portrait (820 × 1180), iPad landscape (1180 × 820) and desktop (1440 × 900).
The page is hidden in production builds; set `ENABLE_DESIGN_PAGE=true` to show it on a preview
deployment. Design rules and tokens: [docs/DESIGN.md](docs/DESIGN.md).

## Supabase setup

1. **Create a project** at [supabase.com](https://supabase.com) (region close to Malaysia, e.g.
   Singapore).
2. **Keys.** Dashboard → Project Settings → API Keys. Put these in `.env.local`:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) |
   | `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_…`). Server only. |

3. **Apply the database** (tables, RLS, storage buckets, reference data):

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push --include-seed
   ```

   Details, the RLS model and the storage buckets: [docs/DATABASE.md](docs/DATABASE.md).

4. **Auth settings** (Dashboard → Authentication):
   - Sign In / Providers → Email: turn **off** "Allow new users to sign up" (admins invite users).
   - URL Configuration: add every address the app runs at to the redirect URLs, with `/**`
     (`http://localhost:3000/**`, `http://localhost:3001/**`, `https://staging.stericare.my/**`);
     set the Site URL to the main one (staging for now, production later).
   - Emails → Templates: paste `supabase/templates/invite.html` into **Invite user** and
     `supabase/templates/recovery.html` into **Reset password**. Their links return to the app that
     sent the email (`{{ .RedirectTo }}`: every send names its own `/auth/confirm`), so a local copy
     and staging can share one Supabase project; Supabase keeps that address only when it is in the
     redirect URLs, else it uses the Site URL. `/auth/confirm` works on whichever device opens the
     email; an invitation's ("Create your account")
     opens Account Creation (`/create-account`), where the invitee types their name, phone and
     password.
   - Passwords: minimum length 10, letters and digits (matches `supabase/config.toml`).
   - Production: set up custom SMTP so invites are not limited by Supabase's built-in mailer,
     which only delivers to the project's team. Until then, invite with **Create Link** on
     `/admin/users` and send the link yourself.

5. **First admin (Kenneth).** Dashboard → Authentication → Users → Add user (with a password),
   then run in the SQL editor, using that email:

   ```sql
   update public.profiles set role = 'admin', active = true where email = 'you@example.com';
   ```

   New accounts start inactive (a safety net in case public sign-up is ever switched on), so
   this line also activates yours. After that, invite everyone else from `/admin/users`; an
   invite activates the account it creates.

6. **Local test accounts** (development projects only, never production):

   ```bash
   npm run seed:dev-users -- --force
   ```

   Creates `lead@test.local` (lead inspector, Ngan Boon Keat), `inspector@test.local` (inspector,
   in Ngan Boon Keat's team) and `admin@test.local` (admin) with a known password, printed at the
   end. Running it again puts the three back as they were (the lead first, then their inspector);
   anyone else in the lead's team stays there. Without `--force` it only runs against a local
   Supabase. It needs the lead inspector migration (`20261007170000`) on the project.

7. **Seed templates** (`STD_EG`, `SAFEDON_EG`, `STD_SG` from BUILD_SPEC 11), once step 3 has run
   `supabase/seed.sql`:

   ```bash
   npm run seed:templates                         # dry run: one line per template; writes nothing
   npm run seed:templates -- --apply              # writes them, active
   npm run seed:templates -- --apply --drafts     # or as drafts, activated by a later run (below)
   ```

   It writes to the Supabase project that `.env.local` names, and says which. Nothing is
   written without `--apply`. Options go after the `--`: npm keeps an option written before it
   (`npm run seed:templates --drafts`) for itself, and the script then stops without writing and
   shows the command to use instead.

   `SAFEDON_EG` belongs to the client Polyco Healthline, which `supabase/seed.sql` creates; the
   script finds it by name and stops before writing anything if it is missing. The dry run should
   list all three templates and give no warning about placeholder modules. The first seed needs
   no `--replace`, and a second run with the same bundle (`lib/templates/definitions/seed-bundle.json`)
   writes nothing. After the bundle is regenerated, a changed definition (or, with `--refresh`,
   new module defaults) becomes a new version, and retiring the seeded version that is active
   needs `--replace`; without it the run stops before writing anything. Admin > Templates, where
   an admin checked and activated drafts, is gone (Kenneth, 26 October 2026): a later run without
   `--drafts` activates a draft that matches the bundle (with `--replace` while another version is
   active). Details: the comment at the top of `scripts/seed-templates.mts`.

8. **Types.** After changing the schema: `npm run db:types` (needs `supabase link`).

## Roles and teams

Every person has one role (BUILD_SPEC 3; Admin > Roles & Permissions, `/admin/roles`). A role is
what its people see and a switch for each screen and action (`lib/auth/permissions.ts`). Three
come with the app:

| Role | Sees | Can |
|---|---|---|
| Inspector | Own Inspections | Records inspections. Works in a lead inspector's team. Made with Create Inspections, Delete Drafts, Export Reports, Steri-AI Reading and Steri-AI Summary; an admin may change its switches. |
| Lead Inspector | Team Inspections | An inspector who also sees every inspection of their team, in every status, read-only: the list, the review, the photos and files, the history. They cannot edit, submit, approve, reopen or delete their team's inspections. Same switches as Inspector to start with. |
| Admin | All Inspections | Everything, and it never changes: users and roles, every screen, every action. Admins are in no team. |

Admins add **custom roles** on Roles & Permissions (a name, what it sees, its switches); a role
that sees its own inspections works in a lead inspector's team, one that sees its team's leads
one. Only the built-in Admin role opens Users and Roles & Permissions, and the app keeps at least
one active Admin. The database refuses what a role does not allow (migration
`20261027150000_roles_and_permissions.sql`); the screens hide it.

Set up on `/admin/users`:

- **Invite User**: their email and their role (and the lead inspector for a role that sees its own
  inspections), then **Send Email** or **Create Link** (copy the link and send it yourself, e.g.
  by WhatsApp; it works once, for an hour). They create their account from the link (name,
  phone, password) and are signed in. Until then the list shows them as **Invited**, by email,
  with **Resend Invite**, **Copy Invite Link** and **Cancel Invite**.

- Invite (or make) the lead inspectors first, then their inspectors: inviting, activating or
  making someone an inspector asks for their lead inspector. **Change Lead Inspector** moves an
  inspector to another team; the **Team** picker and the Lead Inspector column show each team.
- A lead inspector who still leads a team cannot be demoted, made an admin or deactivated:
  move their team to another lead first (the screen names who is in it).
- Accounts from before teams keep working with no lead; the screen lists them under
  **No Lead Inspector** until an admin chooses one.
- **Edit Details**, next to anyone's name (your own included, active or deactivated): the name the
  app shows for them, 1 to 100 characters on one line, and their phone (optional; 7 to 15 digits,
  an optional + and spaces, brackets or hyphens), the same rules as Account Creation
  (`lib/auth/fields.ts`). Every screen, the export and the AI
  hand-offs read it from their profile, so it changes everywhere at once, on their past
  inspections too (the list's Inspector in Charge, the capture header's "Inspected By", the review);
  only what already left the app keeps the old name (exported files, AI reports and the AI's
  earlier answers). Supabase Auth's copy (`user_metadata.full_name`,
  which the Supabase dashboard shows) follows when the server has the secret key. An account
  waiting for activation is activated first: any change to it would make it look deactivated.
- **UIDs.** Every account has a UID, `SC-` and a number: `SC-0001`, `SC-0002` … `SC-9999`, then
  `SC-10000`. The database gives it when the account is created, in order (the accounts from
  before UIDs were numbered oldest first). It never changes, not even for an admin or the secret
  key, and is never given to anyone else, also after an account is deleted: the numbers can skip
  (a deleted account's, a test account's), and a gap never means a missing user. The list shows
  it in its first column, and every dialog beside the person's name. It is not used for signing
  in, on inspections or in reports. Details: [docs/DATABASE.md](docs/DATABASE.md#user-uids).
- **Search**, above the list beside the Team picker: finds people by name, email, phone or UID as you
  type, any part of each word, in any order and any case (`SC-0042`, `sc42`, `boon keat`,
  `@stericare`). It searches the team the Team picker shows and stays when you pick another;
  the links that open a team (a lead's name, **Show Them**, **Show Their Team**) show it
  whole. The address keeps it (`?q=`), so a reload or a shared link does too. When nobody
  matches, the list says so, with **Clear Search**; Escape clears it too.

The rules live in `lib/auth/org.ts` and, enforced for every request, in
`supabase/migrations/20261007170000_lead_inspectors.sql` (details:
[docs/DATABASE.md](docs/DATABASE.md#lead-inspectors-and-teams)). Until a project has run that
migration, the Users screen works with roles only and says what is needed. Until it has run
`supabase/migrations/20261008140000_profile_uid.sql`, the list has no UID column and the search
covers names and emails.

## AI models

Optional. With nothing set, the app shows "AI Not Connected" and offers the JSON export.

| Variable | Purpose |
|---|---|
| `AI_REVIEW_WEBHOOK_URL` | Second opinion via your own service (BUILD_SPEC 9.2) |
| `AI_REPORT_WEBHOOK_URL` | Client report generation via your own service (BUILD_SPEC 9.1) |
| `AI_WEBHOOK_SECRET` | Signs webhook requests (HMAC-SHA256) |
| `ANTHROPIC_API_KEY` | Runs the second opinion directly on Claude when no review webhook is set |
| `AI_REVIEW_PROVIDER` | `auto` (default), `webhook`, `claude`, `mock` or `off` |
| `AI_REVIEW_MODEL` | Default `claude-opus-5-5` |
| `AI_REVIEW_EFFORT` | Default `high` |

The AI never changes a result: it suggests, and an admin records agree, disagree or fixed.
Contract, guardrails, costs and data handling: [docs/AI.md](docs/AI.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (heap capped at 2 GB, so it restarts itself before passing about 1.6 GB) |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run check` | Typecheck, lint and all tests |
| `npm test` | Vitest (unit, AI layer, RLS tests on PGlite) |
| `npm run seed:dev-users` | Local test accounts (see above) |
| `npm run seed:templates` | Shows what the seed templates would change (see above); `-- --apply` writes them |
| `npm run clean:e2e` | Lists what crashed end-to-end runs left; `-- --apply` deletes it ([e2e/README.md](e2e/README.md)) |
| `npm run db:push` | Apply migrations to the linked project |
| `npm run db:types` | Regenerate `lib/supabase/database.types.ts` |

## Testing

- `npm run check` runs everything. No network, Docker or real keys needed.
- **RLS tests** run the real migrations on [PGlite](https://pglite.dev) (Postgres in WASM)
  behind a small Supabase shim, so the inspector, lead inspector and admin policies and the
  team rules are tested on every run.
  With Docker you can also use a local stack (`npx supabase start`); see docs/DATABASE.md.
- Screens are checked at 820 × 1180, 1180 × 820 and 1440 × 900.

## Phase 1 acceptance

From BUILD_SPEC section 12, once Supabase is connected:

- [ ] `/design` signed off at iPad and desktop widths
- [ ] Login and the app shell use the light SteriCare theme
- [ ] An inspector signs in on an iPad and on a desktop and sees only their own data
- [ ] An inspector gets a 404 on `/admin`
- [ ] A deactivated user is blocked
- [x] RLS tests pass for both roles (`npm test`)

## Project layout

```
app/                 routes (App Router): (auth) sign-in screens, (app) signed-in app, design/
components/ui/       shadcn/ui components, themed by app/globals.css tokens
components/qc/       capture UI primitives (status pills, steppers, grids, photo tiles)
lib/auth/            session guard (data access layer), route policy, sign-out, lead inspector rules
lib/supabase/        Supabase clients and generated database types
lib/ai/, lib/schemas/  AI hand-offs and the zod payload schemas
supabase/            migrations, seed data, email templates, CLI config
tests/db/            RLS tests on PGlite
docs/                build spec, design, database and AI docs, reference forms
```

`docs/examples/` holds client data and is not committed.

## Security notes

- The secret key is only read in `lib/supabase/admin.ts`, which is `server-only`.
- Row Level Security enforces roles, teams and deactivation in the database; every page, Server Action
  and Route Handler also checks the session through `lib/auth/session.ts`. `proxy.ts` only
  refreshes the session and redirects.
- Deactivating a user blocks their data access immediately (RLS) and bans their auth account so
  their session cannot be refreshed.
