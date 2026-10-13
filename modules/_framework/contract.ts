// The contract every module implements (BUILD_SPEC 6). A module is plain
// data and pure functions; its capture UI is loaded separately, so server
// code, tests and the export never pull in React. docs/MODULES.md explains
// each member with a worked example.
import type { ReactNode } from "react";
import type { z } from "zod";
import type { FieldType, JsonValue, Unit } from "@/lib/schemas/common";
import type { ModuleKey, ModuleResult } from "@/lib/schemas/module-result";
import type { CalcIssue, IssuePath } from "@/lib/validation/issues";
import type { ContextContribution, InspectionContext } from "./context";
import type { ModuleEvaluation } from "./evaluate";
import type { Hand } from "./hands";

export type JsonObject = { [key: string]: JsonValue };

/** A module's saved data, config and labels as calc receives them. */
export interface CalcInput<TData, TConfig> {
  /** Saved data parsed by the module's schema; for per-size modules only ordered sizes remain. */
  readonly data: TData;
  /** Effective config: module defaults, then the template chain, validated. */
  readonly config: TConfig;
  /** Heading and labels in the template's wording, for summaries and messages. */
  readonly title: string;
  /** Your defaults with the template's wording on top. Read them with `labelFor`. */
  readonly labels: Readonly<Record<string, string>>;
  /** Numbers that flow forward: sizes, header, packing, sampling, cartons, indicative weight, AQL. */
  readonly context: InspectionContext;
  /** Results of the modules named in `dependsOn` that the inspection includes. */
  readonly results: Readonly<Partial<Record<ModuleKey, ModuleResult>>>;
  /** Anything is saved for the module. Without data the framework reports "not done" anyway. */
  readonly hasData: boolean;
}

export interface CalcOutput<TComputed extends JsonObject = JsonObject> {
  /** pass, fail, warn, info or not_done, with a one-line summary and per-size results. */
  readonly result: ModuleResult;
  /** Totals, statistics, code letters, limits: never typed by the inspector (6.2 rule 2). Exported. */
  readonly computed: TComputed;
  /** Errors block submit; warnings go into the export. The framework adds the module key. */
  readonly issues: readonly CalcIssue[];
  /**
   * While the module is not done: the field to complete first, inside the
   * module's data (`["finalResult"]`). The framework's `module_not_done`
   * issue links there instead of to the module as a whole. Ignored once the
   * module is done.
   */
  readonly notDonePath?: IssuePath;
}

export interface ContributeInput<TData, TConfig> {
  readonly data: TData;
  readonly config: TConfig;
}

/** What `shownTitle` gets: the stored title, the module's config and the complete context. */
export interface TitleInput<TConfig> {
  /** The template's title, as stored with the version (`templates.resolved`). */
  readonly title: string;
  /** Effective config, parsed by your schema. */
  readonly config: TConfig;
  /** The complete context, every contribution in (buildInspectionContext). */
  readonly context: InspectionContext;
}

/** An entered value a custom field may map to (Field.mapsTo): `modules.<key>.<path>`. */
export interface CanonicalPath {
  /** Dot path inside the module's data, e.g. "indicativeWeight". */
  readonly path: string;
  readonly label: string;
  readonly type: FieldType;
  readonly unit?: Unit;
}

/** The two packaging levels labelling inspects (BUILD_SPEC 6.1 labeling): the inner unit and the carton. */
export const PACKAGING_LEVELS = ["inner", "carton"] as const;
export type PackagingLevel = (typeof PACKAGING_LEVELS)[number];

/** What the inspector has in focus, so a photo taken now is tagged with it (BUILD_SPEC 8.1). */
export interface CaptureFocus {
  readonly size?: string;
  readonly hand?: Hand;
  /** Defect code, or a check code in labelling. */
  readonly defect?: string;
  /** A box/carton number: the carton in carton sampling, the box in dispensing and labelling (one number, 6.2 rule 7). */
  readonly box?: number;
  /** Packaging level in labelling: the inner unit (dispenser box, plastic pack) or the carton. */
  readonly level?: PackagingLevel;
  /** An entry of the module's own list: a document on the documents checklist, a loading stage. */
  readonly item?: string;
}

