# Building modules

How to build an inspection module on the module framework (BUILD_SPEC 4, 6 and 6.2). Written for the engineers who build the report modules in parallel: read it once end to end, then keep it open while you work. `glove_info` is built end to end as the worked example (section 4).

| Path | What |
|---|---|
| `modules/<key>/` | One folder per module key. Yours to replace; nothing else changes when you do. |
| `modules/_framework/` | The contract, the inspection context, the engine, the test kit. Import it as `@/modules/_framework`. |
| `modules/registry.ts` | Maps every key to `modules/<key>/index.ts`. Never edited. |
| `modules/index.ts` | The app's entry point (`@/modules`): the registry bound into the engine, for screens and server actions. |
| `lib/templates/` | Template resolution, selection, per-inspection overrides, versions. |
| `lib/validation/` | Issues, cell schemas, the framework's 6.2 rules, custom module values, the suggested result, `validateInspection`. |
| `lib/sizes/` | Size normalisation and order, canonical units. |
| `lib/schemas/template.ts` | `TemplateDefinitionSchema` (BUILD_SPEC 4.3) and `ResolvedTemplateSchema`. |

## 1. Ground rules

- **Your folder only.** Each module engineer owns `modules/<key>/` for their keys. Do not edit `modules/registry.ts`, `modules/_framework/`, `lib/templates/`, `lib/validation/`, `lib/sizes/` or `lib/schemas/`. If the framework needs to change, write down the change and ask.
- **Replace the stub in place.** Every folder starts with an `index.ts` that calls `stubModule(...)`. Replace it with your module; keep the export name: `export const definition = defineModule({...})`.
- **Import from these only**: `@/modules/_framework` (contract, helpers, cell schemas, `SpecSchema`, issue builders), `@/lib/stats` (median, mean, specs, strict number parsing), `@/lib/sizes`, `@/lib/aql` (code letters, Ac/Re), `@/lib/schemas`, `zod`, and your own folder. **Never** import `@/modules`, `@/modules/registry` or `@/lib/validation`: they import the modules, so your module would import itself. `modules/_framework/architecture.test.ts` fails if you do.
- **Pure.** `schema.ts`, `config.ts`, `calc.ts` and `index.ts` hold data and pure functions: no React, Next, Supabase, `fetch`, `Date.now()` or randomness. The same code runs on the iPad, in server actions and in the export. Only `Capture.tsx` is React.
- **Plain JSON.** Data, config and computed values survive `JSON.stringify` unchanged: no `Date`, `Map`, class instances, `undefined` or `NaN`.
- **No new npm packages.**
- **Client data stays out.** Fixtures copy measurements from `docs/examples/` but replace client, manufacturer, PO, lot and carton identifiers with placeholders (`PO-0001`, `LOT-M-0001`, `Manufacturer A`).
- **Lint trap:** Next's ESLint rule forbids a variable named `module` (`const module = ...`, `for (const module of ...)`). Use `entry`, `found` or `resolved`.

## 2. Folder layout

```
modules/<key>/
  index.ts       export const definition = defineModule({...})   the registry reads this
  schema.ts      data schema and empty-data factory
  config.ts      default title, default labels, config schema and default config
  calc.ts        calc (and contribute, for the modules that feed the context)
  Capture.tsx    the capture UI, "use client", default export
  schema.test.ts
  calc.test.ts
  __fixtures__/  example data with placeholders (optional)
```

Split further inside your folder if a file grows (for example `calc-size.ts`), but keep these entry files.

## 3. The contract

A module is a `ModuleDefinition` (`modules/_framework/contract.ts`), declared with `defineModule`:

