// The admin overview's status cards (app/(app)/admin/page.tsx): is Supabase
// wired up, are the sign-in emails set up, are the AI hand-offs connected.
// The page reads the facts; these cards only show them, so every state is
// tested on its own (admin-status-cards.test.tsx). They name the variable to
// set, never a value: no keys, secrets or webhook URLs reach the page.
import type { ReactNode } from "react";
import {
  DatabaseIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MailIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { StatusPill } from "@/components/qc";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiReportStatus, AiReviewStatus } from "@/lib/ai";
import type { Status } from "@/lib/design/status";
import type { SupabasePublicEnv } from "@/lib/env";

/** Where the set-up steps live (README "Supabase setup"). */
const README_SETUP_URL = "https://github.com/kennethExstrat-creator/stericareservice/blob/main/README.md#supabase-setup";

/** Counts read as the signed-in admin; null when a table could not be read. */
export type DatabaseSummary = {
  accounts: { active: number; admins: number; inspectors: number; deactivated: number } | null;
  reference: { manufacturers: number; clients: number; defectCodes: number; templates: number } | null;
};

/* ------------------------------------------------------------------ *
 * Supabase
 * ------------------------------------------------------------------ */

export function SupabaseCard({
  env,
  secretKeySet,
  database,
}: {
  env: SupabasePublicEnv | null;
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

/* ------------------------------------------------------------------ *
 * Sign-in emails
 * ------------------------------------------------------------------ */

/**
 * The invite and reset templates (supabase/templates/) build their links from
 * the Supabase project's Site URL, a dashboard setting this app cannot read,
 * so the card says what it must be. `siteUrl` is this app's public address
 * (getSiteUrl()); null when a production build has no NEXT_PUBLIC_SITE_URL
 * and would only know the localhost fallback.
 */
export function EmailCard({ env, siteUrl }: { env: SupabasePublicEnv | null; siteUrl: string | null }) {
  const projectRef = env ? projectRefFrom(env.url) : null;

  return (
    <StatusCard
      icon={MailIcon}
      title="Sign-in emails"
      description="Invites and password resets."
      status={siteUrl ? { status: "info", label: "Check by hand" } : { status: "warn", label: "Needs attention" }}
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
          The links start with the project&apos;s <span className="font-medium text-foreground">Site URL</span>,
          which this page cannot check.
          {siteUrl && (
            <>
              {" "}
              In Authentication → URL Configuration, set it to <Address>{siteUrl}</Address> and add{" "}
              <Address>{`${siteUrl}/**`}</Address> to the redirect URLs.
            </>
          )}
        </p>
        {!siteUrl && (
          <p className="rounded-lg border border-warn-border bg-warn-tint px-3 py-2 text-warn">
            <Variable>NEXT_PUBLIC_SITE_URL</Variable> is not set, so the app does not know its public address. Set it
            to the address people open the app at, and use the same address as the Site URL.
          </p>
        )}
        <p>
          The built-in mailer only sends to the project&apos;s team, a few emails an hour: set up custom SMTP before
          inviting inspectors.
        </p>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
        {projectRef && (
          <>
            <ExternalLink href={`https://supabase.com/dashboard/project/${projectRef}/auth/templates`}>
              Open the email templates
            </ExternalLink>
            <ExternalLink href={`https://supabase.com/dashboard/project/${projectRef}/auth/url-configuration`}>
              Open the URL settings
            </ExternalLink>
          </>
        )}
        <ExternalLink href={README_SETUP_URL}>Set-up guide (README)</ExternalLink>
      </div>
    </StatusCard>
  );
}

/* ------------------------------------------------------------------ *
 * AI hand-offs (status from getAiStatus() in lib/ai)
 * ------------------------------------------------------------------ */

const REVIEW_PROVIDER_LABEL: Readonly<Record<AiReviewStatus["provider"], string>> = {
  webhook: "Webhook (your own service)",
  claude: "Claude (Anthropic API)",
  mock: "Mock reviewer (test data only)",
  off: "None",
  misconfigured: "Not usable",
};

export function AiReviewCard({ status }: { status: AiReviewStatus }) {
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
      {/* "off" is both "nothing set" and "switched off on purpose" (AI_REVIEW_PROVIDER=off): the note covers both. */}
      <AiNote status={status}>
        Not connected: the review panel says so. To connect it, set <Variable>ANTHROPIC_API_KEY</Variable> or{" "}
        <Variable>AI_REVIEW_WEBHOOK_URL</Variable>. If <Variable>AI_REVIEW_PROVIDER</Variable> is set to{" "}
        <Option>off</Option>, change it to <Option>auto</Option>.
      </AiNote>
    </StatusCard>
  );
}

const REPORT_PROVIDER_LABEL: Readonly<Record<AiReportStatus["provider"], string>> = {
  webhook: "Webhook (your own service)",
  off: "None",
  misconfigured: "Not usable",
};

export function AiReportCard({ status }: { status: AiReportStatus }) {
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
          <Icon aria-hidden className="size-5 shrink-0 text-brand-600" />
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

/** One of a variable's documented options, e.g. "off" or "auto". */
function Option({ children }: { children: string }) {
  return <code className="font-mono text-foreground">{children}</code>;
}

/** A web address to copy into a setting; long ones may break anywhere. */
function Address({ children }: { children: string }) {
  return <span className="font-mono [overflow-wrap:anywhere] text-foreground">{children}</span>;
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

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

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

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
