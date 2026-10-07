"use client";

// Labels in the client's or manufacturer's wording (BUILD_SPEC 4.2 rule 3):
// every label key the module has, with the wording it inherits, and the
// template's own wording where it sets one. Data stays under the canonical
// keys; only the words change.
import { useId, useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LABEL_KEY_PATTERN } from "@/lib/schemas/template";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { setLabel, type ModuleView } from "../_lib/model";
import type { EditorProblem } from "../_lib/problems";
import type { EditorApi } from "./editor-api";

/** Ids of the label inputs: `label-glove_info-colour`. */
export function labelFieldId(key: ModuleKey, labelKey: string): string {
  return `label-${key}-${labelKey.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export function LabelOverrides({
  api,
  view,
  problems,
}: {
  api: EditorApi;
  view: ModuleView;
  problems: readonly EditorProblem[];
}) {
  const own = view.entry?.labels ?? {};
  const inherited = view.inherited.labels;
  const keys = [...Object.keys(inherited), ...Object.keys(own).filter((labelKey) => !(labelKey in inherited))];
  const errorsOf = (labelKey: string) =>
    problems.filter(
      (problem) =>
        problem.place.area === "module" && problem.place.part === "labels" && problem.place.path[0] === labelKey,
    );
  const set = (labelKey: string, label: string | undefined) =>
    api.update((draft, context) => setLabel(draft, context, view.key, labelKey, label));

  return (
    <div className="grid gap-4">
      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This module has no labels of its own yet. Add one by its key if the form words a field differently.
        </p>
      ) : (
        <div className="grid gap-3" role="list">
          {keys.map((labelKey) => {
            const id = labelFieldId(view.key, labelKey);
            const errors = errorsOf(labelKey);
            const fallback = inherited[labelKey];
            return (
              <div
                key={labelKey}
                role="listitem"
                data-label-key={labelKey}
                className="grid gap-1.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:items-start md:gap-x-4"
              >
                <div className="grid min-w-0 gap-0.5 md:pt-2">
                  <Label htmlFor={id} className="leading-snug">
                    {fallback ?? "No Default Wording"}
                  </Label>
                  <span className="font-mono text-xs break-all text-muted-foreground">{labelKey}</span>
                </div>
                <div className="grid gap-1">
                  <Input
                    id={id}
                    value={own[labelKey] ?? ""}
                    placeholder={fallback === undefined ? "Wording" : "Same as the default"}
                    readOnly={!api.editable}
                    autoComplete="off"
                    aria-invalid={errors.length > 0 ? true : undefined}
                    aria-describedby={errors.length > 0 ? `${id}-errors` : undefined}
                    onChange={(event) => set(labelKey, event.target.value)}
                  />
                  {errors.length > 0 && (
                    <div id={`${id}-errors`} className="grid gap-1">
                      {errors.map((problem) => (
                        <p key={problem.id} className="text-sm text-destructive">
                          {problem.message}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {api.editable && (
        <AddLabel
          taken={keys}
          suggestions={api.defectCodes.map((entry) => entry.code)}
          onAdd={(labelKey, label) => set(labelKey, label)}
        />
      )}
    </div>
  );
}

function AddLabel({
  taken,
  suggestions,
  onAdd,
}: {
  taken: readonly string[];
  suggestions: readonly string[];
  onAdd: (labelKey: string, label: string) => void;
}) {
  const id = useId();
  const [labelKey, setLabelKey] = useState("");
  const [wording, setWording] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const keyText = labelKey.trim();
    if (!LABEL_KEY_PATTERN.test(keyText)) {
      setError("Use the key as the module names it: letters, digits and _, or a dotted path such as minor.bead_defective.");
      return;
    }
    if (taken.includes(keyText)) {
      setError("That key is in the list already: change its wording there.");
      return;
    }
    if (wording.trim() === "") {
      setError("Enter the wording.");
      return;
    }
    onAdd(keyText, wording);
    setLabelKey("");
    setWording("");
    setError(null);
  };

  return (
    <div className="grid gap-2 rounded-lg border border-dashed border-border p-3" data-testid="add-label">
      <p className="text-sm font-medium text-foreground">Add a Label</p>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_auto] md:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-key`}>Key</Label>
          <Input
            id={`${id}-key`}
            value={labelKey}
            list={`${id}-codes`}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="font-mono"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => setLabelKey(event.target.value)}
          />
          <datalist id={`${id}-codes`}>
            {suggestions.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-wording`}>Wording</Label>
          <Input
            id={`${id}-wording`}
            value={wording}
            autoComplete="off"
            onChange={(event) => setWording(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button type="button" variant="outline" onClick={add}>
          <PlusIcon aria-hidden />
          Add Label
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
