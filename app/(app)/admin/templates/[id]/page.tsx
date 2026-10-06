import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/qc";
import {
  activationBlockers,
  configProblems,
  coverageBlocker,
  coverageChecklist,
  formatBytes,
  formatDateTime,
  loadTemplateVersion,
  nextVersionOf,
  scopeTies,
  sectionViews,
  SOURCE_ACCEPT,
  SOURCE_BUCKET,
  SOURCE_MAX_BYTES,
  SOURCE_TYPE_HINT,
  SOURCE_TYPE_PROBLEM,
  SOURCE_TYPES,
  sourceChangeBlocker,
  sourceFileInfo,
  sourceFileType,
  staleBasesOf,
  templateEditPath,
  templatePath,
  TEMPLATES_PATH,
  UNIT_LABEL,
  type SourceFileInfo,
} from "@/lib/admin/templates";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { MODULE_REGISTRY } from "@/modules";
import { TemplateStatusBadge } from "../_components/template-status-badge";
import { CoverageChecklist } from "./_components/coverage-checklist";
import { ModulesList } from "./_components/modules-list";
import { SourceFile, type SourceFileView } from "./_components/source-file";
import { VersionActions } from "./_components/version-actions";
import { DetailsPanel, Notices, Panel, VersionsPanel } from "./_components/version-panels";

/** One read per request, shared by the title and the page. A malformed id is simply not found. */
const loadVersion = cache(async (id: string) => {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return null;
  const supabase = await createClient();
  return loadTemplateVersion(supabase, parsed.data.toLowerCase());
});

/**
 * The title checks the role first: Next resolves metadata apart from the
 * page, so a title read before requireAdmin() would name the template on an
 * inspector's 404. notFound() swaps in the 404 page's metadata.
 */
export async function generateMetadata({ params }: PageProps<"/admin/templates/[id]">): Promise<Metadata> {
  await requireAdmin();
  const detail = await loadVersion((await params).id);
  if (!detail) notFound();
  return { title: `${detail.code} version ${detail.version}` };
}

/**
 * /admin/templates/[id] (BUILD_SPEC 4.2 rules 8 to 10, 4.5): one template
 * version. Its resolved modules in order with their wording, its custom
 * modules, the source form (upload on a draft, download always), the field
 * coverage checklist, and activate, retire or a new version. A version an
 * inspection uses is frozen; the page says so and offers a new version.
 */
