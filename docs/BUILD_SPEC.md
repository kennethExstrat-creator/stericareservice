# SteriCare Inspection System: Build Spec

For an AI coding agent in VS Code (Claude Code, Codex or Copilot). Build one phase at a time and stop after each phase for review.

**Start prompt:** `Read docs/BUILD_SPEC.md and build Phase 1. Stop when its acceptance checks pass.`

Paths below are relative to the project root (`SteriCare Service Platform/`). Everything you need is inside `docs/`. Do not read or write outside this folder.

```
docs/
├── BUILD_SPEC.md              this file
├── forms/
│   ├── README.md              how the sources relate + module coverage matrix (read first)
│   ├── reports/               PRIMARY: the finished 4-page preshipment reports, field by field
│   │   ├── STD_EG.md          EN 455 style (median, force at break)
│   │   └── SAFEDON_EG.md      ASTM D6319 style (average, tensile), client-branded
│   └── onsite/                SECONDARY: the Word forms used on site (SG, EG, Safedon EG) + PDFs
├── examples/                  filled example reports (PDF) + expected-results.md. Client data: never commit
└── design-reference/          read-only snapshot of the SteriCare website styling (section 2.1)
```

---

## 1. What we are building

A web app for iPad and desktop where SteriCare QC inspectors log in, record preshipment glove inspections at manufacturer sites and take photos as evidence. It replaces the Excel reports and Word forms.

- **iPad for capture, desktop for the rest.** Inspectors fill inspections and take photos on an iPad at the factory. The same app on a desktop browser is used to finish entry, review, approve, upload photos and run admin. One codebase, one responsive layout. No phone layout.
- **Built from modules.** Every section of an inspection (watertight, visual, dimensions, labelling and so on) is a module. A template switches modules on or off and configures them. Different manufacturers, clients and standards get different templates from the same modules.
- **Report first.** The modules mirror the finished preshipment reports in `docs/forms/reports/`. What those reports lack comes in as optional modules.
- **Capture first.** Screens are built for fast data entry, not to look like a report.
- **Structured output.** Every inspection produces one clean JSON document. A separate AI step turns it into the client report. Later, a second AI gives a second opinion on the results and the inspector's comments (section 9.2). This app does not lay out reports.

---

## 2. Stack and agent rules

Match the stack of Kenneth's other projects:

- Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui
- Supabase: Postgres, Auth, Storage, Row Level Security
- `@supabase/ssr`, `@supabase/supabase-js`, `zod` 4
- Vitest for tests
- Tiptap 3 (MIT, on ProseMirror): the editor of the conclusion's inspection summary, formatted text (12 October 2026)
- Supabase CLI layout: `supabase/config.toml`, `supabase/migrations/`, `supabase/seed.sql`
- Hosting: Vercel (later)

Rules:

1. Next.js 16 differs from your training data. Read `node_modules/next/dist/docs/` before writing routing, auth, proxy/middleware or server action code.
2. No libraries beyond the list unless you state why first.
3. zod schemas in `lib/schemas/` are the single source of truth for module data, module config, template definitions, the export and AI review payloads. Forms, server actions and the export all use them.
4. Secret keys stay server-side. Never import the admin client into client components.
5. `git init` at the start. Commit after each working feature.
6. The folder already contains `docs/`. If `create-next-app` refuses a non-empty folder, scaffold into a temp folder and move everything up without touching `docs/`.
7. Add `docs/examples/` to `.gitignore`. Test fixtures copied from it keep the measurements but replace client, manufacturer, PO, lot and carton identifiers with placeholders.

