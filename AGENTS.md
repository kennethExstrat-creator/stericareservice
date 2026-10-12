<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SteriCare Service Platform: project rules

QC inspection app for SteriCare glove inspectors: iPad for capture, desktop for review and admin.
**`docs/BUILD_SPEC.md` is the source of truth.** Build one phase at a time (section 12).

## Stack (do not add libraries without stating why)
- Next.js 16.3 App Router, React 19.2, TypeScript 5, Tailwind CSS 4, shadcn/ui (Radix base, `vega` style), npm.
- Supabase: Postgres, Auth, Storage, RLS via `@supabase/ssr` + `@supabase/supabase-js`. zod 4. Vitest 5.
- Approved additions: `@anthropic-ai/sdk` (AI second opinion on Claude), `@electric-sql/pglite`
  (runs migrations and RLS tests in-process; this machine has no Docker), `server-only`, the
  shadcn runtime deps (`radix-ui`, `cn`, `class-variance-authority`, `lucide-react`, `sonner`, `tw-animate-css`),
  and the Inspection Summary's editor, nine `@tiptap` packages pinned exactly (`core`, `pm`, `react`, `starter-kit`,
  `extension-list`, `extension-text-style`, `extension-highlight`, `extension-text-align`, `extensions`).

## Next.js 16 rules
- Read `node_modules/next/dist/docs/` before writing routing, auth, proxy or server action code.
- `proxy.ts` (not middleware) refreshes the Supabase session. It is not a security boundary:
  every Server Action, Route Handler and protected page re-checks auth with `lib/auth`.
- Request APIs are async (`await cookies()`, `await params`, `await searchParams`).

## Data and security
- zod schemas in `lib/schemas/` are the single source of truth for module data, module config,
  template definitions, the export and AI payloads.
- `lib/supabase/admin.ts` (secret key) is server-only. Never import it into client components.
- RLS enforces roles (`inspector`, `admin`) and `profiles.active`. Status changes go through
  server actions that check the transition and write `audit_log`.
- `docs/examples/` holds client data and is git-ignored. Test fixtures replace client,
  manufacturer, PO, lot and carton identifiers with placeholders.

## Design
- Light SteriCare theme from `docs/design-reference/` (read-only snapshot of the website).
  Tokens live in `app/globals.css`; rules in `docs/DESIGN.md`. No dark mode, no marketing motion.
- Status colours are separate from the brand: pass green, fail red, warn/hold amber, not done slate.
- iPad: 44 px touch targets on any touchscreen (`touch:` = `any-pointer: coarse`, also with a keyboard and
  trackpad attached). Desktop (>= 1280 px and no touchscreen): compact rows, sidebar layout. Every touch screen
  gets the iPad layout whatever its width: `xl:`/`max-xl:` and `WIDE_QUERY` require no touchscreen (12.9 and
  13 inch iPads are 1366 px wide in landscape).

## AI
- `lib/ai/` holds the AI hand-offs (BUILD_SPEC 9). Default model `claude-opus-5-5`.
- The AI never changes a result. It suggests; an admin records agree, disagree or fixed.

## Checks
- `npm run check` (typecheck, lint, Vitest). `npm run build` before declaring a feature done.
- Test at iPad portrait 820x1180, iPad landscape 1180x820, iPad Pro landscape 1366x1024 (touch) and desktop 1440x900.