export default async function TemplateVersionPage({ params }: PageProps<"/admin/templates/[id]">) {
  await requireAdmin();
  const detail = await loadVersion((await params).id);
  if (!detail) notFound();

  const supabase = await createClient();
  const source = detail.sourceFilePath ? await sourceFileInfo(supabase, detail.sourceFilePath) : null;
  const template = detail.resolution.state === "ok" ? detail.resolution.template : null;
  const sections = template ? sectionViews(template, MODULE_REGISTRY) : [];
  const checklist = template ? coverageChecklist(template) : null;
  const problems = template ? configProblems(template, MODULE_REGISTRY) : [];
  const blockers = activationBlockers(detail, problems);
  const stale = staleBasesOf(detail);
  const ties = scopeTies(detail);
  const activeOfCode = detail.versions.find((entry) => entry.status === "active" && entry.id !== detail.id) ?? null;
  // Newest first: the code's latest draft, when it is another version.
  const openDraft = detail.versions.find((entry) => entry.status === "draft" && entry.id !== detail.id) ?? null;
  const baseActive = detail.extendsCode
    ? detail.activeTemplates.find((entry) => entry.code === detail.extendsCode) ?? null
    : null;
  const blockersId = "activation-blockers";
  const confirmedText = detail.coverageConfirmedAt
    ? `by ${detail.coverageConfirmedBy ?? "an admin"} on ${formatDateTime(detail.coverageConfirmedAt)}`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={TEMPLATES_PATH}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-brand-600 underline-offset-4 hover:underline focus-ring touch:min-h-11 touch:text-base"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        All templates
      </Link>

      <PageHeader
        eyebrow="Template"
        title={
          <>
            {detail.code} <span className="text-muted-foreground">version {detail.version}</span>
          </>
        }
        description={
          <div className="flex flex-col gap-2">
            {detail.name && <p>{detail.name}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <TemplateStatusBadge status={detail.status} />
            </div>
          </div>
        }
        actions={
          <VersionActions
            templateId={detail.id}
            seen={detail.updatedAt}
            code={detail.code}
            version={detail.version}
            status={detail.status}
            editHref={templateEditPath(detail.id)}
            canActivate={blockers.length === 0}
            activationBlockersId={blockersId}
            activeVersion={activeOfCode?.version ?? null}
            nextVersion={nextVersionOf(detail.versions)}
            openDraft={openDraft ? { version: openDraft.version, href: templatePath(openDraft.id) } : null}
            usage={detail.usage}
            activationWarnings={[
              ...ties.map(
                (tie) =>
                  `${tie.code} version ${tie.version} is also active for exactly this scope: new inspections get the template whose code comes first in the alphabet.`,
              ),
              ...stale.map((base) =>
                base.active === null
                  ? `Built on ${base.code} version ${base.resolvedWith}, which is no longer active.`
                  : `Built on ${base.code} version ${base.resolvedWith}; version ${base.active} is active now. A new version would take in its changes.`,
              ),
            ]}
          />
        }
      />

      <Notices view={{ detail, stale, ties, problems, blockers, blockersId }} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <aside
          aria-label="About this version"
          className="grid gap-6 md:grid-cols-2 md:items-start xl:col-start-2 xl:row-start-1 xl:grid-cols-1"
        >
          <DetailsPanel
            view={{
              detail,
              baseHref: baseActive ? templatePath(baseActive.id) : null,
              bases: template ? template.bases.map((base) => `${base.code}: built on version ${base.version}`) : [],
              sizes: template
                ? template.sizes.map((size) => (size.label === size.value ? size.value : `${size.label} (${size.value})`)).join(", ")
                : null,
              unit: template ? UNIT_LABEL[template.unit] : null,
              reportTitle: template?.report.title ?? null,
              clientLogo: template ? template.report.showClientLogo : null,
              confirmedText,
              createdText: formatDateTime(detail.createdAt),
              updatedText: formatDateTime(detail.updatedAt),
            }}
          />
          {/* One column beside the details on iPad, so each card keeps its own height. */}
          <div className="flex min-w-0 flex-col gap-6">
            <Panel title="Source file" description="The original form or report this version was built from (BUILD_SPEC 4.2 rule 10).">
              <SourceFile
                templateId={detail.id}
                file={source ? sourceView(source) : null}
                changeBlocked={sourceChangeBlocker({ ...detail, hasFile: detail.sourceFilePath !== null })}
                coverageConfirmed={detail.coverageConfirmedAt !== null}
                bucket={SOURCE_BUCKET}
                accept={SOURCE_ACCEPT}
                types={Object.fromEntries(Object.entries(SOURCE_TYPES).map(([type, entry]) => [type, entry.extensions]))}
                maxBytes={SOURCE_MAX_BYTES}
                hint={SOURCE_TYPE_HINT}
                typeProblem={SOURCE_TYPE_PROBLEM}
              />
            </Panel>
            <VersionsPanel code={detail.code} current={detail.id} versions={detail.versions} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1">
          <Panel
            title="Modules"
            description="In capture order, as this version resolves them: modules switched on and off, titles and labels in the template's wording, and custom modules where they show."
          >
            {template ? (
              <ModulesList sections={sections} />
            ) : (
              <p className="text-sm text-muted-foreground touch:text-base">
                Nothing to show until this version resolves. Open it in the editor and save it without problems.
              </p>
            )}
          </Panel>
          <Panel id="coverage" title="Coverage checklist">
            <CoverageChecklist
              templateId={detail.id}
              seen={detail.updatedAt}
              code={detail.code}
              checklist={checklist}
              confirmed={
                detail.coverageConfirmedAt
                  ? { by: detail.coverageConfirmedBy ?? "an admin", at: formatDateTime(detail.coverageConfirmedAt) }
                  : null
              }
              blocker={detail.coverageConfirmedAt ? null : coverageBlocker(detail, checklist)}
              sourceFileName={source?.name ?? null}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** "Excel · 1.2 MB · added 6 Oct 2026, 14:05". */
function sourceView(info: SourceFileInfo): SourceFileView {
  const type = sourceFileType(info.name, "");
  const kind = type ? SOURCE_TYPES[type].kind : null;
  const parts = [
    kind,
    info.size !== null ? formatBytes(info.size) : null,
    info.uploadedAt ? `added ${formatDateTime(info.uploadedAt)}` : null,
  ].filter((part): part is string => part !== null);
  return { name: info.name, details: parts.length > 0 ? parts.join(" · ") : null, missing: info.missing };
}