| Member | Required | What it is |
|---|---|---|
| `key` | yes | The module key (`lib/schemas/module-result.ts`). Also the folder name and the key in `data.modules`. |
| `title` | yes | Default heading. A template's `title` replaces it with the client's or manufacturer's wording (4.2 rule 3). |
| `labels` | yes | Default field labels, keyed by canonical field key. A template's `labels` replace them key by key. |
| `dataSchema` | yes | zod schema of what the inspector enters, as saved in `data.modules.<key>`. |
| `emptyData()` | yes | A new empty record on every call. |
| `configSchema` | yes | zod schema of the template config. |
| `defaultConfig` | yes | Config when a template says nothing. Templates deep-merge over it. |
| `calc(input)` | yes | Pure: `{ result, computed, issues }` from data, config and context. |
| `perSize` | no (false) | Data kept per ordered size under `sizes`. |
| `handSplit` | no (false) | Can record right and left hands apart; `config.handSplit` switches it on. |
| `dependsOn` | no (none) | Modules whose results `calc` reads; `"all"` for the conclusion. |
| `canonicalPaths` | no (none) | Entered values a template's custom field may map to (`Field.mapsTo`). |
| `contribute(input)` | no | Pure: what the module adds to the shared context. Only for the source modules (section 7). |
| `loadCapture()` | no | `() => import("./Capture")`: the capture UI, loaded on demand. |

`defineModule` takes the data and config types from the two schemas, then checks `emptyData`, `defaultConfig`, `calc` and `contribute` against them. If TypeScript infers a union for `computed` because two branches return different shapes, annotate the return type: `calc: (input): CalcOutput<MyComputed> => ...`. Declare `MyComputed` as a `type`, not an `interface` (it must fit `JsonObject`).

`calc` receives:

| `input.` | What |
|---|---|
| `data` | Saved data parsed by your schema (`emptyData()` when nothing is saved). For a per-size module, only ordered sizes remain. |
| `config` | Effective config: your defaults, then each template down the extends chain, validated by your schema. |
| `title`, `labels` | Effective wording. Use these in summaries and messages, never hard-coded labels. |
| `context` | The inspection context (section 7). |
| `results` | Results of the modules in `dependsOn` that the inspection includes. |
| `hasData` | Anything is saved for the module. |

and returns `CalcOutput`: `result` (`ModuleResult`: `status`, `summary`, `perSize`), `computed` (a JSON object: totals, statistics, code letters, limits; exported) and `issues` (section 8).

## 4. Worked example: `glove_info`

Glove Information (BUILD_SPEC 6.1): surface texture, indicative weight (size M, g), colour and length, on page 1 of both reports. Result `info`. Read the four files in `modules/glove_info/`; the essentials:

**`schema.ts`**: every value may be missing while the inspection is a draft. Cells come from the framework, so a number is a number and blank is `null`:

```ts
export const GloveInfoDataSchema = z.strictObject({
  surfaceTexture: TextCellSchema,
  indicativeWeight: DecimalCellSchema, // grams, a number: "3.5 g" or "2 42" never get in
  colour: TextCellSchema,
  length: TextCellSchema,              // "240 mm minimum" as printed: text, not a measurement
});
export type GloveInfoData = z.infer<typeof GloveInfoDataSchema>;
export function emptyGloveInfo(): GloveInfoData {
  return GloveInfoDataSchema.parse({});
}
```

**`config.ts`**: the defaults a template overrides. The labels are the reports' wording; the config switches fields on and off and names the size the indicative weight is for:

```ts
export const GLOVE_INFO_TITLE = "Glove Information";
export const GLOVE_INFO_LABELS = {
  surfaceTexture: "Glove surface texture",
  indicativeWeight: "Indicative weight (size M)",
  colour: "Glove colour",
  length: "Glove length",
};
export const GloveInfoConfigSchema = z.strictObject({
  fields: z
    .strictObject({ surfaceTexture: z.boolean(), indicativeWeight: z.boolean(), colour: z.boolean(), length: z.boolean() })
    .describe("Fields shown on this template"),
  indicativeWeightSize: CanonicalSizeSchema.describe("The size the indicative weight is given for."),
});
export const GLOVE_INFO_DEFAULT_CONFIG: GloveInfoConfig = {
  fields: { surfaceTexture: true, indicativeWeight: true, colour: true, length: true },
  indicativeWeightSize: "M",
};
```

**`calc.ts`**: info once every field the template shows is filled in, not done until then, an error on an impossible value, and the indicative weight passed forward for `weight`:

