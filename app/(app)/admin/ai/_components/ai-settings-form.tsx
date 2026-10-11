"use client";

// Admin > AI Settings: the Anthropic API key (write-only: only where it comes
// from and its last four characters are shown) and the Claude models.
//
// Save runs from onSubmit, not the form's action prop: React resets a form
// after every action, and the model pickers (Radix Select) would go back to
// empty on a reset.
import { BotIcon, CheckCircle2Icon, KeyRoundIcon, OctagonXIcon, PlugZapIcon, SaveIcon, TrashIcon, TriangleAlertIcon } from "lucide-react";
import { startTransition, useActionState, useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { CLAUDE_MODELS, keyLabel, type AiSettingsView } from "@/lib/schemas/ai-settings";
import {
  removeAiKeyAction,
  saveAiSettingsAction,
  testAiConnectionAction,
  type AiSettingsState,
  type ConnectionTest,
} from "../actions";

const IDLE: AiSettingsState = { status: "idle" };
const OTHER = "other";
const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kuala_Lumpur",
});

export function AiSettingsForm({ view }: { view: AiSettingsView }) {
  const id = useId();
  const [apiKey, setApiKey] = useState("");
  const [documentModel, setDocumentModel] = useState(view.documentModel);
  const [reviewModel, setReviewModel] = useState(view.reviewModel);
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [testing, startTesting] = useTransition();
  const [removed, setRemoved] = useState<AiSettingsState>(IDLE);
  const [removing, startRemoving] = useTransition();
  const [state, formAction, saving] = useActionState(async (previous: AiSettingsState, formData: FormData) => {
    try {
      const result = await saveAiSettingsAction(previous, formData);
      if (result.status === "saved") setApiKey("");
      return result;
    } catch (error) {
      console.error(error);
      return { status: "error", message: UNREACHABLE } satisfies AiSettingsState;
    }
  }, IDLE);
  const canSave = view.storage === "ready";
  const busy = saving || testing || removing;
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formData = new FormData(event.currentTarget);
    setTest(null);
    setRemoved(IDLE);
    startTransition(() => formAction(formData));
  }

  function testConnection(form: HTMLFormElement | null) {
    if (!form || busy) return;
    const formData = new FormData(form);
    startTesting(async () => {
      try {
        setTest(await testAiConnectionAction(formData));
      } catch (error) {
        console.error(error);
        setTest({ ok: false, message: UNREACHABLE });
      }
    });
  }

  function removeKey() {
    if (busy) return;
    startRemoving(async () => {
      try {
        setRemoved(await removeAiKeyAction());
      } catch (error) {
        console.error(error);
        setRemoved({ status: "error", message: UNREACHABLE });
      }
    });
  }

  const outcome = removed.status !== "idle" ? removed : state;

  return (
    <form onSubmit={submit} noValidate aria-busy={busy || undefined} className="flex max-w-3xl flex-col gap-6" data-testid="ai-settings-form">
      {view.storage !== "ready" && (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription className="text-destructive">
            {view.storage === "no_secret_key"
              ? "The server needs SUPABASE_SECRET_KEY before Steri-AI settings can be saved here."
              : "The saved Steri-AI settings could not be read. Reload the page to try again."}
          </AlertDescription>
        </Alert>
      )}

      <Card icon={KeyRoundIcon} title="Anthropic API Key">
        <KeyStatus view={view} />
        <Field data-invalid={errors.apiKey ? true : undefined}>
          <FieldLabel htmlFor={`${id}-key`}>{view.key.source === "saved" ? "Replace the Key" : "API Key"}</FieldLabel>
          <Input
            id={`${id}-key`}
            name="apiKey"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
            disabled={!canSave}
            aria-invalid={errors.apiKey ? true : undefined}
            aria-describedby={`${id}-key-${errors.apiKey ? "error" : "hint"}`}
          />
          {errors.apiKey ? (
            <FieldError id={`${id}-key-error`}>{errors.apiKey}</FieldError>
          ) : (
            <FieldDescription id={`${id}-key-hint`}>
              From console.anthropic.com, under API Keys. It is stored encrypted and never shown again. Leave it blank to keep
              the current key.
            </FieldDescription>
          )}
        </Field>
        {(view.key.source === "saved" || view.key.source === "unreadable") && (
          <div>
            <Button type="button" variant="outline" onClick={removeKey} disabled={busy || !canSave}>
              {removing ? <Spinner aria-hidden /> : <TrashIcon aria-hidden />}
              Remove Saved Key
            </Button>
          </div>
        )}
      </Card>

      <Card icon={BotIcon} title="Models">
        <div className="grid gap-5 md:grid-cols-2">
          <ModelField
            id={`${id}-document-model`}
            name="documentModel"
            label="Reading Documents"
            hint="Fill From a Document on New Inspection."
            value={documentModel}
            onChange={setDocumentModel}
            error={errors.documentModel}
            disabled={!canSave}
          />
          <ModelField
            id={`${id}-review-model`}
            name="reviewModel"
            label="Second Opinion"
            hint="Steri-AI's review on an inspection's review screen."
            value={reviewModel}
            onChange={setReviewModel}
            error={errors.reviewModel}
            disabled={!canSave}
          />
        </div>
      </Card>

      {test && (
        <Alert variant={test.ok ? "default" : "destructive"} data-testid="ai-connection-test">
          {test.ok ? <CheckCircle2Icon aria-hidden className="text-pass" /> : <OctagonXIcon aria-hidden />}
          <AlertDescription className={test.ok ? "text-foreground" : "text-destructive"}>{test.message}</AlertDescription>
        </Alert>
      )}
      {outcome.status !== "idle" && (
        <Alert variant={outcome.status === "saved" ? "default" : "destructive"} role="status" data-testid="ai-settings-outcome">
          {outcome.status === "saved" ? <CheckCircle2Icon aria-hidden className="text-pass" /> : <OctagonXIcon aria-hidden />}
          <AlertDescription className={outcome.status === "saved" ? "text-foreground" : "text-destructive"}>
            {outcome.message}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="outline" disabled={busy} onClick={(event) => testConnection(event.currentTarget.form)}>
          {testing ? <Spinner aria-hidden /> : <PlugZapIcon aria-hidden />}
          {testing ? "Testing…" : "Test Connection"}
        </Button>
        <Button type="submit" disabled={busy || !canSave} className="min-w-32">
          {saving ? <Spinner aria-hidden /> : <SaveIcon aria-hidden />}
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Card({ icon: Icon, title, children }: { icon: typeof KeyRoundIcon; title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-5 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon aria-hidden className="size-5" />
        </span>
        <h2 className="text-lg leading-tight font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function KeyStatus({ view }: { view: AiSettingsView }) {
  const changed =
    view.updatedAt !== null ? ` Last changed ${WHEN.format(new Date(view.updatedAt))}${view.updatedBy ? ` by ${view.updatedBy}` : ""}.` : "";
  const { key } = view;
  const line =
    key.source === "saved"
      ? { ok: true, text: `In use: ${keyLabel(key.hint)}.${changed}` }
      : key.source === "unreadable"
        ? { ok: false, text: `The saved key (${keyLabel(key.hint)}) can no longer be read: the server's secret key changed. Enter it again.` }
        : key.source === "environment"
          ? { ok: true, text: "In use: the ANTHROPIC_API_KEY set on the server. A key saved here replaces it." }
          : { ok: false, text: "No key yet: Steri-AI features are switched off until one is saved." };
  return (
    <p
      data-testid="ai-key-status"
      className={`flex gap-2 rounded-lg px-3 py-2 text-sm touch:text-base ${line.ok ? "bg-pass-tint text-pass" : "bg-warn-tint text-warn"}`}
    >
      {line.ok ? <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0" /> : <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />}
      {line.text}
    </p>
  );
}

function ModelField({
  id,
  name,
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [other, setOther] = useState(!CLAUDE_MODELS.some((model) => model.id === value));
  const known = CLAUDE_MODELS.find((model) => model.id === value);
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={other ? OTHER : value}
        onValueChange={(next) => {
          setOther(next === OTHER);
          if (next !== OTHER) onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CLAUDE_MODELS.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={OTHER}>Other Claude Model…</SelectItem>
        </SelectContent>
      </Select>
      {other && (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="claude-…"
          aria-label={`${label}: model id`}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
        />
      )}
      <input type="hidden" name={name} value={value} />
      {error ? <FieldError>{error}</FieldError> : <FieldDescription>{known ? `${hint} ${known.hint}` : hint}</FieldDescription>}
    </Field>
  );
}
