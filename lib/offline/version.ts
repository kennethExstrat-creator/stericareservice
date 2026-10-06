// The server's version of an inspection is its updated_at, a Postgres
// timestamptz with microseconds ("2026-10-06T09:14:03.123456+00:00").
// Date.parse keeps only milliseconds and Safari is strict about the format,
// so the comparison parses the text itself.

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** Microseconds since the epoch, or null when the text is not an ISO 8601 timestamp with a zone. */
export function timestampMicros(text: string): number | null {
  const match = ISO_TIMESTAMP.exec(text.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [y, mo, d, h, mi, s] = parts;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;

  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const date = new Date(ms);
  if (date.getUTCDate() !== d) return null;

  let offsetMinutes = 0;
  if (zone.toUpperCase() !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const sign = zone.startsWith("-") ? -1 : 1;
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0));
  }
  const micros = Number(fraction.padEnd(6, "0").slice(0, 6));
  return (ms - offsetMinutes * 60_000) * 1000 + micros;
}

/** Order of two server versions: -1 when a is older, 1 when newer, 0 when equal, null when either is unreadable. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  if (a === b) return 0;
  const left = timestampMicros(a);
  const right = timestampMicros(b);
  if (left === null || right === null) return null;
  return left < right ? -1 : left > right ? 1 : 0;
}
