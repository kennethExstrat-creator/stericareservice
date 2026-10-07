// The read-only parts of a version's page: what it is (details), its
// siblings (versions of the code) and what needs attention (notices).
// Server components; the dates arrive formatted in Malaysia time.
import Link from "next/link";
import type { ReactNode } from "react";
import { CircleCheckIcon, InfoIcon, LockIcon, OctagonXIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  changeAdvice,
  PRODUCT_TYPE_LABEL,
  STANDARD_LABEL,
  templatePath,
  usageText,
  type ConfigProblem,
  type TemplateVersionDetail,
  type VersionOfCode,
} from "@/lib/admin/templates";
import { cn } from "@/lib/utils";
import { TemplateStatusBadge } from "../../_components/template-status-badge";

/* ------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------ */

export function Panel({
  title,
  description,
  children,
  className,
  id,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = `${id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-4 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border", className)}
    >
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="font-display text-lg font-bold text-foreground">
          {title}
        </h2>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Details
 * ------------------------------------------------------------------ */

export type DetailsView = {
  detail: TemplateVersionDetail;
  /** The base's active version page, when the base has one. */
  baseHref: string | null;
  /** "built on version 1" for each base, nearest first. */
  bases: string[];
  sizes: string | null;
  unit: string | null;
  reportTitle: string | null;
  clientLogo: boolean | null;
  /** Whether submitting asks for an AI second opinion (BUILD_SPEC 9.2); null until the version resolves. */
  aiOnSubmit: boolean | null;
  confirmedText: string | null;
  createdText: string;
  updatedText: string;
};

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 py-1.5 touch:py-2">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-sm break-words text-foreground touch:text-base">{children}</dd>
    </div>
  );
}

export function DetailsPanel({ view }: { view: DetailsView }) {
  const { detail } = view;
  return (
    <Panel title="Details">
      <dl className="-my-1.5 divide-y divide-border">
        <Row term="Status">
          <TemplateStatusBadge status={detail.status} />
        </Row>
        {detail.name && <Row term="Name">{detail.name}</Row>}
        <Row term="Product">
          {PRODUCT_TYPE_LABEL[detail.productType]} · {STANDARD_LABEL[detail.standard]}
        </Row>
        <Row term="Client">
          {detail.clientName ?? (detail.clientId ? "A client no longer listed" : "Any client")}
        </Row>
        <Row term="Manufacturer">
          {detail.manufacturerName ?? (detail.manufacturerId ? "A manufacturer no longer listed" : "Any manufacturer")}
        </Row>
        <Row term="Extends">
          {detail.extendsCode ? (
            <>
              {view.baseHref ? (
                // On touch, 10 px of padding above and below makes the target 44 px (docs/DESIGN.md); the
                // same negative margin keeps the text on its line, level with its label, even when it wraps.
                <Link
                  href={view.baseHref}
                  className="inline-flex rounded-sm font-medium break-all text-brand-600 underline-offset-4 hover:underline focus-ring touch:-my-2.5 touch:py-2.5"
                >
                  {detail.extendsCode}
                </Link>
              ) : (
                detail.extendsCode
              )}
              {view.bases.length > 0 && <span className="block text-sm text-muted-foreground">{view.bases.join("; ")}</span>}
            </>
          ) : (
            "Nothing: a base template"
          )}
        </Row>
        {view.unit && <Row term="Unit">{view.unit}</Row>}
        {view.sizes && <Row term="Sizes">{view.sizes}</Row>}
        {view.reportTitle && (
          <Row term="Report">
            {view.reportTitle}
            {view.clientLogo !== null && (
              <span className="block text-sm text-muted-foreground">
                {view.clientLogo ? "With the client's logo" : "Without a client logo"}
              </span>
            )}
          </Row>
        )}
        {view.aiOnSubmit !== null && (
          <Row term="AI Second Opinion">{view.aiOnSubmit ? "On submit, and when an admin asks" : "Only when an admin asks"}</Row>
        )}
        <Row term="Used By">{usageText(detail.usage)}</Row>
        <Row term="Coverage">
          {view.confirmedText ? (
            <span className="inline-flex items-start gap-1.5 text-pass">
              <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>Confirmed {view.confirmedText}</span>
            </span>
          ) : (
            "Not confirmed"
          )}
        </Row>
        <Row term="Created">{view.createdText}</Row>
        <Row term="Last Changed">{view.updatedText}</Row>
      </dl>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Versions of the code
 * ------------------------------------------------------------------ */

export function VersionsPanel({ code, current, versions }: { code: string; current: string; versions: VersionOfCode[] }) {
  return (
    <Panel title="Versions" description={`Every version of ${code}, newest first.`}>
      <ol className="-my-1 divide-y divide-border">
        {versions.map((entry) => {
          const isCurrent = entry.id === current;
          const label = `Version ${entry.version}`;
          return (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 touch:py-2">
              {isCurrent ? (
                <span aria-current="page" className="font-semibold text-foreground tabular-nums">
                  {label}
                  <span className="sr-only"> (this page)</span>
                </span>
              ) : (
                <Link
                  href={templatePath(entry.id)}
                  className="inline-flex items-center rounded-sm font-medium text-brand-600 tabular-nums underline-offset-4 hover:underline focus-ring touch:min-h-11"
                >
                  {label}
                </Link>
              )}
              <TemplateStatusBadge status={entry.status} />
              <span className="ml-auto text-sm text-muted-foreground tabular-nums">{usageText(entry.usage)}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

type Tone = "info" | "warn" | "fail";

const TONE: Record<Tone, { icon: LucideIcon; className: string; text: string }> = {
  info: { icon: InfoIcon, className: "border-info-border bg-info-tint text-info", text: "text-info" },
  warn: { icon: TriangleAlertIcon, className: "border-warn-border bg-warn-tint text-warn", text: "text-warn" },
  fail: { icon: OctagonXIcon, className: "border-fail-border bg-fail-tint text-fail", text: "text-fail" },
};

function Notice({
  tone,
  title,
  icon,
  children,
  id,
}: {
  tone: Tone;
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
  id?: string;
}) {
  const look = TONE[tone];
  const Icon = icon ?? look.icon;
  return (
    // A notice describes the page as it loads: role="note", not an alert to read out.
    <Alert role="note" id={id} className={look.className}>
      <Icon aria-hidden />
      <AlertTitle className="font-semibold">{title}</AlertTitle>
      <AlertDescription className={cn(look.text, "[&_ul]:mt-1 [&_ul]:list-disc [&_ul]:pl-5")}>{children}</AlertDescription>
    </Alert>
  );
}

export type NoticesView = {
  detail: TemplateVersionDetail;
  stale: { code: string; resolvedWith: number; active: number | null }[];
  ties: { code: string; version: number }[];
  problems: ConfigProblem[];
  blockers: string[];
  blockersId: string;
};

export function Notices({ view }: { view: NoticesView }) {
  const { detail, stale, ties, problems, blockers, blockersId } = view;
  // In the words of what the page offers: the editor for a draft no inspection uses, else a new version.
  const advice = changeAdvice(detail);
  const notices: ReactNode[] = [];

  if (detail.usage > 0) {
    notices.push(
      <Notice key="frozen" tone="info" icon={LockIcon} title={`Frozen: used by ${usageText(detail.usage)}`}>
        Version {detail.version} can no longer change. Every inspection keeps the exact version it started with (BUILD_SPEC
        4.2 rule 8), so the database refuses any edit to a version an inspection uses. To change {detail.code}, make a new
        version.
      </Notice>,
    );
  }
  if (detail.resolution.state === "missing") {
    notices.push(
      <Notice key="unresolved" tone="warn" title="Not resolved">
        This version has not been resolved down its extends chain, so it shows no modules and cannot be activated.{" "}
        {advice.unresolved}
      </Notice>,
    );
  } else if (detail.resolution.state === "invalid") {
    notices.push(
      <Notice key="invalid" tone="warn" title="Resolved by an earlier build">
        The stored resolution of this version cannot be read now, so it cannot be activated. {advice.outdated}
        <ul>
          {detail.resolution.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      </Notice>,
    );
  }
  if (!detail.definition.ok) {
    notices.push(
      <Notice key="definition" tone="warn" title="The definition has problems">
        The template editor lists them where they are. In short:
        <ul>
          {detail.definition.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      </Notice>,
    );
  }
  if (problems.length > 0) {
    notices.push(
      <Notice key="config" tone="fail" title="Settings that no longer fit their modules">
        Inspections would show a settings error in these modules, so this version cannot be activated. {advice.settings}
        <ul>
          {problems.map((problem) => (
            <li key={problem.key}>
              {problem.title}: {problem.messages.join("; ")}
            </li>
          ))}
        </ul>
      </Notice>,
    );
  }
  for (const base of stale) {
    notices.push(
      base.active === null ? (
        <Notice key={`stale-${base.code}`} tone="warn" title={`${base.code} has no active version`}>
          This version was built on {base.code} version {base.resolvedWith}, which is not active now. It keeps what it took
          from {base.code}. Once {base.code} has an active version, a new version takes in its changes.
        </Notice>
      ) : (
        <Notice key={`stale-${base.code}`} tone="warn" title={`${base.code} has moved on`}>
          This version was built on {base.code} version {base.resolvedWith}; {base.code}&rsquo;s active version is now{" "}
          {base.active}. A new version takes in its changes.
        </Notice>
      ),
    );
  }
  if (ties.length > 0) {
    const names = ties.map((tie) => `${tie.code} version ${tie.version}`).join(", ");
    notices.push(
      <Notice key="ties" tone="warn" title="Another template has the same scope">
        {names} {ties.length === 1 ? "is" : "are"} active for exactly this product type, client and manufacturer.{" "}
        {detail.status === "active" ? "New inspections" : "Once this version is active, new inspections"} for that scope get
        the template whose code comes first in the alphabet.
      </Notice>,
    );
  }
  if (blockers.length > 0) {
    notices.push(
      <Notice key="blockers" id={blockersId} tone="info" title="Before this version can be activated">
        <ul>
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      </Notice>,
    );
  }

  if (notices.length === 0) return null;
  return <div className="flex flex-col gap-3">{notices}</div>;
}
