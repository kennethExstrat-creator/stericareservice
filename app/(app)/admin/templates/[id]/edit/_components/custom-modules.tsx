"use client";

// The template's custom modules (BUILD_SPEC 4.2 rule 2, 4.3): anything on the
// source form that no module captures. Inherited ones show what the base
// gives; copying one in lets this template change it.
import { useRef } from "react";
import { ChevronDownIcon, ChevronUpIcon, CopyPlusIcon, LayersIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { CustomModule } from "@/lib/schemas/template";
import { isModuleKey } from "@/lib/schemas/module-result";
import {
  addCustomModule,
  customModuleViews,
  moduleView,
  overrideCustomModule,
  ownCustomModules,
  removeCustomModule,
  setCustomModule,
} from "../_lib/model";
import { problemsOfCustom } from "../_lib/problems";
import { CustomModuleForm, FIELD_TYPE_LABEL } from "./custom-module-form";
import type { EditorApi } from "./editor-api";

const LAYOUT_LABEL = { fields: "Fields", table: "Table per size", grid: "Grid" } as const;

export function CustomModules({
  api,
  open,
  onOpen,
}: {
  api: EditorApi;
  /** This template's custom module being edited, by position. */
  open: number | null;
  onOpen: (index: number | null) => void;
}) {
  const views = customModuleViews(api.draft, api.context);
  const base = api.context.inheritance.bases[0]?.code;

  // A new or copied custom module goes last in this template's list.
  const nextIndex = ownCustomModules(api.draft).length;
  const add = () => {
    api.update((draft, context) => addCustomModule(draft, context).draft);
    onOpen(nextIndex);
  };

  const afterTitle = (custom: CustomModule) =>
    isModuleKey(custom.after) ? moduleView(api.draft, api.context, custom.after).title : custom.after;

  return (
    <section aria-labelledby="custom-heading" className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="custom-heading" tabIndex={-1} className="text-lg font-bold text-foreground outline-none">
            Custom modules
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Fields a source form has that no module captures. Each sits after a module of your choice, on the capture
            screen and in the export.
          </p>
        </div>
        {api.editable && views.length > 0 && (
          <Button type="button" variant="outline" onClick={add}>
            <PlusIcon aria-hidden />
            Add custom module
          </Button>
        )}
      </div>

      {views.length === 0 && (
        <Empty className="border border-dashed border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No custom modules</EmptyTitle>
            <EmptyDescription>Add one when the form has a field no module covers.</EmptyDescription>
          </EmptyHeader>
          {api.editable && (
            <EmptyContent>
              <Button type="button" onClick={add}>
                <PlusIcon aria-hidden />
                Add custom module
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}

      <ul className="grid gap-4">
        {views.map((view) => {
          const custom = view.custom;
          const problems = view.own ? problemsOfCustom(api.problems, view.index) : [];
          const expanded = view.own && open === view.index;
          const summary = [
            `After ${afterTitle(custom)}`,
            LAYOUT_LABEL[custom.layout],
            custom.fields.length === 1 ? "1 field" : `${custom.fields.length} fields`,
          ].join(" · ");
          return (
            <li
              key={view.own ? `own-${view.index}` : `base-${custom.key}`}
              data-custom-key={custom.key}
              className="grid gap-4 rounded-xl bg-card p-4 shadow-sm ring-1 ring-border sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid min-w-0 gap-1">
                  <h3 className="text-base font-bold text-balance text-foreground">{custom.title || "Untitled"}</h3>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-mono">{custom.key}</span> · {summary}
                  </p>
                  {!view.own && <p className="text-sm text-muted-foreground">From {base ?? "the base template"}.</p>}
                  {view.overrides && <p className="text-sm text-muted-foreground">Replaces the one from {base}.</p>}
                  {problems.length > 0 && !expanded && (
                    <p className="text-sm text-destructive">
                      {problems.length === 1 ? "1 problem to fix" : `${problems.length} problems to fix`}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {view.own ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-expanded={expanded}
                        onClick={() => onOpen(expanded ? null : view.index)}
                      >
                        {expanded ? <ChevronUpIcon aria-hidden /> : <ChevronDownIcon aria-hidden />}
                        {expanded ? "Close" : api.editable ? "Edit" : "Show"}
                        <span className="sr-only"> {custom.title}</span>
                      </Button>
                      {api.editable && (
                        <RemoveCustom
                          title={custom.title || custom.key}
                          onRemove={() => {
                            api.update((draft) => removeCustomModule(draft, view.index));
                            onOpen(null);
                          }}
                        />
                      )}
                    </>
                  ) : (
                    api.editable && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          api.update((draft) => overrideCustomModule(draft, custom).draft);
                          onOpen(nextIndex);
                        }}
                      >
                        <CopyPlusIcon aria-hidden />
                        Change it here
                      </Button>
                    )
                  )}
                </div>
              </div>
              {!expanded && (
                <ul className="flex flex-wrap gap-2" aria-label={`Fields of ${custom.title}`}>
                  {custom.fields.map((field) => (
                    <li key={field.key} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                      {field.label} · {FIELD_TYPE_LABEL[field.type]}
                      {field.unit ? ` (${field.unit})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {expanded && (
                <CustomModuleForm
                  api={api}
                  index={view.index}
                  custom={custom}
                  problems={problems}
                  onChange={(next) => api.update((draft) => setCustomModule(draft, view.index, next))}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RemoveCustom({ title, onRemove }: { title: string; onRemove: () => void }) {
  // Removed, its card (and this button) goes: the focus goes to the list's heading instead.
  const removed = useRef(false);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${title}`}>
          <Trash2Icon aria-hidden />
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!removed.current) return;
          removed.current = false;
          event.preventDefault();
          document.getElementById("custom-heading")?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its fields leave this draft. Nothing is saved until you choose Save, and inspections already done keep
            their version.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              removed.current = true;
              onRemove();
            }}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
