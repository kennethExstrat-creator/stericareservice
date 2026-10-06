export interface Backoff {
  /** Delay before the first retry. */
  initialMs: number;
  maxMs: number;
  factor: number;
  /** Up to this share of a delay is taken off at random, so devices that lost the same Wi-Fi do not retry in step. */
  jitter: number;
}

export const AUTOSAVE_BACKOFF: Backoff = { initialMs: 1_000, maxMs: 30_000, factor: 2, jitter: 0.2 };
export const UPLOAD_BACKOFF: Backoff = { initialMs: 2_000, maxMs: 60_000, factor: 2, jitter: 0.2 };

/** Delay before retry number `attempt` (1 is the first retry): exponential, capped at maxMs. */
export function backoffDelay(attempt: number, backoff: Backoff, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  const base = Math.min(backoff.maxMs, backoff.initialMs * backoff.factor ** (n - 1));
  const share = Math.min(1, Math.max(0, random()));
  return Math.round(base * (1 - backoff.jitter * share));
}
