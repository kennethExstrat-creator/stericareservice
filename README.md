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
   - URL Configuration: Site URL `http://localhost:3000` for local work (the Vercel URL in
     production); add `http://localhost:3000/**` to the redirect URLs.
   - Emails → Templates: paste `supabase/templates/invite.html` into **Invite user** and
     `supabase/templates/recovery.html` into **Reset password**. Their links go to `/auth/confirm`,
     which works on whichever device opens the email.
   - Passwords: minimum length 10, letters and digits (matches `supabase/config.toml`).
   - Production: set up custom SMTP so invites are not limited by Supabase's built-in mailer.

5. **First admin (Kenneth).** Dashboard → Authentication → Users → Add user (with a password),
   then run in the SQL editor, using that email:

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

   After that, invite everyone else from `/admin/users` in the app.

6. **Local test accounts** (development projects only, never production):

   ```bash
   npm run seed:dev-users -- --force
   ```

   Creates `inspector@test.local` (inspector) and `admin@test.local` (admin) with a known
   password, printed at the end. Without `--force` it only runs against a local Supabase.

7. **Types.** After changing the schema: `npm run db:types` (needs `supabase link`).

## AI models

Optional. With nothing set, the app shows "AI not connected" and offers the JSON export.

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
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run check` | Typecheck, lint and all tests |
| `npm test` | Vitest (unit, AI layer, RLS tests on PGlite) |
| `npm run seed:dev-users` | Local test accounts (see above) |
| `npm run db:push` | Apply migrations to the linked project |
| `npm run db:types` | Regenerate `lib/supabase/database.types.ts` |

## Testing

- `npm run check` runs everything. No network, Docker or real keys needed.
- **RLS tests** run the real migrations on [PGlite](https://pglite.dev) (Postgres in WASM)
  behind a small Supabase shim, so the inspector and admin policies are tested on every run.
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
lib/auth/            session guard (data access layer), route policy, sign-out
lib/supabase/        Supabase clients and generated database types
lib/ai/, lib/schemas/  AI hand-offs and the zod payload schemas
supabase/            migrations, seed data, email templates, CLI config
tests/db/            RLS tests on PGlite
docs/                build spec, design, database and AI docs, reference forms
```

`docs/examples/` holds client data and is not committed.

## Security notes

- The secret key is only read in `lib/supabase/admin.ts`, which is `server-only`.
- Row Level Security enforces roles and deactivation in the database; every page, Server Action
  and Route Handler also checks the session through `lib/auth/session.ts`. `proxy.ts` only
  refreshes the session and redirects.
- Deactivating a user blocks their data access immediately (RLS) and bans their auth account so
  their session cannot be refreshed.
