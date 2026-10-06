import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRightIcon,
  ClipboardCheckIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MailIcon,
  SparklesIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { PageHeader, StatusPill } from "@/components/qc";
import { ADMIN_USERS_PATH, navForRole, plannedByPhase } from "@/components/shell/nav";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAiStatus, type AiReportStatus, type AiReviewStatus } from "@/lib/ai";
import { HOME_PATH } from "@/lib/auth/routes";
import { requireAdmin } from "@/lib/auth/session";
import type { Status } from "@/lib/design/status";
import { getSiteUrl, getSupabasePublicEnv } from "@/lib/env";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/**
 * The title checks the role too. Next resolves metadata on its own, so a
 * static title would still name this page on an inspector's 404 (in the tab
 * and the HTML); notFound() here swaps in the 404 page's metadata. The
 * session is cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Admin overview" };
}

/** Where the set-up steps live (README "Supabase setup"). */
const README_SETUP_URL = "https://github.com/kennethExstrat-creator/stericareservice/blob/main/README.md#supabase-setup";

/**
 * System status for admins: is Supabase wired up, are the sign-in emails
 * set up, are the AI hand-offs connected. Shows which variable to set, never
 * a value: no keys, secrets or webhook URLs reach this page.
 */
export default async function AdminOverviewPage() {
  const user = await requireAdmin();

  const supabaseEnv = getSupabasePublicEnv();
  const secretKeySet = isAdminClientConfigured();
  const database = await readDatabaseSummary();
  const ai = getAiStatus();
  const comingLater = plannedByPhase(navForRole(user.role).flatMap((section) => section.entries));

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Admin"
        title="Overview"
        description="Set-up checks and shortcuts. Only admins see this page."
      />

      <section aria-labelledby="system-status" className="space-y-4">
        <h2 id="system-status" className="text-2xl font-bold tracking-tight text-foreground">
          System status
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <SupabaseCard env={supabaseEnv} secretKeySet={secretKeySet} database={database} />
          <EmailCard projectRef={supabaseEnv ? projectRefFrom(supabaseEnv.url) : null} siteUrl={getSiteUrl()} />
          <AiReviewCard status={ai.review} />
          <AiReportCard status={ai.report} />
        </div>
      </section>

      <section aria-labelledby="quick-links" className="space-y-4">
        <h2 id="quick-links" className="text-2xl font-bold tracking-tight text-foreground">
          Quick links
        </h2>
        <ul className="grid gap-6 md:grid-cols-2">
          <li>
            <QuickLink
              href={ADMIN_USERS_PATH}
              icon={UsersIcon}
              title="Users"
              description="Invite people, set roles and deactivate accounts."
            />
          </li>
          <li>
            <QuickLink
              href={HOME_PATH}
              icon={ClipboardCheckIcon}
              title="Inspections"
              description="Every inspection, from every inspector."
            />
          </li>
        </ul>
        {comingLater.map(({ phase, labels }) => (
          <p key={phase} className="text-sm text-muted-foreground">
            Coming in {phase}: {listFormat.format(labels.map((label) => label.toLowerCase()))}.
          </p>
        ))}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */

type DatabaseSummary = {
  accounts: { active: number; admins: number; inspectors: number; deactivated: number } | null;
  reference: { manufacturers: number; clients: number; defectCodes: number; templates: number } | null;
};

/** Read as the signed-in admin, so this also proves RLS lets an admin see everything it should. */
async function readDatabaseSummary(): Promise<DatabaseSummary> {
  const supabase = await createClient();
  const head = { count: "exact", head: true } as const;
  const [profiles, manufacturers, clients, defectCodes, templates] = await Promise.all([
    supabase.from("profiles").select("role, active"),
    supabase.from("manufacturers").select("id", head),
    supabase.from("clients").select("id", head),
    supabase.from("defect_codes").select("code", head),
    supabase.from("templates").select("id", head),
  ]);

  let accounts: DatabaseSummary["accounts"] = null;
  if (!profiles.error) {
    const active = profiles.data.filter((profile) => profile.active);
    accounts = {
      active: active.length,
      admins: active.filter((profile) => profile.role === "admin").length,
      inspectors: active.filter((profile) => profile.role === "inspector").length,
      deactivated: profiles.data.length - active.length,
    };
  }

  const counts = [manufacturers, clients, defectCodes, templates];
  const reference: DatabaseSummary["reference"] = counts.every((result) => !result.error && result.count !== null)
    ? {
        manufacturers: manufacturers.count ?? 0,
        clients: clients.count ?? 0,
        defectCodes: defectCodes.count ?? 0,
        templates: templates.count ?? 0,
      }
    : null;

  return { accounts, reference };
}

/** "abcdefghijklm" from https://abcdefghijklm.supabase.co, for dashboard links. */
function projectRefFrom(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  } catch {
    return null;
  }
}

