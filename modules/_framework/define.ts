import { z } from "zod";
import { JsonValueSchema } from "@/lib/schemas/common";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type {
  CalcInput,
  CalcOutput,
  CanonicalPath,
  CaptureComponent,
  ContributeInput,
  JsonObject,
  ModuleDefinition,
  TitleInput,
} from "./contract";
import type { ContextContribution } from "./context";

/**
 * A module as written in `modules/<key>/index.ts`. The data and config types
 * come from the schemas alone (NoInfer elsewhere), so `emptyData` and
 * `defaultConfig` are checked against them instead of widening them.
 */
export type ModuleSpec<TData, TConfig, TComputed extends JsonObject> = {
  key: ModuleKey;
  title: string;
  labels: Readonly<Record<string, string>>;
  dataSchema: z.ZodType<TData>;
  emptyData: () => NoInfer<TData>;
  configSchema: z.ZodType<TConfig>;
  defaultConfig: NoInfer<TConfig>;
  /** Default false. */
  perSize?: boolean;
  /** Default false. */
  handSplit?: boolean;
  /** Default none. */
  dependsOn?: readonly ModuleKey[] | "all";
  /** Default false: not done is a warning, and the inspection can be submitted on hold. */
  requiredForSubmit?: boolean;
  /** Default none. */
  canonicalPaths?: readonly CanonicalPath[];
  calc: (input: CalcInput<NoInfer<TData>, NoInfer<TConfig>>) => CalcOutput<TComputed>;
  contribute?: (input: ContributeInput<NoInfer<TData>, NoInfer<TConfig>>) => ContextContribution;
  /** Default none: the template's title as stored. */
  shownTitle?: (input: TitleInput<NoInfer<TConfig>>) => string;
  /** Default none: the template's labels over the defaults. */
  shownLabels?: (labels: Readonly<Record<string, string>>) => Readonly<Record<string, string>>;
  loadCapture?: () => Promise<{ default: CaptureComponent<NoInfer<TData>, NoInfer<TConfig>, NoInfer<TComputed>> }>;
};

/**
 * Declares a module. Leaves out what most modules do not need: not per size,
 * no hand split, no dependencies, not required for submit, no mappable paths.
 */
export function defineModule<TData, TConfig, TComputed extends JsonObject = JsonObject>(
  spec: ModuleSpec<TData, TConfig, TComputed>,
): ModuleDefinition<TData, TConfig, TComputed> {
  return {
    perSize: false,
    handSplit: false,
    dependsOn: [],
    requiredForSubmit: false,
    canonicalPaths: [],
    ...spec,
    stub: false,
  };
}

export const NOT_BUILT_SUMMARY = "Not built yet";

export type StubSpec = {
  key: ModuleKey;
  title: string;
  perSize?: boolean;
  handSplit?: boolean;
  dependsOn?: readonly ModuleKey[] | "all";
  requiredForSubmit?: boolean;
};

type StubData = Record<string, unknown>;

// Loose on purpose: templates can configure a module, and data can be saved,
// before the module is built. Its real schemas then validate both.
const StubDataSchema: z.ZodType<StubData> = z.record(z.string(), JsonValueSchema);
const StubPerSizeDataSchema: z.ZodType<StubData> = z.looseObject({
  sizes: z.record(z.string(), JsonValueSchema).default({}),
});
const StubConfigSchema = z.record(z.string(), JsonValueSchema);

/** The placeholder in `modules/<key>/index.ts` until the module is built: always "Not built yet". */
export function stubModule({
  key,
  title,
  perSize = false,
  handSplit = false,
  dependsOn = [],
  requiredForSubmit = false,
}: StubSpec): ModuleDefinition<StubData, JsonObject, JsonObject> {
  return {
    key,
    title,
    labels: {},
    dataSchema: perSize ? StubPerSizeDataSchema : StubDataSchema,
    emptyData: () => (perSize ? { sizes: {} } : {}),
    configSchema: StubConfigSchema,
    defaultConfig: {},
    perSize,
    handSplit,
    dependsOn,
    requiredForSubmit,
    canonicalPaths: [],
    stub: true,
    calc: () => ({ result: { status: "not_done", summary: NOT_BUILT_SUMMARY }, computed: {}, issues: [] }),
  };
}