Env (`.env.local`, plus a committed `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # publishable (anon) key
SUPABASE_SECRET_KEY=                    # secret (service_role) key, server only
AI_REPORT_WEBHOOK_URL=                  # optional, section 9.1
AI_REVIEW_WEBHOOK_URL=                  # optional, section 9.2
```

### 2.1 Design: light theme from the SteriCare website

The app must look like SteriCare. Before building any screen, study the website styling snapshot in `docs/design-reference/` and derive a **light theme** from it. The snapshot is reference only: copy values out of it, never import from it. The `.tsx` files carry a `.txt` suffix so the build ignores them; also exclude `docs/` in `tsconfig.json` and the ESLint config.

**Study these files in `docs/design-reference/`:**

| File | What to take from it |
|---|---|
| `globals.css` | The `@theme` tokens: brand blue scale (logo blue `#0157A2` is brand-600), accent teal scale (logo teal `#1F9D8E`), mist ground `#f5f9fc`, `ease-out-expo`, the `text-gradient-brand` utility, selection colour. Read the comments: they record which steps pass contrast with white text. |
| `layout.tsx.txt` | Fonts via `next/font`: Outfit for body text, Red Hat Display for headings. |
| `ui.tsx.txt` | Component feel: radius, borders, shadows, spacing, Card, Badge, Eyebrow, button styles. |
| `site-header.tsx.txt`, `site-footer.tsx.txt` | Navigation patterns and logo placement. |
| `logo.tsx.txt` and `brand/` | Logo files for light backgrounds: `stericare-horizontal.png` (header), `stericare-lockup.png` (login), `stericare-mark.png` (icon, favicon, home screen icon). |

**Keep from the website:**

- The same two fonts and the same brand, accent and mist tokens. Copy the token values exactly.
- Logo blue to logo teal is the signature gradient. Use it sparingly: logo, login screen, page title accents, the active progress indicator.
- Card style: white surface, `slate-200` border, rounded corners, soft shadow.
- Brand-500 as the primary button colour with white text, brand-500 focus rings.

**Change for the app:**

- **Light only.** The website uses dark ink backgrounds; the app does not. Page background mist `#f5f9fc`, surfaces white, borders `slate-200`, text `slate-900`, secondary text no lighter than `slate-600`. No dark mode for now.
- **No marketing motion.** Drop aurora, blobs, orbs, scroll reveals, hero animations, hover lifts and Lenis. Only short state transitions (150 to 200 ms, `ease-out-expo`). Data entry must feel instant.
- **Status colours separate from the brand.** Pass green, fail red, warning amber, hold amber, not done slate. Do not use brand teal for "pass": teal is the brand, not a result. All status text at least 4.5:1 contrast.
- **Built for factory light.** High contrast everywhere. No text on gradients except large headings.
- **Density by device.** iPad: 44 px touch targets. Desktop: compact table rows.
- **shadcn/ui wiring.** Map the shadcn CSS variables (`--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--ring`, `--radius`) to these tokens so every component inherits the theme without per-component overrides.
- Copy the logo PNGs from `docs/design-reference/brand/` into `public/brand/`.

**Output before any screen work:**

1. `docs/DESIGN.md`: one page listing the tokens, type scale, status colours and component rules you settled on, with the website file each came from.
2. The theme in `app/globals.css`.
3. A `/design` page (dev only, hidden in production) showing logo, type scale, buttons, inputs, steppers, defect chips, a sample grid, status pills, a module card and a photo tile. Kenneth signs this off at iPad and desktop widths before Phase 1 continues.

---

## 3. Users and login

Supabase Auth, email and password. No public sign-up: accounts come by invitation from an admin.

**User info** (Kenneth, 27 October 2026: "User info should be name, phone, email, role, UID"): UID (`SC-0042`, given once), name, email (the sign-in address), phone (`profiles.phone`, 7 to 15 digits with an optional + and spaces, brackets or hyphens; rules in `lib/auth/fields.ts`, checked by the database too), role (with the lead inspector's team for a role that sees its own inspections), and status (Active, Invited, Pending Activation, Deactivated).

**Roles** (Kenneth, 27 October 2026: "build permission and module on off for each role", app sections and actions, custom roles too; migration `20261027150000`, `lib/auth/permissions.ts`). Each person has one role (`profiles.role_id`). A role is:

- **What it sees**: Own Inspections (like an inspector, in a lead inspector's team), Team Inspections (like a lead inspector) or All Inspections (like an admin). `profiles.role` and `is_lead` follow it, so row level security keeps the data boundary it always had.
- **Screen switches**: Dashboard, Manufacturers, Clients, Defects, General Settings, Steri-AI Settings.
- **Action switches**: Create Inspections, Delete Drafts, Approve and Reopen, Switch Inspection Steps On or Off, Export Reports, Steri-AI Reading, Steri-AI Summary, Steri-AI Second Opinion. Approve and Reopen, Switch Inspection Steps and Second Opinion need All Inspections.

Three built-in roles come with the app: **Admin** (everything; never changes), **Lead Inspector** (Team) and **Inspector** (Own), both made with Create Inspections, Delete Drafts, Export Reports, Steri-AI Reading and Steri-AI Summary; an admin may change their switches. Built-in roles are never renamed or deleted and keep what they see. Admins add **custom roles** on Roles & Permissions; one that people have keeps what it sees and is not deleted. **Users** and **Roles & Permissions** belong to the built-in Admin role alone, so nobody gives themselves more than they have, and the app keeps at least one active Admin. The database refuses, row by row, what a role does not allow (`has_permission()`): managing manufacturers, clients and their logos and defect codes, creating inspections, deleting drafts, approving or reopening, switching steps, second opinions, reading Steri-AI's costs; every page, Server Action and Route Handler checks the role on the server as well (`requirePermission`, `authorizeAction({ permission })`), and the screens hide what a role does not allow.

- **Invitation**: an admin invites by email with the role chosen (and the lead inspector for a role that sees its own inspections), by email or, since Supabase's built-in mailer only reaches the project's team, as a link to send another way. The link opens `/create-account` (Account Creation): name, the invited email (read-only), phone, password and confirmation. Create Account saves them (`complete_account()`) and signs the person in, on the Admin Dashboard when their role opens it, else on the inspections list. Until then the account is Invited, every page sends its session to `/create-account`, and no Server Action but Create Account answers it; the link must be opened within the hour, or they ask for a new one (Resend Invite, Copy Invite Link, Cancel Invite on Admin > Users).
- **Forgot password**: `/forgot-password` emails a reset link (the reply never says whether the address has an account); it opens Choose a New Password and signs them in. Someone invited who has not joined goes to Account Creation instead.
- Deactivated users cannot log in or read data. Enforce in RLS (`profiles.active`) and in the session guard.
- Session refresh with `@supabase/ssr`, following the Next 16 docs. Signed-out users go to `/login`. Someone whose role opens no admin screen gets a 404 on `/admin/*`, and an admin screen their role does not open is a 404 too.
- First admin: Kenneth signs up through the Supabase dashboard, then one SQL line in `README.md` sets his role to `admin`.

---

## 4. Modules and templates

This is the central design. Get it right before building screens.

### 4.1 Three layers

| Layer | What it is | Who changes it |
|---|---|---|
| **Module** | One section of an inspection, built in code: its data schema, config schema, capture UI, calculations and result. The library is in section 6. | Developers |
| **Template** | Which modules are on, in what order, and how each is configured: sizes, labels in the client's or manufacturer's wording, specs, defect lists, AQL, standard profile. Plus custom modules for one-off fields. Stored as data and versioned. | Admin |
| **Inspection** | `data = { modules: { <key>: {...} }, custom: { <key>: {...} } }`, each validated by that module's schema. | Inspectors |

Every module can be included or excluded per template. `header` and `conclusion` are always on; their fields still switch on and off.

### 4.2 Rules

1. **Report first.** Modules and their defaults follow `docs/forms/reports/`. Onsite forms and new needs come in as config or optional modules.
2. **Nothing lost.** Every field on a source form exists in its template, as a module field or in a custom module. Nothing is dropped or merged on entry.
3. **Their wording, our keys.** Labels can be overridden per template so the screen reads like the client's or manufacturer's form. Data is stored under canonical keys. Kenneth, 8 October 2026: the app and the report write labels in Title Case (docs/DESIGN.md); the forms' wording stays in the coverage matrix.
4. **Defects map to canonical codes; severity belongs to the template.** Each label maps to a code in `defect_codes`, so "Stain" at one client and "Oil stain" at another count together. The same defect can be major in one template and minor in another (the STD_EG report lists "Defective bead" as major and "Defective beads" as minor). Unmapped labels are allowed and flagged for an admin.
5. **Canonical units and sizes.** mm, g, N, MPa and %. Sizes are normalised (`7` becomes `7.0`).
6. **One rule book.** AQL, totals, statistics, validations (section 6.2) and module results are computed the same way in every template.
7. **Every module returns a result** `{ status: pass | fail | warn | info | not_done, summary, perSize? }`, carries an inspector comment and photos. Results feed the suggested overall result, the export and the AI second opinion.
8. **Versioned and immutable once used.** An edit creates a new template version. An inspection keeps the version it started with.
9. **Inheritance.** A template `extends` another and lists only what differs: modules added, removed, reordered or reconfigured.
10. **Traceability.** A template stores its original form file, and an admin confirms a field coverage checklist before activating it.

### 4.3 Template definition (validated by `TemplateDefinitionSchema`)

```ts
type TemplateDefinition = {
  code: string;                       // "STD_EG", "SAFEDON_EG", "STD_SG"
  name: string;
  extends?: string;                   // base template code
  scope: {
    productType: "examination" | "surgical";
    standard: "EN455" | "ASTM_D6319" | "ASTM_D3578" | "ASTM_D3577" | "custom";
    clientId?: string;
    manufacturerId?: string;
  };
  unit: "pcs" | "pairs";
  sizes: { value: string; label?: string }[];
  modules: ModuleConfig[];            // in report order
  customModules?: CustomModule[];
  report?: { title: string; showClientLogo: boolean };   // for the AI report
  sourceFile?: string;                // storage path of the original form or report
};

type ModuleConfig = {
  key: ModuleKey;                     // section 6
  include: boolean;
  title?: string;                     // heading in the source's words, in Title Case
  labels?: Record<string, string>;    // field label overrides
  config?: unknown;                   // validated by that module's ConfigSchema
};

type CustomModule = {
  key: string;
  title: string;
  after: ModuleKey;                   // position
  layout: "fields" | "table" | "grid";
  fields: Field[];
  grid?: { repeatPer?: "size"; columns: { label: string; default: number; addable: boolean } };
};

type Field = {
  key: string;
  label: string;
  type: "counter" | "number" | "text" | "textarea" | "select" | "yes_no" | "date" | "photo";
  unit?: "mm" | "g" | "N" | "MPa" | "%" | "pcs";
  options?: string[];
  min?: number; max?: number;
  required?: boolean;
  hint?: string;
  mapsTo?: string;                    // canonical path, e.g. "modules.weight.indicative"
};
```

### 4.4 Choosing a template

Every client uses the standard template of the product type: the active template for it with no client and no manufacturer (Kenneth, 26 October 2026: "all the inspection flow will be standardized"). The inspector still picks client, manufacturer and product type: client and manufacturer go into the header, and the product type picks the template. Until then the most specific active template won (client and manufacturer, then client, then manufacturer, then the standard template); a template scoped to a client or a manufacturer now never applies. Admin can override. Admin can also switch a module off for one inspection, with a reason that is logged and exported.

### 4.5 Adding a new form (admin flow)

Kenneth, 26 October 2026: no admin flow. Every client uses the one standard inspection flow, so Admin > Templates (upload the form, extend a template, switch modules and set labels, preview, tick the coverage checklist, activate) is gone. A template changes in its definition in `lib/templates/definitions`, and `npm run seed:templates` publishes it.

---

## 5. Data model

All tables have `created_at` and `updated_at`.

| Table | Columns |
|---|---|
| `profiles` | id (= auth.users.id), full_name, role (`inspector`, `admin`), active, signature_path |
| `manufacturer_brands` | id, name (Kenneth, 27 October 2026: a manufacturer is a brand, its operating companies and each company's factories) |
| `manufacturer_companies` | id, brand_id, name |
| `manufacturers` | One row per factory: id, company_id, factory_name, address, country, notes (`name` copies the company's) |
| `clients` | id, name, logo_path, notes |
| `defect_codes` | code (pk), name, description, active. Severity is set per template, not here. |
| `templates` | id, code, version, extends_code, product_type, standard, client_id, manufacturer_id, status (`draft`, `active`, `retired`), definition (jsonb), resolved (jsonb, inheritance applied), source_file_path, coverage_confirmed_by, coverage_confirmed_at. Unique (code, version). |
| `inspections` | id, ref_no (`INS-2026-0001` from a sequence), template_id (exact version), client_id, manufacturer_id, po_no, product_name, lot_numbers (text[], copied from `order_lots` for search), inspection_date, inspector_id, status (`draft`, `submitted`, `approved`, `reopened`), data (jsonb `{ modules, custom }`, with the Report page's options under `report`), module_overrides (jsonb: modules switched off for this inspection, with reason), suggested_result, result (`pass`, `fail`, `hold`), remarks, submitted_at, approved_by, approved_at, report_url |
| `inspection_photos` | id, inspection_id, module_key, target (e.g. `size:M/hand:R/defect:thin_spot/box:253`), storage_path, thumb_path, caption, taken_at, width, height, flagged (bool, file needs conversion), include_in_report (bool), created_by |
| `inspection_files` | id, inspection_id, module_key, kind (`lab_report`, `certificate`, `other`), storage_path, name, created_by |
| `ai_reviews` | id, inspection_id, inspection_updated_at, status (`pending`, `done`, `failed`), model, suggested_result, confidence, summary, findings (jsonb), questions (jsonb), created_at |
| `ai_review_actions` | id, ai_review_id, finding_id, actor_id, action (`agree`, `disagree`, `fixed`), note, at |
| `audit_log` | id, inspection_id, actor_id, action, changes (jsonb), at |

RLS:

- Helpers `is_admin()` and `is_active()` (security definer).
- Reference tables (`manufacturer_brands`, `manufacturer_companies`, `manufacturers`, `clients`, `defect_codes`, `templates`): read for active users, write for admins.
- `inspections`: inspectors read their own, insert with `inspector_id = auth.uid()`, and update their own only while `draft` or `reopened`. Admins have full access.
- `inspection_photos`, `inspection_files` and the private storage buckets `inspection-photos` and `inspection-files` follow the parent inspection. Show files through signed URLs.
- `ai_reviews` and `ai_review_actions`: admins read and write; inspectors read reviews of their own inspections.
- Status changes go through server actions that check the transition and write `audit_log`.

Status flow: `draft` to `submitted` to `approved`. Admin can reopen a submitted inspection (`reopened`), which goes back to `submitted`. `approved` is read-only.

---

## 6. Module library

Each module lives in `modules/<key>/` with `schema.ts` (data), `config.ts` (config schema and defaults), `calc.ts` (pure calculations and result), `Capture.tsx` and tests. Per-size modules show only the sizes in `order_lots`. Every module has an inspector comment and photos.

### 6.1 Modules

**Report modules: build these first, in report order.** Source column: where they appear (see `docs/forms/README.md`).

| Key | Captures | Config | Result | Source |
|---|---|---|---|---|
| `header` (always on) | Manufacturer / supplier, factory address, PO / SO no., product name (brand, code, description), client, factory glove code, inspection date, mfg date, expiry date, inspector (automatic), report date | fields on/off, labels | info; warn if expiry is not after mfg date | both reports |
| `glove_info` | Surface texture, indicative weight (size M, g), colour, length | fields on/off | info | both reports |
| `order_lots` | Per size: qty (cases), lot numbers, packing site. Totals: cartons and gloves (from `packing_config`) | sizes, packing site on/off | info | both reports |
| `packing_config` | Gloves per inner unit, inner units per case, gloves per case; inner unit name (inner box, plastic pack, dispenser box, pouch). The gloves per case is worked out (Kenneth, 27 October 2026: "if there is already an auto calulate field, why another to fill?"): once both other counts are entered it is their product, saved with them and shown read-only in its place with "100 × 10" under it, so the lot size and the order's totals have it; it is typed only while one of them is missing (a document may state only the gloves per case) | unit names | not done until the gloves per inner unit and inner units per case are entered; warn if a stored gloves per case ≠ inner x per case (data saved before, until either count is edited) | both reports |
| `sampling_plan` | Per size: sampled cases, inner units taken per case and in all (worked out while the count per case is entered), gloves, with the gloves taken per inner unit and those put back (computed); gloves for watertight and visual; gloves for dimensions; gloves for physical test; inner units for packaging and dispensing; pouches (surgical). Each test its own count (Kenneth, 12 October 2026: "each metrics and measurement should have their own number of glove count"). No gloves for weight (Kenneth, 26 October 2026: "remove this, this is not needed"): the row the app had for it is never shown, and a count saved there is kept, unused | columns on/off, general inspection level, special inspection level (none: S-2) | no warning below the AQL plan (Kenneth, 26 October 2026: "the warning is not needed"); the plan is still worked out | both reports, onsite |
| `carton_sampling` | Per size: sampled box/carton numbers | none | fail on validation errors (6.2) | both reports |
| `dimensions` | Per size, per glove (default 13): chosen measures from length, width, finger, palm and cuff thickness; per size and measure, optionally, a spec for this inspection and a P/F set by hand with a comment (rule 12) | measures on/off; statistic `average` or `median`; spec per size per measure (min, max, nominal ± tolerance, or NA); decimals | pass/fail per measure on the statistic against the spec in force; no spec (NA, or none for the size) is Passed once the readings are complete; a P/F set by hand replaces the computed one; fail if any fails | both reports |
| `weight` | Per size: one value, the size's average weight as the dimension sheet prints it (Kenneth, 26 October 2026: "this page should only record average weight of each size, which already in the dimension document"); compared with indicative weight. An inspection saved before then holds one value per glove weighed: their average is the size's weight | optional spec; warn threshold (default 10%); n no longer used | pass/fail if spec set; warn on deviation | both reports |
| `force_at_break` | Per size, per glove of the sampling plan's gloves for FAB (default 13): force (N); median; lab report file | n, spec minimum (default 6 N), standard label | pass/fail per size | STD_EG |
| `tensile` | Per size: tensile strength average (MPa), elongation at break average (%); lab report file required | specs (default ≥ 14 MPa, ≥ 500%), standard label | pass/fail per size | SAFEDON_EG |
| `watertight` | Per size (R/L optional): n tested, holes by location | AQL (default 1.5), locations and labels (between fingers/crotch, palm, finger, cuff, glove burst, other), `handSplit` | accept/reject per size from the AQL engine | both reports, onsite |
| `visual` | Per size (R/L optional), per class: n inspected, defect counts. Captured one size at a time (Kenneth, 26 October 2026): one n inspected for the size, written to every class, then the classes side by side with their defects; no code letter on the capture screen | classes on/off: critical (AQL 0), major (default 2.5), minor (default 4.0); defect list per class with labels; `handSplit` | per class per size; any critical defect fails | both reports, onsite |
| `dispensing_packing` | Per size, per box: box/carton # (typed, the size's sampled numbers suggested), layering %, dispensing %, stickiness code. Per size, one aged sample: the same values, no box/carton # (below) | min layering (default 70%), min dispensing (default 80%), stickiness codes with pass/fail (A, B, B1, C pass; D fail), boxes per size | averages against minimums; any failing code fails; a failed aged sample fails | STD_EG, EG onsite |
| `dispensing_safedon` | Per size, per box: box/carton # (typed, the size's sampled numbers suggested), counts for 6 defects; per box defects / gloves and rate; size total and % | defect list and hints, gloves per pack, max rate (default 5%), boxes per size | size rate against max | SAFEDON_EG, Safedon onsite |
| `labeling` | Per size, per level (inner unit, carton): n inspected, box/carton numbers (optional), defects per check | levels on/off; checks on/off (lot no., mfg date, expiry date, artwork, box/carton # printed); n per level (default 3 inner, 1 carton) | any defect fails (Accept 0 / Reject 1) | both reports |
| `conclusion` (always on) | Suggested result (computed from module results), final result (pass, fail, hold), remark, inspection summary (formatted text), inspector, date, signature drawn on the iPad | none | final result | both reports |

**Optional modules: not in the current reports.** Build after the report modules.

| Key | Captures | Config | Result | Source |
|---|---|---|---|---|
| `dye_leak` | Per size: pouches tested, pouches failed, notes | n per size | any failure fails | SG onsite (planned only) |
| `documents` | Checklist: certificate of analysis, lab test reports, sterilisation certificate and records, ISO 13485, FDA / CE certificates, declaration of origin. Each: verified, not verified or NA; reference no.; expiry date; file | items on/off and required | fail if a required item is not verified; warn if expired | QC scope on the website |
| `loading` | Container no., seal no., cartons loaded vs PO, carton condition, photos at each loading stage | fields on/off | warn on quantity mismatch | QC scope on the website |

`handSplit` (record R and L separately) is a config option on `watertight` and `visual`, used by surgical templates.

**Aged sample** (Kenneth, 26 October 2026: "each size has aged sample for packing check, give aged sample a special section"). Each size of `dispensing_packing` may have one aged sample, in its own section under the boxes: layering %, dispensing %, stickiness code and Others, no box/carton #. It is not a box: never counted with them or in their code letter, averages or stickiness summary. It is judged on its own against the same minimums and codes: a failed one fails the size, a passed one changes nothing, one entered in part keeps the size Not Done, an empty one is none (to confirm: an empty one could keep the size Not Done). The review and the export give it a line of its own after the boxes'. Steri-AI reads a packing row marked as aged into it, never into the boxes.

**Sampling Quantity** (Kenneth, 27 October 2026: "case change to # of Case, Inner Box change to # of Inner Box per Case"; asked whether that count is per case or the total, he answered: add row "Inner Box Taken per Case", then Total # of Inner Box; then the gloves taken per inner box, with those put back: "do not under take, over take it to the nearest of 315"). The rows read # of Case, Inner Box Taken per Case, Total # of Inner Box, Gloves Taken per Inner Box, Put Back, # of Gloves Sample, Code Letter (Kenneth, 27 October 2026: "rearrange the order of row: glove taken per box, total gloves taken, put back, # of Gloves Sample"; then of Total Gloves Taken: "remove this row, instead, add formula beside the number of glove sample such as how u did for total number of inner box. eg: for # of glove sample 500, the formula should be (15 x 34)-10"; and "below number of glove sample (the final), add a row "Code Letter""). # of Gloves Sample shows that sum at its left, quiet as the inner boxes' "16 × 1": (Total # of Inner Box × Gloves Taken per Inner Box) − Put Back, "(15 × 34) − 10" for 500, "25 × 12" when none is put back, while the inner boxes and the gloves per inner box are known, under its count where the cell is too narrow; the count stays typed. **Code Letter** (Kenneth, 27 October 2026: "when calculate, put in code letter for the size. Besides, give a button to reduce the code letter to the previous letter, for example, the auto calculate gives N. The inspector can manually reduce it to M. When code letter is reduced, the auto calculate trigger for that size to meet the new code letter. This is because some inspection are done for high quality factory where their performance is consistent. In that case, we could manually reduce the sampling size."): each size keeps the ISO 2859-1 letter its # of Gloves Sample is taken from, as data. Auto Calculate Sampling writes the lot's letter at the general inspection level in force (asking first when it would change one already there); it is never typed, and a document that states it fills it only where empty. Each size has its own Reduce and Raise (Kenneth: "each size should have their own reduction control button"): Reduce steps the letter down in ISO order (N → M, J → H, P → N; A is the first) after asking for a reason (1 to 500 characters, kept as the size's `codeLetterReason`), Raise steps it back up, never above the lot's letter, and needs none; either works that size's # of Gloves Sample out again as the new letter's Table 2-A sample (M is 315), every glove of a smaller lot, and the per-box rows follow. A letter below the lot's has an amber "↓ N" badge just before it on its line, "Reduced from N" and the reason as its title (Kenneth, 27 October 2026, design A of four: the note under the letter put it out of line with the other sizes), and the size's summary, the review and the export say "Code Letter: M (reduced from N)"; the export also carries `codeLetterReduced` and `reducedFrom` with the lot's own letter. Back at the lot's letter, by Raise or Auto Calculate, the reason goes. A # of Gloves Sample that is not the letter's sample is a warning on the letter, never a block. Each change of a letter is audit logged (rule 13). Watertight & Visual follows # of Gloves Sample whenever it changes, typed, by Auto Calculate, Reduce or Raise, unless the row is switched off (Kenneth, 27 October 2026: "the Watertight and Visual follow # of glvoes sample"); a count typed there holds until # of Gloves Sample next changes, and Auto Calculate asks before replacing one. Inner Box Taken per Case is optional (an inspection saved before, or a document that gives only the total, has none): entered, the total is # of Case × it, worked out and shown read-only, and worked out again whenever the cases change, Auto Calculate Sampling included; empty, the total is typed as before. A stored total that is not the product (data saved another way) is a warning on it. Auto Calculate Sampling fills Inner Box Taken per Case with 1 where a size has none (Kenneth, 27 October 2026: "Always 1 per case"; one entered stays, and it asks before replacing a typed total). Gloves Taken per Inner Box is ⌈# of Gloves ÷ Total # of Inner Box⌉, never under the sample, and Put Back what that takes beyond it (25 inner boxes and 315 gloves: 13 a box, 10 put back), whether the gloves were typed or filled by Auto Calculate Sampling. The Total column sums neither the inner boxes per case, the gloves per inner box nor the code letter; it sums the gloves put back. Where the gloves per case is not known, the Lot Size (Gloves) row says it needs the Packing Configuration on the Order page.

### 6.2 Validation rules

Learned from checking the two example reports (`docs/examples/expected-results.md`). Every module follows them.

1. Numeric cells accept numbers only. A reading like "2 42" is rejected, not stored as text.
2. Totals, averages, medians, rates, code letters and accept/reject limits are always computed, never typed. The sampling plan's Code Letter is never typed either: Auto Calculate Sampling writes each size's from its lot, and the inspector may only step it down, with a reason, and back up (Kenneth, 27 October 2026; section 6.1).
3. Counts can never turn into dates. Dates use date pickers.
4. Sizes not in `order_lots` do not appear in any module. Their values stay saved: a step holding any says so at its top, naming the sizes, with Open Order to the size's row on the order, and a Source Documents reading that fills them says so in its message; nothing adds a size to the order for the inspector (Kenneth, 27 October 2026: "why is the carton number not being auto filled?").
5. A module with missing data shows "Not Done", never "Passed".
6. Carton numbers are unique per size, between 1 and the order quantity, and their count equals the sampled cases.
7. Box numbers in `dispensing_packing`, `dispensing_safedon` and `labeling` are box/carton numbers: the same number as the carton numbers, worded "Box/Carton #" everywhere (Kenneth, 13 October 2026, reversing 12 October: "box# and carton# is the same thing", then "yes link again"). They are typed on the numeric keypad, with the size's sampled carton numbers (`carton_sampling`) suggested as they are typed. A number that is not in that size's list is a warning on its field, never an error: it never blocks submit and never fails a module. The same number may appear in several rows (one carton can supply several inner boxes); only labelling's carton level, which inspects each carton once, calls a number entered twice an error. While the size has no carton list yet, nothing is checked. The other way round, Steri-AI copies the box/carton numbers a source document gives for a size into that size's carton list while it is empty, each once (docs/AI.md, "Source Documents"; Kenneth, 14 October 2026).
8. The sample size sets the code letter and limits (section 7). A plan that does not match the sample size cannot be saved.
9. Measured weight more than the threshold away from the indicative weight raises a warning.
10. Client, product code and PO are entered once in `header` and reused everywhere, including the export.
11. The inspector is always recorded. Section and result labels come from the template and cannot be edited on the capture screen. A module may word its title for the inspection: weight's names no count of gloves, as it records one average per size ("Weight (g) - Average of 13 Gloves per Size" reads "Weight (g)"; Kenneth, 26 October 2026). A module may word a label for the inspection too: the sampling plan's Sampling Quantity rows read # of Case, Inner Box Taken per Case, Total # of Inner Box, Gloves Taken per Inner Box, Put Back, # of Gloves Sample and Code Letter on every inspection, whatever its template version stored (Kenneth, 27 October 2026: "case change to # of Case, Inner Box change to # of Inner Box per Case"). The capture screen's menus, Pending and messages name a step by its short name (docs/DESIGN.md, Step Names); its card, the review and the export keep the template's title.
12. Dimension (Kenneth, 26 October 2026). A measure with no spec, NA or none for the size, is Passed once every glove has its reading, as the client's report prints it ("NA" with "Passed"; "the finger thickness, palm and cuff should be still able to be passed even no specification"), and not done while readings are missing. The spec can change for an inspection, per size and measure, in any kind the template takes, NA included ("the specification should be adjustable, manually or AI auto, read the document uploaded and adjust"): by hand (the pencil in the measure's Spec cell of the size's grid opens Change the Spec: Save, Cancel, Use Template Spec; "put the edit icon into the table, not outside"), or by Steri-AI from a form's Spec row, filled only where the inspection has none yet. The spec set for the inspection is judged, printed and exported in place of the template's, and marked in its grid cell with an amber dot, the template's spec as its title. The inspector may also set a measure's P/F by hand, Passed or Failed with a required comment (the pencil in its P/F cell opens Change the P/F: Cancel, Change Result, Use the Readings' Result): it replaces the computed P/F on the screen (marked in its cell as a changed spec is, the comment as its title), the review and the export, a manual Failed fails the size, and a warning shows it wherever it differs from the readings ("due to special action by inspector"). Each change, set, changed or given back, writes an audit row (`spec_changed`, `pass_fail_changed`) in the same transaction as the data, worked out on the server from the stored and the saved data, so the browser cannot leave it out. The Audit Log page lists them (section 10).
13. Sampling Plan code letter (Kenneth, 27 October 2026). Each size's Code Letter is its lot's ISO 2859-1 letter, filled by Auto Calculate; the inspector may reduce it (N to M), which lowers the size's # of Gloves Sample, for a factory of consistent high quality, giving a reason, and raise it back up to the calculated letter. Asked whether reducing should be audit logged: "yes, reducing code letter go to Audit Log". As with Dimension (rule 12), each change of a size's stored letter writes a `code_letter_changed` audit row in the same transaction as the data, worked out on the server from the stored and the saved data: the letters before and after, reduced or raised, the reason for a letter reduced, and the # of Gloves Sample before and after. A letter cleared writes one too. The first fill is the calculation, not an inspector's decision, and writes none, unless it comes with a reason: a letter filled and reduced in one save (on a device that was offline meanwhile) is recorded as reduced from the lot's letter. The Audit Log page tints a letter reduced and marks it Special Action by Inspector, with its reason (section 10).

Errors block submit and list each problem with a link. Warnings are allowed but go into the export.

---

## 7. AQL engine

`lib/aql/`: pure functions, no I/O.

- ISO 2859-1 single sampling, normal inspection. Table 1 (lot size and inspection level to code letter) and Table 2-A (code letter and AQL to n, Ac, Re). Levels S-1 to S-4, I, II, III. Every AQL column in Table 2-A.
- **From lot size:** at the inspection level in force (below), work out n per size. A sample below it is not flagged, and the Sampling Plan card shows no inspection level (Kenneth, 26 October 2026).
- **Sampling Settings** (Kenneth, 27 October 2026: "put a setting beside the auto calculation sampling, that is to set general inspection level"): an icon button beside Auto Calculate Sampling opens a dialog that sets two levels for the inspection, each under its own heading with a line saying where the level in force comes from and Use Default to go back to it (Kenneth, 27 October 2026: "for dimension and FAB, use Special Inspection Level S2, based on total lot size of each size, so both general inspection and special inspection is in use. for packaging and inspection, number of inner box sampled is also Level S2, based on total innerbox of that size (carton x inner box per carton)"). **General Inspection Level** (I, II, III): set for this inspection, else the template's, else the client's, else I; it gives # of Gloves Sample and its Code Letter, and the plans. **Special Inspection Level** (S-1 to S-4): set for this inspection, else the template's (`specialInspectionLevel` in its config, none on any template so far), else S-2; it gives Dimension, FAB and Packaging & Dispensing. Two lines under them say so: "General: # of Gloves Sample and its code letter." and "Special: Dimension, FAB and Packaging & Dispensing." An inspection saved while the dialog had one level for everything may hold S-1 to S-4 as its level: it still loads, read as no general level of its own, so the general default applies (and the special level is S-2 unless set). "View Code Letter Table" shows ISO 2859-1 Table 1 from `lib/aql` with both columns in use highlighted, the general level's and the special level's, each size named in the row of its lot in gloves and in the row of its lot in inner boxes, and under it, per size, the lot in gloves with the general letter and sample, the same lot with the special letter and sample (Dimension, FAB), and the lot in inner boxes with the special letter and sample (Packaging & Dispensing). "View Table II-A" shows Table 2-A at the general level, each size's code letter and the AQLs the inspection applies marked. No count changes with either level until Auto Calculate Sampling runs; the export carries both levels in force (`computed.inspectionLevel`, `computed.specialInspectionLevel`). The same dialog rounds Auto Calculate Sampling's cases up to the nearest 5 or 10 when its one switch is on, from its next run, never past the cases ordered: the next multiple of 5, 72 to 75 and 78 to 80 (Kenneth, 27 October 2026: "round up to nearest 5 or 10, which means 72 round to 75, 78 round to 80, not either 5 or 10"). Auto Calculate Sampling fills each size's # of Gloves too: the sample size of its lot's code letter at the general level in force (M is 315), every glove when that is not smaller than the lot, and that letter into the size's Code Letter, which the inspector may lower (section 6.1; Reduce and Raise step the general letter only). It fills Dimension and FAB with the sample size of the code letter of the size's lot in gloves at the special level (a lot over 35,000 gloves at S-2 is code E, 13), and Packaging & Dispensing Inspection with that of its lot in inner boxes, the order's cases × the packing configuration's inner boxes per case (1,180 cases of 10 is 11,800, S-2 code D, 8), each never more than the lot, and only where the template shows the row and it is switched on. It asks before replacing any of these counts already entered ("Replace the Counts Entered?"). A size whose lot is not known keeps what it has, and the notice, "Sampling Plan Calculation Completed", names the rows and sizes in a line under it, rows lacking the same thing for the same sizes in one sentence: "# of Gloves Sample, Dimension and FAB need the lot size for S: enter the packing configuration on the Order page.", "Packaging & Dispensing Inspection needs the inner boxes per case for S: …".
- **From sample size:** the example reports set n directly. Map n to its code letter (2 A, 3 B, 5 C, 8 D, 13 E, 20 F, 32 G, 50 H, 80 J, 125 K, 200 L, 315 M, 500 N, 800 P, 1250 Q, 2000 R). A non-standard n uses the largest standard n below it, with a warning.
- **Arrows:** if the Table 2-A cell is an arrow, follow it. An arrow up (smaller plan) uses that plan's Ac/Re. An arrow down (larger plan) means the sample is too small for this AQL: flag it and show the n required.
- **Critical:** AQL 0 is always Accept 0 / Reject 1. Labelling is always Accept 0 / Reject 1.
- Defaults (overridable per template and per client): watertight AQL 1.5, major 2.5, minor 4.0, critical 0.
- Before go-live, the QC team checks every table cell against SteriCare's licensed copy of ISO 2859-1.

Tests that must pass:

| Input | Expected |
|---|---|
| lot 5,000, level I | J, n 80; AQL 1.5: 3 / 4; AQL 2.5: 5 / 6 |
| lot 20,000, level I | K, n 125; AQL 1.5: 5 / 6; AQL 2.5: 7 / 8 |
| lot 50,000, level I | L, n 200; AQL 1.5: 7 / 8; AQL 2.5: 10 / 11 |
| lot 120,000, level I | L, n 200 |
| lot 1,700,000 or 5,800,000, level I | N, n 500 |
| lot 20,000, level II | M, n 315; AQL 1.5: 10 / 11; AQL 2.5: 14 / 15 |
| n 80 | AQL 4.0: 7 / 8 |
| n 200 | AQL 4.0: 14 / 15 |
| n 500 | AQL 1.5: 14 / 15; AQL 2.5: 21 / 22; AQL 4.0: arrow up to M, 21 / 22 |
| lot 100, level I (D) | AQL 1.5: n 8, 0 / 1; AQL 2.5: arrow up, n 5, 0 / 1; AQL 4.0: arrow down, n 13, 1 / 2 |
| any n, AQL 0 | 0 / 1 |

---

## 8. Devices and speed

Devices:

- **iPad** (Safari, current iPadOS, portrait and landscape): primary capture device. Touch targets at least 44 px. Works with or without a keyboard.
- **Desktop** (Chrome, Safari, Edge at 1280 px and wider): review, approval, admin, photo upload, and finishing entry. Keyboard navigation through grids (Tab, Enter, arrow keys).
- Layout: on iPad, modules show as a top tab bar with the grid full width. On desktop, modules show in a left sidebar with wider grids and photos alongside. Packing configuration shows on the order's tab (and sidebar row), right below the order, whose total gloves it works out (Kenneth, 8 October 2026); each keeps its own frame, result, comment and photos. Tabs and sidebar rows show each step's short name.
- Web app manifest so the app can be added to the iPad home screen and opens full screen.
- Test every screen at iPad portrait (820 x 1180), iPad landscape (1180 x 820) and desktop (1440 x 900).

Speed:

- Counts by tapping: +/- steppers and tap-to-add defect chips. No typing for counts.
- Measurements use the numeric keypad (`inputmode="decimal"`). Enter moves to the next cell. Pasting a column of values (from a caliper app or spreadsheet) fills down.
- Size tabs (swipe on iPad, arrow keys on desktop). Sticky size and hand headers.
- Numbers flow forward: sampling sets n in later modules, each test its own, never another test's count. Weight records one average per size and takes no count from the sampling plan. The carton list feeds the box/carton numbers: typed, with the size's sampled numbers suggested, one not sampled a warning (6.2 rule 7).
- Live totals and green/red accept chips update as you tap.
- Autosave on every change (debounced about 800 ms) to Supabase, with a local IndexedDB copy. Status pill: Saved, Saving, or Offline (Will Sync). A dropped signal never loses data.
- "Start From Previous": prefill header, glove info, packing, specs and AQL from the last inspection for the same client, manufacturer and product.
- Defect picker shows the most-used defects first. An inspector can add a one-off defect label; it is saved unmapped and flagged for an admin.
- Progress tracker across modules.

### 8.1 Photos and files

- **iPad:** two buttons on every module. "Take Photo" opens the rear camera (`<input type="file" accept="image/*" capture="environment">`). "Add From Library" picks several photos at once (`accept="image/*" multiple`).
- **Desktop:** drag and drop or file picker, several files at once.
- **Auto-tagged:** a photo taken inside a module is tagged with that module and, where relevant, the size, hand, defect or box in focus. Inspector can retag and add a caption.
- **Processing in the browser:** convert to JPEG, resize to 2048 px on the long edge, quality about 0.8, keep capture time, strip GPS. If the browser cannot decode a file (for example some HEIC), upload the original and flag it.
- **Background upload queue:** capture never waits for upload. Photos queue in IndexedDB, upload with progress, retry when the connection returns. A badge shows pending uploads; submit is blocked until the queue is empty.
- **Gallery per inspection:** thumbnails grouped by module. Desktop shows full size with arrow-key navigation. Inspector can delete or retag photos while the inspection is a draft. Admin can mark photos "include in report".
- **Lab reports and certificates** (`force_at_break`, `tensile`, `documents`): PDF or image upload to `inspection-files` (Source Documents' Excel and CSV files too, since 26 October 2026: below).
- **Storage:** private buckets `inspection-photos` (path `<inspection_id>/<uuid>.jpg`, plus a 400 px thumbnail) and `inspection-files`. Viewed through signed URLs.

> **Since 11 and 12 October 2026 (Kenneth):** photos, videos and files are added on Source Documents, the first step, not on each module or in the gallery, which only shows them. Media lists photos and videos in four categories (Warehouse, Product and Package Samples, Inspection Proof, Product Defects) and Other, as rows like the documents' (Preview, Download, Delete); a row is dragged to another category or moved from its Move To menu. Auto-Sort, at the top, takes every photo and video at once and the AI files each into its category; what it cannot place stays in Other. Lab reports and certificates are uploaded on Files; a module that needs one (`force_at_break`, `tensile`, `documents`) links one of those files, and the AI links a lab report it recognises. Details in docs/AI.md.

> **Since 26 October 2026 (Kenneth: "make the source document to support excel and csv file reading"):** Source Documents' Files, on the capture screen and on New Inspection, also take Excel (`.xlsx`, `.xls`) and CSV files, up to 10 MB for Steri-AI. They are stored as they are; Steri-AI reads each as text, sheet by sheet, with the same fill rules as a PDF, and Preview shows each sheet as a table. Details in docs/AI.md, "Source Documents".

> **Since 27 October 2026 (Kenneth: "pagination with 10 files per page, the uplaod section should be pin at the top"):** Source Documents' Files on the capture screen lists the newest file first, ten to a page, with "Showing 1–10 of 23", Previous / Next and the page numbers under the rows once there are more than ten; the upload (Add Document, or the drop area with a mouse) sits above the rows, pinned under the screen's bars while they scroll. Details in docs/AI.md, "Source Documents", and docs/DESIGN.md.

---

## 9. AI hand-offs

### 9.1 AI report

- `GET /api/inspections/[id]/export` returns one JSON document validated by `ExportSchema`:
  - `schemaVersion`, `refNo`, `status`, timestamps, inspector
  - `template`: code, version, standard, client, manufacturer, report title, client logo URL, source file
  - `modules`: for each included module in template order: title and labels in the template's wording (the source form's words in Title Case), data, computed values, result, warnings, inspector comment
  - `excludedModules`: modules switched off for this inspection, with reason
  - `custom`: every custom module with its labels and values
  - `photos` and `files`: signed URLs (24 h) with module, target, caption and the "include in report" flag
  - `conclusion`: suggested result, final result, remark, inspection summary (HTML and plain text)
  - `report`: the capture screen's Report page options (section 10) in the report's structure: template, page size, title, client shown, footer note, the Summary's blocks (`summary`), each section's switch and its blocks' (`sections`, by the report's section keys; a section the inspection includes none of the modules of goes out with `include` false), and the photo records with the photos per group (`photos`). An inspection saved before them, and an export written before them, read as the defaults (Kenneth, 27 October 2026)
- The inspection's inspector, their lead inspector (Kenneth, 27 October 2026: "Can lead inspectors download reports?" "Yes") or an admin, and only for a role with Export Reports (section 3): a role without it gets a 403 before anything is read, anyone else a 404; the print route answers both with a 404. Steri-AI's panel and report stay with the inspector and admins.
- **The app renders the report itself** (Kenneth, 27 October 2026: the new pre-shipment design, with its charts drawn from the data; `docs/REPORT.md`): the export goes through `buildReportModel` (`lib/report`) into pages drawn by `components/report`, on the print route `/inspections/[id]/report/print` (the same access rule as the export) and in the Report page's preview. Download PDF opens the print route, where the browser's print dialog saves the PDF. Every page carries a Draft tag until the inspection is approved.
- The AI report service stays an option: the admin button "Send to Steri-AI Report" on submitted or approved inspections (the review's, and the Report page's, shown only where it may run, the same action): a server action POSTs the export to `AI_REPORT_WEBHOOK_URL` and stores the returned URL in `report_url`. If the variable is not set, show "AI Not Connected" and offer a JSON download. Its target layout was the 4-page preshipment report in `docs/examples/`, its labels in the template's wording as the export carries them (Title Case, rule 4.2.3).

### 9.2 AI second opinion (build the slot now, the AI later)

An AI reviews each submitted inspection on top of the inspector's results and comments, and the admin decides.

- **Input:** the export from 9.1: every module's data, results and warnings, the inspector's comment per module, the remark, the inspection summary and the photos.
- **Output** (validated by `AiReviewSchema`): suggested result (pass, fail, hold), confidence, summary, findings (each with module, size, severity, message and the evidence it points to: values, boxes, photos) and questions for the inspector.
- **Never automatic.** The AI never changes a result. The review screen shows three columns: the system's computed results, the inspector's result and comments, and the AI's opinion. The admin records agree, disagree (with a note) or fixed for each finding.
- **Trigger:** on submit (template setting) or by an admin button. A server action POSTs the export to `AI_REVIEW_WEBHOOK_URL` and stores the response in `ai_reviews`. A new review is kept for each version of the inspection.
- **Build now:** tables, schema, webhook call, the review panel and a mock webhook for tests. With no URL set, the panel shows "AI Second Opinion Not Connected".

---

## 10. Screens

- `/login`, `/forgot-password`, `/reset-password`, `/create-account` (Account Creation, from an invitation: section 3)
- `/inspections`: own list (admins see all). Filter by status, client, manufacturer. Search by ref, PO, lot or box/carton #.
- `/inspections/new`: pick client, manufacturer and product type (template resolves), or start from previous
- `/inspections/[id]`: capture screen, modules as tabs with progress and a result chip per tab; one tab per module, except packing configuration, on the order's tab below the order. After the Conclusion, the Report page (Kenneth, 27 October 2026: "After conclusion page, give another page "Report", thats the page where report generation is done, inclusing customizing report"; `?module=report`): in the sidebar, the iPad tabs and Previous / Next, but no step (no progress, result, count or Pending row). Its options are saved with the inspection's data (`data.report`, `ReportOptionsSchema` in `lib/schemas/report-options.ts`) through the autosave, like any field, and are read-only when the inspection is. They follow the report's design (Kenneth, 27 October 2026: "make the setting of report match the the report design"; `docs/REPORT.md`): General (Report Template, Standard Preshipment Report; Page Size, A4 or Letter; Report Title, "Pre-Shipment Inspection Report" by default; Show Client; a Footer Note of up to 300 characters), Report Content as a tree (the Summary, always in, with Order Mix by Size, Inspection Summary and Results by Check; then a row per section, 02 Order, Product & Sampling to 08 Packaging Labelling & Conclusion, each with its switch and opening, closed at first, to its blocks' switches; a section none of whose modules the inspection includes is greyed with "Not in this inspection" and left out), and Photo Records (Sampling & Packaging; Packing, Visual & Ageing; Watertight & Laboratory Testing; Photos per Group 4, 8 or 12), each on by default; options saved in the morning's first shape (a switch per step) are read into these. Beside them (below them on an iPad in portrait) the report's own pages in the new design (`components/report`), built from the screen's copy as it stands and zoomed to the column, every page tagged Draft until the inspection is approved; the sections still to be built print "<Section>: coming next". Download PDF, the primary action for the inspection's inspector and admins, saves what is waiting and opens `/inspections/[id]/report/print` in a new tab, where the print dialog saves the PDF. Send to Steri-AI Report (9.1) shows beside it only for an admin on a submitted or approved inspection with `AI_REPORT_WEBHOOK_URL` set; Open Last Report opens `report_url`, with when it was made where the audit log records it. Last, the Audit Log page (Kenneth, 26 October 2026: "The audit log should be kept in a special page, 'Audit Log', place under conclusion page"; `?module=audit_log`): in the sidebar, the iPad tabs and Previous / Next, but no step (no progress, result, count or Pending row). It lists the inspection's audit rows newest first (`loadAuditLog`, read with the user's own session, so whoever can open the inspection sees them): when in Malaysia time, who, and what in plain words, a size as the template labels it; a P/F set by hand is tinted and marked Special Action by Inspector, with its comment, and so is a size's code letter reduced on the Sampling Plan, with its reason ("Size S Code Letter reduced from N to M: # of Gloves Sample 500 → 315. Reason: …"; 6.2 rule 13). Read-only for everyone
- `/inspections/[id]/sampling-plan/print`: the sampling plan for the manufacturer (Kenneth, 27 October 2026, with a one-page PDF as its design: "Do a button to export the sampling plan using this template design. This is to send to the manufacturer to prepare the sample before the inspector arrive. Which means, though the whole inspection is not done, sampling plan should be can be exported once the sampling plan section is done."). Export Sampling Plan, after Sampling Settings on the Sampling Plan card (44 px on touch), opens it in a new tab once the step is Done (its result pass or info), on a draft and on a read-only inspection alike, what is waiting saved first; until then it is disabled, titled "Complete the Sampling Plan first". The route re-checks the session and reads the export with the report's rule (the inspection's inspector or an admin; anyone else, and an inspection with no Sampling Plan step, gets a 404). One A4 landscape page at true size under a bar that is never printed (Print / Save as PDF, Back), in the report's chrome without a page number or Draft tag ("Prepared for" the manufacturer and the PO; "Computer-generated document. No signature required."). At the left, the product type over the product's name, "Please have these samples ready for SteriCare's pre-shipment inspection.", The Sample at a Glance (cases to pull, inner boxes taken, gloves drawn with those put back, gloves sampled) and the Order (each size's lots, cases and gloves). At the right, Client, PO / SO Number, Manufacturer and Inspection Date ("Not stated" when empty), then Sampling Plan by Size: Sampling Quantity (cases to pull, inner boxes per case, inner boxes taken, gloves per inner box, gloves drawn, put back shown negative, gloves sampled tinted) and For Each Test, the rows switched off on the step left out, a per-case or per-box count unlike the other sizes' in bold, totals except per case and per box, and under it the code letters the samples follow, "(reduced from N)" where the inspector lowered one. Save as PDF names the file after the day and the PO, as his was named (`2026-10-27_sampling-plan_PO-0001` for a placeholder PO). `lib/sampling-plan`, `components/sampling-plan`, on the report's primitives
- `/inspections/[id]/review`: module results, inspector comments, photos, AI second opinion panel, approve or reopen
- `/admin`: the admin dashboard (Kenneth, 27 October 2026: "the overview should be a dashboard"; `lib/admin/dashboard.ts`). Open Inspections: Awaiting Approval, Reopened and Drafts, each count a link to the list filtered to it. Activity, for the period its picker names (Last 7, 30 or 90 Days, or All Time; `?period=`, the last 30 days by default): the inspections, then Passed, On Hold, Failed and Not Done with each one's share; Inspections per Day (per Month for All Time over 92 days), stacked by result from the first inspection on; By Client, By Manufacturer and By Inspector, busiest first, a client or manufacturer linking to the list filtered to it. An inspection counts on its inspection date, with the result its Result column shows (the inspector's, whatever the status; Not Done until set)
- `/admin/users` (the built-in Admin role only): UID, name, email, phone (its own column from 1440 px without touch, under the name otherwise), role and team, status (Active, Invited, Pending Activation, Deactivated), last signed in, added. Search by name, email, phone or UID. Invite User (email and role, sent by email or as a link). Row actions: Edit Details (name and phone), Change Role, Change Lead Inspector, Send Password Link, Resend Invite / Copy Invite Link / Cancel Invite for an Invited account, Deactivate / Reactivate / Activate
- `/admin/roles`, Roles & Permissions (the built-in Admin role only; Kenneth, 27 October 2026): every role, the built-in ones first, with what it sees, how many screens and actions it allows and how many people have it; a panel to add or edit one (name, description, what it sees, a switch per screen and action; Users and Roles & Permissions locked to the Admin role; the Admin role read-only), version-checked saves, Delete Role for a custom role nobody has
- `/admin/manufacturers` (brand, company and factory with its address in one table: Kenneth, 27 October 2026), `/admin/clients` (with logo), `/admin/defects` (codes and label mapping), each behind its switch
- `/admin/settings`, General Settings: whether Supabase is wired up and the sign-in emails are set up (the status the overview showed; Kenneth, 27 October 2026: "these looks more like should be in general settings or AI settings"). The Steri-AI hand-offs' status sits on Steri-AI Settings' General (`/admin/ai`, docs/AI.md)
- No `/admin/templates` (Kenneth, 26 October 2026): every client uses the one standard inspection flow, so the Templates screens (the list, the versions, the editor) are gone and the address is an unknown page. Templates stay behind the scenes: `npm run seed:templates` publishes them, `/inspections/new` shows the one it picks (an admin can Use Another Template), and `/admin/defects/labels` lists their labels, read only.
- **Role switches** (section 3; Kenneth, 27 October 2026): every screen hides what the person's role does not allow, and every Server Action and route refuses it on the server. The list's New Inspection, Review and Delete follow Create Inspections, Approve and Reopen and Delete Drafts; `/inspections/new` is a 404 without Create Inspections, and without Steri-AI Reading its files only upload (no reading, no Read Again) and media go to Other (no Auto-Sort); Use Another Template stays with roles that see every inspection. On the capture screen the step switches follow Switch Inspection Steps, the Summary button Steri-AI Summary, Source Documents' reading Steri-AI Reading, Download PDF Export Reports (with the owner-or-admin rule) and Send to Steri-AI Report Export Reports for an admin. On the review, approve, reopen and the report photos follow Approve and Reopen; the Steri-AI panel's request and decisions follow Steri-AI Second Opinion, its Download JSON Export Reports.
- Look and feel: light theme per section 2.1.

---

## 11. Seed data

Build every seed template field for field from `docs/forms/reports/` first, then `docs/forms/onsite/`: every label in the form's words (fix only the `[sic]` typos), written in Title Case (rule 4.2.3; the coverage matrix keeps them verbatim), every column, the same row counts as defaults.

- **Manufacturers:** Hartalega › Hartalega NGC; Top Glove › Terang Nusa Sdn. Bhd. › TG Factory 40 (TG-F40 on the live project). Addresses from the example reports. An inspection names its manufacturer by brand and factory ("Top Glove · TG-F40"), as Kenneth's report design does.
- **Clients:** the client of `SAFEDON_EG` (the report carries the Polyco Healthline logo), retired with its template on 26 October 2026.
- **Templates:**

| Template | Scope | Built from | Modules on (in order) |
|---|---|---|---|
| `STD_EG` | examination, EN 455: the one standard template for every client | `reports/STD_EG.md`, `onsite/EG.md`: its own flow, the one INS-2026-2435 uses (Kenneth, 26 October 2026: "I SAID STANDARDIZED!!!!! USE THAT OF 2435"; "FROM NOW ON, I ONLY WANT TO SEE ONE STANDARD FLOW") | header (+ client, factory glove code), glove_info, order_lots, packing_config (inner box), sampling_plan, carton_sampling, dimensions (median; length, width, finger, palm, cuff), force_at_break, weight (average of 13), watertight, visual, dispensing_packing (Glove Packing Check), labeling, conclusion. Version 5, published and retired the same day, ran SAFEDON_EG's flow; the inspections made on it keep it. |
| `SAFEDON_EG` | examination, ASTM D6319, client scoped; extends `STD_EG`'s report flow. Retired 26 October 2026: its flow is STD_EG's, and its versions stay for the inspections that use them | `reports/SAFEDON_EG.md`, `onsite/SAFEDON_EG.md` | as STD_EG's report flow, with: header + inspected by and client logo (no client row, no factory glove code); order_lots + packing site; inner unit "plastic pack"; dimensions average (length, width, finger, palm, no cuff); weight 1 value (no gloves for weight in the sampling plan); tensile instead of force_at_break; watertight + glove burst; dispensing_safedon instead of dispensing_packing (125 per pack, ≤ 5%) and its onsite notes; labeling + expiry date at both levels |
| `STD_SG` | surgical | `onsite/SG.md` | header, order_lots, packing_config (pouch), sampling_plan (+ pouches), watertight (handSplit), visual (handSplit), dimensions, dye_leak, conclusion. No filled SG report yet: specs to confirm |

- **Defect codes** (one master list; labels map per template; severity per template):

| Code | Labels in the reports |
|---|---|
| `hole_crotch` | Between fingers (crotch); Between fingers |
| `hole_palm`, `hole_finger`, `hole_cuff`, `hole_other` | Palm; Finger; Cuff; Other |
| `glove_burst` | Glove burst |
| `embedded_insect`, `embedded_metal` | Embedded insects; Embedded metal debris |
| `thin_crotch_ring` | Ring-shaped thin area (crotch); Thin ring between fingers (crotch) |
| `thin_crotch_area` | Thin area between fingers (crotch) |
| `thin_body_area` | Thin area on glove body; Thin patch / area (body) |
| `thin_spot` | Thin spot on glove body; Thin spot |
| `dirt_nonremovable` | Non-removable dirt |
| `stain` | Oil stain; Stain |
| `foreign_matter` | Residue material / foreign matter |
| `powder_mark`, `bead_blister` | Powder mark; Bead blister |
| `bead_defective` | Defective bead (major); Defective beads (minor) |
| `lump_big`, `lump_small` | Big Lumps (>2mm); Lumps (<2mm) |
| `dirt_small`, `sticky_pleats` | Small dirt / stain; Sticky pleats (< 5mm) |
| `bead_thin`, `bead_small_defect`, `bead_poor`, `bead_rolled` | Thin bead; Thin bead / small beading defect; Poor beading; Rolled bead |
| `skin_visual`, `flow_mark` | Not in the reports: Skin Visual; Flow Mark, written SKV and FM on the onsite forms. Major in STD_EG and SAFEDON_EG, after the reports' rows (Kenneth, 12 October 2026) |
| `ring_mark` | Not in the reports: Ring Mark, as inspectors write it on the onsite forms; not the ring-shaped thin area between the fingers (`thin_crotch_ring`). Major in STD_EG from version 7, last (Kenneth, 27 October 2026: "ring mark should be added") |
| `no_cuff`, `finger_out`, `multiple_out`, `stuck`, `sticky`, `faulty_cuff` | Safedon dispensing defects |

- **Labelling checks:** `lot_no`, `mfg_date`, `expiry_date`, `artwork`, `carton_no`.
- **Local test users** (local dev only): `inspector@test.local`, `admin@test.local`, and the lead inspector `lead@test.local` (Ngan Boon Keat), whose team `inspector@test.local` is in.

---

## 12. Phases

**Phase 1: Foundation**
- Scaffold, Tailwind, shadcn, Supabase clients (browser, server, admin), `.env.example`, `.gitignore` with `docs/examples/`
- Design first (section 2.1): study the website, write `docs/DESIGN.md`, set the light theme, build `/design`. Stop for Kenneth's sign-off before the next item.
- Migrations: all tables, enums, sequence, RLS, storage buckets and policies. Seed.
- Login, logout, forgot and reset password, invite and deactivate users, role guard
- App shell (iPad tab layout, desktop sidebar layout), web app manifest, and an empty inspections list
- Done when: the `/design` page is signed off; login and the app shell use the light SteriCare theme; an inspector logs in on an iPad and on a desktop and sees only their own data; an inspector gets a 404 on `/admin`; a deactivated user is blocked; RLS tests pass for both roles.

**Phase 2: Module engine and report modules**
- Module framework (section 6 layout), template resolver (inheritance, versioning, include/exclude) with tests
- AQL engine with the tests in section 7; validation rules in section 6.2 with tests
- All report modules in section 6.1, rendered from the resolved template
- Templates `STD_EG` and `SAFEDON_EG`
- New inspection, start from previous, autosave with IndexedDB copy, review and submit
- Photos and files (section 8.1)
- Done when: both example reports are entered on an iPad and every result matches `docs/examples/expected-results.md`, including the corrected values and the validation errors; a module switched off in a template disappears from capture, validation and export; photos taken in at least three modules show correctly on desktop; reloading mid-entry or losing the connection loses nothing.

**Phase 3: Optional modules, admin and AI slots**
- Optional modules `dye_leak`, `documents`, `loading`; `handSplit`; template `STD_SG`
- Template editor with module switches (section 10; removed with Admin > Templates, Kenneth, 26 October 2026), defect mapping screen
- Approve, reopen, per-inspection module overrides, audit log
- Export endpoint and AI report webhook (9.1)
- AI second opinion slot (9.2) tested against a mock webhook
- Done when: an admin builds a new template by switching modules and setting labels, without code changes; an STD_SG inspection with R/L and dye leak works; the export validates and contains everything needed to write the report without opening the app; the AI review panel shows mock findings next to the inspector's results.

**Later (not now):** full offline mode, client portal, defect trends by manufacturer and client, AI-drafted templates from uploaded forms, the AI second opinion service itself.

---

## 13. Open items for Kenneth

- Client for `SAFEDON_EG`: the report carries the Polyco Healthline logo. Is the client Polyco, and does the Safedon dispensing check apply to all its products? (Settled 26 October 2026: every client, Polyco included, uses STD_EG's own flow, the one standard flow; SAFEDON_EG is retired.)
- Inspection level per client. The SAFEDON_EG example sampled 80 and 200 where ISO 2859-1 level I gives 200 and 500; the STD_EG example matches level I.
- Spec limits per product for dimensions, weight and physical tests
- Final defect lists and severities per client
- Surgical (SG) report format: no filled example yet
- Signature drawn in the app: acceptable for clients?
- Who else gets admin access