function hostFrom(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const listFormat = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

function SupabaseCard({
  env,
  secretKeySet,
  database,
}: {
  env: ReturnType<typeof getSupabasePublicEnv>;
  secretKeySet: boolean;
  database: DatabaseSummary;
}) {
  const ready = Boolean(env) && secretKeySet && database.accounts !== null && database.reference !== null;
  const { accounts, reference } = database;

  return (
    <StatusCard
      icon={DatabaseIcon}
      title="Supabase"
      description="Database, sign-in and photo storage."
      status={ready ? { status: "pass", label: "Ready" } : { status: "fail", label: "Needs attention" }}
    >
      <Rows>
        <Row label="Project" value={env ? <span className="font-mono text-foreground">{hostFrom(env.url)}</span> : "Not set"} />
        <Row
          label="URL and publishable key"
          value={
            env ? (
              "The app can reach the project."
            ) : (
              <>
                Set <Variable>NEXT_PUBLIC_SUPABASE_URL</Variable> and{" "}
                <Variable>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</Variable>.
              </>
            )
          }
          pill={env ? <StatusPill size="sm" status="pass" label="Set" /> : <StatusPill size="sm" status="fail" label="Missing" />}
        />
        <Row
          label="Secret key (server only)"
          value={
            secretKeySet ? (
              "Used to invite and deactivate users."
            ) : (
              <>
                Set <Variable>SUPABASE_SECRET_KEY</Variable> to invite and deactivate users.
              </>
            )
          }
          pill={
            secretKeySet ? <StatusPill size="sm" status="pass" label="Set" /> : <StatusPill size="sm" status="fail" label="Missing" />
          }
        />
        <Row
          label="Accounts"
          value={
            accounts
              ? [
                  `${accounts.active} active (${plural(accounts.admins, "admin")}, ${plural(accounts.inspectors, "inspector")})`,
                  accounts.deactivated > 0 ? `${accounts.deactivated} deactivated` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Could not read the accounts. Check the migrations are applied."
          }
          pill={accounts ? undefined : <StatusPill size="sm" status="fail" label="Not readable" />}
        />
        <Row
          label="Reference data"
          value={
            reference
              ? [
                  plural(reference.manufacturers, "manufacturer"),
                  plural(reference.clients, "client"),
                  plural(reference.defectCodes, "defect code"),
                  plural(reference.templates, "template"),
                ].join(" · ")
              : "Could not read the reference tables. Check the migrations and seed are applied."
          }
          pill={reference ? undefined : <StatusPill size="sm" status="fail" label="Not readable" />}
        />
      </Rows>
    </StatusCard>
  );
}

function EmailCard({ projectRef, siteUrl }: { projectRef: string | null; siteUrl: string }) {
  return (
    <StatusCard
      icon={MailIcon}
      title="Sign-in emails"
      description="Invites and password resets."
      status={{ status: "info", label: "Check by hand" }}
    >
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          Supabase sends these emails. Paste SteriCare&apos;s templates into the project once; without them the
          links in the emails do not work.
        </p>
        <ul className="space-y-1.5">
          <li>
            <code className="font-mono text-foreground">supabase/templates/invite.html</code> into{" "}
            <span className="font-medium text-foreground">Invite user</span>
          </li>
          <li>
            <code className="font-mono text-foreground">supabase/templates/recovery.html</code> into{" "}
            <span className="font-medium text-foreground">Reset password</span>
          </li>
        </ul>
        <p>
          Links in the emails open <span className="font-mono text-foreground">{siteUrl}/auth/confirm</span>. The
          built-in mailer only sends to the project&apos;s team, a few emails an hour: set up custom SMTP before
          inviting inspectors.
        </p>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
        {projectRef && (
          <ExternalLink href={`https://supabase.com/dashboard/project/${projectRef}/auth/templates`}>
            Open the email templates
          </ExternalLink>
        )}
        <ExternalLink href={README_SETUP_URL}>Set-up guide (README)</ExternalLink>
      </div>
    </StatusCard>
  );
}

const REVIEW_PROVIDER_LABEL: Readonly<Record<AiReviewStatus["provider"], string>> = {
  webhook: "Webhook (your own service)",
  claude: "Claude (Anthropic API)",
  mock: "Mock reviewer (test data only)",
  off: "None",
  misconfigured: "Not usable",
};

function AiReviewCard({ status }: { status: AiReviewStatus }) {
  return (
    <StatusCard
      icon={SparklesIcon}
      title="AI second opinion"
      description="Reviews submitted inspections. It suggests; an admin decides."
      status={aiPill(status)}
    >
      <Rows>
        <Row label="Provider" value={REVIEW_PROVIDER_LABEL[status.provider]} />
        {status.provider === "claude" && status.model && (
          <Row label="Model" value={<span className="font-mono text-foreground">{status.model}</span>} />
        )}
      </Rows>
      <AiNote status={status}>
        Not connected: the review panel says so. Set <Variable>ANTHROPIC_API_KEY</Variable> or{" "}
        <Variable>AI_REVIEW_WEBHOOK_URL</Variable> to connect it.
      </AiNote>
    </StatusCard>
  );
}

const REPORT_PROVIDER_LABEL: Readonly<Record<AiReportStatus["provider"], string>> = {
  webhook: "Webhook (your own service)",
  off: "None",
  misconfigured: "Not usable",
};

function AiReportCard({ status }: { status: AiReportStatus }) {
  return (
    <StatusCard
      icon={FileTextIcon}
      title="AI report"
      description="Turns an approved inspection into the client report."
      status={aiPill(status)}
    >
      <Rows>
        <Row label="Provider" value={REPORT_PROVIDER_LABEL[status.provider]} />
      </Rows>
      <AiNote status={status}>
        Not connected: &ldquo;Send to AI report&rdquo; offers the JSON download instead. Set{" "}
        <Variable>AI_REPORT_WEBHOOK_URL</Variable> to connect a report service.
      </AiNote>
    </StatusCard>
  );
}

function aiPill(status: AiReviewStatus | AiReportStatus): { status: Status; label: string } {
  if (status.provider === "misconfigured") return { status: "fail", label: "Configuration error" };
  if (status.provider === "mock") return { status: "warn", label: "Test data only" };
  return status.connected ? { status: "pass", label: "Connected" } : { status: "info", label: "Not connected" };
}

/** What to do next: the problem (it names the variable, never its value), or how to connect. */
function AiNote({ status, children }: { status: AiReviewStatus | AiReportStatus; children: ReactNode }) {
  if (status.provider === "misconfigured") {
    return (
      <p className="rounded-lg border border-fail-border bg-fail-tint px-3 py-2 text-sm text-fail">
        {status.detail ?? status.label}
      </p>
    );
  }
  if (!status.connected) return <p className="text-sm text-muted-foreground">{children}</p>;
  return null;
}

/* ------------------------------------------------------------------ *
 * Building blocks
 * ------------------------------------------------------------------ */

function StatusCard({
  icon: Icon,
  title,
  description,
  status,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  status: { status: Status; label: string };
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-lg font-bold">
          <Icon aria-hidden className="size-5 text-brand-600" />
          <h3>{title}</h3>
        </CardTitle>
        {/* The pill sits beside the title only, so the description gets the full width. */}
        <CardDescription className="col-span-2">{description}</CardDescription>
        <CardAction className="row-span-1">
          <StatusPill status={status.status} label={status.label} />
        </CardAction>
      </CardHeader>
      <CardContent className="gap-4">{children}</CardContent>
    </Card>
  );
}

/**
 * An environment variable's name (never its value). It wraps to the next line
 * whole and only splits when one name is wider than the card.
 */
function Variable({ children }: { children: string }) {
  return <code className="font-mono wrap-break-word text-foreground">{children}</code>;
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-border">{children}</dl>;
}

/** Label and value on the left, an optional status pill on the right. */
function Row({ label, value, pill }: { label: string; value: ReactNode; pill?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 py-3 first:pt-0 last:pb-0">
      <dt className="text-sm font-medium text-foreground">{label}</dt>
      {pill && <dd className="col-start-2 row-span-2 row-start-1 self-start">{pill}</dd>}
      <dd className="col-start-1 text-sm break-words text-muted-foreground">{value}</dd>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-brand-600 underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 touch:min-h-11"
    >
      {children}
      <ExternalLinkIcon aria-hidden className="size-4" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // h-full: cards in one row match height when one description wraps.
        "group flex h-full items-center gap-4 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border outline-none transition-colors",
        "hover:ring-brand-300 focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-brand-600">
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base font-bold text-foreground">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
      <ArrowRightIcon aria-hidden className="size-5 shrink-0 text-slate-500 transition-colors group-hover:text-brand-600" />
    </Link>
  );
}