```ts
export function calcGloveInfo({ data, config, labels }: CalcInput<GloveInfoData, GloveInfoConfig>): CalcOutput<GloveInfoComputed> {
  const shown = GLOVE_INFO_FIELDS.filter((field) => config.fields[field]);
  const issues: CalcIssue[] = [];
  if (config.fields.indicativeWeight && data.indicativeWeight !== null && data.indicativeWeight <= 0) {
    issues.push(errorIssue("indicative_weight_not_positive", `${labels.indicativeWeight}: must be more than 0 g.`, {
      path: ["indicativeWeight"],
    }));
  }
  const missing = shown.filter((field) => !isFilled(data, field));
  if (missing.length > 0) {
    return { result: notDone(`Missing: ${missing.map((field) => labels[field]).join(", ")}.`), computed: {}, issues };
  }
  return { result: { status: "info", summary: summarise(data, config) }, computed: {}, issues };
}

export function contributeGloveInfo({ data, config }: ContributeInput<GloveInfoData, GloveInfoConfig>): ContextContribution {
  const grams = data.indicativeWeight;
  if (!config.fields.indicativeWeight || grams === null || grams <= 0) return {};
  return { indicativeWeight: { grams, size: config.indicativeWeightSize } };
}
```

**`index.ts`**: the definition the registry picks up:

```ts
export const definition = defineModule<GloveInfoData, GloveInfoConfig, GloveInfoComputed>({
  key: "glove_info",
  title: GLOVE_INFO_TITLE,
  labels: GLOVE_INFO_LABELS,
  dataSchema: GloveInfoDataSchema,
  emptyData: emptyGloveInfo,
  configSchema: GloveInfoConfigSchema,
  defaultConfig: GLOVE_INFO_DEFAULT_CONFIG,
  canonicalPaths: [
    { path: "indicativeWeight", label: GLOVE_INFO_LABELS.indicativeWeight, type: "number", unit: "g" },
    // surfaceTexture, colour, length: text
  ],
  calc: calcGloveInfo,
  contribute: contributeGloveInfo,
  // loadCapture: () => import("./Capture"),   once Capture.tsx exists
});
```

