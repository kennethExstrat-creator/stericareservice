"use client";

// The body of the open section. A module renders its own Capture
// (modules/<key>/Capture.tsx, loaded on demand through the registry) with
// the props of the contract (docs/MODULES.md 10); a module without one shows
// a simplified form of its canonical paths, a placeholder module says it is
// not built yet, and a custom module gets the screen's own form. A module
// whose settings or saved data cannot be read says so instead of guessing.
import { lazy, Suspense, useMemo, type LazyExoticComponent, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedModule } from "@/lib/schemas/template";
import type { IssuePath, ValidationIssue } from "@/lib/validation";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  effectiveLabels,
  parseModuleData,
  readModuleEntry,
  type CaptureComponent,
  type CaptureFocus,
  type CustomModuleEvaluation,
  type InspectionContext,
  type ModuleEvaluation,
} from "@/modules/_framework";
import { CustomModuleForm, FallbackModuleForm } from "./plain-forms";
import { SectionErrorBoundary } from "./section-error-boundary";

type LazyCapture = LazyExoticComponent<CaptureComponent>;

function lazyCapture(key: ModuleKey): LazyCapture | null {
  const load = MODULE_REGISTRY[key].loadCapture;
  return load ? lazy(() => load()) : null;
}

/* One lazy component per module, made once for the page, so switching back
   and forth never downloads a form's code again. A download that failed is
   made afresh by "Try again" (SectionErrorBoundary's onReset). */
const CAPTURES: Partial<Record<ModuleKey, LazyCapture | null>> = Object.fromEntries(
  MODULE_KEYS.map((key) => [key, lazyCapture(key)]),
);

type ModuleBodyProps = {
  moduleKey: ModuleKey;
  resolved: ResolvedModule;
  /** `data.modules.<key>` as stored, comment included. */
  entry: unknown;
  evaluation: ModuleEvaluation | null;
  context: InspectionContext;
  focusPath: IssuePath | null;
  readOnly: boolean;
  onChange: (next: unknown) => void;
  onFocusChange: (focus: CaptureFocus) => void;
};

export function ModuleBody({
  moduleKey,
  resolved,
  entry,
  evaluation,
  context,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: ModuleBodyProps) {
  const definition = MODULE_REGISTRY[moduleKey];
  const labels = useMemo(() => effectiveLabels(definition, resolved), [definition, resolved]);
  const config = useMemo(() => definition.configSchema.safeParse(resolved.config), [definition, resolved.config]);
  // Every saved size, also those no longer ordered: Capture hands them back unchanged (docs/MODULES.md 10).
  const saved = useMemo(
    () => parseModuleData(definition, readModuleEntry({ modules: { [moduleKey]: entry }, custom: {} }, "modules", moduleKey)),
    [definition, entry, moduleKey],
  );

  if (definition.stub) {
    return (
      <Notice>
        This section arrives in a later build. Nothing can be entered here yet; the checks show it as Not done.
      </Notice>
    );
  }
  if (!config.success) {
    const issue = config.error.issues[0];
    return (
      <Problem>
        The template&apos;s settings for this section are invalid
        {issue ? ` (${[...issue.path.map(String), issue.message].join(": ")})` : ""}. Ask an admin to fix the template.
      </Problem>
    );
  }
  if (!saved.success) {
    const issue = saved.error.issues[0];
    return (
      <Problem>
        What is saved for this section cannot be read
        {issue ? ` (${[...issue.path.map(String), issue.message].join(": ")})` : ""}. It is kept as it is; report this to
        a developer.
      </Problem>
    );
  }

  const Capture = CAPTURES[moduleKey];
  if (!Capture) {
    return (
      <FallbackModuleForm
        definition={definition}
        data={saved.data}
        config={config.data}
        labels={labels}
        issues={evaluation?.issues ?? []}
        focusPath={focusPath}
        readOnly={readOnly}
        onChange={onChange}
      />
    );
  }
  return (
    <SectionErrorBoundary title={resolved.title} onReset={() => (CAPTURES[moduleKey] = lazyCapture(moduleKey))}>
      <Suspense fallback={<BodySkeleton />}>
        <Capture
          data={saved.data}
          config={config.data}
          title={resolved.title}
          labels={labels}
          context={context}
          evaluation={evaluation}
          focusPath={focusPath}
          readOnly={readOnly}
          onChange={onChange}
          onFocusChange={onFocusChange}
        />
      </Suspense>
    </SectionErrorBoundary>
  );
}

export function CustomBody({
  evaluation,
  entry,
  context,
  focusPath,
  readOnly,
  showRequired,
  onChange,
  onMappedChange,
  onFocusChange,
}: {
  evaluation: CustomModuleEvaluation;
  /** `data.custom.<key>` as stored, comment included. */
  entry: unknown;
  context: InspectionContext;
  focusPath: IssuePath | null;
  readOnly: boolean;
  /**
   * "X is required" under an empty field only once submit was tried: until
   * then the label says "(required)" and the issues panel lists it.
   */
  showRequired: boolean;
  onChange: (next: Record<string, unknown>) => void;
  onMappedChange: (mapsTo: string, value: unknown) => void;
  onFocusChange: (focus: CaptureFocus) => void;
}) {
  const value = readModuleEntry({ modules: {}, custom: { [evaluation.custom.key]: entry } }, "custom", evaluation.custom.key).value;
  const issues = showRequired ? evaluation.issues : evaluation.issues.filter((issue) => issue.code !== "required");
  return (
    <CustomModuleForm
      custom={evaluation.custom}
      value={value}
      mappedValues={evaluation.values}
      context={context}
      issues={issues as ValidationIssue[]}
      focusPath={focusPath}
      readOnly={readOnly}
      onChange={onChange}
      onMappedChange={onMappedChange}
      onFocusChange={onFocusChange}
    />
  );
}

export function BodySkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">Loading the form…</span>
      <Skeleton aria-hidden className="h-4 w-48 bg-slate-200" />
      <Skeleton aria-hidden className="h-11 w-full bg-slate-200" />
      <Skeleton aria-hidden className="h-11 w-full bg-slate-200" />
      <Skeleton aria-hidden className="h-11 w-2/3 bg-slate-200" />
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-foreground touch:text-base">
      {children}
    </p>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-fail-border bg-fail-tint px-4 py-3 text-sm font-medium text-fail touch:text-base"
    >
      {children}
    </p>
  );
}
