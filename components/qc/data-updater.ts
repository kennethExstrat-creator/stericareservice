// How a Capture writes its data under CaptureProps' onChange(next), which
// replaces the module's whole value. Kit callbacks fire while the module still
// holds the `data` it rendered with, so two changes in one event (a pasted
// column, a commit on blur as the size turns) would each start from that same
// stale value and only the last would survive. An updater applies each change
// to the latest value instead: the data the screen last rendered plus the
// changes it has not rendered yet. Inside batchDataChanges (a paste) the
// changes are collected and handed over in one onChange at the end. Pure, so
// it is tested without a DOM; useDataUpdater (use-data-updater.ts) binds it to
// a Capture.

/** A change to the module's data: the new value from the current one. Never mutate `current`. */
export type DataChange<T> = (current: T) => T;

let depth = 0;
const queued = new Set<() => void>();

/**
 * Runs `run` with data changes held back: every updater it touches calls its
 * onChange once, after the last change, with all of them applied.
 */
export function batchDataChanges(run: () => void): void {
  depth += 1;
  try {
    run();
  } finally {
    depth -= 1;
    if (depth === 0) {
      const flushes = [...queued];
      queued.clear();
      for (const flush of flushes) flush();
    }
  }
}

export type DataUpdater<T> = {
  /** Applies `change` to the latest data and hands the result to onChange (once per batch). */
  readonly update: (change: DataChange<T>) => void;
  /** The screen rendered `data`: later changes start from it. Also takes the latest onChange. */
  readonly sync: (data: T, onChange: (next: T) => void) => void;
};

export function createDataUpdater<T>(data: T, onChange: (next: T) => void): DataUpdater<T> {
  let rendered = data;
  let notify = onChange;
  // Changes handed to onChange (or queued for it) that the screen has not rendered yet.
  let ahead: { readonly value: T } | null = null;
  const flush = () => {
    if (ahead) notify(ahead.value);
  };

  return {
    update(change) {
      const current = ahead ? ahead.value : rendered;
      const next = change(current);
      if (Object.is(next, current)) return;
      ahead = { value: next };
      if (depth > 0) queued.add(flush);
      else notify(next);
    },
    sync(data, onChange) {
      notify = onChange;
      if (!Object.is(data, rendered)) {
        rendered = data;
        ahead = null;
      }
    },
  };
}
