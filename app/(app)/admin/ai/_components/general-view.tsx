"use client";

// Steri-AI Settings, General: the Anthropic API key (write-only: only where it
// comes from and its last four characters are shown) and the connection test.
//
// Save Key runs from onSubmit, not the form's action prop: React resets a form
// after every action. It sends the key alone (saveApiKeyAction), so the models
// in use are never written with it; Test Connection tries the typed key, else
// the key in use, with the models in use.
import { KeyRoundIcon, PlugZapIcon, SaveIcon, TrashIcon } from "lucide-react";
import { startTransition, useActionState, useId, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { AiSettingsView } from "@/lib/schemas/ai-settings";
import { removeAiKeyAction, saveApiKeyAction, testAiConnectionAction, type ApiKeyState, type ConnectionTest } from "../actions";
import { ResultAlert, StorageAlert, UNREACHABLE } from "./alerts";
import { KeyStatus } from "./key-status";
import { SectionCard } from "./section-card";

const IDLE: ApiKeyState = { status: "idle" };

export function GeneralView({ view }: { view: AiSettingsView }) {
  const id = useId();
  const [apiKey, setApiKey] = useState("");
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [testing, startTesting] = useTransition();
  const [removed, setRemoved] = useState<ApiKeyState>(IDLE);
  const [removing, startRemoving] = useTransition();
  const [state, formAction, saving] = useActionState(async (previous: ApiKeyState, formData: FormData) => {
    try {
      const result = await saveApiKeyAction(previous, formData);
      if (result.status === "saved") setApiKey("");
      return result;
    } catch (error) {
      console.error(error);
      return { status: "error", message: UNREACHABLE } satisfies ApiKeyState;
    }
  }, IDLE);
  const canSave = view.storage === "ready";
  const busy = saving || testing || removing;
  const keyError = state.status === "error" ? state.fieldErrors?.apiKey : undefined;
  const outcome = removed.status !== "idle" ? removed : state;
  // A refused key says why under the field; the alert is for everything else.
  const showOutcome = outcome.status === "saved" || (outcome.status === "error" && !outcome.fieldErrors?.apiKey);
  const keySaved = view.key.source === "saved" || view.key.source === "unreadable";

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || apiKey.trim() === "") return;
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

  return (
    <div className="flex flex-col gap-6" data-testid="ai-general">
      <StorageAlert storage={view.storage} />
      <form onSubmit={save} noValidate aria-busy={busy || undefined} className="grid gap-6 lg:grid-cols-2">
        <SectionCard icon={KeyRoundIcon} title="Anthropic API Key">
          <KeyStatus view={view} />
          <Field data-invalid={keyError ? true : undefined}>
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
              aria-invalid={keyError ? true : undefined}
              aria-describedby={`${id}-key-${keyError ? "error" : "hint"}`}
            />
            {keyError ? (
              <FieldError id={`${id}-key-error`}>{keyError}</FieldError>
            ) : (
              <FieldDescription id={`${id}-key-hint`} className="touch:text-base">
                From console.anthropic.com, under API Keys. Stored encrypted and never shown again.
              </FieldDescription>
            )}
          </Field>
          {showOutcome && (
            <ResultAlert ok={outcome.status === "saved"} message={outcome.message} role="status" data-testid="ai-key-outcome" />
          )}
          <div className="mt-auto flex flex-wrap items-center justify-end gap-3">
            {keySaved && (
              <Button type="button" variant="outline" onClick={removeKey} disabled={busy || !canSave}>
                {removing ? <Spinner aria-hidden /> : <TrashIcon aria-hidden />}
                Remove Saved Key
              </Button>
            )}
            <Button type="submit" disabled={busy || !canSave || apiKey.trim() === ""} className="min-w-32">
              {saving ? <Spinner aria-hidden /> : <SaveIcon aria-hidden />}
              {saving ? "Saving…" : "Save Key"}
            </Button>
          </div>
        </SectionCard>

        <SectionCard icon={PlugZapIcon} title="Connection">
          <p className="text-sm text-muted-foreground touch:text-base">
            Checks the key with the models in Inspection Settings. Nothing is billed.
          </p>
          {test && <ResultAlert ok={test.ok} message={test.message} role="status" data-testid="ai-connection-test" />}
          <div className="mt-auto flex flex-wrap items-center justify-end gap-3">
            <Button type="button" variant="outline" disabled={busy} onClick={(event) => testConnection(event.currentTarget.form)}>
              {testing ? <Spinner aria-hidden /> : <PlugZapIcon aria-hidden />}
              {testing ? "Testing…" : "Test Connection"}
            </Button>
          </div>
        </SectionCard>
      </form>
    </div>
  );
}
