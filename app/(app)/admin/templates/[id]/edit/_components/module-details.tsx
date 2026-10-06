"use client";

// One module of the template: on or off, where it sits, its heading and
// labels in the source's wording, and its settings (BUILD_SPEC 4.3
// ModuleConfig). Everything shows what the template inherits next to what it
// sets itself.
import { ArrowDownIcon, ArrowUpIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { cn } from "@/lib/utils";
import { isAlwaysOn, moduleView, resetModule, setInclude, setTitle } from "../_lib/model";
import { problemsOfModule } from "../_lib/problems";
import { ConfigForm } from "./config-form";
import type { EditorApi } from "./editor-api";
import { LabelOverrides } from "./label-overrides";

/** Ids the problem list links to. */
export const titleFieldId = (key: ModuleKey) => `title-${key}`;
export const includeFieldId = (key: ModuleKey) => `include-${key}`;

export function ModuleDetails({
  api,
  moduleKey,
  position,
  total,
  onMove,
  headingId,
}: {
  api: EditorApi;
  moduleKey: ModuleKey;
  /** Zero-based place in the template's order. */
  position: number;
  total: number;
  onMove: (to: number) => void;
  headingId: string;
}) {
  const view = moduleView(api.draft, api.context, moduleKey);
  const definition = api.context.registry[moduleKey];
  const problems = problemsOfModule(api.problems, moduleKey);
  const pinned = isAlwaysOn(moduleKey);
  const partProblems = (part: string) =>
    problems.filter((problem) => problem.place.area === "module" && problem.place.part === part);
  const includeProblems = [...partProblems("include"), ...partProblems("entry")];
  const titleProblems = partProblems("title");
  const configProblemCount = partProblems("config").length;
  const first = position <= 1;
  const last = position >= total - 2;

  return (
    <div className="grid gap-5" data-testid="module-details" data-module-key={moduleKey}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 id={headingId} tabIndex={-1} className="text-xl leading-snug font-bold text-balance text-foreground outline-none">
            {view.title}
          </h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{moduleKey}</span>
            {definition.stub && <span>· Not built yet</span>}
            {definition.perSize && <span>· Per size</span>}
          </p>
        </div>
        {api.editable && view.changed && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => api.update((draft) => resetModule(draft, moduleKey))}
          >
            <RotateCcwIcon aria-hidden />
            Undo this template&apos;s changes
          </Button>
        )}
      </header>

      <Section title="In this template">
        <div className="flex items-start gap-3">
          <Switch
            id={includeFieldId(moduleKey)}
            checked={view.include}
            disabled={pinned || !api.editable}
            onCheckedChange={(checked) => api.update((draft, context) => setInclude(draft, context, moduleKey, checked))}
            className="mt-0.5 touch:mt-0"
            aria-describedby={[`${includeFieldId(moduleKey)}-hint`, includeProblems.length > 0 ? `${includeFieldId(moduleKey)}-errors` : null]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={includeProblems.length > 0 ? true : undefined}
          />
          <div className="grid gap-1">
            <Label htmlFor={includeFieldId(moduleKey)}>{pinned ? "Always on" : "Include this module"}</Label>
            <p id={`${includeFieldId(moduleKey)}-hint`} className="text-sm text-muted-foreground">
              {pinned
                ? "Header and conclusion are in every template; switch their fields off in the settings instead."
                : view.include
                  ? "Inspectors fill it in, and it goes into the export."
                  : "Off: it is not on the capture screen, in validation or in the export."}
            </p>
          </div>
        </div>
        <Problems id={`${includeFieldId(moduleKey)}-errors`} problems={includeProblems} />
        {!pinned && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
              Position {position + 1} of {total}
            </p>
            {api.editable && (
              <>
                <Button type="button" variant="outline" size="sm" disabled={first} onClick={() => onMove(position - 1)}>
                  <ArrowUpIcon aria-hidden />
                  Move up
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={last} onClick={() => onMove(position + 1)}>
                  <ArrowDownIcon aria-hidden />
                  Move down
                </Button>
              </>
            )}
          </div>
        )}
      </Section>

      <Section title="Heading">
        <div className="grid gap-1.5">
          <Label htmlFor={titleFieldId(moduleKey)}>Heading in the form&apos;s wording</Label>
          <Input
            id={titleFieldId(moduleKey)}
            value={view.entry?.title ?? ""}
            placeholder="Same as the default"
            readOnly={!api.editable}
            autoComplete="off"
            aria-describedby={[`${titleFieldId(moduleKey)}-hint`, titleProblems.length > 0 ? `${titleFieldId(moduleKey)}-errors` : null]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={titleProblems.length > 0 ? true : undefined}
            onChange={(event) => api.update((draft, context) => setTitle(draft, context, moduleKey, event.target.value))}
          />
          <p id={`${titleFieldId(moduleKey)}-hint`} className="text-sm text-muted-foreground">
            Default: “{view.inherited.title}”. Leave empty to use it.
          </p>
          <Problems id={`${titleFieldId(moduleKey)}-errors`} problems={titleProblems} />
        </div>
      </Section>

      <Section title="Labels" description="The template's wording for each field. Leave a field empty to use the default.">
        <LabelOverrides api={api} view={view} problems={problems} />
      </Section>

      <Section
        title="Settings"
        description={
          definition.stub
            ? "This module is not built yet, so its settings are free-form JSON. They are checked against its own settings once it lands."
            : "Generated from the module's settings. Values this template sets are marked Changed and can be reset."
        }
        badge={configProblemCount > 0 ? `${configProblemCount} to fix` : undefined}
      >
        <ConfigForm api={api} view={view} />
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-xl bg-card p-4 shadow-sm ring-1 ring-border sm:p-5">
      <div className="grid gap-1">
        <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-foreground">
          {title}
          {badge && <span className="rounded-full bg-fail-tint px-2 py-0.5 text-xs font-medium text-fail">{badge}</span>}
        </h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Problems({
  id,
  problems,
  className,
}: {
  id?: string;
  problems: readonly { id: string; message: string }[];
  className?: string;
}) {
  if (problems.length === 0) return null;
  return (
    <div id={id} className={cn("grid gap-1", className)}>
      {problems.map((problem) => (
        <p key={problem.id} className="text-sm text-destructive">
          {problem.message}
        </p>
      ))}
    </div>
  );
}

/** The details of a module by key, for the sheet and the side panel. */
export function moduleTitle(api: EditorApi, key: ModuleKey): string {
  return moduleView(api.draft, api.context, key).title;
}
