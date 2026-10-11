"use client";

// Admin > AI Settings, Shortforms: the shortforms inspectors write on their
// paper forms ("BF", "SKV") and what each means. The AI gets the list with
// every document it reads (lib/ai/reading-guide.ts); a meaning not yet
// confirmed by an inspector is given as a guess.
import { BookAIcon, CheckCircle2Icon, OctagonXIcon, PlusIcon, SaveIcon, TrashIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { GlossaryEntry } from "@/lib/schemas/ai-settings";
import { saveGlossaryAction, type ConnectionTest } from "../actions";

type Row = GlossaryEntry & { key: number };

const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

export function GlossaryForm({ initial, disabled }: { initial: readonly GlossaryEntry[]; disabled: boolean }) {
  const id = useId();
  const [rows, setRows] = useState<Row[]>(() => initial.map((entry, key) => ({ ...entry, key })));
  const [nextKey, setNextKey] = useState(initial.length);
  const [outcome, setOutcome] = useState<ConnectionTest | null>(null);
  const [saving, startSaving] = useTransition();

  function change(key: number, patch: Partial<GlossaryEntry>) {
    setOutcome(null);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function add() {
    setOutcome(null);
    setRows((current) => [...current, { key: nextKey, short: "", meaning: "", confirmed: true }]);
    setNextKey((key) => key + 1);
  }

  function save() {
    const entries = rows.map(({ short, meaning, confirmed }) => ({ short, meaning, confirmed }));
    startSaving(async () => {
      try {
        setOutcome(await saveGlossaryAction(entries));
      } catch (error) {
        console.error(error);
        setOutcome({ ok: false, message: UNREACHABLE });
      }
    });
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex min-w-0 flex-col gap-5 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6"
      data-testid="glossary-form"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <BookAIcon aria-hidden className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1 pt-1">
          <h2 id={`${id}-heading`} className="text-lg leading-tight font-bold text-foreground">
            Shortforms
          </h2>
          <p className="text-sm text-muted-foreground touch:text-base">
            Examples of what inspectors write on their paper forms. They help Steri-AI read other inspectors&apos; words too; it
            still records every defect in the template&apos;s standard list, or as a new label for an admin to map.
          </p>
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-lg ring-1 ring-border">
        {rows.map((row, index) => (
          <li key={row.key} className="grid gap-2 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto_auto] sm:items-center">
            <Input
              value={row.short}
              onChange={(event) => change(row.key, { short: event.target.value })}
              aria-label={`Shortform, row ${index + 1}`}
              placeholder="BF"
              maxLength={40}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={disabled}
            />
            <Input
              value={row.meaning}
              onChange={(event) => change(row.key, { meaning: event.target.value })}
              aria-label={`Meaning of ${row.short || `row ${index + 1}`}`}
              placeholder="Between Finger"
              maxLength={300}
              autoComplete="off"
              disabled={disabled}
            />
            <label className="flex min-h-11 items-center gap-2 text-sm text-foreground fine:min-h-9">
              <Checkbox
                checked={row.confirmed}
                onCheckedChange={(checked) => change(row.key, { confirmed: checked === true })}
                disabled={disabled}
              />
              Confirmed
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setOutcome(null);
                setRows((current) => current.filter((entry) => entry.key !== row.key));
              }}
              disabled={disabled}
            >
              <TrashIcon aria-hidden />
              <span className="sr-only">Remove {row.short || `row ${index + 1}`}</span>
            </Button>
          </li>
        ))}
        {rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">No shortforms yet.</li>}
      </ul>

      {outcome && (
        <Alert variant={outcome.ok ? "default" : "destructive"} role="status">
          {outcome.ok ? <CheckCircle2Icon aria-hidden className="text-pass" /> : <OctagonXIcon aria-hidden />}
          <AlertDescription className={outcome.ok ? "text-foreground" : "text-destructive"}>{outcome.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={add} disabled={disabled || saving}>
          <PlusIcon aria-hidden />
          Add Shortform
        </Button>
        <Button type="button" onClick={save} disabled={disabled || saving} className="min-w-44">
          {saving ? <Spinner aria-hidden /> : <SaveIcon aria-hidden />}
          {saving ? "Saving…" : "Save Shortforms"}
        </Button>
      </div>
    </section>
  );
}
