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
  /**
   * The dictionary template (lib/coverage) whose flow the seed runs: its
   * modules, order, titles, wording, config, sizes and custom modules. Its
   * own code, except STD_EG, which runs SAFEDON_EG's flow under its own
   * identity since 26 October 2026 (std-eg.ts).
   */
  readonly flow: TemplateCode;
  /**
   * The seed retires the code's active version and publishes no new one:
   * SAFEDON_EG since 26 October 2026 (safedon-eg.ts). Its definition stays
   * for the inspections that use its versions, and for tests.
   */
  readonly retired?: true;
  /** The definition. A client-scoped template takes the client's id; without one it has no client yet. */
  definition(clientId?: string): TemplateDefinition;
};
