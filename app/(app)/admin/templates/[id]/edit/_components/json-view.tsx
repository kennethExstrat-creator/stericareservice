"use client";

// The whole template as JSON, for advanced edits (BUILD_SPEC 10). Text is
// checked as it is typed against TemplateDefinitionSchema; Apply takes a
// valid definition into the editor, where the other tabs show it and Save
// stores it.
import { useMemo, useState } from "react";
import { CheckIcon, ClipboardCopyIcon, OctagonXIcon, Undo2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TemplateDefinitionSchema } from "@/lib/schemas/template";
import { parseWithMessages } from "@/lib/zod-form";
import type { Draft } from "../_lib/model";

export type JsonCheck =
  | { ok: true; definition: Draft }
  | { ok: false; problems: { path: string; message: string }[] };

/** Text as a template definition: valid JSON, the template format, and this version's code. */
export function checkJson(text: string, code: string): JsonCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [{ path: "", message: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  const result = parseWithMessages(TemplateDefinitionSchema, parsed);
  const problems = result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
  const ownCode = (parsed as { code?: unknown } | null)?.code;
  if (typeof ownCode === "string" && ownCode !== code) {
    problems.push({ path: "code", message: `The code of this version is ${code}; it cannot change.` });
  }
  return problems.length === 0 ? { ok: true, definition: parsed as Draft } : { ok: false, problems };
}

export function JsonView({
  draft,
  code,
  editable,
  text,
  onTextChange,
  onApply,
}: {
  draft: Draft;
  code: string;
  editable: boolean;
  /** Text being edited and not applied yet; null shows the draft as it is. */
  text: string | null;
  onTextChange: (text: string | null) => void;
  onApply: (definition: Draft) => void;
}) {
  const current = useMemo(() => JSON.stringify(draft, null, 2), [draft]);
  const shown = text ?? current;
  const editing = text !== null && text !== current;
  const check = useMemo(() => checkJson(shown, code), [shown, code]);
  const [copied, setCopied] = useState(false);

  return (
    <section aria-labelledby="json-heading" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="json-heading" className="text-lg font-bold text-foreground">
          JSON
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The whole template definition. Changes here are checked against the template format as you type; Apply puts
          them into the editor, and Save stores them.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="template-json">Template Definition</Label>
        <Textarea
          id="template-json"
          value={shown}
          readOnly={!editable}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={!check.ok ? true : undefined}
          aria-describedby="template-json-status"
          className="max-h-[70vh] min-h-80 font-mono leading-relaxed fine:text-[13px]"
          onChange={(event) => onTextChange(event.target.value === current ? null : event.target.value)}
        />
      </div>

      <div id="template-json-status" aria-live="polite">
        {check.ok ? (
          <p className="flex items-center gap-2 text-sm text-pass">
            <CheckIcon aria-hidden className="size-4" />
            {editing ? "Valid. Apply to use it." : "Valid template definition."}
          </p>
        ) : (
          <Alert variant="destructive" className="border-fail-border bg-fail-tint">
            <OctagonXIcon aria-hidden />
            <AlertTitle>
              {check.problems.length === 1 ? "1 Problem in the JSON" : `${check.problems.length} Problems in the JSON`}
            </AlertTitle>
            <AlertDescription className="text-fail">
              <ul className="grid gap-1">
                {check.problems.slice(0, 12).map((problem, index) => (
                  <li key={index}>
                    {problem.path && <span className="font-mono">{problem.path}: </span>}
                    {problem.message}
                  </li>
                ))}
                {check.problems.length > 12 && <li>And {check.problems.length - 12} more.</li>}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {editable && (
          <>
            <Button type="button" disabled={!editing || !check.ok} onClick={() => check.ok && onApply(check.definition)}>
              <CheckIcon aria-hidden />
              Apply JSON
            </Button>
            <Button type="button" variant="outline" disabled={text === null} onClick={() => onTextChange(null)}>
              <Undo2Icon aria-hidden />
              Undo JSON Edits
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(shown).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          <ClipboardCopyIcon aria-hidden />
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
    </section>
  );
}