**Tests**: `schema.test.ts` (draft parsing, numbers never text, strict keys, config defaults, JSON Schema for the editor) and `calc.test.ts` (the contract check, info, not done with the template's wording, fields switched off, the error, the contribution, and one run through the engine).

## 5. Data

- **Drafts.** The schema describes a draft: every value can still be missing. Use the cell schemas, which default to `null`: `DecimalCellSchema` (a measurement), `CountCellSchema` (a whole number from 0), `CartonNumberCellSchema` (from 1), `TextCellSchema`, `DateCellSchema` (`YYYY-MM-DD` from a picker), `YesNoCellSchema`. Completeness is calc's job (not done), never the schema's.
- **Numbers are numbers (6.2 rules 1 to 3).** A numeric cell holds `number | null`. Text such as `"2 42"`, `"1/80"` or a date never gets past the schema; saved data that does is reported as an `invalid_data` error with the path. Parse typed or pasted text with `readDecimalCell` / `readCountCell` (lib/stats' strict parser; `NumericCell` in `components/qc` uses the same one).
- **Never store what is computed (rule 2).** Totals, averages, medians, rates, code letters and accept/reject limits go in `computed`, not in data.
- **Strict objects.** `z.strictObject`, so a mistyped key is an error instead of silently kept or dropped.
- **Per size.** A per-size module (`perSize: true`) keeps its data under `sizes`, keyed by canonical size: build the schema with `perSizeData(rowSchema)` and add module-wide fields with `.extend({...})`. The framework keeps sizes that are not in the order out of your calc, your result and the export, and warns about the ignored data (rule 4).
- **Hand split.** Modules with `handSplit: true` (watertight, visual) have a boolean `handSplit` in their config; with it on, keep each size's data per hand, e.g. `sizes.M = { R: {...}, L: {...} }`. `HANDS`, `HandSchema` and `isHandSplit(definition, config)` are in the framework.
- **The comment is not yours.** Every module carries an inspector comment, which the framework stores under the reserved key `comment` in your entry and strips before your schema sees the data. Do not define `comment`.
- **Box numbers (rule 7)** are carton numbers picked from `context.cartons[size]`; store the number, not an index into the list.
- **Evolving a schema.** Saved inspections are re-read with your current schema. Add fields with defaults; never rename or retype a key without a migration.

## 6. Config, title and labels

- **Defaults first (4.2 rule 1).** Default title and labels follow `docs/forms/reports/`, with `[sic]` typos fixed. Where the two reports differ, pick the STD_EG wording and let SAFEDON_EG's template override it.
- **Labels are keyed by canonical field key.** Use your data keys, plus defect codes, check keys or measure keys where your config lists them (a template may label `thin_spot` "Thin spot"). Read every label from `input.labels` (calc) or `props.labels` (Capture): never hard-code wording.
- **Config schema.** Strict objects, enums, numbers, booleans and arrays, with `.describe()` on what an admin edits: the template editor generates its form from your schema with `z.toJSONSchema()`, so no transforms. The contract check fails if the schema cannot become JSON Schema.
- **How templates merge config.** Your `defaultConfig`, then each template from the root of the extends chain down. Objects merge key by key; a **tagged object** (one with a `kind` key, such as a spec) is one value and is replaced whole; everything else replaces too: arrays (a defect list, the measures), numbers, strings, booleans, `null`. So a child template writes `{ classes: { major: { aql: 1.5 } } }` to change one AQL and keeps the rest; to change one defect in a list it writes the whole list; to change a spec it writes the whole spec, and may change its kind: STD_EG's XS width `{ kind: "max", max: 80 }` becomes SAFEDON_EG's `{ kind: "tolerance", nominal: 76, tolerance: 4 }` with no `max` left over. The merged result must parse with your schema, or the template does not save.
- **Specs.** Use `SpecSchema` from the framework for every specification limit (min, max, range, nominal ± tolerance, NA). It is lib/stats' `Spec`, so `checkSpec` and `formatSpec` take it as parsed, and it is tagged by `kind`, so templates replace it whole. If your config has another union of object shapes, discriminate it on `kind` too (`z.discriminatedUnion("kind", [...])`); a union without a `kind` key would be merged key by key into a mix of two shapes.
- **Frozen with the template.** The resolved config is stored with the template version (`templates.resolved`) and re-parsed with your schema on every run. Changing a default in code does not change templates already saved; add new config fields with a default so older resolved templates still parse.
- **Field on/off.** For "fields on/off" (header, glove_info, loading) use `fields: { <key>: boolean }` as glove_info does.
- **AQL.** Defaults are in `context.aql` (BUILD_SPEC 7: watertight 1.5, critical 0, major 2.5, minor 4.0; per-client values replace them). A module's config may set its own AQL (the template's choice wins): make that field nullable and fall back to `context.aql` when it is `null`.

## 7. The inspection context: numbers flow forward

Values entered once and read by every module that needs them (BUILD_SPEC 8, 6.2 rules 4, 7, 9 and 10). `input.context` in calc, `props.context` in Capture. Type: `InspectionContext` (`modules/_framework/context.ts`).

| Field | What | Comes from |
|---|---|---|
| `sizes` | Ordered sizes, canonical, in the template's order. **The only sizes any module shows** (rule 4). | `order_lots` |
| `order[size]` | `{ qtyCases, lotNumbers }` | `order_lots` |
| `header` | `client`, `manufacturer`, `poNo`, `productName`, `productCode`, `inspectionDate`, `mfgDate`, `expiryDate` (blank header fields fall back to the inspection row) | `header` |
| `packing` | `innerUnit`, `glovesPerInner`, `innersPerCase`, `glovesPerCase` | `packing_config` |
| `sampling[size]` | `cases`, `innerUnits`, `gloves`, `watertightVisual`, `dimensions`, `physical`, `packagingDispensing`, `pouches`: n for the modules that follow | `sampling_plan` |
| `cartons[size]` | Sampled carton numbers, unique: what box pickers offer (rule 7) | `carton_sampling` |
| `indicativeWeight` | `{ grams, size }` (rule 9) | `glove_info` |
| `aql` | `watertight`, `critical`, `major`, `minor`, `inspectionLevel` | defaults, per client, `sampling_plan` config |
| `template` | `code`, `name`, `productType`, `standard`, `unit` (`pcs` or `pairs`) | the template |
| `templateSizes` | Sizes the template offers, `{ value, label }` | the template |
| `inspection` | `refNo`, `inspector` (always recorded, rule 11), `client`, `manufacturer` | the inspection row |

Readers: `samplingFor(context, size)` (empty values when missing), `cartonsFor(context, size)`, `lotSizeGloves(context, size)` (cases x gloves per case, or null), `sizeLabel(context, size)` (the template's label, e.g. "Medium").

**Any part can be empty.** A source module that is switched off, not filled in, or not built yet leaves its part empty: no sizes, no n, no cartons, no indicative weight. Handle it: a per-size module with no ordered sizes is not done (the framework says so); with no n, it is not done; with no carton list, the box number is entered freely and not checked; with no indicative weight, `weight` has nothing to compare against.

**Source modules contribute.** The six modules in the table implement `contribute({ data, config })` and return only the parts they own (`CONTEXT_SOURCES`); returning another module's part throws. Contributions read only their own saved data, and per-size maps may use any size spelling (the builder normalises and drops unordered sizes).

**Calculation order.** The context is built first, from every included module's `contribute`, so every calc sees the complete context whatever the template's order. Calcs then run in template order, except that a module runs after the modules in its `dependsOn` and sees only their results. The conclusion declares `"all"` and runs last. In practice only the conclusion reads other modules' results; everything else flows through the context.

## 8. Results and issues

**Status** (`ModuleResult.status`, 4.2 rule 7):

| Status | Use when |
|---|---|
| `pass` | Everything required is entered and within limits. |
| `fail` | A limit is exceeded, or a rule says fail (a critical defect, a failing stickiness code, a carton error). |
| `warn` | Complete and acceptable, with something the reviewer must see (weight deviation, packing mismatch, below the AQL plan). |
| `info` | A record with no verdict (header, glove_info, order_lots). |
| `not_done` | Anything missing. **Never** `pass` with missing data (rule 5). |

**Per size.** A per-size module returns a result for every size in `context.sizes`: build them with `perSizeResults(context.sizes, (size) => ...)` and return `resultFromSizes(perSize, summary)`, which sets the module status to the worst size. If you leave `perSize` out, the framework counts every ordered size as not done.

**Summary.** One plain line in the template's wording, e.g. "Size M: 1 hole in 500 (finger), limit 14 / 15." It shows on the module tab and goes into the export.

**Issues** (BUILD_SPEC 6.2, last paragraph): errors block submit; warnings are allowed and go into the export. Build them with `errorIssue(code, message, { size, path })` and `warningIssue(...)`; the framework adds your module key.

- `code`: snake case, stable, prefixed by what it is about: `carton_duplicate`, `carton_out_of_range`, `box_not_in_cartons`, `weight_deviation`. Screens and the AI review match on it.
- `message`: one sentence for the inspector, with the template's labels and the values: "Carton 578 is entered twice for size M."
- `path`: where the problem is **inside your data**, for the link in the issue list: `["sizes", "M", 12]` is the 13th carton of size M. `[]` points at the module.
- `size`: the size it concerns, when there is one.
- Missing values are not issues: they make the module not done, and the framework adds one `module_not_done` warning per module. Raise issues for **wrong** data.

**What the framework does for every module**, whatever calc returns:

| Code | Level | When |
|---|---|---|
| `module_not_done` | warning | The final status is not done (rule 5). |
| `size_not_ordered` | warning | Data saved for a size not in the order; ignored (rule 4). |
| `invalid_data` | error | Saved data fails your schema (text in a numeric cell, rule 1). |
| `invalid_config` | error | The template's config fails your schema. |
| `calc_failed` | error | Your calc threw. Only your module is affected. |
| `invalid_output` | error | Your calc returned a result, computed values or issues outside the contract. |
| `inspector_missing` | error | No inspector recorded (rule 11), on `header`. |
| `required`, `out_of_range`, `invalid_option`, `too_many_columns`, `mapped_value_ignored` | | Custom module fields. |

It also overrides the status: nothing saved means not done; per-size results only for ordered sizes, missing ones not done; the module never better than its worst size. Do not reuse these codes.

## 9. BUILD_SPEC 6.2, rule by rule

| Rule | Your module | The framework |
|---|---|---|
| 1. Numeric cells accept numbers only | Cell schemas; `NumericCell`; `readDecimalCell` for pasted text | `invalid_data` error on saved text |
| 2. Totals, averages, medians, rates, code letters, limits are computed | Compute in calc, return in `computed`, show read-only | |
| 3. Counts never turn into dates; dates use pickers | `CountCellSchema`, steppers; `DateCellSchema` with a date picker | |
| 4. Sizes not in order_lots appear nowhere | Loop over `context.sizes` | Drops unordered sizes from data, results and export; `size_not_ordered` warning |
| 5. Missing data shows "Not done", never "Passed" | Return `not_done` until complete | Forces not done without data or for missing sizes; `module_not_done` warning |
| 6. Cartons unique per size, 1 to the order quantity, count = sampled cases | `carton_sampling`: errors with paths; result fail | Carton list into the context, unique |
| 7. Box numbers picked from that size's carton list | Pick from `context.cartons[size]`; error when a saved box is not in it | |
| 8. The sample size sets code letter and limits; a plan that does not match n cannot be saved | Use `lib/aql`; an error when n does not fit the plan | |
| 9. Weight beyond the threshold from the indicative weight warns | `weight`: compare with `context.indicativeWeight` | Indicative weight into the context |
| 10. Client, product code and PO entered once, reused everywhere | Read `context.header`; never ask again | One header in the context; `mapsTo` binds a custom field to a module value; `inspectionRowValues(context)` copies PO, product and lots to the inspection row |
| 11. Inspector always recorded; labels from the template, not editable on capture | Show `context.inspection.inspector`; labels read-only | `inspector_missing` error |

## 10. `Capture.tsx`

The capture screen wraps your Capture in `ModuleCard` (title, result pill, inspector comment, the two photo buttons). Capture renders the module body only.

```tsx
"use client";
import type { CaptureProps } from "@/modules/_framework";
import type { GloveInfoComputed, GloveInfoConfig, GloveInfoData } from ".";

export default function Capture({ data, config, labels, context, evaluation, readOnly, onChange }: CaptureProps<GloveInfoData, GloveInfoConfig, GloveInfoComputed>) {
  // ...components/qc: NumericCell, MeasurementGrid, Stepper, DefectChipGroup, StatusPill
}
```

Then add `loadCapture: () => import("./Capture")` to your definition.

| Prop | What |
|---|---|
| `data`, `config` | Parsed with your schemas. |
| `title`, `labels` | The template's wording. Read-only: never editable on the capture screen (rule 11). |
| `context` | Sizes, n, cartons and the rest, as in calc. |
| `evaluation` | The latest `result`, `computed` and `issues` for your module: live totals, accept/reject chips, inline errors. |
| `onChange(next)` | Replace your data; the screen merges it into the inspection and autosaves. |
| `onFocusChange(focus)` | Report the size, hand, defect or box in focus, so a photo taken now is tagged with it (BUILD_SPEC 8.1). |
| `focusPath` | A data path to scroll to and focus, from a link in the issue list. |
| `readOnly` | Approved, or not the user's to edit. |

Follow `docs/DESIGN.md`: counts by tapping (steppers, defect chips), measurements in `NumericCell` / `MeasurementGrid` (Enter goes down, paste fills down), computed values read-only, 44 px touch targets on iPad, one block per ordered size in `context.sizes` order. Check `components/qc` before writing your own control.

## 11. Testing

- Vitest, files next to the code: `schema.test.ts`, `calc.test.ts`. Every rule in your brief has a test; every result in `docs/examples/expected-results.md` that your module produces has a test with placeholder identifiers.
- `expect(checkModuleContract(definition)).toEqual([])`: defaults parse, empty data parses and is not done, the config becomes JSON Schema, canonical paths exist, contributions stay in your parts. `modules/registry.test.ts` runs it on every module too.
- `makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) }, cartons: { M: [32, 578] } })` builds a context for calc tests (`@/modules/_framework/testing`).
- Through the engine, with the real registry (a test may import it):

  ```ts
  import { MODULE_REGISTRY } from "@/modules/registry";
  import { buildInspectionContext, evaluateInspection } from "@/modules/_framework";
  import { makeTestTemplate } from "@/modules/_framework/testing";

  const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", "sampling_plan", "watertight"]);
  const context = buildInspectionContext({ template, data }, MODULE_REGISTRY);
  const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
  ```

  Modules other than yours may still be stubs that contribute nothing: set the context parts you need with `makeTestContext` in unit tests, and only rely on built modules in engine tests.
- Run `npx vitest run modules/<key>` while working; `npm run check` before handing in. Do not run `next dev` or `next build` for module work.

## 12. Templates

A template (BUILD_SPEC 4.3, `TemplateDefinitionSchema`) lists modules in report order with `{ key, include, title?, labels?, config? }`, sizes, custom modules and report settings. `lib/templates` resolves it into a `ResolvedTemplate` when a version is saved: modules in final order with effective title, labels and config. That is what your module receives.

**Extends.** A child lists only what differs (4.2 rule 9):

- `include`, `title`: the nearest template that sets them wins. Header and conclusion are always on (4.1), first and last.
- `labels`: merged key by key over your defaults. `config`: merged as section 6 describes, then validated by your schema.
- **Order**: the child's list is read top to bottom and each module it lists ends up somewhere after the module listed before it, not necessarily right after. A module the base already has stays put if it already comes after; otherwise it moves to just after it. A new module goes right after the previous entry (to the top, after header, if listed first). Modules the child does not list keep their place, and listing modules in the base's order (to relabel or reconfigure them) moves nothing. So:
  - to add `tensile` after `weight`, list `weight` then `tensile`;
  - to move a module **later**, list the module it must follow, then it;
  - to move a module **earlier**, list it, then the modules it must now come before. Listing it after a module it already follows leaves it in place: with base `a, b, c, m`, the list `a, m` changes nothing, while `m, b, c` gives `a, m, b, c`;
  - listing every module gives exactly that order.
- Custom modules are inherited; a child's custom module with the same key replaces the base's.
- Scope, unit, sizes and name are the template's own; the report settings are inherited when absent; the source file is not.

**Custom modules** add one-off fields (4.2 rule 2) after a module: layout `fields` (a form), `table` (a row per ordered size) or `grid` (a row per field, repeated columns such as boxes, per size with `grid.repeatPer`). A field with `mapsTo: "modules.<key>.<path>"` shows and edits your module's value instead of keeping its own; the path must be in your `canonicalPaths`, with a matching type and unit, and only one field may map to a path. Declare as canonical paths the entered values a client form might ask for under its own section (header fields, glove info, packing values).

**Until your module is built** its stub accepts any config, so seed templates can be written now. Once your schema is in, every seed template must still resolve: check them in a test with `resolveTemplateOrThrow`.

**Choosing a template** (4.4): `selectTemplate` picks the most specific active template (client and manufacturer, client, manufacturer, standard), or an admin's override. An admin can switch a module off for one inspection with a reason (`module_overrides`); `applyModuleOverrides` gives the inspection's copy of the template, which the context, the engine and the export all use.

**Versions** (4.2 rule 8): `planTemplateEdit` edits an unused draft in place and makes a new version of anything else; `planActivation` requires the coverage checklist and retires the active version first. The database freezes a version once an inspection uses it.

## 13. Validation and the suggested result

For the capture screen, submit and the export (`@/modules`, `@/lib/validation`, `@/lib/templates`):

```ts
const template = applyModuleOverrides(ResolvedTemplateSchema.parse(row.resolved), parseModuleOverrides(row.module_overrides));
const context = buildInspectionContext({ template, data, meta: { refNo, inspectionDate, inspector, client, manufacturer } });
const report = validateInspection(data, template, context);
// report.modules: result, computed, issues, comment per included module, in template order
// report.custom, report.excluded (with reasons), report.issues (screen order)
// report.errors, report.warnings, report.canSubmit, report.suggested
```

- **Saving a template version**: `resolveTemplate(definition, getBase)` from `@/modules` resolves against the real modules (`getBase` returns a base's definition, usually its active version; `lookupFrom(definitions)` builds one). On success, write `templateRowFields(definition, resolved)` to the `templates` row; on failure, show each problem's `template`, `path` and `message` in the editor.
- **Errors block submit; warnings go into the export.** Each issue has `moduleKey` and `path` for the link. `exportIssuesOf(issues, key)` gives a module's `warnings` and `errors` in the export's shape; `templateSections(template)` gives modules and custom modules in screen and export order; `inspectionRowValues(context)` gives `po_no`, `product_name` and `lot_numbers` for the inspection row.
- **Suggested result** (`suggestResult`, the conclusion's suggestion and `inspections.suggested_result`), over the included modules except the conclusion:
  1. **fail** if any module failed;
  2. **hold** if any module is not done;
  3. **hold** if no module gave a verdict (nothing tested);
  4. **pass** otherwise, with the modules that warned listed.

  It never changes the final result: the inspector decides, and an admin reviews. A module not done is a warning, not an error, so an inspection can be submitted on hold (for example while a lab report is pending).

## 14. Notes per module

| Module | perSize | Notes for the builder |
|---|---|---|
| `header` | no | Always on. Contributes `header`; use its keys (`client`, `manufacturer`, `poNo`, `productName`, `productCode`, `inspectionDate`, `mfgDate`, `expiryDate`) as your data keys. Inspector from `context.inspection`, never typed. Warn if expiry is not after mfg date. Canonical paths for the text fields. |
| `glove_info` | no | Done: the worked example. |
| `order_lots` | no | The source of sizes, so not per size itself. Contributes `sizes` (sizes with a quantity) and `order`. Totals in `computed`, gloves from `context.packing`. Offer only `context.templateSizes`. |
| `packing_config` | no | Contributes `packing`. Warn if gloves per case is not inner x per case. Inner unit name from config. |
| `sampling_plan` | yes | Contributes `sampling` (the `SamplingValues` keys) and `aql.inspectionLevel` from config. Warn when below the AQL plan (`lib/aql`, `lotSizeGloves`). |
| `carton_sampling` | yes | Contributes `cartons`. Rule 6 errors with paths; fail on them. |
| `dimensions` | yes | n from `context.sampling[size].dimensions` or config; `summarizeColumn` and `checkSpec` in `lib/stats`; median or average from config. Specs per size and measure with `SpecSchema`, e.g. `specs: z.record(CanonicalSizeSchema, z.strictObject({ length: SpecSchema, ... }).partial())`. |
| `weight` | yes | Compare with `context.indicativeWeight` when its size matches; warn beyond the threshold (rule 9). The optional spec is `SpecSchema.nullable()`. |
| `force_at_break`, `tensile` | yes | Lab report files are uploaded by the screen with the module key; keep a file id in data if the module needs it. Spec minimums (6 N; 14 MPa, 500%) with `SpecSchema`. |
| `watertight`, `visual` | yes | `handSplit`. n from `context.sampling[size].watertightVisual`; limits from `lib/aql` with AQL from config or `context.aql`. Any critical defect fails. |
| `dispensing_packing`, `dispensing_safedon`, `labeling` | yes | Box numbers from `context.cartons[size]` (rule 7). Labelling is Accept 0 / Reject 1. |
| `conclusion` | no | Always on. Keep `dependsOn: "all"`; compute the suggestion with `suggestResult` over `input.results`, put it in `computed.suggestedResult`; the final result is the inspector's. |
| `dye_leak` | yes | Optional module (Phase 3). |
| `documents`, `loading` | no | Optional modules (Phase 3). |

## 15. Before you hand in

- [ ] `index.ts` exports `definition` from `defineModule`; the stub is gone.
- [ ] Title and labels follow the reports; summaries and messages use `input.labels`.
- [ ] Data schema: strict objects, cell schemas, `perSizeData` for per-size modules, no `comment`.
- [ ] Config schema: strict, described, JSON-Schema friendly; defaults parse.
- [ ] calc: not done until complete; per-size results for every ordered size; computed values in `computed`; wrong data raises issues with paths.
- [ ] Source modules: `contribute` returns only your parts of the context.
- [ ] `checkModuleContract(definition)` is `[]`; every rule in your brief has a test; expected results reproduced with placeholders.
- [ ] `Capture.tsx` uses `components/qc`, reads labels from props, reports focus for photo tags; `loadCapture` set.
- [ ] `npm run check` passes.
