import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { TemplateEditor } from "./_components/template-editor";
import { loadActiveBases, loadDefectCodes, loadEditorTemplate } from "./_lib/load";

/** A template version by id, or nothing for an id that cannot be one. */
async function templateFor(id: string) {
  return z.uuid().safeParse(id).success ? loadEditorTemplate(id) : null;
}

/**
 * The title names the template, so it checks the role first: Next resolves
 * metadata on its own, and an inspector's 404 must not name anything. The
 * session and the template are read once per request (React cache).
 */
export async function generateMetadata({ params }: PageProps<"/admin/templates/[id]/edit">): Promise<Metadata> {
  await requireAdmin();
  const template = await templateFor((await params).id);
  if (!template) notFound();
  return { title: `Edit ${template.code} v${template.version}` };
}

/**
 * /admin/templates/[id]/edit (BUILD_SPEC 4.5 and 10): the template editor for
 * one version. Admins only; inspectors get a 404 from requireAdmin(). A draft
 * no inspection uses is edited and saved here; any other version opens read
 * only, with "New version".
 *
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function TemplateEditPage({ params }: PageProps<"/admin/templates/[id]/edit">) {
  const viewer = await requireAdmin();
  const template = await templateFor((await params).id);
  if (!template) notFound();
  const [bases, defectCodes] = await Promise.all([loadActiveBases(), loadDefectCodes()]);

  return (
    <TemplateEditor
      key={template.id}
      template={template}
      bases={bases}
      defectCodes={defectCodes}
      viewer={{ id: viewer.id, name: viewer.fullName ?? viewer.email }}
    />
  );
}
