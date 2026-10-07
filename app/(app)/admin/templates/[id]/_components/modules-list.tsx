// The version's modules in capture order (BUILD_SPEC 4.3): include state,
// the title and labels in the template's wording, fields its settings switch
// off, and each custom module where it shows, after the module it names.
// Native <details> for the label lists: no script, and keyboard and screen
// reader support come with the element.
import { ChevronRightIcon, CircleOffIcon, CirclePlusIcon, LockIcon, PowerIcon, type LucideIcon } from "lucide-react";
import type { CustomModuleView, ModuleView, SectionView } from "@/lib/admin/templates";
import { cn } from "@/lib/utils";
import { FIELD_TYPE_LABEL } from "../edit/_lib/field-types";

export function ModulesList({ sections }: { sections: SectionView[] }) {
  const included = sections.filter((section) => section.kind === "module" && section.include).length;
  const custom = sections.filter((section) => section.kind === "custom").length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        {included} of {sections.filter((section) => section.kind === "module").length} modules on
        {custom > 0 ? ` · ${custom} custom ${custom === 1 ? "module" : "modules"}` : ""}
      </p>
      <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {sections.map((section) =>
          section.kind === "module" ? (
            <ModuleItem key={`module:${section.key}`} section={section} />
          ) : (
            <CustomItem key={`custom:${section.key}`} section={section} />
          ),
        )}
      </ol>
    </div>
  );
}

function Chip({ icon: Icon, children, className }: { icon: LucideIcon; children: string; className: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap",
        "touch:h-7 touch:px-2.5 touch:text-sm [&>svg]:size-3.5",
        className,
      )}
    >
      <Icon aria-hidden />
      {children}
    </span>
  );
}

function IncludeChip({ section }: { section: ModuleView }) {
  if (section.alwaysOn) {
    return (
      <Chip icon={LockIcon} className="border-brand-200 bg-brand-50 text-brand-700">
        Always On
      </Chip>
    );
  }
  return section.include ? (
    <Chip icon={PowerIcon} className="border-brand-200 bg-brand-50 text-brand-700">
      On
    </Chip>
  ) : (
    <Chip icon={CircleOffIcon} className="border-dashed border-slate-400 bg-card text-slate-700">
      Off
    </Chip>
  );
}

const SUMMARY =
  "flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-brand-600 select-none focus-ring touch:min-h-11 touch:text-base [&::-webkit-details-marker]:hidden";

function ModuleItem({ section }: { section: ModuleView }) {
  const changed = section.labels.filter((label) => label.changed).length;
  return (
    <li
      data-module={section.key}
      data-include={section.include}
      className={cn("flex gap-3 px-3 py-2.5 touch:py-3", !section.include && "bg-slate-50")}
    >
      <span
        aria-hidden
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 tabular-nums"
      >
        {section.position}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="font-semibold break-words text-foreground">
            <span className="sr-only">{section.position}. </span>
            {section.title}
          </h3>
          <IncludeChip section={section} />
          {section.notBuilt && (
            <span className="text-sm text-muted-foreground">Not Built Yet</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          <code className="font-mono text-[0.8125rem] text-slate-700">{section.key}</code>
          {section.defaultTitle && <> · the module calls it “{section.defaultTitle}”</>}
        </p>
        {section.fieldsOff.length > 0 && (
          <p className="text-sm text-muted-foreground">Switched off: {section.fieldsOff.join(", ")}</p>
        )}
        {section.labels.length > 0 ? (
          <details className="group">
            <summary className={SUMMARY}>
              <ChevronRightIcon aria-hidden className="size-4 transition-transform group-open:rotate-90" />
              {section.labels.length} {section.labels.length === 1 ? "label" : "labels"}
              {changed > 0 && (
                <span className="font-normal text-muted-foreground">
                  · {changed} in this template&rsquo;s wording
                </span>
              )}
            </summary>
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              {section.labels.map((label) => (
                <div key={label.key} className="contents">
                  <dt className="font-mono text-[0.8125rem] break-all text-slate-700">{label.key}</dt>
                  <dd className="mb-1.5 break-words text-foreground sm:mb-0">
                    {label.label}
                    {label.changed && <span className="ml-2 text-muted-foreground">(template wording)</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ) : (
          <p className="text-sm text-muted-foreground">No labels set: the module&rsquo;s own wording applies.</p>
        )}
      </div>
    </li>
  );
}

const LAYOUT_LABEL: Record<CustomModuleView["layout"], string> = {
  fields: "a form",
  table: "a row per ordered size",
  grid: "a grid of repeated columns",
};

function CustomItem({ section }: { section: CustomModuleView }) {
  return (
    <li data-custom={section.key} className="flex gap-3 bg-accent-50/60 px-3 py-2.5 touch:py-3">
      <CirclePlusIcon aria-hidden className="mt-0.5 size-6 shrink-0 text-accent-700" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="font-semibold break-words text-foreground">{section.title}</h3>
          <Chip icon={CirclePlusIcon} className="border-accent-200 bg-card text-accent-700">
            Custom
          </Chip>
        </div>
        <p className="text-sm text-muted-foreground">
          <code className="font-mono text-[0.8125rem] text-slate-700">{section.key}</code> · after {section.afterTitle} ·{" "}
          {LAYOUT_LABEL[section.layout]}
        </p>
        <details className="group">
          <summary className={SUMMARY}>
            <ChevronRightIcon aria-hidden className="size-4 transition-transform group-open:rotate-90" />
            {section.fields.length} {section.fields.length === 1 ? "field" : "fields"}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 rounded-md bg-card p-3 text-sm ring-1 ring-border">
            {section.fields.map((field) => (
              <li key={field.key} className="break-words">
                <span className="font-medium text-foreground">{field.label}</span>{" "}
                <span className="text-muted-foreground">
                  · {FIELD_TYPE_LABEL[field.type]}
                  {field.unit ? ` (${field.unit})` : ""}
                  {field.required ? " · required" : ""}
                  {field.options.length > 0 ? ` · ${field.options.join(", ")}` : ""}
                  {field.mapsTo ? ` · shows ${field.mapsTo}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </li>
  );
}
