import type { TemplateCode } from "@/lib/coverage";
import type { TemplateDefinition } from "@/lib/schemas/template";

/** One seed template (BUILD_SPEC 11). */
export type SeedTemplate = {
  readonly code: TemplateCode;
  /**
   * The client a client-scoped template belongs to, by name, as
   * supabase/seed.sql creates it. The seed looks its id up, so the template
   * follows the client row whatever id it has; null for every other template.
   */
  readonly client: string | null;
  /** The definition. A client-scoped template takes the client's id; without one it has no client yet. */
  definition(clientId?: string): TemplateDefinition;
};
