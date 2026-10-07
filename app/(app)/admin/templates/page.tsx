import type { Metadata } from "next";
import { FileStackIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { listTemplates, loadBaseOptions, type TemplateGroup } from "@/lib/admin/templates";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadScopeOptions } from "./[id]/edit/_lib/load";
import { NewTemplateDialog } from "./_components/new-template-dialog";
import { TemplateGroups } from "./_components/template-groups";

/**
 * The title checks the role too. Next resolves metadata apart from the page,
 * so a static title would still name this page on an inspector's 404 (in the
 * tab and the HTML); notFound() here swaps in the 404 page's metadata. The
 * session is cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Templates" };
}

/**
 * /admin/templates (BUILD_SPEC 4.2 rules 8 to 10, 10): every template by
 * code with its versions, status, scope, base template and how many
 * inspections use each version. A version opens its own page (coverage,
 * source file, activation); New template builds one on an active template
 * (BUILD_SPEC 4.5 step 2). Inspectors get a 404 from requireAdmin(); the
 * admin layout is not a security boundary, so this page checks for itself.
 *
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function TemplatesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [list, bases, scope] = await Promise.all([
    listTemplates(supabase),
    loadBaseOptions(supabase),
    // Without the clients and manufacturers a new template could not be scoped: no New template then.
    loadScopeOptions(supabase).catch((error: unknown) => {
      console.error("[admin/templates] could not read the clients and manufacturers", error);
      return null;
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Templates"
        actions={
          list.ok &&
          scope && (
            <NewTemplateDialog
              bases={bases}
              clients={scope.clients}
              manufacturers={scope.manufacturers}
              takenCodes={list.groups.map((group) => group.code)}
            />
          )
        }
      />

      {!list.ok ? (
        <Empty className="border border-fail-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-12 rounded-xl bg-fail-tint text-fail">
              <TriangleAlertIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>
              <h2 className="text-lg font-bold text-foreground">The templates could not be loaded</h2>
            </EmptyTitle>
            <EmptyDescription className="text-base text-muted-foreground fine:text-sm">
              Check the connection and reload the page. If it keeps happening, Supabase may be unavailable.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : list.groups.length === 0 ? (
        <Empty className="border border-dashed border-slate-300 bg-card px-6 py-12 md:py-16">
          <EmptyHeader className="max-w-md">
            <EmptyMedia variant="icon" className="size-12 rounded-xl bg-brand-50 text-brand-600">
              <FileStackIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>
              <h2 className="text-lg font-bold text-foreground">No templates yet</h2>
            </EmptyTitle>
            <EmptyDescription className="text-base text-muted-foreground fine:text-sm">
              Templates appear here by code, with every version. Inspectors can start inspections once a template has
              an active version. New template starts one.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <p className="text-sm text-muted-foreground tabular-nums">{describeList(list.groups)}</p>
          <TemplateGroups groups={list.groups} />
        </>
      )}
    </div>
  );
}

/** "3 templates · 5 versions · 2 active". */
function describeList(groups: readonly TemplateGroup[]): string {
  const versions = groups.reduce((sum, group) => sum + group.versions.length, 0);
  const active = groups.filter((group) => group.active).length;
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return [plural(groups.length, "template", "templates"), plural(versions, "version", "versions"), `${active} active`].join(
    " · ",
  );
}
