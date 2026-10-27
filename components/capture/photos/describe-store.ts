// Steri-AI describing the report's photos in the background (docs/AI.md,
// "Describing photos"): one run per inspection on this page, a batch per
// Server Action call, each batch's descriptions going into the page's media
// store as they come, so the Report page's preview follows. Leaving the
// Report page lets the run finish, and coming back shows it. A photo is sent
// once a page: one Steri-AI gave no answer for waits for the next visit, so
// nothing is asked for again and again. A failure stops the run until Try
// Again. Browser only.
import {
  DESCRIBE_BATCH,
  DESCRIBE_MESSAGES,
  type DescribePhotos,
  type DescribePhotosResult,
} from "@/lib/inspections/photos/descriptions";
import { mediaStore } from "./media-store";

export type DescribeRunState =
  | { status: "idle" }
  /** `count`: the photos of the run not described yet. */
  | { status: "describing"; count: number }
  | { status: "failed"; message: string };

export const DESCRIBE_IDLE: DescribeRunState = { status: "idle" };

export class PhotoDescribeRun {
  private state: DescribeRunState = DESCRIBE_IDLE;
  private readonly listeners = new Set<() => void>();
  /** Photos sent on this page. */
  private readonly sent = new Set<string>();
  private running = false;

  constructor(readonly inspectionId: string) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): DescribeRunState => this.state;

  /**
   * Describes the photos not sent yet, DESCRIBE_BATCH a call, one call at a
   * time (Next.js runs a page's Server Actions in turn, so a save waits
   * behind one batch at most). Nothing while a run is on, or after a failure
   * until retry(). A failure stops the run, and the photos it did not
   * describe can be sent again; the server's quiet refusal (it cannot
   * describe photos yet) stops it without a word.
   */
  async run(describe: DescribePhotos, ids: readonly string[]): Promise<void> {
    if (this.running || this.state.status === "failed") return;
    const queue = ids.filter((id) => !this.sent.has(id));
    if (queue.length === 0) return;
    this.running = true;
    for (const id of queue) this.sent.add(id);
    let left = queue.length;
    this.setState({ status: "describing", count: left });
    try {
      for (let start = 0; start < queue.length; start += DESCRIBE_BATCH) {
        const batch = queue.slice(start, start + DESCRIBE_BATCH);
        const result = await describe(this.inspectionId, batch).catch(
          (): DescribePhotosResult => ({ ok: false, error: DESCRIBE_MESSAGES.noAnswer }),
        );
        if (!result.ok) {
          if (result.quiet) {
            this.setState(DESCRIBE_IDLE);
            return;
          }
          for (const id of queue.slice(start)) this.sent.delete(id);
          this.setState({ status: "failed", message: result.error });
          return;
        }
        mediaStore(this.inspectionId).applyDescriptions(result.photos);
        left -= batch.length;
        if (left > 0) this.setState({ status: "describing", count: left });
      }
      this.setState(DESCRIBE_IDLE);
    } finally {
      this.running = false;
    }
  }

  /** Try Again after a failure: the photos not described yet. */
  retry(describe: DescribePhotos, ids: readonly string[]): Promise<void> {
    if (this.state.status === "failed") this.setState(DESCRIBE_IDLE);
    return this.run(describe, ids);
  }

  private setState(next: DescribeRunState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }
}

const runs = new Map<string, PhotoDescribeRun>();

/** The page's run for one inspection (browser only). */
export function describeRun(inspectionId: string): PhotoDescribeRun {
  let run = runs.get(inspectionId);
  if (!run) {
    run = new PhotoDescribeRun(inspectionId);
    runs.set(inspectionId, run);
  }
  return run;
}
