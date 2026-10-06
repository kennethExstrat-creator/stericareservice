import type { AutosaveTransport, SaveOutcome, SaveRequest, ServerCopy } from "../protocol";

/** Postgres-style updated_at values, one microsecond apart. */
export function version(tick: number): string {
  return `2026-10-06T09:00:00.${String(tick).padStart(6, "0")}+00:00`;
}

/**
 * An inspections row behind a compare-and-set save, the way the real
 * transport must behave (docs/OFFLINE.md, "The transport"), with switches
 * for the ways a factory connection fails.
 */
export class FakeInspectionServer<T> {
  data: T;
  updatedAt: string;
  editable = true;
  /** False: requests fail before reaching the server, as fetch does offline. */
  reachable = true;
  /** The next save is applied, then its answer is lost on the way back. */
  loseNextAnswer = false;
  /** Answer the next saves with these outcomes instead of saving. */
  readonly scripted: SaveOutcome<T>[] = [];
  readonly requests: Omit<SaveRequest<T>, "signal">[] = [];
  /** Called as each request arrives, before it is answered. */
  onRequest: ((request: SaveRequest<T>) => void | Promise<void>) | null = null;
  private tick = 1;
  private held: (() => void)[] = [];
  private holding = false;

  constructor(initial: T) {
    this.data = structuredClone(initial);
    this.updatedAt = version(this.tick);
  }

  copy(): ServerCopy<T> {
    return { data: structuredClone(this.data), updatedAt: this.updatedAt };
  }

  /** Another device, or an admin, writes the row: new data, or only other columns. */
  writeElsewhere(data?: T): void {
    if (data !== undefined) this.data = structuredClone(data);
    this.updatedAt = version(++this.tick);
  }

  /** Requests wait until release(): a slow or stalled connection. */
  hold(): void {
    this.holding = true;
  }

  release(): void {
    this.holding = false;
    for (const resume of this.held.splice(0)) resume();
  }

  transport(): AutosaveTransport<T> {
    return { save: (request) => this.save(request) };
  }

  private async save(request: SaveRequest<T>): Promise<SaveOutcome<T>> {
    const { signal, ...rest } = request;
    this.requests.push(structuredClone(rest));
    await this.onRequest?.(request);
    if (this.holding) {
      await new Promise<void>((resolve, reject) => {
        this.held.push(resolve);
        signal.addEventListener("abort", () => reject(new DOMException("The request was aborted.", "AbortError")));
      });
    }
    if (!this.reachable) throw new TypeError("Load failed");
    const scripted = this.scripted.shift();
    if (scripted) return scripted;
    if (!this.editable) return { ok: false, reason: "forbidden", message: "The inspection is submitted." };
    if (request.baseUpdatedAt !== this.updatedAt) return { ok: false, reason: "conflict", server: this.copy() };

    this.data = structuredClone(request.data);
    this.updatedAt = version(++this.tick);
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      throw new TypeError("The network connection was lost.");
    }
    return { ok: true, updatedAt: this.updatedAt };
  }
}
