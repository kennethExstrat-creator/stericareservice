// Reads radios out of server-drawn markup (renderToStaticMarkup). Import it
// from tests only:
//   import { radioNames } from "@/app/(app)/admin/_components/radio-card.testing";

const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };
const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Each radio's attributes, in the order drawn, entities decoded. */
export function radiosIn(html: string): Record<string, string>[] {
  return [...html.matchAll(/<button\b[^>]*\brole="radio"[^>]*>/g)].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/\s([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)])),
  );
}

/** The text of the element with this id (text only, nothing nested), or null when there is none. */
export function textOf(html: string, id: string | undefined): string | null {
  if (!id) return null;
  const text = html.match(new RegExp(`\\sid="${escape(id)}"[^>]*>([^<]*)<`))?.[1];
  return text === undefined ? null : decode(text);
}

/**
 * Each radio's name and description as its aria-labelledby and
 * aria-describedby give them: null where it has no such reference, or the
 * reference points at nothing.
 */
export function radioNames(html: string): { name: string | null; description: string | null }[] {
  return radiosIn(html).map((radio) => ({
    name: textOf(html, radio["aria-labelledby"]),
    description: textOf(html, radio["aria-describedby"]),
  }));
}