/** Props of `modules/<key>/Capture.tsx`. */
export interface CaptureProps<TData = unknown, TConfig = unknown, TComputed extends JsonObject = JsonObject> {
  /**
   * Your saved data parsed with your schema (parseModuleData), every saved
   * size included: not `evaluation.data`, which keeps ordered sizes only.
   * Show only `context.sizes`.
   */
  readonly data: TData;
  readonly config: TConfig;
  /** Read-only on screen: section and result labels come from the template (6.2 rule 11). */
  readonly title: string;
  /** `effectiveLabels(definition, resolvedModule)`, as calc gets them. Read them with `labelFor`. */
  readonly labels: Readonly<Record<string, string>>;
  readonly context: InspectionContext;
  /** The latest result, computed values and issues: live totals, chips and inline errors. */
  readonly evaluation: ModuleEvaluation<TComputed> | null;
  /** A data path to scroll to and focus, from a link in the issue list. */
  readonly focusPath: IssuePath | null;
  /** Approved, or not the user's to edit. */
  readonly readOnly: boolean;
  /**
   * What the screen has in focus now, as the last module reported it: open
   * on its size when that size is ordered, so the size chosen in one module
   * stays chosen in the next. Absent on screens that do not track it.
   */
  readonly focus?: CaptureFocus | null;
  /**
   * How often each defect code was counted in earlier inspections (the same
   * client and manufacturer, else any the user can see), for "the most-used
   * defects first" (BUILD_SPEC 8): order defect rows by it, ties in the
   * template's order. Fixed while the screen is open, so rows never move
   * while the inspector counts; it never changes a result. Absent where no
   * usage is known: keep the template's order.
   */
  readonly defectUsage?: Readonly<Record<string, number>>;
  /**
   * Replace the module's data with the whole new value; the screen saves it.
   * Do not call it yourself: write through the kit's `useDataUpdater(data,
   * onChange)` and build each change from its `current` value
   * (docs/CAPTURE_KIT.md), so a pasted column or two changes in one event all
   * land, and sizes no longer ordered keep their data. Never store text in a
   * numeric cell.
   */
  onChange(next: TData): void;
  /** Report what is in focus, for photo tags. */
  onFocusChange?(focus: CaptureFocus): void;
}

// Method syntax keeps the props parameter bivariant, so a module's own
// Capture fits the registry's erased type (the React event-handler trick).
export type CaptureComponent<TData = unknown, TConfig = unknown, TComputed extends JsonObject = JsonObject> = {
  bivarianceHack(props: CaptureProps<TData, TConfig, TComputed>): ReactNode;
}["bivarianceHack"];

export interface ModuleDefinition<TData = unknown, TConfig = unknown, TComputed extends JsonObject = JsonObject> {
  /** Module key (BUILD_SPEC 6.1): the folder name and the key in `data.modules`. */
  readonly key: ModuleKey;
  /** Default heading; a template's title replaces it (4.2 rule 3). */
  readonly title: string;
  /**
   * Default labels by canonical key, or by dotted path for wording in one
   * place only (`minor.bead_defective`); a template's labels replace them key by key.
   */
  readonly labels: Readonly<Record<string, string>>;
  /** Saved data in `data.modules.<key>`. Draft-tolerant: every value may still be missing. */
  readonly dataSchema: z.ZodType<TData>;
  /** A new empty record on every call. */
  emptyData(): TData;
  /** Template config. Strict objects, so a mistyped key fails when the template is saved. */
  readonly configSchema: z.ZodType<TConfig>;
  /** Config when a template says nothing; templates deep-merge over it. */
  readonly defaultConfig: TConfig;
  /** Data is kept per ordered size under `sizes` (only sizes in order_lots, 6.2 rule 4). */
  readonly perSize: boolean;
  /** Can record right and left hands apart, switched on by `config.handSplit`. */
  readonly handSplit: boolean;
  /** Modules whose results calc reads (`input.results`), computed first; "all" for the conclusion. */
  readonly dependsOn: readonly ModuleKey[] | "all";
  /**
   * Submit waits until this module is done: its "not done" is an error, not
   * a warning. The conclusion, which holds the final result.
   */
  readonly requiredForSubmit: boolean;
  /** Entered values a custom field may map to. */
  readonly canonicalPaths: readonly CanonicalPath[];
  /** A placeholder from the framework: calc says "Not built yet". */
  readonly stub: boolean;
  /** Pure: result, computed values and issues from data, config and context. */
  calc(input: CalcInput<TData, TConfig>): CalcOutput<TComputed>;
  /**
   * Pure: what this module adds to the shared context. Only the parts it owns
   * (CONTEXT_SOURCES), and of the AQL settings only its own (AQL_SOURCES).
   */
  contribute?(input: ContributeInput<TData, TConfig>): ContextContribution;
  /**
   * Pure: the title this inspection shows, from the template's title as
   * stored with the version, for a count in it that follows the inspection
   * (weight's gloves weighed). Return `title` unchanged when nothing applies.
   * The stored wording never changes: the framework applies this once per
   * evaluation (withShownTitles), so the step list, every message, the
   * review and the export name the module alike. A hook that throws, or
   * answers blank, keeps the stored title.
   */
  shownTitle?(input: TitleInput<TConfig>): string;
  /** The capture UI, loaded on demand: `loadCapture: () => import("./Capture")`. */
  loadCapture?(): Promise<{ default: CaptureComponent<TData, TConfig, TComputed> }>;
}

/** A definition with its types erased, as the registry holds it. */
export type AnyModuleDefinition = ModuleDefinition<unknown, unknown, JsonObject>;

/** Every module key mapped to its definition (modules/registry.ts). */
export type ModuleRegistry = { readonly [K in ModuleKey]: AnyModuleDefinition };
