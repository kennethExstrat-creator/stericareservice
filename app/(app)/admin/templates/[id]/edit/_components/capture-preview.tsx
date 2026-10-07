"use client";

// Live capture preview (BUILD_SPEC 4.5 step 4, 10): the capture screen of
// every included module, drawn by the module's own Capture from
// modules/registry.ts with nothing entered and read-only, in the template's
// order with its wording, custom modules in their places. It follows the
// draft as it is edited, unsaved changes included. A Capture that fails is
// caught on its own card, which names the module; the rest still show.
// Files cannot be attached here (no FileSlotProvider): the modules that keep
// a lab report or certificate say so in their slot.
import { Component, lazy, Suspense, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { CameraIcon } from "lucide-react";
import { ModuleCard } from "@/components/qc";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { CustomModule, ResolvedModule, ResolvedTemplate } from "@/lib/schemas/template";
import { templateSections } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { buildInspectionContext, evaluateInspection, MODULE_REGISTRY } from "@/modules";
import {
  effectiveLabels,
  emptyInspectionData,
  parseModuleData,
  readModuleEntry,
  sizeLabel,
  type AnyModuleDefinition,
  type CaptureProps,
  type InspectionContext,
  type ModuleEvaluation,
} from "@/modules/_framework";
import { FIELD_TYPE_LABEL } from "./custom-module-form";

const NO_DATA = emptyInspectionData();
const noop = () => {};

type AnyCapture = ComponentType<CaptureProps<unknown, unknown>>;

/** Each built module's Capture, loaded on demand the first time it is drawn (definition.loadCapture). */
const CAPTURES: Readonly<Partial<Record<ModuleKey, AnyCapture>>> = Object.fromEntries(
  (Object.values(MODULE_REGISTRY) as AnyModuleDefinition[]).flatMap((definition) => {
    const load = definition.loadCapture;
    return load ? [[definition.key, lazy(async () => ({ default: (await load()).default as AnyCapture }))]] : [];
  }),
);

export function CapturePreview({
  resolved,
  stale,
  inspector,
}: {
  /** The draft as resolved; null when it has never resolved. */
  resolved: ResolvedTemplate | null;
  /** The draft has problems: this is the last version that resolved. */
  stale: boolean;
  inspector: { id: string; name: string };
}) {
  const [everySize, setEverySize] = useState(true);
  const context = useMemo(() => {
    if (!resolved) return null;
    const built = buildInspectionContext({ template: resolved, data: NO_DATA, meta: { inspector } });
    return everySize ? { ...built, sizes: resolved.sizes.map((size) => size.value) } : built;
  }, [resolved, everySize, inspector]);
  const evaluation = useMemo(
    () => (resolved && context ? evaluateInspection({ template: resolved, data: NO_DATA, context }) : null),
    [resolved, context],
  );

  if (!resolved || !context || !evaluation) {
    return (
      <p className="rounded-xl bg-card p-6 text-sm text-muted-foreground ring-1 ring-border">
        The preview appears once the template has no problems.
      </p>
    );
  }

  const sections = templateSections(resolved);
  return (
    <section aria-labelledby="preview-heading" className="grid gap-5" data-testid="capture-preview">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h2 id="preview-heading" className="text-lg font-bold text-foreground">
            Capture Preview
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            What inspectors see, with nothing entered. Read only; it follows your changes before they are saved.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="preview-every-size" checked={everySize} onCheckedChange={setEverySize} />
          <Label htmlFor="preview-every-size" className="font-normal">
            Show Every Size as Ordered
          </Label>
        </div>
      </div>
      {stale && (
        <p className="rounded-lg border border-warn-border bg-warn-tint px-4 py-3 text-sm text-warn" role="status">
          The template has problems, so this is the last version of it that worked. Fix them to see your latest changes.
        </p>
      )}
      <div className="grid gap-6 [--capture-sticky-top:calc(var(--shell-top)+var(--editor-bar-height,0px))]">
        {sections.map((section) =>
          section.kind === "module" ? (
            <PreviewModule
              key={section.key}
              resolvedModule={section.module}
              context={context}
              evaluation={evaluation.modules.find((entry) => entry.key === section.key) ?? null}
            />
          ) : (
            <PreviewCustom key={`custom-${section.key}`} custom={section.custom} context={context} />
          ),
        )}
      </div>
    </section>
  );
}

function PreviewModule({
  resolvedModule,
  context,
  evaluation,
}: {
  resolvedModule: ResolvedModule;
  context: InspectionContext;
  evaluation: ModuleEvaluation | null;
}) {
  const definition = MODULE_REGISTRY[resolvedModule.key];
  const Capture = CAPTURES[resolvedModule.key];
  const data = parseModuleData(definition, readModuleEntry(NO_DATA, "modules", resolvedModule.key));
  const config = definition.configSchema.safeParse(resolvedModule.config);
  const status = evaluation?.result.status ?? "not_done";

  let body: ReactNode;
  if (!Capture) {
    body = (
      <p className="text-sm text-muted-foreground">
        {definition.stub ? "Its capture screen arrives with the module." : "This module has no capture screen yet."}
      </p>
    );
  } else if (!data.success || !config.success) {
    body = <p className="text-sm text-destructive">The settings of this module do not read, so it cannot be shown.</p>;
  } else {
    body = (
      <CaptureBoundary key={JSON.stringify(resolvedModule)} title={resolvedModule.title} moduleKey={resolvedModule.key}>
        <Suspense fallback={<Skeleton className="h-32 w-full" />}>
          <Capture
            data={data.data}
            config={config.data}
            title={resolvedModule.title}
            labels={effectiveLabels(definition, resolvedModule)}
            context={context}
            evaluation={evaluation}
            focusPath={null}
            readOnly
            onChange={noop}
            onFocusChange={noop}
          />
        </Suspense>
      </CaptureBoundary>
    );
  }

  return (
    <div data-preview-module={resolvedModule.key}>
      <ModuleCard
        title={resolvedModule.title}
        status={status}
        description={evaluation?.result.summary}
        comment=""
        onCommentChange={noop}
        onFiles={noop}
        disabled
        headingLevel={3}
      >
        {body}
      </ModuleCard>
    </div>
  );
}

type BoundaryProps = {
  /** The module's heading in this template, and its key: both name it, for the admin and for a developer. */
  title: string;
  moduleKey: ModuleKey;
  children: ReactNode;
};

/**
 * One module's Capture, caught on its own: a module whose capture screen
 * throws (or whose code does not load) shows what failed, named, on its card.
 */
export class CaptureBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[template editor] the capture preview of ${this.props.moduleKey} failed`, error);
  }

  render() {
    const { error } = this.state;
    if (error) {
      const { title, moduleKey } = this.props;
      return (
        <div
          role="alert"
          data-preview-error={moduleKey}
          className="grid gap-1 rounded-lg border border-fail-border bg-fail-tint px-4 py-3 text-sm text-fail"
        >
          <p className="font-semibold">
            The capture screen of {title} ({moduleKey}) failed to draw.
          </p>
          <p className="break-words">{error.message || "No reason was given."}</p>
          <p>The other modules still show. The inspection screen may fail the same way: tell the developers.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ------------------------------------------------------------------ *
 * Custom modules: fields, a table per size, or a grid
 * ------------------------------------------------------------------ */

function PreviewCustom({ custom, context }: { custom: CustomModule; context: InspectionContext }) {
  return (
    <div data-preview-custom={custom.key}>
      <ModuleCard
        title={custom.title}
        status="not_done"
        comment=""
        onCommentChange={noop}
        onFiles={noop}
        disabled
        headingLevel={3}
      >
        {custom.layout === "fields" && <CustomFields custom={custom} />}
        {custom.layout === "table" && <CustomTable custom={custom} context={context} />}
        {custom.layout === "grid" && <CustomGrid custom={custom} context={context} />}
      </ModuleCard>
    </div>
  );
}

function fieldCaption(field: CustomModule["fields"][number]): string {
  return `${field.label}${field.unit ? ` (${field.unit})` : ""}${field.required ? " *" : ""}`;
}

function CustomFields({ custom }: { custom: CustomModule }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {custom.fields.map((field) => (
        <div key={field.key} className="grid gap-1.5">
          <dt className="text-sm font-medium text-foreground">{fieldCaption(field)}</dt>
          <dd className="grid gap-1">
            <EmptyControl type={field.type} options={field.options} />
            {field.hint && <span className="text-sm text-muted-foreground">{field.hint}</span>}
            {field.mapsTo && <span className="text-sm text-muted-foreground">Shows {field.mapsTo.split(".").slice(1).join(" › ")}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CustomTable({ custom, context }: { custom: CustomModule; context: InspectionContext }) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{custom.title}</caption>
        <thead className="bg-slate-50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">
              Size
            </th>
            {custom.fields.map((field) => (
              <th key={field.key} scope="col" className="px-3 py-2 font-semibold">
                {fieldCaption(field)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {context.sizes.length === 0 && (
            <tr>
              <td colSpan={custom.fields.length + 1} className="px-3 py-3 text-muted-foreground">
                One row per ordered size.
              </td>
            </tr>
          )}
          {context.sizes.map((size) => (
            <tr key={size} className="border-t border-border">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {sizeLabel(context, size)}
              </th>
              {custom.fields.map((field) => (
                <td key={field.key} className="px-3 py-2">
                  <EmptyControl type={field.type} options={field.options} compact />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomGrid({ custom, context }: { custom: CustomModule; context: InspectionContext }) {
  const columns = custom.grid?.columns;
  const count = Math.min(columns?.default ?? 1, 13);
  const blocks = custom.grid?.repeatPer === "size" ? context.sizes : [null];
  return (
    <div className="grid gap-4">
      {blocks.map((size) => (
        <div key={size ?? "all"} className="grid gap-2">
          {size && <p className="text-sm font-semibold text-foreground">Size {sizeLabel(context, size)}</p>}
          <div className="overflow-x-auto rounded-lg ring-1 ring-border">
            <table className="text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    <span className="sr-only">Field</span>
                  </th>
                  {Array.from({ length: count }, (_, index) => (
                    <th key={index} scope="col" className="px-2 py-2 font-semibold whitespace-nowrap">
                      {columns?.label} {index + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {custom.fields.map((field) => (
                  <tr key={field.key} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                      {fieldCaption(field)}
                    </th>
                    {Array.from({ length: count }, (_, index) => (
                      <td key={index} className="px-2 py-1.5">
                        <span className="block h-8 min-w-12 rounded-md border border-input bg-muted" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            {(columns?.default ?? 1) > count ? `${columns?.default} columns in all. ` : ""}
            {columns?.addable ? "The inspector can add more." : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

/** What an empty field of a type looks like, read-only. */
function EmptyControl({
  type,
  options,
  compact = false,
}: {
  type: CustomModule["fields"][number]["type"];
  options?: readonly string[];
  compact?: boolean;
}) {
  const box = cn("flex items-center rounded-md border border-input bg-muted px-2.5 text-sm text-muted-foreground", compact ? "h-8" : "h-9 touch:h-11");
  switch (type) {
    case "photo":
      return (
        <span className={box}>
          <CameraIcon aria-hidden className="mr-2 size-4" />
          Photo
        </span>
      );
    case "select":
      return <span className={box}>{options && options.length > 0 ? options.join(" / ") : "Choose…"}</span>;
    case "yes_no":
      return <span className={box}>Yes / No</span>;
    case "textarea":
      return <span className={cn(box, "h-16 items-start py-2")}>{FIELD_TYPE_LABEL.textarea}</span>;
    default:
      return <span className={box}>{FIELD_TYPE_LABEL[type]}</span>;
  }
}
