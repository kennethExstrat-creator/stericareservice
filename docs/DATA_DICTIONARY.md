# Data dictionary

The canonical data of every module, what each seed template fixes, and where every field of every
source document goes (BUILD_SPEC 4.2 rules 1 to 5 and 10). Module schemas, template seeds and the
coverage checklist are built from it.

**The data is the source of truth:** `lib/coverage/`. This page explains it; the tables between
`generated` markers are rendered from it, and `lib/coverage/doc.test.ts` fails when they drift. After
changing the data, rewrite them with:

```bash
UPDATE_DATA_DICTIONARY=1 npx vitest run lib/coverage/doc.test.ts
```

| File | Holds | Used by |
|---|---|---|
| `lib/coverage/fields.ts` | Per module: data fields, config fields with complete defaults, captions, default labels (STD_EG wording, `defaultLabels`), other templates' wording; key types `EnteredKey`, `SystemKey`, `ComputedKey` | Module engineers: `modules/<key>/schema.ts` and `config.ts` |
| `lib/coverage/templates.ts` | Per template: modules on and their order, sizes, unit, report title, every module's config values, custom modules, what is still to confirm. `defaultConfig(module)` is a module's default config; `seedConfig(code, module)` the config a seed writes (whole for a root template, the diff for a child); `seedModuleConfigs(code)` gives BUILD_SPEC 4.3 `ModuleConfig` values; `fieldShown` says whether a template shows a field | Template seeds `STD_EG`, `SAFEDON_EG`, `STD_SG` |
| `lib/coverage/defects.ts` | Defect labels per template and class in report order, mapped to the codes of `supabase/seed.sql`; hole locations; the Safedon dispensing defects; stickiness codes; labelling checks per level | Template seeds, defect mapping screen |
| `lib/coverage/sources.ts` | Every field of every source document, verbatim, with stable ids and where it goes | Coverage checklist (rule 4.2.10) |
| `lib/coverage/wording.ts` | The forms' wording against the app's (decision 17): `sameWording` (a template label is the printed one, `[sic]` fixed, its capitals aside and the box or carton number worded Box/Carton #), `targetLabel` (what a template shows for a target) and `appWording` (the coverage matrix's App wording) | The coverage tests; the coverage matrix |
| `lib/coverage/merge.ts` | How module config merges down an extends chain, as the framework's `lib/templates/merge.ts` does it, with `configDiff` | The tests; template seeds |
| `lib/coverage/keys.ts` | Closed key lists: measures, sampling columns, header fields, labelling levels and checks, inner units, inspection levels, code letters | All of the above |

The tests check that every source field has a target and every target exists in a field the
template shows; that every cell someone fills in on a source lands on an entered, recorded or custom
field; that no module has duplicate keys; that every module key is a `ModuleKey`; that every defect
code is in `seed.sql` (and every seeded code is used); that each template's module order is BUILD_SPEC
11's; that `[sic]` labels are corrected; that every label printed on the reports and on the SG
form is the label the template shows, the same words in Title Case, the box or carton number worded
Box/Carton # (`sameWording`); and that every
label in `lib/coverage` is in Title Case (`lowerCaseWords`). They also resolve every template from the module defaults down
its extends chain, merged as the framework merges, and check the result is the template's config;
and they check every label key fits the framework's `ModuleConfig.labels`. Config keys and the
completeness of every module's defaults are checked at compile time against the dictionary.

## Conventions

**Keys.** Data, config and caption keys are camelCase and unique within a module (data fields and
captions share one namespace: `ModuleConfig.labels`). Codes are snake_case: defect codes
(`defect_codes.code`, hole locations included) and labelling checks (`lot_no`, `mfg_date`,
`expiry_date`, `artwork`, `carton_no`). Module keys are `ModuleKey`.

**Shape.** `Per` gives a field's nesting, outermost first:

| Per | Means |
|---|---|
| inspection | one value per inspection |
| size | one per ordered size (keyed by the normalised size, rule 6.2.4) |
| hand | R and L, only when the module's `handSplit` is on; otherwise absent |
| class | `critical`, `major`, `minor` (visual) |
| level | `inner`, `carton` (labeling) |
| glove, box | rows of a table (dimensions gloves; dispensing boxes) |
| item | documents checklist items |

`count_map` is a map from code to count; `label_counts` is a list of `{ label, count }` for labels
not in the template's list (saved unmapped, flagged for an admin: BUILD_SPEC 4.2 rule 4, 8);
`*_list` is a plain array; `reference` is an id (client, manufacturer, profile); `file` is an
`inspection_files` row; `signature` a drawn image.

**Entry.** `entered`: typed or tapped by the inspector, possibly prefilled (numbers flow forward,
BUILD_SPEC 8). `system`: recorded by the app, never typed (the inspector). **`computed`**: derived by
the app, never typed (rule 6.2.2); it belongs in the export's `computed`, not in `data`. Every
computed field gives its formula. The types `EnteredKey<M>`, `SystemKey<M>` and `ComputedKey<M>`
(and `dataKeys(module, entry)` at run time) split a module's keys this way: a module's zod data
schema holds its `EnteredKey`s (a `file` field is an `inspection_files` row instead), its `computed`
holds its `ComputedKey`s. `DataKey<M>` is all three.

**Units** (rule 4.2.5): mm, g, N, MPa, %, pcs. Percentages are numbers in % (88, not 0.88), rates
included. Counts of cases, inner units, pouches, boxes and cartons say what they count.

**Labels** (rule 4.2.3). The default label of a field or caption is STD_EG's wording with `[sic]`
typos fixed, or the source's wording where STD_EG lacks it; other templates override only what
differs. Every label is written in Title Case (decision 17): the source's words with the capitals
of `docs/DESIGN.md`, "Packing Configuration" for the printed "Packing configuration", and so are
the rows a template lists (defects, hole locations, labelling checks). `defaultLabels(module)` gives a module's default labels and `labelOverrides(template,
module)` a template's overrides, both keyed as `ModuleConfig.labels` is: data field keys, caption
keys, and class or level wording keyed group first, then field (`groupLabelKey`: `majorTotal`,
`criticalResult`, `innerResult`), like the captions `majorHeading` and `innerLevel`. All are
camelCase, so they fit the framework's label keys (letters, digits and `_`) and never meet a
snake_case defect code. The one exception is an option's word, keyed by its select field and the
option, as the framework's dotted label keys allow: `status.verified`, `status.not_verified`
(documents). Captions may hold placeholders the app fills in: `{size}`, `{codeLetters}`
(the code letters of the ordered sizes, as the headings print them), `{aql}` (one decimal: 0.0,
2.5), `{minLayeringPct}`, `{minDispensingPct}`, `{standardLabel}`.

**Config** (BUILD_SPEC 4.2 rule 9). Every config field has a complete default, BUILD_SPEC's where it
gives one and otherwise STD_EG's (its lists and wording), so a module's `defaultConfig` is exactly
these defaults (`defaultConfig(module)`). Specs are the exception: they belong to the product
(BUILD_SPEC 13), so a module has none by default. A template's config merges over the defaults and
down its extends chain as the framework merges it (`merge.ts`): objects key by key, lists and values
whole. So whatever a child template must replace whole is a list (the dimension and weight spec
rows, the defect lists), and an object keeps every key its base has (`decimals` covers every measure,
on or off), because a merge can add or change a key but never remove one.

**Every module** also carries an inspector comment and photos (BUILD_SPEC 4.2 rule 7) and returns
`{ status, summary, perSize? }` (`lib/schemas/module-result.ts`); the dictionary does not repeat
them. Dates are `YYYY-MM-DD`. Header values that the `inspections` table also holds name their
column.

## Validation rules

<!-- generated:rules -->

| Rule | BUILD_SPEC 6.2 | Modules that apply it |
|---|---|---|
| 1 | Numeric cells accept numbers only: '2 42' is rejected, not stored as text. | `glove_info`, `order_lots`, `packing_config`, `sampling_plan`, `carton_sampling`, `dimensions`, `weight`, `force_at_break`, `tensile`, `watertight`, `visual`, `dispensing_packing`, `dispensing_safedon`, `labeling`, `dye_leak`, `loading` |
| 2 | Totals, averages, medians, rates, code letters and accept/reject limits are computed, never typed. | `order_lots`, `packing_config`, `sampling_plan`, `carton_sampling`, `dimensions`, `weight`, `force_at_break`, `tensile`, `watertight`, `visual`, `dispensing_packing`, `dispensing_safedon`, `labeling`, `conclusion`, `dye_leak`, `documents`, `loading` |
| 3 | Counts never turn into dates; dates use date pickers. | `header`, `conclusion`, `documents` |
| 4 | Sizes not in order_lots appear in no module. | `order_lots`, `sampling_plan`, `carton_sampling`, `dimensions`, `weight`, `force_at_break`, `tensile`, `watertight`, `visual`, `dispensing_packing`, `dispensing_safedon`, `labeling`, `dye_leak` |
| 5 | A module with missing data shows Not Done, never Passed. | `dimensions`, `weight`, `force_at_break`, `tensile`, `watertight`, `visual`, `dispensing_packing`, `dispensing_safedon`, `labeling`, `dye_leak`, `documents` |
| 6 | Box/carton numbers are unique per size, from 1 to the order quantity, as many as the sampled cases. | `sampling_plan`, `carton_sampling` |
| 7 | Box/carton numbers in dispensing_packing, dispensing_safedon and labeling are the size's sampled ones: typed, with those suggested; one the size's list does not hold is a warning, never a block. | `dispensing_packing`, `dispensing_safedon`, `labeling` |
| 8 | The sample size sets the code letter and limits; a plan that does not match the sample size cannot be saved. | `sampling_plan`, `watertight`, `visual` |
| 9 | Measured weight more than the threshold away from the indicative weight raises a warning. | `glove_info`, `weight` |
| 10 | Client, product code and PO are entered once in header and reused everywhere, the export included. | `header` |
| 11 | The inspector is always recorded; section and result labels come from the template, not editable on capture. | `header`, `conclusion` |

<!-- /generated:rules -->

## Modules

<!-- generated:modules -->

### `header`: Manufacturer Information

Report module, always on. Captures: Manufacturer and factory address, PO, product, client, factory glove code, inspection, manufacturing and expiry dates, and the inspector. Result: info; warn when the expiry date is not after the manufacturing date. Rules (6.2): 3, 10, 11. Title in other templates: STD_SG: Purchase Order / Shipment Information.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `manufacturer` | Manufacturer / Supplier | STD_SG: Manufacturer Name | reference |  | inspection | entered |  | Column `inspections.manufacturer_id`. Picked on /inspections/new, where it resolves the template (BUILD_SPEC 4.4). Shown as the manufacturer's name with the factory name in brackets, as the reports print it (manufacturers.name, factory_name). |
| `factoryAddress` | Supplier Factory Address / Location |  | textarea |  | inspection | entered |  | Prefilled from manufacturers.address of the picked manufacturer. |
| `poNo` | PO / SO Number | SAFEDON_EG: PO Number<br>STD_SG: Purchase/Sales Order No. | text |  | inspection | entered | 10 | Column `inspections.po_no`. One text value as printed: the PO with the SO or the client's own reference in brackets. Entered once, reused everywhere (rule 10). |
| `productName` | Product Name (Brand, Code & Description) | SAFEDON_EG: Product Name (Brand & Code)<br>STD_SG: Product Name | textarea |  | inspection | entered | 10 | Column `inspections.product_name`. Brand, product code and description in one value, as printed (up to two lines), so the report keeps the source's wording. |
| `productCode` | Product Code |  | text |  | inspection | entered | 10 | The product code on its own, entered once and reused everywhere: export, report header, file names (rule 10). The STD_EG example printed HN91 in the report but GN91 in the file name; one field prevents that. Feeds HeaderValues.productCode in the inspection context. |
| `client` | Client Name |  | reference |  | inspection | entered | 10 | Column `inspections.client_id`. Picked on /inspections/new; may be empty. SAFEDON_EG prints the client as the report logo (clients.logo_path) instead of a row. |
| `factoryGloveCode` | Factory Glove Code |  | text |  | inspection | entered |  | Printed 'Factrory glove code' [sic]. |
| `inspectionDate` | Inspection Date | STD_SG: Date | date |  | inspection | entered | 3 | Prefilled from today in Malaysia (the column default). Column `inspections.inspection_date`. |
| `mfgDate` | Manufacturing Date | STD_SG: Mfg Date | date |  | inspection | entered | 3 | The onsite forms have one 'Mfg / Exp Date' box; the app splits it into mfgDate and expiryDate. Precision: config mfgExpiryPrecision. |
| `expiryDate` | Expiry Date | STD_SG: Exp Date | date |  | inspection | entered | 3 | The module warns when it is not after mfgDate. |
| `inspector` | Inspected By |  | reference |  | inspection | system | 11 | Column `inspections.inspector_id`. The logged-in inspector, always recorded (rule 11). config fields.inspector only shows or hides the row: the STD_EG report prints none, the onsite forms and the SAFEDON_EG report do. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `fields` | Record&lt;HeaderField, boolean> | `{"manufacturer":true,"factoryAddress":true,"poNo":true,"productName":true,"productCode":true,"client":true,"factoryGloveCode":true,"inspectionDate":true,"mfgDate":true,"expiryDate":true,"inspector":true}` | Which header fields show (BUILD_SPEC: fields on/off). The inspector is recorded even when its row is off. |
| `mfgExpiryPrecision` | "day" \| "month" | `"day"` | Manufacturing and expiry dates as a full date or as month and year. SAFEDON_EG prints month and year; stored as the first of the month (open question). |

Note: BUILD_SPEC 6.1 lists 'report date' here. Both reports print that date once, in the conclusion block: it is conclusion.date.

Note: The onsite forms' 'Lot Number' goes to order_lots, 'Packing Mode' to packing_config and 'Glove Type' to the custom module glove_type.

### `glove_info`: Glove Information

Report module. Captures: The glove's Glove Type, once per inspection, then its variants (Kenneth, 11 October 2026: one PO can hold several): each a combination of surface texture, indicative weight (g), colour and length, for the sizes it covers (none picked: every size). Result: info. Rules (6.2): 1, 9.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `gloveType` | Glove Type |  | text |  | inspection | entered |  | Once per inspection, first on the page (12 October 2026). The onsite forms' Glove Type; a custom module of its own until 11 October 2026, kept on templates saved before (no gloveType switch: off). |
| `surfaceTexture` | Glove Surface Texture |  | text |  | inspection | entered |  | Per variant. |
| `indicativeWeight` | Indicative Weight (Size M) |  | decimal | g | inspection | entered | 1, 9 | Weight of one glove of the size in config indicativeWeightSize ('(Size M)' in the label). The weight module compares that size's average with it (rule 9). |
| `colour` | Glove Colour |  | text |  | inspection | entered |  |  |
| `length` | Glove Length |  | decimal | mm | inspection | entered |  | Per variant, in mm (Kenneth, 11 October 2026). Saved text ("240 mm minimum") reads as its number. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `fields` | Record&lt;GloveInfoField, boolean> | `{"gloveType":true,"surfaceTexture":true,"indicativeWeight":true,"colour":true,"length":true}` | Which fields show (BUILD_SPEC: fields on/off). |
| `indicativeWeightSize` | size | `"M"` | The size the indicative weight is for. Only that size's weight is compared with it. |

### `order_lots`: Order

Report module. Captures: Per size: quantity in cases, lot numbers and packing site. Totals: cartons and gloves. Result: info. Rules (6.2): 1, 2, 4. Title in other templates: STD_SG: PO Info.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `qtyCases` | Qty (Cases) | STD_SG: Qty (Case) | integer |  | size | entered | 1, 4 | Counts cases. A size with a quantity is ordered: only ordered sizes appear in any module (rule 4). The sampling plan's 'Order Qty (Case)' column shows this value again. |
| `lotNumbers` | Lot Number |  | text_list |  | size | entered |  | Column `inspections.lot_numbers (copy, for search)`. One or more lots per size. The onsite forms have one box for all lots of the order. |
| `packingSite` | Packing Site |  | text |  | size | entered |  | One per size row, as printed (SAFEDON_EG). config fields.packingSite switches it on. |
| `lotSizeGloves` | Lot Size (Gloves) |  | integer | pcs | size | **computed** | 2 | qtyCases × packing_config.glovesPerCase. The lot size the AQL plan starts from (BUILD_SPEC 7). |
| `totalCartons` | Total # Carton |  | integer |  | inspection | **computed** | 2 | Sum of qtyCases. Counts cases. |
| `totalGloves` | Total # Gloves |  | integer | pcs | inspection | **computed** | 2 | totalCartons × packing_config.glovesPerCase. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `fields` | { packingSite: boolean } | `{"packingSite":false}` | Packing site on or off. The size list is the template's `sizes`. |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `size` | Size |  | Caption of the size column. |

Note: The reports print no heading over the order table: 'Order' is the app's title for it.

### `packing_config`: Packing Configuration

Report module. Captures: Gloves per inner unit, inner units per case, gloves per case; the inner unit's name; the onsite packing mode text. Result: warn when glovesPerCase is not glovesPerInner × innersPerCase; info otherwise. Rules (6.2): 1, 2. Title in other templates: STD_SG: Packing Mode.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `glovesPerInner` | # Glove per Inner Box | SAFEDON_EG: # Glove per Plastic Pack<br>STD_SG: # Gloves per Pouch | integer | pcs | inspection | entered | 1 |  |
| `innersPerCase` | # Inners per Case | SAFEDON_EG: # Packs per Case<br>STD_SG: # Pouches per Case | integer |  | inspection | entered | 1 | Counts inner units. |
| `glovesPerCase` | # Gloves per Case |  | integer | pcs | inspection | entered | 1 | Entered as printed, then checked against glovesPerCaseCheck (BUILD_SPEC 6.1). |
| `packingMode` | Packing Mode |  | text |  | inspection | entered |  | **Beyond BUILD_SPEC 6.1:** All three onsite forms have a 'Packing Mode' text box (forms/README.md: packing mode text). Free text as written on site. config fields.packingMode switches it on. |
| `glovesPerCaseCheck` | Gloves per Case (Inner × per Case) |  | integer | pcs | inspection | **computed** | 2 | glovesPerInner × innersPerCase. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `innerUnit` | "inner_box" \| "plastic_pack" \| "dispenser_box" \| "pouch" | `"inner_box"` | What one inner unit is. The wording of every label that names it is set per template. |
| `fields` | { packingMode: boolean } | `{"packingMode":false}` | The onsite forms' Packing Mode text on or off. |

### `sampling_plan`: Sampling Plan

Report module. Captures: Per size: sampled cases, inner units and gloves; gloves for watertight and visual, for dimensions, for the physical test and for weight; inner units for packaging and dispensing; pouches and dye leak pouches (surgical). Result: warn when a size's watertight and visual sample is below the AQL plan of config inspectionLevel; info otherwise. Rules (6.2): 1, 2, 4, 6, 8.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `cases` | Case |  | integer |  | size | entered | 1, 6 | Counts cases. carton_sampling must list exactly this many box/carton numbers (rule 6). |
| `innerUnits` | Inner Box | SAFEDON_EG: Inner Pack | integer |  | size | entered | 1 | Counts inner units. |
| `gloves` | Gloves |  | integer | pcs | size | entered | 1 |  |
| `glovesWatertightVisual` | # Gloves for Watertight & Visual | STD_SG: # Gloves | integer | pcs | size | entered | 1, 8 | Flows forward as n in watertight and visual (BUILD_SPEC 8). SG prints it under 'Sampling Quantity (WTT & Visual)'. |
| `glovesDimensions` | # Gloves for Dimension | STD_SG: # Gloves Dimension | integer | pcs | size | entered | 1 | Flows forward as the dimension rows. |
| `glovesPhysical` | # Gloves for FAB | SAFEDON_EG: # Gloves for Tensile<br>STD_SG: # Gloves (FAB) | integer | pcs | size | entered | 1 | Gloves for the physical test: force at break (EN 455) or tensile (ASTM D6319). |
| `glovesWeight` | # Gloves for Weight |  | integer | pcs | size | entered | 1 | Flows forward as the gloves weighed (weight), its own count (Kenneth, 12 October 2026: each measurement has its own glove count); empty, weight weighs config n. No form prints it: STD_EG's report names it in the weight heading ('average of 13 gloves per size'). Off where weight weighs one value per size (SAFEDON_EG) or is not included (STD_SG). |
| `innerUnitsDispensing` | # Inner Box for Packaging & Dispensing Inspection | SAFEDON_EG: # Inner Packs for Packaging & Dispensing Inspection | integer |  | size | entered | 1 | Counts inner units. Printed 'packaing' [sic]. Flows forward as the box rows of dispensing_packing or dispensing_safedon. |
| `pouches` | Pouches |  | integer |  | size | entered | 1 | Counts pouches. Surgical: sampled pouches (SG onsite). |
| `pouchesDyeLeak` | # Pouches (Dye Leak Test) |  | integer |  | size | entered | 1 | Counts pouches. Surgical: flows forward as dye_leak.pouchesTested. |
| `inspectionLevel` | Inspection Level |  | select |  | inspection | **computed** | 2, 8 | config inspectionLevel, else the client's; none without either. The level the plans are worked out at. Values: S-1, S-2, S-3, S-4, I, II, III. |
| `lotSizeGloves` | Lot Size (Gloves) |  | integer | pcs | size | **computed** | 2 | order_lots.lotSizeGloves: qtyCases × packing_config.glovesPerCase. The lot the inspection level's plan is for. |
| `codeLetter` | Code Letter |  | select |  | size | **computed** | 2, 8 | ISO 2859-1 Table 1 from order_lots.lotSizeGloves and config inspectionLevel (lib/aql planFromLotSize); none without a level. Values: A, B, C, D, E, F, G, H, J, K, L, M, N, P, Q, R. |
| `planSampleSize` | Sample Size by Plan |  | integer | pcs | size | **computed** | 2, 8 | The largest Table 2-A n for codeLetter among the AQLs the inspection checks on the watertight and visual sample (watertight, and visual's classes switched on), arrows followed; Table 1's n when it checks none. A glovesWatertightVisual below it raises the module warning. |
| `totals` | Total: |  | count_map |  | inspection | **computed** | 2 | Sum over the ordered sizes of each column on (the onsite forms' Total: row). Map keyed by sampling column. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `columns` | Record&lt;SamplingColumn, boolean> | `{"cases":true,"innerUnits":true,"gloves":true,"glovesWatertightVisual":true,"glovesDimensions":true,"glovesPhysical":true,"glovesWeight":false,"innerUnitsDispensing":true,"pouches":false,"pouchesDyeLeak":false}` | Columns on or off (BUILD_SPEC: columns on/off). The surgical pouch columns and glovesWeight are off by default; a template version saved before glovesWeight existed reads it as off. |
| `inspectionLevel` | "S-1" \| "S-2" \| "S-3" \| "S-4" \| "I" \| "II" \| "III" \| null | `null` | ISO 2859-1 level used to suggest n per size from the lot size and flag a sample below the plan. null: samples are entered directly with no plan check. |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `samplingQuantity` | Sampling Quantity | STD_SG: Sampling Quantity (WTT & Visual) | Caption over the case, inner unit and glove (and pouch) columns. |
| `orderQty` | Order Qty (Case) | STD_SG: Qty (Case) | Caption of the column that shows order_lots.qtyCases again. |
| `gloveSize` | Glove Size |  | Caption of the size column on the capture screen. |

### `carton_sampling`: Finished Goods Sampling Information (Box/Carton #)

Report module. Captures: Per size: the sampled box/carton numbers. Result: fail on a validation error (rule 6); pass when every ordered size has its full, valid list; not_done before. Rules (6.2): 1, 2, 4, 6.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `cartonNumbers` | (Box/Carton #) |  | integer_list |  | size | entered | 1, 6 | Unique per size, each from 1 to order_lots.qtyCases, as many as sampling_plan.cases (rule 6). The report grid holds 50 (10 columns × 5 rows); the app takes as many as were sampled. Dispensing and labeling suggest this list's numbers for their box/carton numbers and warn about one it does not hold (rule 7). |
| `samplingQuantity` | Sampling Quantity |  | integer |  | size | **computed** | 2, 6 | Count of cartonNumbers; must equal sampling_plan.cases. Counts cartons. |

No config.

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `sizeCaption` | {size} (Box/Carton #) |  | Caption of each size's grid. |

### `dimensions`: Dimension

Report module. Captures: Per size, per glove (default 13): the measures on, from length, width, finger, palm and cuff thickness (mm). Result: Per size and measure: the statistic against the spec (pass, fail, na for an NA or missing spec). Fail if any measure fails; not_done until every glove row of every ordered size is complete. Rules (6.2): 1, 2, 4, 5.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `length` | Length |  | decimal | mm | size › glove | entered | 1 |  |
| `width` | Width |  | decimal | mm | size › glove | entered | 1 |  |
| `fingerThickness` | Finger Thickness |  | decimal | mm | size › glove | entered | 1 |  |
| `palmThickness` | Palm Thickness |  | decimal | mm | size › glove | entered | 1 |  |
| `cuffThickness` | Cuff Thickness |  | decimal | mm | size › glove | entered | 1 |  |
| `statistic` | Median | SAFEDON_EG: Average | decimal | mm | size | **computed** | 2 | Median or average (config statistic) of the measure's glove values, shown at config decimals. Map keyed by measure. |
| `measureResult` | P/F \* | SAFEDON_EG: A / Rej. | select |  | size | **computed** | 2, 5 | statistic against the measure's spec in the size's row of config specs (lib/stats summarizeColumn); an NA or missing spec gives na. Map keyed by measure. Values: pass, fail, na, not_done. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `measures` | Measure[] | `["length","width","fingerThickness","palmThickness","cuffThickness"]` | The measures on, in column order (BUILD_SPEC: measures on/off). |
| `statistic` | "median" \| "average" | `"median"` | Median (EN 455 style, STD_EG) or average (ASTM style, SAFEDON_EG). |
| `specs` | { size: string; specs: Partial&lt;Record&lt;Measure, Spec>> }[] | `[]` | One row per size with the spec of each measure, as lib/stats Spec: min (≥), max (≤), range, tolerance (nominal ± tolerance) or na. A list, so a child template replaces it whole; a size or measure with no spec is not judged. Empty by default: specs belong to the product (BUILD_SPEC 13). |
| `decimals` | Record&lt;Measure, number> | `{"length":0,"width":0,"fingerThickness":2,"palmThickness":2,"cuffThickness":2}` | Decimals the statistic is shown with, as the reports print it, for every measure (on or off). lib/stats judges the shown value. |
| `rows` | number | `13` | Gloves per size. sampling_plan.glovesDimensions sets it when entered. |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `sizeHeading` | Dimension - Size {size} |  | Heading of each size's table. |
| `rowNo` | No. |  | Caption of the glove row number column. |
| `specRow` | Spec. |  | Caption of the spec row (config specs, printed as lib/stats formatSpec). |
| `pass` | Passed | SAFEDON_EG: A | Word for pass in the result row. |
| `fail` | Failed | SAFEDON_EG: Rej. | Word for fail in the result row. |

### `weight`: Weight (g) - Average of 13 Gloves per Size

Report module. Captures: Per size: the gloves weighed (one value, or one per glove of the sampling plan's gloves for weight: config n until the plan gives one) and their average, compared with the indicative weight. Result: Per size: pass or fail against a spec when one is set; warn when the size of the indicative weight deviates by more than the threshold; info otherwise. not_done until every glove weighed has its value, and when the sampling plan has no gloves for weight. Rules (6.2): 1, 2, 4, 5, 9. Title in other templates: SAFEDON_EG: Weight (g).

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `values` | Weight (g) |  | decimal_list | g | size | entered | 1 | One value per glove weighed: the sampling plan's gloves for weight (sampling_plan.glovesWeight), else config n (13 on STD_EG), weighed one by one; or one value per size when config n is 1 (SAFEDON_EG, printed as a merged column of the dimension table). |
| `average` | Average |  | decimal | g | size | **computed** | 2 | Mean of values (the value itself when n is 1), shown at config decimals. |
| `deviationPct` | Deviation From Indicative Weight |  | decimal | % | size | **computed** | 2, 9 | (average − glove_info.indicativeWeight) / glove_info.indicativeWeight × 100, for the size in glove_info config indicativeWeightSize only. |
| `result` | Remark | SAFEDON_EG: A / Rej. | select |  | size | **computed** | 2, 5, 9 | Against the size's row of config specs when there is one; warn when \|deviationPct\| > config warnThresholdPct; info otherwise. Values: pass, fail, warn, info, not_done. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `n` | number | `13` | Gloves weighed per size when sampling_plan.glovesWeight gives no number, one by one; 1 weighs one value per size, whatever the plan says. |
| `specs` | { size: string; spec: Spec }[] | `[]` | Optional spec per size (BUILD_SPEC: optional spec), one row per size; a list, so a child template replaces it whole. A size with no row has no spec row and its result is info. |
| `warnThresholdPct` | number | `10` | Deviation from the indicative weight, in %, above which the module warns (rule 9). |
| `decimals` | number | `2` | Decimals the average is shown with (both reports print 2). |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `info` | Info | SAFEDON_EG: A | Word printed for a result with no spec. |
| `rowNo` | No. |  | Caption of the glove row number column (the gloves weighed one by one). |
| `specRow` | Spec. |  | Caption of the spec row (config specs, printed as lib/stats formatSpec). |
| `pass` | Passed | SAFEDON_EG: A | Word for pass in the result row of a size with a spec. |
| `fail` | Failed | SAFEDON_EG: Rej. | Word for fail in the result row of a size with a spec. |

### `force_at_break`: Force at Break in Newton (Refer to Attached Where Applicable)

Report module. Captures: Per size, per glove (default 13): force at break (N), its median, and the lab report file. Result: Per size: the median against config specMin. not_done until n readings are entered. Rules (6.2): 1, 2, 4, 5.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `values` | Force at Break (N) |  | decimal_list | N | size | entered | 1 | One reading per glove of the sampling plan's gloves for the physical test (sampling_plan.glovesPhysical), else config n, from the lab report. The report prints only their median. |
| `labReport` | Lab Report |  | file |  | inspection | entered |  | 'Refer to attached where applicable': inspection_files, kind lab_report, module force_at_break. Tag a size when the lab issues one report per size. |
| `median` | Median |  | decimal | N | size | **computed** | 2 | Median of values, shown at config decimals. |
| `result` | Passed / Failed |  | select |  | size | **computed** | 2, 5 | median ≥ config specMin. Values: pass, fail, not_done. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `n` | number | `13` | Readings per size when sampling_plan.glovesPhysical gives no number. |
| `specMin` | number (N) | `6` | Minimum median force at break, every size. |
| `standardLabel` | string \| null | `null` | Standard printed with the spec, e.g. 'Spec. (EN 455)'. STD_EG prints none. |
| `decimals` | number | `3` | Decimals the median is shown with (STD_EG prints 3). |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `rowNo` | No. |  | Caption of the reading number column. |
| `specRow` | Spec. |  | Caption of the spec row (≥ specMin N). |

### `tensile`: Physical Properties Average (Refer to Attached Lab. Reports)

Report module. Captures: Per size: tensile strength average (MPa) and elongation at break average (%) from the lab report; the lab report file. Result: Per size: both averages against their minimums; fail if either fails. not_done until both values and the lab report are in. Rules (6.2): 1, 2, 4, 5.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `tensileStrength` | Tensile Strength (Average) (MPa) |  | decimal | MPa | size | entered | 1 | The lab report's average, typed as printed: the app holds no individual readings (BUILD_SPEC 6.1), so this is a typed average, not one the app computes. |
| `elongationAtBreak` | Elongation at Break, Average (%) |  | decimal | % | size | entered | 1 | The lab report's average, typed as printed. |
| `labReport` | Lab Report |  | file |  | inspection | entered |  | Required (BUILD_SPEC 6.1): inspection_files, kind lab_report, module tensile. |
| `tensileResult` | Passed / Failed |  | select |  | size | **computed** | 2, 5 | tensileStrength ≥ config tensileMin. Values: pass, fail, not_done. |
| `elongationResult` | Passed / Failed |  | select |  | size | **computed** | 2, 5 | elongationAtBreak ≥ config elongationMin. Values: pass, fail, not_done. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `tensileMin` | number (MPa) | `14` | Minimum tensile strength. |
| `elongationMin` | number (%) | `500` | Minimum elongation at break. |
| `standardLabel` | string | `"ASTM D6319"` | Standard printed with the specs: 'Spec. (ASTM D6319)'. |
| `decimals` | { tensileStrength: number; elongationAtBreak: number } | `{"tensileStrength":2,"elongationAtBreak":0}` | Decimals the values are shown with, as printed. |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `specRow` | Spec. ({standardLabel}) |  | Caption of each spec row. |

### `watertight`: Freedom From Holes by Watertight Test

Report module. Captures: Per size (R and L when handSplit): gloves tested and holes by location. Result: Per size: accept or reject from the AQL engine on the total (both hands). not_done until tested is entered. Rules (6.2): 1, 2, 4, 5, 8. Title in other templates: STD_SG: Watertight Inspection.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `tested` | No. of Sample Tested |  | integer | pcs | size | entered | 1, 8 | Prefilled from sampling_plan.glovesWatertightVisual. |
| `holes` | Pin Hole | SAFEDON_EG: Holes<br>STD_SG: Defect | count_map |  | size › hand | entered | 1 | Map keyed by hole location: a defect code from config locations. |
| `otherDescription` | Other : Description |  | text |  | size › hand | entered |  | **Beyond BUILD_SPEC 6.1:** The 'Other :' row of both reports ends in a colon for the location; this holds it. |
| `unmapped` | Defect Not in the List |  | label_counts |  | size › hand | entered |  | One-off labels (the onsite forms' handwritten rows) with their counts, saved unmapped and flagged for an admin (BUILD_SPEC 4.2 rule 4, 8). They count towards the total. |
| `codeLetter` | Sampling Code Letter |  | select |  | size | **computed** | 2, 8 | lib/aql planFromSampleSize(tested, config aql): the plan's codeLetter, from n (a non-standard n uses the standard n below it, with a warning). Its usedLetter, n and arrow go into computed with it. Values: A, B, C, D, E, F, G, H, J, K, L, M, N, P, Q, R. |
| `accept` | Accept |  | integer |  | size | **computed** | 2, 8 | The plan's ac: Table 2-A for config aql at the usedLetter (arrows followed). |
| `reject` | Reject |  | integer |  | size | **computed** | 2, 8 | The plan's re (ac + 1). |
| `totalDefects` | Total Number of Defects Found | STD_SG: Total WTT | integer |  | size | **computed** | 2 | Sum of holes and unmapped counts, both hands. Printed as &lt;total>/&lt;tested>. |
| `result` | Freedom From Holes (Passed / Failed) |  | select |  | size | **computed** | 2, 5 | totalDefects ≤ accept passes; ≥ reject fails. Values: pass, fail, not_done. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `aql` | number | `1.5` | AQL of the watertight test. |
| `locations` | { code: string; label: string }[] | STD_EG's five locations (see Defects) | Hole locations in the template's order and wording, each mapped to a defect code (BUILD_SPEC: between fingers/crotch, palm, finger, cuff, glove burst, other). |
| `handSplit` | boolean | `false` | Record R and L separately (surgical). Holes are per hand; tested and the limits stay per size. |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `heading` | Freedom From Holes by Watertight Test (Single Sampling Code Letter {codeLetters}, AQL {aql}) | SAFEDON_EG: Freedom From Holes by Watertight Test (Sampling Code Letter {codeLetters}; AQL={aql})<br>STD_SG: Watertight Inspection | Full heading as printed: the code letters of the ordered sizes and the AQL are filled in. |
| `defectLimit` | Defect Limit |  | Caption of the Accept / Reject row. |

### `visual`: Visual Inspection

Report module. Captures: Per size (R and L when handSplit), per class: gloves inspected and defect counts. Result: Per size and class: accept or reject from the AQL engine; any critical defect fails. Fail if any class fails; not_done until inspected is entered. Rules (6.2): 1, 2, 4, 5, 8.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `inspected` | No. of Sample Inspected |  | integer | pcs | size › class | entered | 1, 8 | Prefilled from sampling_plan.glovesWatertightVisual. |
| `counts` | Defects | critical: Critical Defects<br>major: Major Defects (STD_SG: Major Defect)<br>minor: Minor Defects (STD_SG: Minor Defect) | count_map |  | size › hand › class | entered | 1 | Map keyed by defect code from config classes[class].defects. |
| `unmapped` | Defect Not in the List |  | label_counts |  | size › hand › class | entered |  | One-off labels (the onsite forms' handwritten rows) with their counts, saved unmapped and flagged for an admin. They count towards the class total. |
| `codeLetter` | Sampling Code Letter |  | select |  | size › class | **computed** | 2, 8 | lib/aql planFromSampleSize(inspected, class AQL): codeLetter from n; an arrow moves the class's plan to its usedLetter (expected-results B: minor at N uses M), kept in computed with it. Values: A, B, C, D, E, F, G, H, J, K, L, M, N, P, Q, R. |
| `accept` | Accept | critical: Acc. = (SAFEDON_EG: Accept) | integer |  | size › class | **computed** | 2, 8 | The class plan's ac at its usedLetter; always 0 for critical (AQL 0). |
| `reject` | Reject | critical: Rej. = (SAFEDON_EG: Reject) | integer |  | size › class | **computed** | 2, 8 | The class plan's re (ac + 1); always 1 for critical. |
| `total` | Total Number of Defects Found | critical: Total Number of "Critical Defects" Found<br>major: Total Number of "Major Defects" Found (STD_SG: Total Major)<br>minor: Total Number of "Minor Defects" Found (STD_SG: Total Minor) | integer |  | size › class | **computed** | 2 | Sum of counts and unmapped counts of the class, both hands. Printed as &lt;total>/&lt;inspected>. |
| `result` | Disposition (Passed / Failed) | critical: Disposition - Visual Critical (Passed / Failed)<br>major: Disposition - Visual Major (Passed / Failed)<br>minor: Disposition - Visual Minor (Passed / Failed) | select |  | size › class | **computed** | 2, 5 | total ≤ accept passes; ≥ reject fails. Both reports print the critical line as 'Visual Minor' [sic]. Values: pass, fail, not_done. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `handSplit` | boolean | `false` | Record R and L separately (surgical). Counts are per hand; inspected and the limits stay per size. |
| `classes` | Record&lt;DefectClass, { include: boolean; aql: number; defects: { code: string; label: string }[] }> | all three classes on, AQL 0, 2.5 and 4.0, with STD_EG's defect lists (see Defects) | Classes on or off with their AQL, and each class's defect list in the template's order and wording, mapped to defect codes. Severity is the class the template puts a code in (rule 4.2.4). |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `heading` | Visual Inspection (Single Sampling Code Letter {codeLetters}) | SAFEDON_EG: Visual Inspection (Sampling Code Letter {codeLetters})<br>STD_SG: Visual Inspection | Full heading as printed, with the code letters of the ordered sizes. |
| `criticalHeading` | Critical Defects (AQL {aql}) |  | Heading of the critical class (AQL printed 0.0). |
| `majorHeading` | Major Defects (AQL {aql}) | STD_SG: Major Defect | Heading of the major class. |
| `minorHeading` | Minor Defects (AQL {aql}) | STD_SG: Minor Defect | Heading of the minor class. |
| `criticalLimit` | Defect Limit : Accept / Reject | SAFEDON_EG: Defect Limit | Caption of the critical class's limit row (STD_EG prints Acc. = 0 / Rej. = 1). |
| `defectLimit` | Defect Limit |  | Caption of the major and minor limit rows. |

### `dispensing_packing`: Glove Packing Check

Report module. Captures: Per size, per box (its box/carton number typed): layering %, dispensing %, stickiness code, note. Result: Per size: layering and dispensing averages against the minimums; any box with a failing stickiness code fails. not_done until the size's boxes are entered. Rules (6.2): 1, 2, 4, 5, 7.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `boxNo` | Box/Carton # |  | integer |  | size › box | entered | 7 | Typed on the numeric keypad, the size's sampled box/carton numbers (carton_sampling) suggested as it is typed; one the size's list does not hold is a warning, never a block (rule 7; Kenneth, 13 October 2026). |
| `layeringPct` | Layering % |  | decimal | % | size › box | entered | 1 |  |
| `dispensingPct` | Dispensing % |  | decimal | % | size › box | entered | 1 |  |
| `stickiness` | Stickiness \*\* |  | select |  | size › box | entered |  | One of config stickinessCodes. |
| `note` | Others: |  | text |  | size › box | entered |  | **Beyond BUILD_SPEC 6.1:** The EG onsite form's 'Others:' column, one note per box. |
| `codeLetter` | Sampling Code Letter |  | select |  | size | **computed** | 2 | From the number of boxes tested (BUILD_SPEC 7), for the heading. Values: A, B, C, D, E, F, G, H, J, K, L, M, N, P, Q, R. |
| `layeringAverage` | Average |  | decimal | % | size | **computed** | 2 | Mean of layeringPct. |
| `dispensingAverage` | Average |  | decimal | % | size | **computed** | 2 | Mean of dispensingPct. |
| `stickinessSummary` | Average |  | select |  | size | **computed** | 2 | The worst code entered: the latest in config stickinessCodes order. The report prints a code in the Average row. |
| `layeringResult` | Passed / Failed |  | select |  | size | **computed** | 2, 5 | layeringAverage ≥ config minLayeringPct. Values: pass, fail, not_done. |
| `dispensingResult` | Passed / Failed |  | select |  | size | **computed** | 2, 5 | dispensingAverage ≥ config minDispensingPct. Values: pass, fail, not_done. |
| `stickinessResult` | Passed / Failed |  | select |  | size | **computed** | 2, 5 | Fails when any box has a code whose pass is false. Values: pass, fail, not_done. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `minLayeringPct` | number (%) | `70` | Minimum average layering. |
| `minDispensingPct` | number (%) | `80` | Minimum average dispensing. |
| `stickinessCodes` | { code: string; label: string; pass: boolean }[] | STD_EG's legend: A, B, B1 and C pass, D fails (see Defects) | Codes from least to most sticky, with their legend and whether they pass. |
| `boxesPerSize` | { default: number; bySize?: Record&lt;size, number> } | `{"default":13}` | Box rows per size. sampling_plan.innerUnitsDispensing sets them when entered. |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `heading` | Glove Packing Check (Sampling Code Letter {codeLetters}) : Min. {minLayeringPct}% Layering & {minDispensingPct}% Dispensing |  | Full heading as printed: code letters of the box counts and the two minimums. |
| `itemColumn` | Item |  | Caption of the box row number column. |
| `stickinessLegend` | \*\*Glove Stickiness Code |  | Caption of the stickiness code legend. |

### `dispensing_safedon`: Glove Dispensing Inspection

Report module. Captures: Per size, per box (its box/carton number typed): counts of the six Safedon dispensing defects. Per box defects, gloves and rate; per size total and rate. Result: Per size: the defect rate against config maxRatePct. not_done until the size's boxes are entered. Rules (6.2): 1, 2, 4, 5, 7.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `boxNo` | Box/Carton # |  | integer |  | size › box | entered | 7 | Typed on the numeric keypad, the size's sampled box/carton numbers (carton_sampling) suggested as it is typed; one the size's list does not hold is a warning, never a block (rule 7; Kenneth, 13 October 2026). Messages name a box by its No. in the box list. |
| `counts` | Safedon Packing Defects |  | count_map |  | size › box | entered | 1 | Map keyed by defect code from config defects. |
| `codeLetter` | Sampling Code Letter |  | select |  | size | **computed** | 2 | From the number of boxes tested (BUILD_SPEC 7), for the heading. Values: A, B, C, D, E, F, G, H, J, K, L, M, N, P, Q, R. |
| `boxDefects` | Defects / Gloves per Pack |  | integer |  | size › box | **computed** | 2 | Sum of the box's counts. Printed as &lt;defects>/&lt;glovesPerPack> (Total, line 1). |
| `boxRatePct` | Defect Rate |  | decimal | % | size › box | **computed** | 2 | boxDefects / config glovesPerPack × 100 (Total, line 2: the report prints it as a percentage with one decimal, e.g. 0.8%). |
| `boxesTested` | Boxes Tested |  | integer |  | size | **computed** | 2 | Boxes with a box/carton number (onsite/SAFEDON_EG.md, mapping to the core). Counts boxes. |
| `boxesFailed` | Boxes Failed |  | integer |  | size | **computed** | 2 | Boxes with any count above zero. Counts boxes. |
| `totalDefects` | Total |  | integer |  | size | **computed** | 2 | Sum of the size's box counts (Total, line 3: &lt;defects> / &lt;gloves> (&lt;rate> %)). |
| `glovesInspected` | Gloves Inspected |  | integer | pcs | size | **computed** | 2 | boxesTested × config glovesPerPack. |
| `ratePct` | Defect Rate (%) |  | decimal | % | size | **computed** | 2 | totalDefects / glovesInspected × 100. |
| `result` | Conclusion |  | select |  | size | **computed** | 2, 5 | ratePct ≤ config maxRatePct. Values: pass, fail, not_done. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `defects` | { code: string; label: string; hint: string }[] | the six Safedon dispensing defects with the app's hints (see Defects) | The six defects in the template's order and wording, mapped to defect codes, with the definition shown as a hint. |
| `glovesPerPack` | number (pcs) | `125` | Gloves dispensed per box, the denominator of the rates. |
| `maxRatePct` | number (%) | `5` | Maximum defect rate per size (≤, inclusive). |
| `boxesPerSize` | { default: number; bySize?: Record&lt;size, number> } | `{"default":13}` | Box columns per size (13 on the onsite sheet; more can be added). sampling_plan.innerUnitsDispensing sets them when entered. |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `heading` | Glove Dispensing Inspection (Sampling Code Letter {codeLetters}) |  | Full heading as printed on the report, with the code letters of the box counts. |
| `totalGroup` | Total |  | Caption over the three computed total lines. |
| `specRow` | Specification / Requirement |  | Caption of the row that prints ≤ maxRatePct %. |

### `labeling`: Packaging Labeling Inspection

Report module. Captures: Per size, per level (inner unit, carton): boxes inspected, their box/carton numbers typed, and defects per check. Result: Per size and level: any defect fails (Accept 0 / Reject 1). not_done until inspected is entered. Rules (6.2): 1, 2, 4, 5, 7.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `inspected` | No. of Sampled Boxes Inspected |  | integer |  | size › level | entered | 1 | Counts boxes. Prefilled from config levels[level].n. |
| `boxNos` | Box/Carton # |  | integer_list |  | size › level | entered | 7 | **Beyond BUILD_SPEC 6.1:** The box/carton numbers of the boxes inspected, typed with the size's sampled box/carton numbers suggested; one the size's list does not hold is a warning (rule 6.2.7; Kenneth, 13 October 2026). The reports print only how many were inspected. |
| `defects` | Defects |  | count_map |  | size › level | entered | 1 | Map keyed by labelling check code from config levels[level].checks. |
| `accept` | Accept | inner: Accept (SAFEDON_EG: Acc. =)<br>carton: Accept (SAFEDON_EG: Acc. =) | integer |  | size › level | **computed** | 2 | Always 0 (BUILD_SPEC 7: labelling is Accept 0 / Reject 1). |
| `reject` | Reject | inner: Reject (SAFEDON_EG: Rej. =)<br>carton: Reject (SAFEDON_EG: Rej. =) | integer |  | size › level | **computed** | 2 | Always 1. |
| `total` | Total Number of Defects Found |  | integer |  | size › level | **computed** | 2 | Sum of defects. |
| `result` | Disposition (Passed / Failed) | inner: Disposition - Inner Box (Passed / Failed)<br>carton: Disposition - Carton Box (Passed / Failed) | select |  | size › level | **computed** | 2, 5 | total ≥ 1 fails. STD_EG prints the carton line as 'Inner Box' [sic]. Values: pass, fail, not_done. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `levels` | Record&lt;LabellingLevel, { include: boolean; n: number; checks: { code: LabellingCheck; label: string }[] }> | both levels on, 3 inner units and 1 carton, with STD_EG's checks | Levels on or off, boxes inspected per level, and each level's checks in the template's order and wording. |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `innerLevel` | Dispenser Box | SAFEDON_EG: Inner Boxes/Packs | Heading of the inner unit level. |
| `cartonLevel` | Carton Box | SAFEDON_EG: Carton Boxes | Heading of the carton level. |
| `defectLimit` | Defect Limit | SAFEDON_EG: Limit : Accept / Reject | Caption of the Accept / Reject row. |

### `conclusion`: Conclusion

Report module, always on. Captures: Suggested result, final result, remark, inspection summary (formatted text), inspector, date and the signature drawn on the iPad, or the choice to sign the report by hand after it is exported. Result: The final result as chosen; not_done until it is chosen. Rules (6.2): 2, 3, 11.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `suggestedResult` | Suggested Result |  | select |  | inspection | **computed** | 2 | From the included modules' results (BUILD_SPEC 6.1). Not on the reports. Values: pass, fail, hold. Column `inspections.suggested_result`. |
| `finalResult` | Conclusion |  | select |  | inspection | entered |  | Values: pass, fail, hold. Column `inspections.result`. The reports print PASSED or FAILED; the app adds hold. |
| `remark` | Remark |  | textarea |  | inspection | entered |  | Column `inspections.remarks`. |
| `inspectionSummary` | Inspection Summary |  | rich_text |  | inspection | entered |  | Kenneth, 12 October 2026: the inspector's summary with formatting (bold, italic, underline, strikethrough, size, colour, highlight, lists, alignment), lib/schemas/rich-text.ts. Not on the paper forms; the export adds HTML and plain text. |
| `inspector` | Inspected By |  | reference |  | inspection | system | 11 | Column `inspections.inspector_id`. The same person as header.inspector, shown beside the signature (SAFEDON_EG prints it here). |
| `date` | Date |  | date |  | inspection | entered | 3 | Prefilled from today, when the conclusion is signed. The report date: BUILD_SPEC 6.1 lists it under header, both reports print it once, here. |
| `signature` | Signature |  | signature |  | inspection | entered |  | Drawn on the iPad (BUILD_SPEC 6.1; bucket signatures). BUILD_SPEC 13 asks whether clients accept it. |
| `signAfterExport` | To Sign After Exported |  | yes_no |  | inspection | entered |  | Kenneth, 13 October 2026: the report is signed by hand after it is exported. On, the screen shows a note in place of the pad, the summary says "To be signed after export.", and the export says so in its conclusion block and sends the signature as null; drawn strokes stay in the data. Switching it on dates the conclusion, as signing does. Off by default; not on the paper forms. |

No config.

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `pass` | PASSED |  | Word printed for a pass. |
| `fail` | FAILED |  | Word printed for a fail. |
| `hold` | HOLD |  | Word for hold (not on the reports). |

### `dye_leak`: Dye Leak Test

Optional module. Captures: Per size: pouches tested, pouches failed, notes. Result: Per size: any failed pouch fails. not_done until pouchesTested is entered. Rules (6.2): 1, 2, 4, 5.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `pouchesTested` | Pouches Tested |  | integer |  | size | entered | 1 | Counts pouches. Prefilled from sampling_plan.pouchesDyeLeak, else config n. |
| `pouchesFailed` | Pouches Failed |  | integer |  | size | entered | 1 | Counts pouches. |
| `notes` | Notes |  | textarea |  | size | entered |  |  |
| `pouchesPlanned` | Pouches Planned |  | integer |  | size | **computed** | 2 | sampling_plan.pouchesDyeLeak when it plans any, else config n; none when neither does. Counts pouches. |
| `result` | Passed / Failed |  | select |  | size | **computed** | 2, 5 | pouchesFailed = 0 passes. Values: pass, fail, not_done. |
| `totalTested` | Total Pouches Tested |  | integer |  | inspection | **computed** | 2 | Sum of pouchesTested over the ordered sizes that have it; none until one does. Counts pouches. |
| `totalFailed` | Total Pouches Failed |  | integer |  | inspection | **computed** | 2 | Sum of pouchesFailed over the ordered sizes that have it; none until one does. Counts pouches. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `n` | number \| null | `null` | Pouches tested per size when the sampling plan has none. null: take sampling_plan.pouchesDyeLeak. |

Note: The SG onsite form plans the pouches ('# pouches (dye leak test)') but has nowhere to record results.

### `documents`: Documents

Optional module. Captures: Checklist of certificates and reports: verified, not verified or NA; reference no.; expiry date; file. Result: fail if a required item is not verified; warn if an item has expired; pass otherwise. Rules (6.2): 2, 3, 5.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `status` | Status |  | select |  | item | entered |  | Values: verified, not_verified, na. |
| `referenceNo` | Reference No. |  | text |  | item | entered |  |  |
| `expiryDate` | Expiry Date |  | date |  | item | entered | 3 |  |
| `file` | File |  | file |  | item | entered |  | inspection_files, kind certificate or lab_report, module documents. |
| `expired` | Expired |  | yes_no |  | item | **computed** | 2 | expiryDate before header.inspectionDate. |
| `itemStatus` | Item Result |  | select |  | item | **computed** | 2, 5 | not_done without a status; fail when required and not verified; warn when expired; pass when verified; info when not verified or NA and not required. The chip on the item's row. Values: pass, fail, warn, info, not_done. |
| `counts` | Items per Status |  | count_map |  | inspection | **computed** | 2 | Items on the checklist per status. Map keyed by status (verified, not_verified, na, and open for none yet). |
| `fileState` | File Status |  | select |  | item | **computed** | 2 | The file the item keeps against the inspection's files: none kept, attached, or missing (deleted, or still uploading from another device). Attached while the inspection's files are not known. Values: none, attached, missing. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `items` | { key: DocumentItem; include: boolean; required: boolean }[] | `[{"key":"certificateOfAnalysis","include":true,"required":false},{"key":"labTestReports","include":true,"required":false},{"key":"sterilisation","include":true,"required":false},{"key":"iso13485","include":true,"required":false},{"key":"fdaCe","include":true,"required":false},{"key":"declarationOfOrigin","include":true,"required":false}]` | Items on or off and required (BUILD_SPEC: items on/off and required). |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `certificateOfAnalysis` | Certificate of Analysis |  | Item label. |
| `labTestReports` | Lab Test Reports |  | Item label. |
| `sterilisation` | Sterilisation Certificate and Records |  | Item label. |
| `iso13485` | ISO 13485 |  | Item label. |
| `fdaCe` | FDA / CE Certificates |  | Item label. |
| `declarationOfOrigin` | Declaration of Origin |  | Item label. |
| `required` | Required |  | Badge on an item the template requires. |
| `status.verified` | Verified |  | Word for the status verified. |
| `status.not_verified` | Not Verified |  | Word for the status not_verified. |
| `status.na` | NA |  | Word for the status na. |

Note: Not on any current form: the website's QC scope (forms/README.md).

### `loading`: Loading

Optional module. Captures: Container no., seal no., cartons loaded against the PO, carton condition; photos at each loading stage. Result: warn when cartonsLoaded is not cartonsOrdered; info otherwise. Rules (6.2): 1, 2.

| Key | Label (STD_EG) | Other wording | Type | Unit | Per | Entry | Rules | Notes |
|---|---|---|---|---|---|---|---|---|
| `containerNo` | Container No. |  | text |  | inspection | entered |  |  |
| `sealNo` | Seal No. |  | text |  | inspection | entered |  |  |
| `cartonsLoaded` | Cartons Loaded |  | integer |  | inspection | entered | 1 | Counts cartons. |
| `cartonCondition` | Carton Condition |  | textarea |  | inspection | entered |  |  |
| `cartonsOrdered` | Cartons Ordered |  | integer |  | inspection | **computed** | 2 | order_lots.totalCartons. Counts cartons. |
| `cartonsDifference` | Cartons Loaded Less Ordered |  | integer |  | inspection | **computed** | 2 | cartonsLoaded − cartonsOrdered: below 0 is short, above 0 over; none until both are known. Counts cartons. |

| Config key | Type | Default | Meaning |
|---|---|---|---|
| `fields` | Record&lt;LoadingField, boolean> | `{"containerNo":true,"sealNo":true,"cartonsLoaded":true,"cartonCondition":true}` | Which fields show (BUILD_SPEC: fields on/off). |

| Caption key | Label (STD_EG) | Other wording | Meaning |
|---|---|---|---|
| `loadingStage` | Loading Stage |  | Caption of the stage picker that tags loading photos. |
| `emptyContainer` | Empty Container |  | Loading stage, for photo tags. |
| `halfLoaded` | Half Loaded |  | Loading stage, for photo tags. |
| `fullyLoaded` | Fully Loaded |  | Loading stage, for photo tags. |
| `doorsClosed` | Doors Closed |  | Loading stage, for photo tags. |
| `sealed` | Sealed |  | Loading stage, for photo tags. |

Note: Not on any current form: the website's QC scope. Loading-stage photos are the module's photos; the stages are to confirm.

<!-- /generated:modules -->

## Templates

The tables below are each template as its source documents built it. **Since 26 October 2026 every
client uses one standard flow** (Kenneth: "all the inspection flow will be standardized", with "the flow
that I have asked u to tweak as the standard form", the one INS-2026-2210 uses). The STD_EG seed runs
`SAFEDON_EG`'s flow under STD_EG's identity: SAFEDON_EG's modules, order, wording, config, specs (ASTM
D6319), defect lists and AQLs, with no client, the STD_EG report's title, no client logo, and the
header's client row on (`lib/templates/definitions/std-eg.ts`, `definitionWithFlow`). `STD_EG` below is
the report flow of STD_EG's versions 1 to 4, which the inspections made on them keep
(`STD_EG_REPORT_SEED`), and the STD_EG example report's fixtures use. `SAFEDON_EG` is retired: the seed
retires its active version and writes no new one. Its versions stay for the inspections that use them.
The admin editor's coverage checklist still lists, for STD_EG, the STD_EG report's forms.

<!-- generated:templates -->

### `STD_EG`: Standard examination gloves (EN 455)

| Property | Value |
|---|---|
| Extends | none |
| Scope | examination, EN455 |
| Built from | `reports/STD_EG.md`, `onsite/EG.md` |
| Unit, sizes | pcs; XS, S, M, L, XL |
| Report title | Preshipment Inspection / Nitrile Disposable Examination Gloves |
| Client logo | no |
| Custom modules | none |

| # | Module | Title | Config |
|---|---|---|---|
| 1 | `header` | Manufacturer Information | fields off: none; mfg / expiry dates: day |
| 2 | `glove_info` | Glove Information | fields off: none; indicative weight for size M |
| 3 | `order_lots` | Order | packing site off |
| 4 | `packing_config` | Packing Configuration | inner unit inner_box; packing mode text on |
| 5 | `sampling_plan` | Sampling Plan | columns off: pouches, pouchesDyeLeak; inspection level I |
| 6 | `carton_sampling` | Finished Goods Sampling Information (Box/Carton #) | none |
| 7 | `dimensions` | Dimension | median of 13 gloves; measures length, width, fingerThickness, palmThickness, cuffThickness; decimals length 0, width 0, fingerThickness 2, palmThickness 2, cuffThickness 2; specs for XS, S, M, L, XL, below |
| 8 | `force_at_break` | Force at Break in Newton (Refer to Attached Where Applicable) | 13 readings per size; median ≥ 6 N; 3 decimals; standard label none |
| 9 | `weight` | Weight (g) - Average of 13 Gloves per Size | 13 values per size; spec none (info); warn beyond 10%; 2 decimals |
| 10 | `watertight` | Freedom From Holes by Watertight Test | AQL 1.5; hand split off; locations: Between Fingers (Crotch) (hole_crotch), Palm (hole_palm), Finger (hole_finger), Cuff (hole_cuff), Other : (hole_other) |
| 11 | `visual` | Visual Inspection | hand split off; critical AQL 0.0, 2 defects; major AQL 2.5, 11 defects; minor AQL 4.0, 6 defects |
| 12 | `dispensing_packing` | Glove Packing Check | layering ≥ 70%, dispensing ≥ 80%; 13 boxes per size (XL 5); stickiness A pass, B pass, B1 pass, C pass, D fail |
| 13 | `labeling` | Packaging Labeling Inspection | inner: 3 boxes, checks lot_no, mfg_date, artwork; carton: 1 box, checks lot_no, mfg_date, artwork, carton_no |
| 14 | `conclusion` | Conclusion | none |

Dimension specs (mm, median; a size without a row is not judged):

| Size | length | width | fingerThickness | palmThickness | cuffThickness |
|---|---|---|---|---|---|
| XS | ≥ 240 | ≤ 80 | NA | NA | NA |
| S | ≥ 240 | 80 ± 10 | NA | NA | NA |
| M | ≥ 240 | 95 ± 10 | NA | NA | NA |
| L | ≥ 240 | 110 ± 10 | NA | NA | NA |
| XL | ≥ 240 | ≥ 110 | NA | NA | NA |

To confirm:

- `header.fields`: Inspected by is shown: the EG onsite form prints it (section 2); the STD_EG report does not, and BUILD_SPEC 11 names it as a SAFEDON_EG addition.
- `sampling_plan.inspectionLevel`: Level I: the example's samples match it. BUILD_SPEC 13 asks for the inspection level per client.
- `dimensions.specs`: The example report's specs. BUILD_SPEC 13: spec limits per product.
- `dimensions.decimals`: As printed: 0 for length and width, 2 for thickness. lib/stats judges the shown (rounded) value: confirm.
- `visual.classes`: The example report's lists and severities, then Skin Visual and Flow Mark (major), which only the onsite forms have (Kenneth, 12 October 2026). BUILD_SPEC 13: final defect lists and severities per client.
- `dispensing_packing.boxesPerSize`: 13 per size and 5 in the XL block, as printed. The sampling plan's inner box count sets the rows when entered.
- `force_at_break.n`: The report prints only the median; the 13 readings come from the lab report (rule 6.2.2 computes the median).

### `SAFEDON_EG`: Safedon examination gloves (ASTM D6319)

| Property | Value |
|---|---|
| Extends | `STD_EG` |
| Scope | examination, ASTM_D6319, one client |
| Built from | `reports/SAFEDON_EG.md`, `onsite/SAFEDON_EG.md` |
| Unit, sizes | pcs; XS, S, M, L, XL |
| Report title | Preshipment Inspection / Safedon Nitrile PF Exam Gloves |
| Client logo | yes |
| Custom modules | `safedon_dispensing_notes` "Glove Dispensing Inspection: Onsite Notes" (table) after `dispensing_safedon`: `specRequirement` "Specification / Requirement", `conclusion` "Conclusion" |

| # | Module | Title | Config |
|---|---|---|---|
| 1 | `header` | Manufacturer Information | fields off: client, factoryGloveCode; mfg / expiry dates: month |
| 2 | `glove_info` | Glove Information | fields off: none; indicative weight for size M |
| 3 | `order_lots` | Order | packing site on |
| 4 | `packing_config` | Packing Configuration | inner unit plastic_pack; packing mode text on |
| 5 | `sampling_plan` | Sampling Plan | columns off: glovesWeight, pouches, pouchesDyeLeak; inspection level I |
| 6 | `carton_sampling` | Finished Goods Sampling Information (Box/Carton #) | none |
| 7 | `dimensions` | Dimension | average of 13 gloves; measures length, width, fingerThickness, palmThickness; decimals length 0, width 0, fingerThickness 2, palmThickness 2; specs for XS, S, M, L, below |
| 8 | `tensile` | Physical Properties Average (Refer to Attached Lab. Reports) | tensile ≥ 14 MPa; elongation ≥ 500%; Spec. (ASTM D6319); decimals 2 and 0 |
| 9 | `weight` | Weight (g) | 1 value per size; spec per size, below; warn beyond 10%; 2 decimals |
| 10 | `watertight` | Freedom From Holes by Watertight Test | AQL 1.5; hand split off; locations: Between Fingers (hole_crotch), Palm (hole_palm), Cuff (hole_cuff), Finger (hole_finger), Glove Burst (glove_burst), Other : (hole_other) |
| 11 | `visual` | Visual Inspection | hand split off; critical AQL 0.0, 2 defects; major AQL 2.5, 10 defects; minor AQL 4.0, 5 defects |
| 12 | `dispensing_safedon` | Glove Dispensing Inspection | rate ≤ 5% per size; 125 gloves per pack; 13 boxes per size; defects no_cuff, finger_out, multiple_out, stuck, sticky, faulty_cuff |
| 13 | `labeling` | Packaging Labeling Inspection | inner: 3 boxes, checks lot_no, mfg_date, expiry_date, artwork; carton: 1 box, checks lot_no, mfg_date, expiry_date, artwork, carton_no |
| 14 | `conclusion` | Conclusion | none |

Dimension specs (mm, average; a size without a row is not judged):

| Size | length | width | fingerThickness | palmThickness |
|---|---|---|---|---|
| XS | ≥ 230 | 76 ± 4 | 0.18 ± 0.04 | 0.14 ± 0.04 |
| S | ≥ 230 | 86 ± 4 | 0.18 ± 0.04 | 0.14 ± 0.04 |
| M | ≥ 230 | 98 ± 4 | 0.18 ± 0.04 | 0.14 ± 0.04 |
| L | ≥ 230 | 107 ± 4 | 0.18 ± 0.04 | 0.14 ± 0.04 |

Weight specs: XS NA, S NA, M NA, L NA.

Differences from `STD_EG`: its seed writes only these config values (`seedConfig`). Objects merge key by key and lists replace whole (`merge.ts`), so the spec rows are lists and `templates.test.ts` checks that merging them over `STD_EG` gives the config above.

- Modules: `tensile`, `dispensing_safedon` instead of `force_at_break`, `dispensing_packing`, in the same places; the added modules' config is written whole.
- `header` config: `fields.client`, `fields.factoryGloveCode`, `mfgExpiryPrecision`.
- `order_lots` config: `fields.packingSite`.
- `packing_config` config: `innerUnit`.
- `sampling_plan` config: `columns.glovesWeight`.
- `dimensions` config: `measures`, `statistic`, `specs`.
- `weight` config: `n`, `specs`.
- `watertight` config: `locations`.
- `visual` config: `classes.major.defects`, `classes.minor.defects`.
- `labeling` config: `levels.inner.checks`, `levels.carton.checks`.
- `header` wording: `poNo` "PO Number", `productName` "Product Name (Brand & Code)".
- `packing_config` wording: `glovesPerInner` "# Glove per Plastic Pack", `innersPerCase` "# Packs per Case".
- `sampling_plan` wording: `innerUnits` "Inner Pack", `glovesPhysical` "# Gloves for Tensile", `innerUnitsDispensing` "# Inner Packs for Packaging & Dispensing Inspection".
- `dimensions` wording: `statistic` "Average", `measureResult` "A / Rej.", `pass` "A", `fail` "Rej.".
- `weight` wording: `result` "A / Rej.", `info` "A", `pass` "A", `fail` "Rej.".
- `weight` title: "Weight (g)".
- `watertight` wording: `holes` "Holes", `heading` "Freedom From Holes by Watertight Test (Sampling Code Letter {codeLetters}; AQL={aql})".
- `visual` wording: `criticalAccept` "Accept", `criticalReject` "Reject", `heading` "Visual Inspection (Sampling Code Letter {codeLetters})", `criticalLimit` "Defect Limit".
- `labeling` wording: `innerAccept` "Acc. =", `cartonAccept` "Acc. =", `innerReject` "Rej. =", `cartonReject` "Rej. =", `innerLevel` "Inner Boxes/Packs", `cartonLevel` "Carton Boxes", `defectLimit` "Limit : Accept / Reject".

To confirm:

- `scope.clientScoped`: BUILD_SPEC 13: confirm the client (the report carries its logo) and whether the Safedon dispensing check applies to all its products.
- `sampling_plan.inspectionLevel`: Level I raises the below-plan notice of expected-results A; the example sampled 80 and 200 where level I gives 200 and 500. BUILD_SPEC 13.
- `dimensions.specs`: The example's specs, XS to L: no XL row is printed, so XL is not judged. BUILD_SPEC 13: spec limits per product.
- `weight.specs`: NA as printed for XS to L; XL has no row (not printed).
- `header.mfgExpiryPrecision`: The report prints month and year only: confirm month precision.
- `visual.classes`: The report's lists, then Skin Visual and Flow Mark (major), which only the onsite forms have (Kenneth, 12 October 2026). BUILD_SPEC 13: final defect lists and severities per client.
- `dispensing_safedon.glovesPerPack`: 125, the same number as packing_config glovesPerInner (125 per plastic pack): confirm which one the rate uses if they differ.

### `STD_SG`: Standard sterile surgical gloves

| Property | Value |
|---|---|
| Extends | none |
| Scope | surgical, custom |
| Built from | `onsite/SG.md` |
| Unit, sizes | pairs; 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0 |
| Report title | to confirm |
| Client logo | no |
| Custom modules | `glove_type` "Glove Type" (fields) after `header`: `gloveType` "Glove Type" |

| # | Module | Title | Config |
|---|---|---|---|
| 1 | `header` | Purchase Order / Shipment Information | fields off: factoryAddress, client, factoryGloveCode; mfg / expiry dates: day |
| 2 | `order_lots` | PO Info | packing site off |
| 3 | `packing_config` | Packing Mode | inner unit pouch; packing mode text on |
| 4 | `sampling_plan` | Sampling Plan | columns off: gloves, glovesWeight, innerUnitsDispensing; inspection level none (to confirm) |
| 5 | `watertight` | Watertight Inspection | AQL 1.5; hand split on; locations: Between Fingers (Crotch) (hole_crotch), Palm (hole_palm), Finger (hole_finger), Cuff (hole_cuff), Other : (hole_other) |
| 6 | `visual` | Visual Inspection | hand split on; critical AQL 0.0, 2 defects; major AQL 2.5, 9 defects; minor AQL 4.0, 6 defects |
| 7 | `dimensions` | Dimension | median of 13 gloves; measures length, width, fingerThickness, palmThickness, cuffThickness; decimals length 0, width 0, fingerThickness 2, palmThickness 2, cuffThickness 2; specs none |
| 8 | `dye_leak` | Dye Leak Test | pouches per size: from the sampling plan |
| 9 | `conclusion` | Conclusion | none |

Wording that differs from the defaults:

- `header`: `manufacturer` "Manufacturer Name", `poNo` "Purchase/Sales Order No.", `productName` "Product Name", `inspectionDate` "Date", `mfgDate` "Mfg Date", `expiryDate` "Exp Date"
- `order_lots`: `qtyCases` "Qty (Case)"
- `packing_config`: `glovesPerInner` "# Gloves per Pouch", `innersPerCase` "# Pouches per Case"
- `sampling_plan`: `glovesWatertightVisual` "# Gloves", `glovesDimensions` "# Gloves Dimension", `glovesPhysical` "# Gloves (FAB)", `samplingQuantity` "Sampling Quantity (WTT & Visual)", `orderQty` "Qty (Case)"
- `watertight`: `holes` "Defect", `totalDefects` "Total WTT", `heading` "Watertight Inspection"
- `visual`: `majorCounts` "Major Defect", `minorCounts` "Minor Defect", `majorTotal` "Total Major", `minorTotal` "Total Minor", `heading` "Visual Inspection", `majorHeading` "Major Defect", `minorHeading` "Minor Defect"

To confirm:

- `scope.standard`: 'custom' until confirmed: no filled SG report, so EN 455 or ASTM D3577 is open (BUILD_SPEC 13).
- `unit`: pairs (sterile surgical gloves are packed in pairs); the SG form counts '# gloves'.
- `sizes`: The form has 8 size columns with blank headings: 5.5 to 9.0 assumed.
- `report.titleLines`: No filled SG report.
- `header.fields`: The SG form has no factory address, client or factory glove code: off.
- `packing_config.innerUnit`: pouch (BUILD_SPEC 11), so the counts read '# Gloves per Pouch' and '# Pouches per Case' (the SG form words neither); the SG sampling plan counts both Inner Box and Pouches, so a second packing level may be needed.
- `sampling_plan.inspectionLevel`: Not on the form.
- `watertight.locations`: The form has 7 blank rows: STD_EG's locations until confirmed. AQL 1.5 is the default.
- `watertight.handSplit`: R and L per size as on the form; tested and the limits per size (the sampling plan has one '# gloves' per size).
- `visual.classes`: Blank rows on the form: the STD_EG report's lists and the default AQLs until confirmed, without Skin Visual and Flow Mark (Kenneth's yes of 12 October 2026 covered STD_EG and SAFEDON_EG). The form has no critical class; it is on as in both reports.
- `dimensions.measures`: Planned only on the form ('# Gloves dimension'): STD_EG's five measures until confirmed.
- `dimensions.statistic`: Median (EN 455 style) until confirmed.
- `dimensions.specs`: None yet, so nothing is judged: no SG spec (BUILD_SPEC 13).
- `dimensions.decimals`: The reports' decimals until confirmed.
- `dye_leak.n`: Planned only on the form ('# pouches (dye leak test)').
- `modules`: BUILD_SPEC 11 does not switch force_at_break on, although the form plans '# Gloves (FAB)'.

<!-- /generated:templates -->

## Defects

<!-- generated:defects -->

`STD_EG` visual defects, in report order, then the ones only the onsite forms have:

| Class | Label | Code | Printed |
|---|---|---|---|
| critical | Embedded Insects | `embedded_insect` | Embeded Insects |
| critical | Embedded Metal Debris | `embedded_metal` | Embeded metal debris |
| major | Thin Area Between Fingers (Crotch) | `thin_crotch_area` |  |
| major | Ring-Shaped Thin Area (Crotch) | `thin_crotch_ring` |  |
| major | Thin Area on Glove Body | `thin_body_area` |  |
| major | Thin Spot on Glove Body | `thin_spot` |  |
| major | Non-Removable Dirt | `dirt_nonremovable` |  |
| major | Oil Stain | `stain` |  |
| major | Residue Material / Foreign Matter | `foreign_matter` |  |
| major | Defective Bead | `bead_defective` |  |
| major | Big Lumps (>2mm) | `lump_big` |  |
| major | Skin Visual | `skin_visual` | not printed: written SKV on the onsite forms |
| major | Flow Mark | `flow_mark` | not printed: written FM on the onsite forms |
| minor | Small Dirt / Stain | `dirt_small` |  |
| minor | Sticky Pleats (&lt; 5mm) | `sticky_pleats` |  |
| minor | Lumps (&lt;2mm) | `lump_small` |  |
| minor | Poor Beading | `bead_poor` |  |
| minor | Rolled Bead | `bead_rolled` |  |
| minor | Defective Beads | `bead_defective` |  |

`SAFEDON_EG` visual defects, in report order, then the ones only the onsite forms have:

| Class | Label | Code | Printed |
|---|---|---|---|
| critical | Embedded Insects | `embedded_insect` | Embeded Insects |
| critical | Embedded Metal Debris | `embedded_metal` | Embeded metal debris |
| major | Thin Ring Between Fingers (Crotch) | `thin_crotch_ring` |  |
| major | Thin Area Between Fingers (Crotch) | `thin_crotch_area` |  |
| major | Thin Patch / Area (Body) | `thin_body_area` | Thin batch / area (body) |
| major | Thin Spot | `thin_spot` |  |
| major | Non-Removable Dirt | `dirt_nonremovable` |  |
| major | Stain | `stain` |  |
| major | Powder Mark | `powder_mark` |  |
| major | Bead Blister | `bead_blister` |  |
| major | Skin Visual | `skin_visual` | not printed: written SKV on the onsite forms |
| major | Flow Mark | `flow_mark` | not printed: written FM on the onsite forms |
| minor | Small Dirt / Stain | `dirt_small` |  |
| minor | Sticky Pleats (&lt; 5mm) | `sticky_pleats` |  |
| minor | Lumps (&lt;2mm) | `lump_small` |  |
| minor | Thin Bead | `bead_thin` |  |
| minor | Thin Bead / Small Beading Defect | `bead_small_defect` |  |

`STD_SG` uses the STD_EG report's lists until confirmed, without Skin Visual and Flow Mark (Kenneth's yes of 12 October 2026 covered STD_EG and SAFEDON_EG): the SG form has blank rows.

Severity per template, by code (a code in two classes of one template is a deliberate split):

| Code | STD_EG | SAFEDON_EG |
|---|---|---|
| `embedded_insect` | critical: Embedded Insects | critical: Embedded Insects |
| `embedded_metal` | critical: Embedded Metal Debris | critical: Embedded Metal Debris |
| `thin_crotch_area` | major: Thin Area Between Fingers (Crotch) | major: Thin Area Between Fingers (Crotch) |
| `thin_crotch_ring` | major: Ring-Shaped Thin Area (Crotch) | major: Thin Ring Between Fingers (Crotch) |
| `thin_body_area` | major: Thin Area on Glove Body | major: Thin Patch / Area (Body) |
| `thin_spot` | major: Thin Spot on Glove Body | major: Thin Spot |
| `dirt_nonremovable` | major: Non-Removable Dirt | major: Non-Removable Dirt |
| `stain` | major: Oil Stain | major: Stain |
| `foreign_matter` | major: Residue Material / Foreign Matter |  |
| `bead_defective` | major: Defective Bead<br>minor: Defective Beads |  |
| `lump_big` | major: Big Lumps (>2mm) |  |
| `skin_visual` | major: Skin Visual | major: Skin Visual |
| `flow_mark` | major: Flow Mark | major: Flow Mark |
| `dirt_small` | minor: Small Dirt / Stain | minor: Small Dirt / Stain |
| `sticky_pleats` | minor: Sticky Pleats (&lt; 5mm) | minor: Sticky Pleats (&lt; 5mm) |
| `lump_small` | minor: Lumps (&lt;2mm) | minor: Lumps (&lt;2mm) |
| `bead_poor` | minor: Poor Beading |  |
| `bead_rolled` | minor: Rolled Bead |  |
| `powder_mark` |  | major: Powder Mark |
| `bead_blister` |  | major: Bead Blister |
| `bead_thin` |  | minor: Thin Bead |
| `bead_small_defect` |  | minor: Thin Bead / Small Beading Defect |

Watertight hole locations, in report order:

| Template | Locations (code) |
|---|---|
| `STD_EG` | Between Fingers (Crotch) (`hole_crotch`), Palm (`hole_palm`), Finger (`hole_finger`), Cuff (`hole_cuff`), Other : (`hole_other`) |
| `SAFEDON_EG` | Between Fingers (`hole_crotch`), Palm (`hole_palm`), Cuff (`hole_cuff`), Finger (`hole_finger`), Glove Burst (`glove_burst`), Other : (`hole_other`) |
| `STD_SG` | Between Fingers (Crotch) (`hole_crotch`), Palm (`hole_palm`), Finger (`hole_finger`), Cuff (`hole_cuff`), Other : (`hole_other`) |

Safedon dispensing defects (SAFEDON_EG report page 3, Safedon onsite sheet):

| Code | Label | Hint shown in the app | Printed definition |
|---|---|---|---|
| `no_cuff` | No Cuff | Cuff should ideally be at least 2 cm out | Cuff should ideallly be at least 2 cm out |
| `finger_out` | Finger Out | Only the cuff, not a finger, should come out first | Only cuff but no finger should be out first |
| `multiple_out` | Multiple Gloves Out | Only one glove should come out at a time | Only one glove should be out at one time |
| `stuck` | Glove Stuck | Glove could not be dispensed or was very difficult to dispense | Glove ould not be dispensed or very difficult to dispense |
| `sticky` | Sticky Glove | Two or more gloves out at once because they stick together | Two or more gloves out at the same time caused by gloves sticking together |
| `faulty_cuff` | Faulty Cuff | Deformed or misshapen cuff causing a dispensing problem | Deformed or out of shaped cuff which causes dispensing problem |

Stickiness codes (STD_EG report page 4):

| Code | Legend | Result | Printed |
|---|---|---|---|
| `A` | Non sticky | pass |  |
| `B` | A mix of non sticky to lightly sticky | pass |  |
| `B1` | A mix of non sticky to light stickiness at the bead | pass | A mix of non sticky to light sickiness at the bead |
| `C` | Lightly sticky but dispensable | pass |  |
| `D` | Too sticky & affect dispensing | fail |  |

<!-- /generated:defects -->

## Decisions

Where the sources or BUILD_SPEC leave a choice, the dictionary takes one. Each is open to change.

1. **Report date.** BUILD_SPEC 6.1 lists a report date under `header`; both reports print one date,
   in the conclusion block. It is `conclusion.date` (also the export's `conclusion.date`).
2. **Glove Type** (all three onsite forms) has no module in BUILD_SPEC 6.1: it is the custom module
   `glove_type` (field `gloveType`, after `header`) in all three templates.
3. **Fields beyond BUILD_SPEC 6.1**, each because a source has it: `packing_config.packingMode`
   (onsite "Packing Mode"), `dispensing_packing.note` (EG onsite "Others:"),
   `watertight.otherDescription` (the reports' "Other :"), `labeling.boxNos` (the box/carton
   numbers of the boxes inspected, typed with the size's sampled ones suggested, one not sampled a
   warning, rule 6.2.7; the reports print only how many).
4. **Report first** (rule 4.2.1). The EG onsite form's stickiness (onsite/EG.md suggests none,
   slight, severe) uses the report's codes A, B, B1, C, D. The Safedon onsite sheet's free-text
   "Specification / Requirement" and "Conclusion" are kept as written, per size, in the custom
   module `safedon_dispensing_notes` (layout `table`, after `dispensing_safedon`) and exported, as
   onsite/SAFEDON_EG.md asks; nothing written there is lost (rule 4.2.2). The app still judges each
   size's rate against `maxRatePct` and computes the result, which is what the report prints in
   those two rows.
5. **Weight** is compared with the indicative weight only for the size it is given for
   (`glove_info.indicativeWeightSize`, M): the other sizes' averages are info. Comparing every size
   with size M's weight would warn on sizes the expected results pass.
6. **Dimension keys** are `length`, `width`, `fingerThickness`, `palmThickness`, `cuffThickness`.
   The AI fixture on main and the example fixtures use `finger`, `palm`, `cuff`; the explicit keys
   stay unambiguous next to hole locations and future measures.
7. **Holes, defects and checks are keyed by code**, so the same defect counts together across
   templates whatever its label ("Oil stain" and "Stain" are both `stain`).
8. **Lab averages are typed.** `tensile.tensileStrength` and `elongationAtBreak` are the lab report's
   averages, typed as printed: the app has no readings to compute them from. Force at break is the
   opposite: the 13 readings are entered and the median computed, so they must come from the lab
   report.
9. **Capture order** follows BUILD_SPEC 11. SAFEDON_EG is "as STD_EG" with substitutions in place,
   though its report prints dispensing (page 3) before watertight and visual (page 4) and weight
   inside the dimension table.
10. **STD_SG** has no filled report. Values the SG form does not fix are provisional and listed
    under "To confirm": the standard (`custom`, since the template schema requires one), STD_EG's
    defect lists and hole locations, the default AQLs, sizes 5.5 to 9.0 (8 blank columns), unit
    pairs, STD_EG's dimension measures, median and decimals, and no dimension specs yet.
11. **Decimals** are the reports' printed decimals (length and width 0, thickness 2, force 3, weight
    2, tensile 2, elongation 0). `lib/stats` judges the statistic as shown, so the decimals decide
    borderline results (question 9).
12. **Product code** is its own field, `header.productCode`, entered once and reused everywhere
    (rule 6.2.10): the export, the report header, file names. The product name keeps the code as
    printed, so the report keeps the source's wording. The STD_EG example printed one code in the
    report and another in the file name; one field prevents that (question 11).
13. **Report title** is kept as lines (`report.titleLines`); BUILD_SPEC 4.3's `report.title` is one
    string, so a seed joins them. The running headers of pages 2 to 4 are report layout: BUILD_SPEC
    4.3's report settings hold only the title and the client logo, and the AI report draws them from
    the PO and the product name (their wording is in the coverage matrix).
14. **Hand split.** With `handSplit` on, holes and defect counts are per hand; tested, inspected and
    the AQL limits stay per size, as the SG form's totals span R and L.
15. **Inspected by in the STD_EG header.** The STD_EG report prints no Inspected by row, but its EG
    onsite form does (section 2), so STD_EG shows the header's inspector row (rule 4.2.1: onsite
    forms come in as config). BUILD_SPEC 11 names Inspected by as a SAFEDON_EG addition because only
    that report prints it. Listed under "To confirm".
16. **Client logo.** SAFEDON_EG prints the client's logo instead of a Client Name row: the logo is a
    report setting (`report.showClientLogo`), and the client is the inspection's
    (`inspections.client_id`, picked on /inspections/new) while the header's Client Name row is off.
17. **Title Case.** Kenneth, 8 October 2026: the app and the report write labels in Title Case
    (docs/DESIGN.md); the forms' wording stays in the coverage matrix. Every module title, field
    label, class and level wording, caption and template override in `fields.ts`, the custom
    modules in `templates.ts` and the rows of the lists in `defects.ts` (visual defects, hole
    locations, labelling checks, the Safedon dispensing defects) take the rule's capitals, and the
    module defaults and the seed templates follow; the export carries them to the AI report. Units
    in brackets stay lower case ("Weight (g)"), words in brackets do not ("Qty (Cases)"); "#",
    "No." and codes stay. Sentences stay sentences: the stickiness legend, the Safedon definitions
    and every hint. The conclusion words keep the reports' capitals (PASSED, FAILED, HOLD). The
    tests still prove every printed label reaches its template: `sameWording` compares the
    printed label, `[sic]` fixed, with the template's, the first letters of its words aside. Box
    and carton numbers are one number (Kenneth, 13 October 2026: "all regarding to box and carton
    use Box/Carton #"): every label naming it says Box/Carton # where the forms print "Box #",
    "(Carton #)", "carton number" or "Box Number" (the module title "Finished Goods Sampling
    Information (Box/Carton #)", the dispensing and labelling columns, labelling's "No Box/Carton #
    Printed"), and `sameWording` reads the forms' words for it as Box/Carton #. "Carton" alone, the
    packaging level ("Carton Box"), stays as printed.

## Open questions

Values that wait on Kenneth. BUILD_SPEC 13 first.

1. **Client of SAFEDON_EG** (BUILD_SPEC 13): confirm the client named by the report's logo, and
   whether the Safedon dispensing check applies to all its products. Blocks the template's client
   scope, and whether `dispensing_safedon` belongs to the client or to a product template.
2. **Inspection level per client** (BUILD_SPEC 13). `sampling_plan.inspectionLevel` is I in both
   templates: the STD_EG example matches it; the SAFEDON_EG example sampled 80 and 200 where level I
   gives 200 and 500, so the app warns there.
3. **Spec limits per product** (BUILD_SPEC 13). The templates carry the example reports' specs.
   SAFEDON_EG prints none for XL (dimensions or weight), and no template has a weight spec.
4. **Defect lists and severities per client** (BUILD_SPEC 13). The lists are the example reports'.
5. **Surgical report format** (BUILD_SPEC 13): for STD_SG, the standard (EN 455 or ASTM D3577), unit,
   sizes, report title, dimension measures, statistic and specs, defect lists and hole locations,
   AQLs, inspection level, whether a critical class applies (not on the SG form), and whether
   `force_at_break` is on (the form plans "# Gloves (FAB)"; BUILD_SPEC 11 leaves it off).
6. **Signature drawn in the app** (BUILD_SPEC 13): `conclusion.signature`.
7. **Mfg and expiry dates as month and year.** SAFEDON_EG prints month and year only. The dictionary
   proposes `header.mfgExpiryPrecision: "month"`, stored as the first of the month.
8. **Force at break readings.** The report prints only the median; rule 6.2.2 computes it from the 13
   readings. Does every lab report list them, or should the app accept a lab median?
9. **Rounding before the spec check.** `lib/stats` judges the statistic at the printed decimals: an
   average length of 239.6 shows as 240 and passes ≥ 240. Confirm, or judge the raw value.
10. **Safedon gloves per pack.** `dispensing_safedon.glovesPerPack` (125) repeats
    `packing_config.glovesPerInner` (125 per plastic pack). Which one sets the rate if they differ?
11. **Product code as its own field.** Settled: `header.productCode` holds it (decision 12), and the
    product name keeps it as printed.
12. **Packing site per lot.** One per size row, as printed. If one size has lots from two sites, it
    needs to move to the lot.
13. **Labelling box numbers.** `labeling.boxNos` is optional; should the boxes be required?
14. **Stickiness summary.** The STD_EG Average row prints a code; the dictionary shows the worst code
    entered. Confirm.
15. **STD_EG dispensing rows.** 13 per size and 5 in the XL block, as printed; the sampling plan's
    inner box count sets the rows when entered. Confirm the XL default.
16. **SG packing.** The SG form samples Inner Box and Pouches; `packing_config` has one inner unit
    (pouch, BUILD_SPEC 11). A second packing level may be needed. The form words no packing counts,
    so STD_SG words them by its inner unit, "# Gloves per Pouch" and "# Pouches per Case", as the
    export's `innerUnit` says: confirm the wording, and whether a pouch is counted in gloves or pairs.
17. **Safedon** is called the manufacturer in onsite/SAFEDON_EG.md and the product line in
    reports/SAFEDON_EG.md. The dictionary treats it as the product line.
18. **AQL per client.** The templates set the AQLs their reports print (watertight 1.5; 0, 2.5 and
    4.0). The module framework ranks a template's AQL above a client's (template, then client, then
    BUILD_SPEC 7), so a client AQL would never apply to these templates, and the sampling plan's lot
    check uses the template's too (`AQL_SOURCES`). Should the standard templates leave the AQLs unset
    so per-client values apply? `watertight.aql` and the major and minor class AQLs already take
    null, which falls back to the client's AQL, else BUILD_SPEC 7's.

## Coverage matrix

Every field of every source document, in document order: the label as printed (verbatim, typos
included), the app's wording beside it (what the template shows for the field, in Title Case with
`[sic]` typos fixed and Box/Carton # for the box or carton number, decision 17: `appWording`), what
the cell holds and where it goes. A field the
template splits shows each part's label ("Manufacturing Date; Expiry Date"); a Safedon definition
shows the hint the app shows in its place. `field[group][key]` picks a class
or level and a code; `config`, `caption` and `title` are template values; `custom` is a custom
module field; `template` a template property; `layout` is drawn by the AI report only.

<!-- generated:coverage -->

#### `reports/STD_EG.md`: 150 fields

| Section | Label (verbatim) | App wording | Input | Maps to | Notes |
|---|---|---|---|---|---|
| All pages | Page &lt;n> of 4 |  | page | layout: Page number: Steri-AI's report numbers its own pages. |  |
| All pages | Pre-shipment Inspection : &lt;PO> &lt;product> |  | page | layout: Running header of pages 2 to 4, 'Pre-shipment Inspection : &lt;PO> &lt;product>': Steri-AI's report draws it from header.poNo and header.productName. | BUILD_SPEC 4.3's report settings hold the title and the client logo only. |
| Page 1 > Title | Preshipment Inspection |  | heading | template `report.titleLines` |  |
| Page 1 > Title | Nitrile Disposable Examination Gloves |  | heading | template `report.titleLines` |  |
| Page 1 > Manufacturer Information | Manufacturer Information | Manufacturer Information | heading | title `header` |  |
| Page 1 > Manufacturer Information | Manufacturer / Supplier | Manufacturer / Supplier | text | `header.manufacturer` | Printed as the manufacturer's name with the factory name in brackets. |
| Page 1 > Manufacturer Information | Supplier Factory Address / Location | Supplier Factory Address / Location | text | `header.factoryAddress` |  |
| Page 1 > Manufacturer Information | PO / SO Number | PO / SO Number | text | `header.poNo` | The PO with the SO number in brackets: one value. |
| Page 1 > Manufacturer Information | Product Name (Brand, code & description) | Product Name (Brand, Code & Description) | text | `header.productName` |  |
| Page 1 > Manufacturer Information | Client Name | Client Name | text | `header.client` |  |
| Page 1 > Manufacturer Information | Inspection date | Inspection Date | date | `header.inspectionDate` |  |
| Page 1 > Manufacturer Information | Manufacturing date | Manufacturing Date | date | `header.mfgDate` |  |
| Page 1 > Manufacturer Information | Expiry date | Expiry Date | date | `header.expiryDate` |  |
| Page 1 > Manufacturer Information | Factrory glove code | Factory Glove Code | text | `header.factoryGloveCode` | No 'Inspected by' row on this report; the app records the inspector anyway, and STD_EG shows the row because the EG onsite form prints it (header.inspector). |
| Page 1 > Glove Information | Glove Information | Glove Information | heading | title `glove_info` |  |
| Page 1 > Glove Information | Glove surface texture | Glove Surface Texture | text | `glove_info.surfaceTexture` |  |
| Page 1 > Glove Information | Indicative weight (size M) | Indicative Weight (Size M) | number | `glove_info.indicativeWeight`<br>config `glove_info.indicativeWeightSize` | Grams. |
| Page 1 > Glove Information | Glove colour | Glove Colour | text | `glove_info.colour` |  |
| Page 1 > Glove Information | Glove length | Glove Length | text | `glove_info.length` | Text, e.g. a minimum in mm. |
| Page 1 > Order table | Size |  | size | template `sizes` | Rows XS, S, M, L, XL. |
| Page 1 > Order table | Qty (cases) | Qty (Cases) | number | `order_lots.qtyCases` |  |
| Page 1 > Order table | Lot Number | Lot Number | text | `order_lots.lotNumbers` |  |
| Page 1 > Order table | Total # carton | Total # Carton | computed | `order_lots.totalCartons` |  |
| Page 1 > Order table | Total # gloves | Total # Gloves | computed | `order_lots.totalGloves` |  |
| Page 1 > Packing configuration | Packing configuration | Packing Configuration | label | title `packing_config` |  |
| Page 1 > Packing configuration | # glove per inner box | # Glove per Inner Box | number | `packing_config.glovesPerInner`<br>config `packing_config.innerUnit` | Names the inner unit: inner box. |
| Page 1 > Packing configuration | # inners per case | # Inners per Case | number | `packing_config.innersPerCase` |  |
| Page 1 > Packing configuration | # gloves per case | # Gloves per Case | number | `packing_config.glovesPerCase` |  |
| Page 1 > Sampling Plan | Sampling Plan | Sampling Plan | heading | title `sampling_plan` |  |
| Page 1 > Sampling Plan | Glove Size |  | size | template `sizes` |  |
| Page 1 > Sampling Plan | Order Qty (case) | Order Qty (Case) | repeat | caption `sampling_plan.orderQty`<br>`order_lots.qtyCases` | The order quantity again: entered once, in the order table. |
| Page 1 > Sampling Plan | Sampling Quantity | Sampling Quantity | label | caption `sampling_plan.samplingQuantity` |  |
| Page 1 > Sampling Plan | Case | Case | number | `sampling_plan.cases` |  |
| Page 1 > Sampling Plan | Inner Box | Inner Box | number | `sampling_plan.innerUnits` |  |
| Page 1 > Sampling Plan | Gloves | Gloves | number | `sampling_plan.gloves` |  |
| Page 1 > Sampling Plan | # gloves for watertight & Visual | # Gloves for Watertight & Visual | number | `sampling_plan.glovesWatertightVisual` |  |
| Page 1 > Sampling Plan | # gloves for dimension | # Gloves for Dimension | number | `sampling_plan.glovesDimensions` |  |
| Page 1 > Sampling Plan | # gloves for FAB | # Gloves for FAB | number | `sampling_plan.glovesPhysical` |  |
| Page 1 > Sampling Plan | # inner box for packaing & dispensing inspection | # Inner Box for Packaging & Dispensing Inspection | number | `sampling_plan.innerUnitsDispensing` |  |
| Page 1 > Finished Goods Sampling Information (carton number) | Finished Goods Sampling Information (carton number) | Finished Goods Sampling Information (Box/Carton #) | heading | title `carton_sampling` |  |
| Page 1 > Finished Goods Sampling Information (carton number) | (Carton #) | (Box/Carton #) | number | `carton_sampling.cartonNumbers`<br>caption `carton_sampling.sizeCaption` | One grid per size, XS to XL: 10 columns × 5 rows, up to 50 carton numbers. Printed after the size ('M (Carton #)'; 'XS (carton #)' in lower case). The app says Box/Carton # (Kenneth, 13 October 2026: box # and carton # are one number). |
| Page 1 > Finished Goods Sampling Information (carton number) | Sampling Quantity | Sampling Quantity | number | `carton_sampling.samplingQuantity` | The app counts the box/carton numbers; the count must equal the sampled cases (rule 6). |
| Page 2 > Dimension - Size &lt;size> | Dimension - Size &lt;size> | Dimension - Size {size} | heading | caption `dimensions.sizeHeading`<br>title `dimensions` | One table per size, XS to XL. |
| Page 2 > Dimension - Size &lt;size> | No. | No. | fixed | caption `dimensions.rowNo`<br>config `dimensions.rows` | Rows 1 to 13. |
| Page 2 > Dimension - Size &lt;size> | Length | Length | number | `dimensions.length` |  |
| Page 2 > Dimension - Size &lt;size> | Width | Width | number | `dimensions.width` |  |
| Page 2 > Dimension - Size &lt;size> | Finger Thickness | Finger Thickness | number | `dimensions.fingerThickness` |  |
| Page 2 > Dimension - Size &lt;size> | Palm Thickness | Palm Thickness | number | `dimensions.palmThickness` |  |
| Page 2 > Dimension - Size &lt;size> | Cuff Thickness | Cuff Thickness | number | `dimensions.cuffThickness` |  |
| Page 2 > Dimension - Size &lt;size> | Median | Median | computed | `dimensions.statistic`<br>config `dimensions.statistic`<br>config `dimensions.decimals` |  |
| Page 2 > Dimension - Size &lt;size> | Spec. | Spec. | fixed | caption `dimensions.specRow`<br>config `dimensions.specs` | Length ≥ 240; Width XS ≤ 80, S 80 ± 10, M 95 ± 10, L 110 ± 10, XL ≥ 110; thickness NA. |
| Page 2 > Dimension - Size &lt;size> | P/F \* | P/F \* | computed | `dimensions.measureResult`<br>caption `dimensions.pass`<br>caption `dimensions.fail` |  |
| Page 2 > Dimension - Size &lt;size> | \* P = Passed F = Failed |  | fixed | layout: Legend of the P/F row: the app shows result words and chips. |  |
| Page 2 > Force At Break in Newton | Force At Break in Newton (Refer to attached where applicable) | Force at Break in Newton (Refer to Attached Where Applicable) | heading | title `force_at_break`<br>`force_at_break.labReport` | 'Refer to attached': the lab report, uploaded as a file. |
| Page 2 > Force At Break in Newton | Size |  | size | template `sizes` |  |
| Page 2 > Force At Break in Newton | Median | Median | computed | `force_at_break.median`<br>`force_at_break.values`<br>config `force_at_break.n` | Only the median is printed; the app keeps the n readings and computes it (rule 2). |
| Page 2 > Force At Break in Newton | Spec. | Spec. | fixed | caption `force_at_break.specRow`<br>config `force_at_break.specMin` | ≥ 6 N (left blank for XS). |
| Page 2 > Force At Break in Newton | Passed / Failed | Passed / Failed | computed | `force_at_break.result` |  |
| Page 2 > Weight (g) - average of 13 gloves per size | Weight (g) - average of 13 gloves per size | Weight (g) - Average of 13 Gloves per Size | heading | title `weight`<br>config `weight.n` | The app fills in the count of gloves weighed (the sampling plan's # Gloves for Weight, else config n), so the heading names the gloves really weighed. |
| Page 2 > Weight (g) - average of 13 gloves per size | Size |  | size | template `sizes` |  |
| Page 2 > Weight (g) - average of 13 gloves per size | Average | Average | computed | `weight.average`<br>`weight.values`<br>config `weight.decimals` | The 13 weighings are not printed; the app keeps them and computes the average. |
| Page 2 > Weight (g) - average of 13 gloves per size | Remark | Remark | computed | `weight.result`<br>caption `weight.info`<br>config `weight.specs` | Printed 'Info': no weight spec. |
| Page 3 > Freedom from Holes by watertight test | Freedom from Holes by watertight test (Single sampling code letter k, L & M, AQL 1.5) | Freedom From Holes by Watertight Test (Single Sampling Code Letter {codeLetters}, AQL {aql}) | heading | caption `watertight.heading`<br>title `watertight`<br>`watertight.codeLetter`<br>config `watertight.aql` | The code letters (printed 'k, L & M') follow from the samples: computed (rule 2). |
| Page 3 > Freedom from Holes by watertight test | Glove Size |  | size | template `sizes` |  |
| Page 3 > Freedom from Holes by watertight test | No. of sample tested | No. of Sample Tested | number | `watertight.tested` |  |
| Page 3 > Freedom from Holes by watertight test | Defect Limit | Defect Limit | computed | caption `watertight.defectLimit`<br>`watertight.accept`<br>`watertight.reject` | Accept / Reject per size, from the AQL engine. |
| Page 3 > Freedom from Holes by watertight test | Pin hole | Pin Hole | label | `watertight.holes`<br>config `watertight.locations` |  |
| Page 3 > Freedom from Holes by watertight test | Between fingers (crotch) | Between Fingers (Crotch) | number | `watertight.holes[hole_crotch]` |  |
| Page 3 > Freedom from Holes by watertight test | Palm | Palm | number | `watertight.holes[hole_palm]` |  |
| Page 3 > Freedom from Holes by watertight test | Finger | Finger | number | `watertight.holes[hole_finger]` |  |
| Page 3 > Freedom from Holes by watertight test | Cuff | Cuff | number | `watertight.holes[hole_cuff]` |  |
| Page 3 > Freedom from Holes by watertight test | Other : | Other : | number | `watertight.holes[hole_other]`<br>`watertight.otherDescription` | The colon takes the location: watertight.otherDescription. |
| Page 3 > Freedom from Holes by watertight test | Total number of defects found | Total Number of Defects Found | computed | `watertight.totalDefects` | Printed as &lt;defects>/&lt;tested>. |
| Page 3 > Freedom from Holes by watertight test | Freedom from holes (Passed / Failed) | Freedom From Holes (Passed / Failed) | computed | `watertight.result` |  |
| Page 3 > Visual Inspection | Visual Inspection (Single Sampling code letter K, L & M) | Visual Inspection (Single Sampling Code Letter {codeLetters}) | heading | caption `visual.heading`<br>title `visual`<br>`visual.codeLetter` |  |
| Page 3 > Visual Inspection > Critical Defects (AQL 0.0) | Critical Defects (AQL 0.0) | Critical Defects (AQL {aql}) | heading | caption `visual.criticalHeading`<br>config `visual.classes[critical]` |  |
| Page 3 > Visual Inspection > Critical Defects (AQL 0.0) | Glove Size |  | size | template `sizes` |  |
| Page 3 > Visual Inspection > Critical Defects (AQL 0.0) | No. of sample inspected | No. of Sample Inspected | number | `visual.inspected[critical]` |  |
| Page 3 > Visual Inspection > Critical Defects (AQL 0.0) | Defect Limit : Accept / Reject | Defect Limit : Accept / Reject | computed | caption `visual.criticalLimit`<br>`visual.accept[critical]`<br>`visual.reject[critical]` | Printed Acc. = 0 / Rej. = 1: AQL 0 is always Accept 0 / Reject 1. |
| Page 3 > Visual Inspection > Critical Defects (AQL 0.0) | Critical Defects | Critical Defects | label | `visual.counts[critical]` |  |
| Page 3 > Visual Inspection > Critical Defects (AQL 0.0) | Embeded Insects | Embedded Insects | number | `visual.counts[critical][embedded_insect]` |  |
| Page 3 > Visual Inspection > Critical Defects (AQL 0.0) | Embeded metal debris | Embedded Metal Debris | number | `visual.counts[critical][embedded_metal]` |  |
| Page 3 > Visual Inspection > Critical Defects (AQL 0.0) | Total number of "Critical Defects" found | Total Number of "Critical Defects" Found | computed | `visual.total[critical]` |  |
| Page 3 > Visual Inspection > Critical Defects (AQL 0.0) | Disposition - Visual Minor (Passed / Failed) | Disposition - Visual Critical (Passed / Failed) | computed | `visual.result[critical]` | Mislabelled on the report: the app labels the critical line Critical. |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Major Defects (AQL 2.5) | Major Defects (AQL {aql}) | heading | caption `visual.majorHeading`<br>config `visual.classes[major]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Glove Size |  | size | template `sizes` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | No. of sample inspected | No. of Sample Inspected | number | `visual.inspected[major]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Defect Limit | Defect Limit | computed | caption `visual.defectLimit`<br>`visual.accept[major]`<br>`visual.reject[major]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Major Defects | Major Defects | label | `visual.counts[major]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Thin area between fingers (crotch) | Thin Area Between Fingers (Crotch) | number | `visual.counts[major][thin_crotch_area]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Ring-shaped thin area (crotch) | Ring-Shaped Thin Area (Crotch) | number | `visual.counts[major][thin_crotch_ring]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Thin area on glove body | Thin Area on Glove Body | number | `visual.counts[major][thin_body_area]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Thin spot on glove body | Thin Spot on Glove Body | number | `visual.counts[major][thin_spot]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Non-removable dirt | Non-Removable Dirt | number | `visual.counts[major][dirt_nonremovable]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Oil stain | Oil Stain | number | `visual.counts[major][stain]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Residue material / foreign matter | Residue Material / Foreign Matter | number | `visual.counts[major][foreign_matter]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Defective bead | Defective Bead | number | `visual.counts[major][bead_defective]` | Major here; 'Defective beads' is minor: same code, severity per class. |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Big Lumps (>2mm) | Big Lumps (>2mm) | number | `visual.counts[major][lump_big]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Total number of "Major Defects" found | Total Number of "Major Defects" Found | computed | `visual.total[major]` |  |
| Page 3 > Visual Inspection > Major Defects (AQL 2.5) | Disposition - Visual Major (Passed / Failed) | Disposition - Visual Major (Passed / Failed) | computed | `visual.result[major]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Minor Defects (AQL 4.0) | Minor Defects (AQL {aql}) | heading | caption `visual.minorHeading`<br>config `visual.classes[minor]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Glove Size |  | size | template `sizes` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | No. of sample inspected | No. of Sample Inspected | number | `visual.inspected[minor]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Defect Limit | Defect Limit | computed | caption `visual.defectLimit`<br>`visual.accept[minor]`<br>`visual.reject[minor]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Minor Defects | Minor Defects | label | `visual.counts[minor]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Small dirt / stain | Small Dirt / Stain | number | `visual.counts[minor][dirt_small]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Sticky pleats (&lt; 5mm) | Sticky Pleats (&lt; 5mm) | number | `visual.counts[minor][sticky_pleats]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Lumps (&lt;2mm) | Lumps (&lt;2mm) | number | `visual.counts[minor][lump_small]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Poor beading | Poor Beading | number | `visual.counts[minor][bead_poor]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Rolled bead | Rolled Bead | number | `visual.counts[minor][bead_rolled]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Defective beads | Defective Beads | number | `visual.counts[minor][bead_defective]` | Minor here; 'Defective bead' is major: same code, severity per class. |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Total number of "Minor Defects" found | Total Number of "Minor Defects" Found | computed | `visual.total[minor]` |  |
| Page 3 > Visual Inspection > Minor Defects (AQL 4.0) | Disposition - Visual Minor (Passed / Failed) | Disposition - Visual Minor (Passed / Failed) | computed | `visual.result[minor]` |  |
| Page 4 > Glove Packing Check | Glove Packing Check (Sampling code letter D & E) : min. 70% layering & 80% dispensing | Glove Packing Check (Sampling Code Letter {codeLetters}) : Min. {minLayeringPct}% Layering & {minDispensingPct}% Dispensing | heading | caption `dispensing_packing.heading`<br>title `dispensing_packing`<br>`dispensing_packing.codeLetter`<br>config `dispensing_packing.minLayeringPct`<br>config `dispensing_packing.minDispensingPct` |  |
| Page 4 > Glove Packing Check | &lt;size> |  | size | template `sizes` | One block per size, headed by the size. |
| Page 4 > Glove Packing Check | Item | Item | fixed | caption `dispensing_packing.itemColumn`<br>config `dispensing_packing.boxesPerSize` | Rows 1 to 13 (1 to 5 in the XL block). |
| Page 4 > Glove Packing Check | Box # | Box/Carton # | number | `dispensing_packing.boxNo` | Box/Carton # in the app: one of the size's sampled carton numbers, typed with them suggested; one not sampled is a warning (rule 7). |
| Page 4 > Glove Packing Check | Layering % | Layering % | number | `dispensing_packing.layeringPct` |  |
| Page 4 > Glove Packing Check | Dispensing % | Dispensing % | number | `dispensing_packing.dispensingPct` |  |
| Page 4 > Glove Packing Check | Stickiness \*\* | Stickiness \*\* | select | `dispensing_packing.stickiness` |  |
| Page 4 > Glove Packing Check | Average | Average | computed | `dispensing_packing.layeringAverage`<br>`dispensing_packing.dispensingAverage`<br>`dispensing_packing.stickinessSummary` | One per column; the stickiness column prints a code. |
| Page 4 > Glove Packing Check | Passed / Failed | Passed / Failed | computed | `dispensing_packing.layeringResult`<br>`dispensing_packing.dispensingResult`<br>`dispensing_packing.stickinessResult` | One per column. |
| Page 4 > Glove Packing Check | \*\*Glove stickiness Code | \*\*Glove Stickiness Code | label | caption `dispensing_packing.stickinessLegend`<br>config `dispensing_packing.stickinessCodes` |  |
| Page 4 > Glove Packing Check | A = Non sticky (Passed) | A = Non sticky (Passed) | fixed | config `dispensing_packing.stickinessCodes[A]` |  |
| Page 4 > Glove Packing Check | B = A mix of non sticky to lightly sticky (Passed) | B = A mix of non sticky to lightly sticky (Passed) | fixed | config `dispensing_packing.stickinessCodes[B]` |  |
| Page 4 > Glove Packing Check | B1 = A mix of non sticky to light sickiness at the bead (Passed) | B1 = A mix of non sticky to light stickiness at the bead (Passed) | fixed | config `dispensing_packing.stickinessCodes[B1]` |  |
| Page 4 > Glove Packing Check | C = Lightly sticky but dispensable (Passed) | C = Lightly sticky but dispensable (Passed) | fixed | config `dispensing_packing.stickinessCodes[C]` |  |
| Page 4 > Glove Packing Check | D = Too sticky & affect dispensing (Failed) | D = Too sticky & affect dispensing (Failed) | fixed | config `dispensing_packing.stickinessCodes[D]` |  |
| Page 4 > Packaging Labeling Inspection | Packaging Labeling Inspection | Packaging Labeling Inspection | heading | title `labeling` |  |
| Page 4 > Packaging Labeling Inspection > Dispenser Box | Dispenser Box | Dispenser Box | heading | caption `labeling.innerLevel`<br>config `labeling.levels[inner]` |  |
| Page 4 > Packaging Labeling Inspection > Dispenser Box | No. of sampled boxes inspected | No. of Sampled Boxes Inspected | number | `labeling.inspected[inner]`<br>config `labeling.levels[inner]` | 3 per size. |
| Page 4 > Packaging Labeling Inspection > Dispenser Box | Defect Limit | Defect Limit | computed | caption `labeling.defectLimit`<br>`labeling.accept[inner]`<br>`labeling.reject[inner]` | Accept 0 / Reject 1. |
| Page 4 > Packaging Labeling Inspection > Dispenser Box | Wrong / No lot number | Wrong / No Lot Number | number | `labeling.defects[inner][lot_no]` |  |
| Page 4 > Packaging Labeling Inspection > Dispenser Box | Wrong / No mfg. date | Wrong / No Mfg. Date | number | `labeling.defects[inner][mfg_date]` |  |
| Page 4 > Packaging Labeling Inspection > Dispenser Box | Wrong artwork print | Wrong Artwork Print | number | `labeling.defects[inner][artwork]` |  |
| Page 4 > Packaging Labeling Inspection > Dispenser Box | Total number of defects found | Total Number of Defects Found | computed | `labeling.total[inner]` |  |
| Page 4 > Packaging Labeling Inspection > Dispenser Box | Disposition - Inner Box (Passed / Failed) | Disposition - Inner Box (Passed / Failed) | computed | `labeling.result[inner]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Box | Carton Box | Carton Box | heading | caption `labeling.cartonLevel`<br>config `labeling.levels[carton]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Box | No. of sampled boxes inspected | No. of Sampled Boxes Inspected | number | `labeling.inspected[carton]`<br>config `labeling.levels[carton]` | 1 per size. |
| Page 4 > Packaging Labeling Inspection > Carton Box | Defect Limit | Defect Limit | computed | caption `labeling.defectLimit`<br>`labeling.accept[carton]`<br>`labeling.reject[carton]` | Accept 0 / Reject 1. |
| Page 4 > Packaging Labeling Inspection > Carton Box | Wrong / No lot number | Wrong / No Lot Number | number | `labeling.defects[carton][lot_no]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Box | Wrong / No mfg. date | Wrong / No Mfg. Date | number | `labeling.defects[carton][mfg_date]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Box | Wrong artwork print | Wrong Artwork Print | number | `labeling.defects[carton][artwork]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Box | No carton number printed | No Box/Carton # Printed | number | `labeling.defects[carton][carton_no]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Box | Total number of defects found | Total Number of Defects Found | computed | `labeling.total[carton]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Box | Disposition - Inner Box (Passed / Failed) | Disposition - Carton Box (Passed / Failed) | computed | `labeling.result[carton]` | Mislabelled on the report: the carton line reads Inner Box. |
| Page 4 > Conclusion | Conclusion | Conclusion | select | `conclusion.finalResult`<br>caption `conclusion.pass`<br>caption `conclusion.fail` | PASSED / FAILED. |
| Page 4 > Conclusion | (signature) | Signature | signature | `conclusion.signature` | Signature image beside the conclusion, no label. |
| Page 4 > Conclusion | Date | Date | date | `conclusion.date` | The report date. |
| Page 4 > Conclusion | Remark | Remark | text | `conclusion.remark` |  |

#### `reports/SAFEDON_EG.md`: 158 fields

| Section | Label (verbatim) | App wording | Input | Maps to | Notes |
|---|---|---|---|---|---|
| All pages | Page &lt;n> of 4 |  | page | layout: Page number: Steri-AI's report numbers its own pages. |  |
| All pages | Preshipment Report (PO# &lt;PO>: &lt;product>) |  | page | layout: Running header of pages 2 to 4, 'Preshipment Report (PO# &lt;PO>: &lt;product>)': Steri-AI's report draws it from header.poNo and header.productName. | BUILD_SPEC 4.3's report settings hold the title and the client logo only. |
| Page 1 > Title | Preshipment Inspection |  | heading | template `report.titleLines` |  |
| Page 1 > Title | Safedon Nitrile PF Exam Gloves |  | heading | template `report.titleLines` |  |
| Page 1 > Title | (client logo) |  | image | template `report.showClientLogo` | Top left: the logo (clients.logo_path) of the inspection's client, in place of a Client Name row. The client is picked on /inspections/new and kept in inspections.client_id; the header's Client Name row is off. |
| Page 1 > Manufacturer Information | Manufacturer Information | Manufacturer Information | heading | title `header` |  |
| Page 1 > Manufacturer Information | Manufacturer / Supplier | Manufacturer / Supplier | text | `header.manufacturer` |  |
| Page 1 > Manufacturer Information | Supplier Factory Address / Location | Supplier Factory Address / Location | text | `header.factoryAddress` |  |
| Page 1 > Manufacturer Information | PO Number | PO Number | text | `header.poNo` | The PO with the client's reference in brackets: one value. |
| Page 1 > Manufacturer Information | Product Name (Brand & code) | Product Name (Brand & Code) | text | `header.productName` |  |
| Page 1 > Manufacturer Information | Inspection date | Inspection Date | date | `header.inspectionDate` |  |
| Page 1 > Manufacturer Information | Manufacturing date | Manufacturing Date | date | `header.mfgDate`<br>config `header.mfgExpiryPrecision` | Printed as month and year. |
| Page 1 > Manufacturer Information | Expiry date | Expiry Date | date | `header.expiryDate`<br>config `header.mfgExpiryPrecision` | Printed as month and year. |
| Page 1 > Manufacturer Information | Inspected by | Inspected By | text | `header.inspector` | The app records the logged-in inspector (rule 11). |
| Page 1 > Glove Information | Glove Information | Glove Information | heading | title `glove_info` |  |
| Page 1 > Glove Information | Glove surface texture | Glove Surface Texture | text | `glove_info.surfaceTexture` |  |
| Page 1 > Glove Information | Indicative weight (size M) | Indicative Weight (Size M) | number | `glove_info.indicativeWeight`<br>config `glove_info.indicativeWeightSize` | Grams. |
| Page 1 > Glove Information | Glove colour | Glove Colour | text | `glove_info.colour` |  |
| Page 1 > Glove Information | Glove length | Glove Length | text | `glove_info.length` |  |
| Page 1 > Order table | Size |  | size | template `sizes` | Rows XS, S, M, L, XL. |
| Page 1 > Order table | Qty (cases) | Qty (Cases) | number | `order_lots.qtyCases` |  |
| Page 1 > Order table | Lot Number | Lot Number | text | `order_lots.lotNumbers` |  |
| Page 1 > Order table | Packing Site | Packing Site | text | `order_lots.packingSite`<br>config `order_lots.fields` | The site that packed the size's lot. |
| Page 1 > Order table | Total # carton | Total # Carton | computed | `order_lots.totalCartons` |  |
| Page 1 > Order table | Total # gloves | Total # Gloves | computed | `order_lots.totalGloves` |  |
| Page 1 > Packing configuration | Packing configuration | Packing Configuration | label | title `packing_config` |  |
| Page 1 > Packing configuration | # glove per plastic pack | # Glove per Plastic Pack | number | `packing_config.glovesPerInner`<br>config `packing_config.innerUnit` | Names the inner unit: plastic pack. |
| Page 1 > Packing configuration | # packs per case | # Packs per Case | number | `packing_config.innersPerCase` |  |
| Page 1 > Packing configuration | # gloves per case | # Gloves per Case | number | `packing_config.glovesPerCase` |  |
| Page 1 > Sampling Plan | Sampling Plan | Sampling Plan | heading | title `sampling_plan` |  |
| Page 1 > Sampling Plan | Glove Size |  | size | template `sizes` |  |
| Page 1 > Sampling Plan | Order Qty (case) | Order Qty (Case) | repeat | caption `sampling_plan.orderQty`<br>`order_lots.qtyCases` | The order quantity again: entered once, in the order table. |
| Page 1 > Sampling Plan | Sampling Quantity | Sampling Quantity | label | caption `sampling_plan.samplingQuantity` |  |
| Page 1 > Sampling Plan | Case | Case | number | `sampling_plan.cases` |  |
| Page 1 > Sampling Plan | Inner pack | Inner Pack | number | `sampling_plan.innerUnits` |  |
| Page 1 > Sampling Plan | Gloves | Gloves | number | `sampling_plan.gloves` |  |
| Page 1 > Sampling Plan | # gloves for watertight & Visual | # Gloves for Watertight & Visual | number | `sampling_plan.glovesWatertightVisual` |  |
| Page 1 > Sampling Plan | # gloves for dimension | # Gloves for Dimension | number | `sampling_plan.glovesDimensions` |  |
| Page 1 > Sampling Plan | # gloves for Tensile | # Gloves for Tensile | number | `sampling_plan.glovesPhysical` |  |
| Page 1 > Sampling Plan | # inner packs for packaing & dispensing inspection | # Inner Packs for Packaging & Dispensing Inspection | number | `sampling_plan.innerUnitsDispensing` |  |
| Page 1 > Finished Goods Sampling Information (carton number) | Finished Goods Sampling Information (carton number) | Finished Goods Sampling Information (Box/Carton #) | heading | title `carton_sampling` |  |
| Page 1 > Finished Goods Sampling Information (carton number) | (Carton #) | (Box/Carton #) | number | `carton_sampling.cartonNumbers`<br>caption `carton_sampling.sizeCaption` | Same grid as STD_EG: 10 columns × 5 rows per size. |
| Page 1 > Finished Goods Sampling Information (carton number) | Sampling Quantity | Sampling Quantity | number | `carton_sampling.samplingQuantity` | The app counts the box/carton numbers (rule 6). |
| Page 2 > Dimension - Size &lt;size> | Dimension - Size &lt;size> | Dimension - Size {size} | heading | caption `dimensions.sizeHeading`<br>title `dimensions` | One table per ordered size. |
| Page 2 > Dimension - Size &lt;size> | No. | No. | fixed | caption `dimensions.rowNo`<br>config `dimensions.rows` | Rows 1 to 13. |
| Page 2 > Dimension - Size &lt;size> | Length | Length | number | `dimensions.length` |  |
| Page 2 > Dimension - Size &lt;size> | Width | Width | number | `dimensions.width` |  |
| Page 2 > Dimension - Size &lt;size> | Finger Thickness | Finger Thickness | number | `dimensions.fingerThickness` |  |
| Page 2 > Dimension - Size &lt;size> | Palm Thickness | Palm Thickness | number | `dimensions.palmThickness` |  |
| Page 2 > Dimension - Size &lt;size> | Weight (g) | Weight (g) | number | `weight.values`<br>config `weight.n`<br>title `weight` | One value per size in a merged cell (weight, n = 1), printed as a column of the dimension table. |
| Page 2 > Dimension - Size &lt;size> | Average | Average | computed | `dimensions.statistic`<br>config `dimensions.statistic`<br>config `dimensions.decimals` |  |
| Page 2 > Dimension - Size &lt;size> | Spec. | Spec. | fixed | caption `dimensions.specRow`<br>config `dimensions.specs`<br>config `weight.specs` | Length ≥ 230; Width XS 76 ± 4, S 86 ± 4, M 98 ± 4, L 107 ± 4; Finger 0.18 ± 0.04; Palm 0.14 ± 0.04; Weight NA. |
| Page 2 > Dimension - Size &lt;size> | A / Rej. | A / Rej. | computed | `dimensions.measureResult`<br>`weight.result`<br>caption `dimensions.pass`<br>caption `dimensions.fail` | A = accepted. The weight column prints A against its NA spec. |
| Page 2 > Physical Properties | Physical Properties average (Refer to attached lab. reports) | Physical Properties Average (Refer to Attached Lab. Reports) | heading | title `tensile`<br>`tensile.labReport` | 'Refer to attached lab. reports': uploaded as files. |
| Page 2 > Physical Properties > Tensile Strength | Size |  | size | template `sizes` |  |
| Page 2 > Physical Properties > Tensile Strength | Tensile Strength (Average) (MPa) | Tensile Strength (Average) (MPa) | number | `tensile.tensileStrength` |  |
| Page 2 > Physical Properties > Tensile Strength | Spec. (ASTM D6319) | Spec. ({standardLabel}) | fixed | caption `tensile.specRow`<br>config `tensile.tensileMin`<br>config `tensile.standardLabel` | ≥ 14.00 MPa. |
| Page 2 > Physical Properties > Tensile Strength | Passed / Failed | Passed / Failed | computed | `tensile.tensileResult` |  |
| Page 2 > Physical Properties > Elongation at break | Size |  | size | template `sizes` |  |
| Page 2 > Physical Properties > Elongation at break | Elongation at break, average (%) | Elongation at Break, Average (%) | number | `tensile.elongationAtBreak` |  |
| Page 2 > Physical Properties > Elongation at break | Spec. (ASTM D6319) | Spec. ({standardLabel}) | fixed | caption `tensile.specRow`<br>config `tensile.elongationMin`<br>config `tensile.decimals` | ≥ 500%. |
| Page 2 > Physical Properties > Elongation at break | Passed / Failed | Passed / Failed | computed | `tensile.elongationResult` |  |
| Page 3 > Glove Dispensing Inspection | Glove Dispensing Inspection (Sampling code letter C & D) | Glove Dispensing Inspection (Sampling Code Letter {codeLetters}) | heading | caption `dispensing_safedon.heading`<br>title `dispensing_safedon`<br>`dispensing_safedon.codeLetter` |  |
| Page 3 > Glove Dispensing Inspection | Size |  | size | template `sizes` | Two sizes share a block row, the 13 box columns split between them; the app shows one block per size. |
| Page 3 > Glove Dispensing Inspection | Box # | Box/Carton # | number | `dispensing_safedon.boxNo`<br>config `dispensing_safedon.boxesPerSize` | Box/Carton # in the app: one of the size's sampled carton numbers, typed with them suggested; one not sampled is a warning (rule 7). |
| Page 3 > Glove Dispensing Inspection | Safedon Packing Defects | Safedon Packing Defects | label | `dispensing_safedon.counts`<br>config `dispensing_safedon.defects` |  |
| Page 3 > Glove Dispensing Inspection | No cuff | No Cuff | number | `dispensing_safedon.counts[no_cuff]` | A count per box. |
| Page 3 > Glove Dispensing Inspection | Cuff should ideallly be at least 2 cm out | Cuff should ideally be at least 2 cm out | fixed | config `dispensing_safedon.defects[no_cuff]` | Definition of 'No cuff', printed beside the row; the app shows its own wording as the hint. |
| Page 3 > Glove Dispensing Inspection | Finger out | Finger Out | number | `dispensing_safedon.counts[finger_out]` | A count per box. |
| Page 3 > Glove Dispensing Inspection | Only cuff but no finger should be out first | Only the cuff, not a finger, should come out first | fixed | config `dispensing_safedon.defects[finger_out]` | Definition of 'Finger out', printed beside the row; the app shows its own wording as the hint. |
| Page 3 > Glove Dispensing Inspection | Multiple gloves out | Multiple Gloves Out | number | `dispensing_safedon.counts[multiple_out]` | A count per box. |
| Page 3 > Glove Dispensing Inspection | Only one glove should be out at one time | Only one glove should come out at a time | fixed | config `dispensing_safedon.defects[multiple_out]` | Definition of 'Multiple gloves out', printed beside the row; the app shows its own wording as the hint. |
| Page 3 > Glove Dispensing Inspection | Glove stuck | Glove Stuck | number | `dispensing_safedon.counts[stuck]` | A count per box. |
| Page 3 > Glove Dispensing Inspection | Glove ould not be dispensed or very difficult to dispense | Glove could not be dispensed or was very difficult to dispense | fixed | config `dispensing_safedon.defects[stuck]` | Definition of 'Glove stuck', printed beside the row; the app shows its own wording as the hint. |
| Page 3 > Glove Dispensing Inspection | Sticky glove | Sticky Glove | number | `dispensing_safedon.counts[sticky]` | A count per box. |
| Page 3 > Glove Dispensing Inspection | Two or more gloves out at the same time caused by gloves sticking together | Two or more gloves out at once because they stick together | fixed | config `dispensing_safedon.defects[sticky]` | Definition of 'Sticky glove', printed beside the row; the app shows its own wording as the hint. |
| Page 3 > Glove Dispensing Inspection | Faulty cuff | Faulty Cuff | number | `dispensing_safedon.counts[faulty_cuff]` | A count per box. |
| Page 3 > Glove Dispensing Inspection | Deformed or out of shaped cuff which causes dispensing problem | Deformed or misshapen cuff causing a dispensing problem | fixed | config `dispensing_safedon.defects[faulty_cuff]` | Definition of 'Faulty cuff', printed beside the row; the app shows its own wording as the hint. |
| Page 3 > Glove Dispensing Inspection | Total | Total | computed | caption `dispensing_safedon.totalGroup`<br>`dispensing_safedon.boxDefects`<br>`dispensing_safedon.boxRatePct`<br>`dispensing_safedon.totalDefects`<br>`dispensing_safedon.glovesInspected`<br>`dispensing_safedon.ratePct`<br>config `dispensing_safedon.glovesPerPack` | Three lines: per box &lt;defects>/&lt;gloves per pack>; per box the rate as a percentage with one decimal (e.g. 0.8%); per size &lt;defects> / &lt;gloves> (&lt;rate> %). |
| Page 3 > Glove Dispensing Inspection | Specification / Requirement | Specification / Requirement | fixed | caption `dispensing_safedon.specRow`<br>config `dispensing_safedon.maxRatePct` | ≤ 5% per size. |
| Page 3 > Glove Dispensing Inspection | Conclusion | Conclusion | computed | `dispensing_safedon.result` | Passed / Failed per size. |
| Page 4 > Freedom from Holes by watertight test | Freedom from Holes by watertight test (Sampling code letter J & L; AQL=1.5) | Freedom From Holes by Watertight Test (Sampling Code Letter {codeLetters}; AQL={aql}) | heading | caption `watertight.heading`<br>title `watertight`<br>`watertight.codeLetter`<br>config `watertight.aql` |  |
| Page 4 > Freedom from Holes by watertight test | Glove Size |  | size | template `sizes` |  |
| Page 4 > Freedom from Holes by watertight test | No. of sample tested | No. of Sample Tested | number | `watertight.tested` |  |
| Page 4 > Freedom from Holes by watertight test | Defect Limit | Defect Limit | computed | caption `watertight.defectLimit`<br>`watertight.accept`<br>`watertight.reject` | Accept / Reject per size. |
| Page 4 > Freedom from Holes by watertight test | Holes | Holes | label | `watertight.holes`<br>config `watertight.locations` |  |
| Page 4 > Freedom from Holes by watertight test | Between fingers | Between Fingers | number | `watertight.holes[hole_crotch]` |  |
| Page 4 > Freedom from Holes by watertight test | Palm | Palm | number | `watertight.holes[hole_palm]` |  |
| Page 4 > Freedom from Holes by watertight test | Cuff | Cuff | number | `watertight.holes[hole_cuff]` |  |
| Page 4 > Freedom from Holes by watertight test | Finger | Finger | number | `watertight.holes[hole_finger]` |  |
| Page 4 > Freedom from Holes by watertight test | Glove burst | Glove Burst | number | `watertight.holes[glove_burst]` |  |
| Page 4 > Freedom from Holes by watertight test | Other : | Other : | number | `watertight.holes[hole_other]`<br>`watertight.otherDescription` | The colon takes the location: watertight.otherDescription. |
| Page 4 > Freedom from Holes by watertight test | Total number of defects found | Total Number of Defects Found | computed | `watertight.totalDefects` | Printed as &lt;defects> / &lt;tested>. |
| Page 4 > Freedom from Holes by watertight test | Freedom from holes (Passed / Failed) | Freedom From Holes (Passed / Failed) | computed | `watertight.result` |  |
| Page 4 > Visual Inspection | Visual Inspection (Sampling code letter J & L) | Visual Inspection (Sampling Code Letter {codeLetters}) | heading | caption `visual.heading`<br>title `visual`<br>`visual.codeLetter` |  |
| Page 4 > Visual Inspection > Critical Defects (AQL 0.0) | Critical Defects (AQL 0.0) | Critical Defects (AQL {aql}) | heading | caption `visual.criticalHeading`<br>config `visual.classes[critical]` |  |
| Page 4 > Visual Inspection > Critical Defects (AQL 0.0) | Glove Size |  | size | template `sizes` |  |
| Page 4 > Visual Inspection > Critical Defects (AQL 0.0) | No. of sample inspected | No. of Sample Inspected | number | `visual.inspected[critical]` |  |
| Page 4 > Visual Inspection > Critical Defects (AQL 0.0) | Defect Limit | Defect Limit | computed | caption `visual.criticalLimit`<br>`visual.accept[critical]`<br>`visual.reject[critical]` | Accept 0 / Reject 1. |
| Page 4 > Visual Inspection > Critical Defects (AQL 0.0) | Critical Defects | Critical Defects | label | `visual.counts[critical]` |  |
| Page 4 > Visual Inspection > Critical Defects (AQL 0.0) | Embeded Insects | Embedded Insects | number | `visual.counts[critical][embedded_insect]` |  |
| Page 4 > Visual Inspection > Critical Defects (AQL 0.0) | Embeded metal debris | Embedded Metal Debris | number | `visual.counts[critical][embedded_metal]` |  |
| Page 4 > Visual Inspection > Critical Defects (AQL 0.0) | Total number of "Critical Defects" found | Total Number of "Critical Defects" Found | computed | `visual.total[critical]` |  |
| Page 4 > Visual Inspection > Critical Defects (AQL 0.0) | Disposition - Visual Minor (Passed / Failed) | Disposition - Visual Critical (Passed / Failed) | computed | `visual.result[critical]` | Mislabelled on the report: the app labels the critical line Critical. |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Major Defects (AQL 2.5) | Major Defects (AQL {aql}) | heading | caption `visual.majorHeading`<br>config `visual.classes[major]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Glove Size |  | size | template `sizes` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | No. of sample inspected | No. of Sample Inspected | number | `visual.inspected[major]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Defect Limit | Defect Limit | computed | caption `visual.defectLimit`<br>`visual.accept[major]`<br>`visual.reject[major]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Major Defects | Major Defects | label | `visual.counts[major]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Thin ring between fingers (crotch) | Thin Ring Between Fingers (Crotch) | number | `visual.counts[major][thin_crotch_ring]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Thin area between fingers (crotch) | Thin Area Between Fingers (Crotch) | number | `visual.counts[major][thin_crotch_area]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Thin batch / area (body) | Thin Patch / Area (Body) | number | `visual.counts[major][thin_body_area]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Thin spot | Thin Spot | number | `visual.counts[major][thin_spot]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Non-removable dirt | Non-Removable Dirt | number | `visual.counts[major][dirt_nonremovable]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Stain | Stain | number | `visual.counts[major][stain]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Powder mark | Powder Mark | number | `visual.counts[major][powder_mark]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Bead blister | Bead Blister | number | `visual.counts[major][bead_blister]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Total number of "Major Defects" found | Total Number of "Major Defects" Found | computed | `visual.total[major]` |  |
| Page 4 > Visual Inspection > Major Defects (AQL 2.5) | Disposition - Visual Major (Passed / Failed) | Disposition - Visual Major (Passed / Failed) | computed | `visual.result[major]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Minor Defects (AQL 4.0) | Minor Defects (AQL {aql}) | heading | caption `visual.minorHeading`<br>config `visual.classes[minor]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Glove Size |  | size | template `sizes` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | No. of sample inspected | No. of Sample Inspected | number | `visual.inspected[minor]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Defect Limit | Defect Limit | computed | caption `visual.defectLimit`<br>`visual.accept[minor]`<br>`visual.reject[minor]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Minor Defects | Minor Defects | label | `visual.counts[minor]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Small dirt / stain | Small Dirt / Stain | number | `visual.counts[minor][dirt_small]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Sticky pleats (&lt; 5mm) | Sticky Pleats (&lt; 5mm) | number | `visual.counts[minor][sticky_pleats]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Lumps (&lt;2mm) | Lumps (&lt;2mm) | number | `visual.counts[minor][lump_small]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Thin bead | Thin Bead | number | `visual.counts[minor][bead_thin]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Thin bead / small beading defect | Thin Bead / Small Beading Defect | number | `visual.counts[minor][bead_small_defect]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Total number of "Minor Defects" found | Total Number of "Minor Defects" Found | computed | `visual.total[minor]` |  |
| Page 4 > Visual Inspection > Minor Defects (AQL 4.0) | Disposition - Visual Minor (Passed / Failed) | Disposition - Visual Minor (Passed / Failed) | computed | `visual.result[minor]` |  |
| Page 4 > Packaging Labeling Inspection | Packaging Labeling Inspection | Packaging Labeling Inspection | heading | title `labeling` |  |
| Page 4 > Packaging Labeling Inspection > Inner Boxes/Packs | Inner Boxes/Packs | Inner Boxes/Packs | heading | caption `labeling.innerLevel`<br>config `labeling.levels[inner]` |  |
| Page 4 > Packaging Labeling Inspection > Inner Boxes/Packs | Glove Size |  | size | template `sizes` |  |
| Page 4 > Packaging Labeling Inspection > Inner Boxes/Packs | No. of sampled boxes inspected | No. of Sampled Boxes Inspected | number | `labeling.inspected[inner]`<br>config `labeling.levels[inner]` | 3 per size. |
| Page 4 > Packaging Labeling Inspection > Inner Boxes/Packs | Limit : Accept / Reject | Limit : Accept / Reject | computed | caption `labeling.defectLimit`<br>`labeling.accept[inner]`<br>`labeling.reject[inner]` | Acc. = 0 / Rej. = 1. |
| Page 4 > Packaging Labeling Inspection > Inner Boxes/Packs | Wrong / No lot number | Wrong / No Lot Number | number | `labeling.defects[inner][lot_no]` |  |
| Page 4 > Packaging Labeling Inspection > Inner Boxes/Packs | Wrong / No mfg. date | Wrong / No Mfg. Date | number | `labeling.defects[inner][mfg_date]` |  |
| Page 4 > Packaging Labeling Inspection > Inner Boxes/Packs | Wrong / No expiry date | Wrong / No Expiry Date | number | `labeling.defects[inner][expiry_date]` |  |
| Page 4 > Packaging Labeling Inspection > Inner Boxes/Packs | Wrong artwork print | Wrong Artwork Print | number | `labeling.defects[inner][artwork]` |  |
| Page 4 > Packaging Labeling Inspection > Inner Boxes/Packs | Total number of defects found | Total Number of Defects Found | computed | `labeling.total[inner]` |  |
| Page 4 > Packaging Labeling Inspection > Inner Boxes/Packs | Disposition - Inner Box (Passed / Failed) | Disposition - Inner Box (Passed / Failed) | computed | `labeling.result[inner]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | Carton Boxes | Carton Boxes | heading | caption `labeling.cartonLevel`<br>config `labeling.levels[carton]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | Glove Size |  | size | template `sizes` |  |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | No. of sampled boxes inspected | No. of Sampled Boxes Inspected | number | `labeling.inspected[carton]`<br>config `labeling.levels[carton]` | 1 per size. |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | Limit : Accept / Reject | Limit : Accept / Reject | computed | caption `labeling.defectLimit`<br>`labeling.accept[carton]`<br>`labeling.reject[carton]` | Acc. = 0 / Rej. = 1. |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | Wrong / No lot number | Wrong / No Lot Number | number | `labeling.defects[carton][lot_no]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | Wrong / No mfg. date | Wrong / No Mfg. Date | number | `labeling.defects[carton][mfg_date]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | Wrong / No expiry date | Wrong / No Expiry Date | number | `labeling.defects[carton][expiry_date]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | Wrong artwork print | Wrong Artwork Print | number | `labeling.defects[carton][artwork]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | No carton number | No Box/Carton # | number | `labeling.defects[carton][carton_no]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | Total number of defects found | Total Number of Defects Found | computed | `labeling.total[carton]` |  |
| Page 4 > Packaging Labeling Inspection > Carton Boxes | Disposition - Carton Box (Passed / Failed) | Disposition - Carton Box (Passed / Failed) | computed | `labeling.result[carton]` |  |
| Page 4 > Conclusion | Conclusion | Conclusion | select | `conclusion.finalResult`<br>caption `conclusion.pass`<br>caption `conclusion.fail` | PASSED / FAILED. |
| Page 4 > Conclusion | Inspected by | Inspected By | text | `conclusion.inspector` | The logged-in inspector. |
| Page 4 > Conclusion | Date | Date | date | `conclusion.date` | The report date. |
| Page 4 > Conclusion | (signature) | Signature | signature | `conclusion.signature` | Signature image beside the conclusion, no label. |
| Page 4 > Conclusion | Remark | Remark | text | `conclusion.remark` |  |

#### `onsite/EG.md`: 43 fields

| Section | Label (verbatim) | App wording | Input | Maps to | Notes |
|---|---|---|---|---|---|
| 1. Purchase Order / Shipment Information | Purchase Order / Shipment Information | Manufacturer Information | heading | title `header` |  |
| 1. Purchase Order / Shipment Information | Manufacturer Name | Manufacturer / Supplier | text | `header.manufacturer` |  |
| 1. Purchase Order / Shipment Information | Purchase/Sales Order No. | PO / SO Number | text | `header.poNo` |  |
| 1. Purchase Order / Shipment Information | Product Name | Product Name (Brand, Code & Description) | text | `header.productName` |  |
| 1. Purchase Order / Shipment Information | Lot Number | Lot Number | text | `order_lots.lotNumbers` | Double-height box for several lots, not split by size; the app records the lots per size. |
| 1. Purchase Order / Shipment Information | Mfg / Exp Date | Manufacturing Date; Expiry Date | text | `header.mfgDate`<br>`header.expiryDate` | One box for both dates; the app splits it into two date pickers (rule 3). |
| 1. Purchase Order / Shipment Information | Glove Type | Glove Type | text | `glove_info.gloveType` | Glove Information's Glove Type, once per inspection, first on its page (a custom module of its own until 11 October 2026). |
| 1. Purchase Order / Shipment Information | Packing Mode | Packing Mode | text | `packing_config.packingMode`<br>config `packing_config.fields` |  |
| 2. Inspected by | Inspected by | Inspected By | heading | `header.inspector` |  |
| 2. Inspected by | Name | Inspected By | text | `header.inspector` | The logged-in inspector, recorded by the app. |
| 2. Inspected by | Date | Inspection Date | date | `header.inspectionDate` | The inspection date. |
| 2. Inspected by | (unlabelled tall box) | Signature | blank | `conclusion.signature`<br>`conclusion.remark` | Likely signature or remarks: the app takes both in the conclusion. |
| 3. PO Info / Sampling Plan | PO Info | Order | label | title `order_lots` |  |
| 3. PO Info / Sampling Plan | Glove Size |  | size | template `sizes` | 5 blank size rows. |
| 3. PO Info / Sampling Plan | Qty (case) | Qty (Cases) | number | `order_lots.qtyCases` |  |
| 3. PO Info / Sampling Plan | Sampling Plan | Sampling Plan | heading | title `sampling_plan` |  |
| 3. PO Info / Sampling Plan | Sampling Quantity | Sampling Quantity | label | caption `sampling_plan.samplingQuantity` |  |
| 3. PO Info / Sampling Plan | Case | Case | number | `sampling_plan.cases` |  |
| 3. PO Info / Sampling Plan | Inner | Inner Box | number | `sampling_plan.innerUnits` |  |
| 3. PO Info / Sampling Plan | Gloves | Gloves | number | `sampling_plan.gloves` |  |
| 3. PO Info / Sampling Plan | # Gloves for WTT & Visual | # Gloves for Watertight & Visual | number | `sampling_plan.glovesWatertightVisual` |  |
| 3. PO Info / Sampling Plan | # Gloves dimension | # Gloves for Dimension | number | `sampling_plan.glovesDimensions` |  |
| 3. PO Info / Sampling Plan | # Gloves for FAB | # Gloves for FAB | number | `sampling_plan.glovesPhysical` |  |
| 3. PO Info / Sampling Plan | # inner for dispensing test | # Inner Box for Packaging & Dispensing Inspection | number | `sampling_plan.innerUnitsDispensing` |  |
| 3. PO Info / Sampling Plan | Total: | Total: | computed | `sampling_plan.totals`<br>`order_lots.totalCartons` | Sums every column except Glove Size. |
| 4. Watertight Inspection | Watertight Inspection | Freedom From Holes by Watertight Test | heading | title `watertight` |  |
| 4. Watertight Inspection | Size |  | size | template `sizes` | 5 size columns, no R/L split. |
| 4. Watertight Inspection | Defect | Pin Hole | handwritten_rows | `watertight.holes`<br>`watertight.unmapped` | 6 blank rows: a handwritten defect name and a count per size. Names in the template's location list count there; others are saved unmapped for an admin. |
| 4. Watertight Inspection | Total: | Total Number of Defects Found | computed | `watertight.totalDefects` | One total per size. |
| 5. Visual Inspection | Visual Inspection | Visual Inspection | heading | title `visual` |  |
| 5. Visual Inspection | Size |  | size | template `sizes` | One shared row of 5 sizes. |
| 5. Visual Inspection | Major defect | Major Defects | handwritten_rows | `visual.counts[major]`<br>`visual.unmapped[major]` | 7 blank rows: defect name and a count per size. |
| 5. Visual Inspection | Total Major | Total Number of "Major Defects" Found | computed | `visual.total[major]` |  |
| 5. Visual Inspection | Minor defect | Minor Defects | handwritten_rows | `visual.counts[minor]`<br>`visual.unmapped[minor]` | 5 blank rows: defect name and a count per size. |
| 5. Visual Inspection | Total Minor | Total Number of "Minor Defects" Found | computed | `visual.total[minor]` |  |
| 6. Dispensing Result | Dispensing Result | Glove Packing Check | heading | title `dispensing_packing` |  |
| 6. Dispensing Result | Size |  | size | template `sizes` | A size per row; the app shows one block per size. |
| 6. Dispensing Result | No. | Item | computed | caption `dispensing_packing.itemColumn`<br>config `dispensing_packing.boxesPerSize` | Running row number, automatic. 51 blank rows, one per box tested. |
| 6. Dispensing Result | Box Number | Box/Carton # | text | `dispensing_packing.boxNo` | Box/Carton # in the app: one of the size's sampled carton numbers, typed with them suggested; one not sampled is a warning (rule 7). |
| 6. Dispensing Result | Layering (%) | Layering % | number | `dispensing_packing.layeringPct` |  |
| 6. Dispensing Result | Dispensing (%) | Dispensing % | number | `dispensing_packing.dispensingPct` |  |
| 6. Dispensing Result | Stickiness | Stickiness \*\* | text | `dispensing_packing.stickiness`<br>config `dispensing_packing.stickinessCodes` | onsite/EG.md suggests none / slight / severe plus a note; the report's codes A, B, B1, C, D apply (report first, rule 4.2.1). |
| 6. Dispensing Result | Others: | Others: | text | `dispensing_packing.note` |  |

#### `onsite/SG.md`: 42 fields

| Section | Label (verbatim) | App wording | Input | Maps to | Notes |
|---|---|---|---|---|---|
| 1. Purchase Order / Shipment Information | Purchase Order / Shipment Information | Purchase Order / Shipment Information | heading | title `header` |  |
| 1. Purchase Order / Shipment Information | Manufacturer Name | Manufacturer Name | text | `header.manufacturer` |  |
| 1. Purchase Order / Shipment Information | Purchase/Sales Order No. | Purchase/Sales Order No. | text | `header.poNo` |  |
| 1. Purchase Order / Shipment Information | Product Name | Product Name | text | `header.productName` |  |
| 1. Purchase Order / Shipment Information | Lot Number | Lot Number | text | `order_lots.lotNumbers` | Double-height box for several lots, not split by size; the app records the lots per size. |
| 1. Purchase Order / Shipment Information | Mfg / Exp Date | Mfg Date; Exp Date | text | `header.mfgDate`<br>`header.expiryDate` | One box for both dates; the app splits it into two date pickers (rule 3). |
| 1. Purchase Order / Shipment Information | Glove Type | Glove Type | text | custom `glove_type.gloveType` | No Glove Information on this template: custom module glove_type. |
| 1. Purchase Order / Shipment Information | Packing Mode | Packing Mode | text | `packing_config.packingMode`<br>config `packing_config.fields` |  |
| 2. Inspected by | Inspected by | Inspected By | heading | `header.inspector` |  |
| 2. Inspected by | Name | Inspected By | text | `header.inspector` | The logged-in inspector, recorded by the app. |
| 2. Inspected by | Date | Date | date | `header.inspectionDate` | The inspection date. |
| 2. Inspected by | (unlabelled tall box) | Signature | blank | `conclusion.signature`<br>`conclusion.remark` | Likely signature or remarks: the app takes both in the conclusion. |
| 3. PO Info / Sampling Plan | PO Info | PO Info | label | title `order_lots` |  |
| 3. PO Info / Sampling Plan | Glove Size |  | size | template `sizes` | 8 blank size rows. |
| 3. PO Info / Sampling Plan | Qty (case) | Qty (Case) | number | `order_lots.qtyCases` |  |
| 3. PO Info / Sampling Plan | Sampling Plan | Sampling Plan | heading | title `sampling_plan` |  |
| 3. PO Info / Sampling Plan | Sampling Quantity (WTT & Visual) | Sampling Quantity (WTT & Visual) | label | caption `sampling_plan.samplingQuantity` | Unlike EG, the watertight and visual sample is inside Sampling Quantity. |
| 3. PO Info / Sampling Plan | Case | Case | number | `sampling_plan.cases` |  |
| 3. PO Info / Sampling Plan | Inner Box | Inner Box | number | `sampling_plan.innerUnits` |  |
| 3. PO Info / Sampling Plan | Pouches | Pouches | number | `sampling_plan.pouches` |  |
| 3. PO Info / Sampling Plan | # gloves | # Gloves | number | `sampling_plan.glovesWatertightVisual` | The watertight and visual sample; STD_SG has no separate Gloves column. |
| 3. PO Info / Sampling Plan | # Gloves dimension | # Gloves Dimension | number | `sampling_plan.glovesDimensions` |  |
| 3. PO Info / Sampling Plan | # Gloves (FAB) | # Gloves (FAB) | number | `sampling_plan.glovesPhysical` | Planned only: no FAB results on the form, and BUILD_SPEC 11 has no force_at_break in STD_SG. |
| 3. PO Info / Sampling Plan | # pouches (dye leak test) | # Pouches (Dye Leak Test) | number | `sampling_plan.pouchesDyeLeak` | Planned only on the form; results go to dye_leak. |
| 3. PO Info / Sampling Plan | Total: | Total: | computed | `sampling_plan.totals`<br>`order_lots.totalCartons` | Sums every column except Glove Size. |
| 4. Watertight Inspection | Watertight Inspection | Watertight Inspection | heading | title `watertight` |  |
| 4. Watertight Inspection | Size |  | size | template `sizes` | 8 size columns. |
| 4. Watertight Inspection | R |  | label | config `watertight.handSplit` | Each size column splits into R and L. |
| 4. Watertight Inspection | L |  | label | config `watertight.handSplit` |  |
| 4. Watertight Inspection | Defect | Defect | handwritten_rows | `watertight.holes`<br>`watertight.unmapped` | 7 blank rows: a handwritten defect name and a count per size per hand. |
| 4. Watertight Inspection | Total WTT | Total WTT | computed | `watertight.totalDefects` | One total per size, spanning R and L. |
| 5. Visual Inspection | Visual Inspection | Visual Inspection | heading | title `visual` |  |
| 5. Visual Inspection > Major defect | Size |  | size | template `sizes` | 8 sizes, each split R / L. |
| 5. Visual Inspection > Major defect | R |  | label | config `visual.handSplit` | Each size column splits into R and L. |
| 5. Visual Inspection > Major defect | L |  | label | config `visual.handSplit` |  |
| 5. Visual Inspection > Major defect | Major defect | Major Defect | handwritten_rows | `visual.counts[major]`<br>`visual.unmapped[major]`<br>caption `visual.majorHeading` | 7 blank rows: defect name and a count per size per hand. |
| 5. Visual Inspection > Major defect | Total Major | Total Major | computed | `visual.total[major]` | One total per size, spanning R and L. |
| 5. Visual Inspection > Minor defect | Size |  | size | template `sizes` | 8 sizes, each split R / L. |
| 5. Visual Inspection > Minor defect | R |  | label | config `visual.handSplit` | Each size column splits into R and L. |
| 5. Visual Inspection > Minor defect | L |  | label | config `visual.handSplit` |  |
| 5. Visual Inspection > Minor defect | Minor defect | Minor Defect | handwritten_rows | `visual.counts[minor]`<br>`visual.unmapped[minor]`<br>caption `visual.minorHeading` | 6 blank rows: defect name and a count per size per hand. |
| 5. Visual Inspection > Minor defect | Total Minor | Total Minor | computed | `visual.total[minor]` | One total per size, spanning R and L. |

#### `onsite/SAFEDON_EG.md`: 54 fields

| Section | Label (verbatim) | App wording | Input | Maps to | Notes |
|---|---|---|---|---|---|
| 1. Purchase Order / Shipment Information | Purchase Order / Shipment Information (Safedon) | Manufacturer Information | heading | title `header` |  |
| 1. Purchase Order / Shipment Information | Manufacturer Name | Manufacturer / Supplier | text | `header.manufacturer` |  |
| 1. Purchase Order / Shipment Information | Purchase/Sales Order No. | PO Number | text | `header.poNo` |  |
| 1. Purchase Order / Shipment Information | Product Name | Product Name (Brand & Code) | text | `header.productName` |  |
| 1. Purchase Order / Shipment Information | Lot Number | Lot Number | text | `order_lots.lotNumbers` | Double-height box for several lots, not split by size; the app records the lots per size. |
| 1. Purchase Order / Shipment Information | Mfg / Exp Date | Manufacturing Date; Expiry Date | text | `header.mfgDate`<br>`header.expiryDate` | One box for both dates; the app splits it into two date pickers (rule 3). |
| 1. Purchase Order / Shipment Information | Glove Type | Glove Type | text | `glove_info.gloveType` | Glove Information's Glove Type, once per inspection, first on its page (a custom module of its own until 11 October 2026). |
| 1. Purchase Order / Shipment Information | Packing Mode | Packing Mode | text | `packing_config.packingMode`<br>config `packing_config.fields` |  |
| 2. Inspected by | Inspected by | Inspected By | heading | `header.inspector` |  |
| 2. Inspected by | Name | Inspected By | text | `header.inspector` | The logged-in inspector, recorded by the app. |
| 2. Inspected by | Date | Inspection Date | date | `header.inspectionDate` | The inspection date. |
| 2. Inspected by | (unlabelled tall box) | Signature | blank | `conclusion.signature`<br>`conclusion.remark` | Likely signature or remarks: the app takes both in the conclusion. |
| 3. PO Info / Sampling Plan | PO Info | Order | label | title `order_lots` |  |
| 3. PO Info / Sampling Plan | Glove Size |  | size | template `sizes` | 5 blank size rows. |
| 3. PO Info / Sampling Plan | Qty (case) | Qty (Cases) | number | `order_lots.qtyCases` |  |
| 3. PO Info / Sampling Plan | Sampling Plan | Sampling Plan | heading | title `sampling_plan` |  |
| 3. PO Info / Sampling Plan | Sampling Quantity | Sampling Quantity | label | caption `sampling_plan.samplingQuantity` |  |
| 3. PO Info / Sampling Plan | Case | Case | number | `sampling_plan.cases` |  |
| 3. PO Info / Sampling Plan | Inner | Inner Pack | number | `sampling_plan.innerUnits` |  |
| 3. PO Info / Sampling Plan | Gloves | Gloves | number | `sampling_plan.gloves` |  |
| 3. PO Info / Sampling Plan | # Gloves for WTT & Visual | # Gloves for Watertight & Visual | number | `sampling_plan.glovesWatertightVisual` |  |
| 3. PO Info / Sampling Plan | # Gloves dimension | # Gloves for Dimension | number | `sampling_plan.glovesDimensions` |  |
| 3. PO Info / Sampling Plan | # Gloves for FAB | # Gloves for Tensile | number | `sampling_plan.glovesPhysical` |  |
| 3. PO Info / Sampling Plan | # inner for dispensing test | # Inner Packs for Packaging & Dispensing Inspection | number | `sampling_plan.innerUnitsDispensing` |  |
| 3. PO Info / Sampling Plan | Total: | Total: | computed | `sampling_plan.totals`<br>`order_lots.totalCartons` | Sums every column except Glove Size. |
| 4. Watertight Inspection | Watertight Inspection | Freedom From Holes by Watertight Test | heading | title `watertight` |  |
| 4. Watertight Inspection | Size |  | size | template `sizes` | 5 size columns, no R/L split. |
| 4. Watertight Inspection | Defect | Holes | handwritten_rows | `watertight.holes`<br>`watertight.unmapped` | 6 blank rows: a handwritten defect name and a count per size. Names in the template's location list count there; others are saved unmapped for an admin. |
| 4. Watertight Inspection | Total: | Total Number of Defects Found | computed | `watertight.totalDefects` | One total per size. |
| 5. Visual Inspection | Visual Inspection | Visual Inspection | heading | title `visual` |  |
| 5. Visual Inspection | Size |  | size | template `sizes` | One shared row of 5 sizes. |
| 5. Visual Inspection | Major defect | Major Defects | handwritten_rows | `visual.counts[major]`<br>`visual.unmapped[major]` | 7 blank rows: defect name and a count per size. |
| 5. Visual Inspection | Total Major | Total Number of "Major Defects" Found | computed | `visual.total[major]` |  |
| 5. Visual Inspection | Minor defect | Minor Defects | handwritten_rows | `visual.counts[minor]`<br>`visual.unmapped[minor]` | 5 blank rows: defect name and a count per size. |
| 5. Visual Inspection | Total Minor | Total Number of "Minor Defects" Found | computed | `visual.total[minor]` |  |
| 6. Glove Dispensing Inspection | Glove Dispensing Inspection | Glove Dispensing Inspection | heading | title `dispensing_safedon` |  |
| 6. Glove Dispensing Inspection | Size |  | text | template `sizes` | One per block; 3 identical blocks on the page. |
| 6. Glove Dispensing Inspection | Box # | Box/Carton # | number | `dispensing_safedon.boxNo`<br>config `dispensing_safedon.boxesPerSize` | 13 box columns, the box number written at the top of each (Box/Carton # in the app, rule 7); the app allows more. |
| 6. Glove Dispensing Inspection | Safedon Packing Defects | Safedon Packing Defects | label | `dispensing_safedon.counts`<br>config `dispensing_safedon.defects` |  |
| 6. Glove Dispensing Inspection | No cuff | No Cuff | number | `dispensing_safedon.counts[no_cuff]` | A count per box. |
| 6. Glove Dispensing Inspection | Cuff should ideallly be at least 2 cm out | Cuff should ideally be at least 2 cm out | fixed | config `dispensing_safedon.defects[no_cuff]` | Definition of 'No cuff', printed beside the row; the app shows its own wording as the hint. |
| 6. Glove Dispensing Inspection | Finger out | Finger Out | number | `dispensing_safedon.counts[finger_out]` | A count per box. |
| 6. Glove Dispensing Inspection | Only cuff but no finger should be out first | Only the cuff, not a finger, should come out first | fixed | config `dispensing_safedon.defects[finger_out]` | Definition of 'Finger out', printed beside the row; the app shows its own wording as the hint. |
| 6. Glove Dispensing Inspection | Multiple gloves out | Multiple Gloves Out | number | `dispensing_safedon.counts[multiple_out]` | A count per box. |
| 6. Glove Dispensing Inspection | Only one glove should be out at one time | Only one glove should come out at a time | fixed | config `dispensing_safedon.defects[multiple_out]` | Definition of 'Multiple gloves out', printed beside the row; the app shows its own wording as the hint. |
| 6. Glove Dispensing Inspection | Glove stuck | Glove Stuck | number | `dispensing_safedon.counts[stuck]` | A count per box. |
| 6. Glove Dispensing Inspection | Glove ould not be dispensed or very difficult to dispense | Glove could not be dispensed or was very difficult to dispense | fixed | config `dispensing_safedon.defects[stuck]` | Definition of 'Glove stuck', printed beside the row; the app shows its own wording as the hint. |
| 6. Glove Dispensing Inspection | Sticky glove | Sticky Glove | number | `dispensing_safedon.counts[sticky]` | A count per box. |
| 6. Glove Dispensing Inspection | Two or more gloves out at the same time caused by gloves sticking together | Two or more gloves out at once because they stick together | fixed | config `dispensing_safedon.defects[sticky]` | Definition of 'Sticky glove', printed beside the row; the app shows its own wording as the hint. |
| 6. Glove Dispensing Inspection | Faulty cuff | Faulty Cuff | number | `dispensing_safedon.counts[faulty_cuff]` | A count per box. |
| 6. Glove Dispensing Inspection | Deformed or out of shaped cuff which causes dispensing problem | Deformed or misshapen cuff causing a dispensing problem | fixed | config `dispensing_safedon.defects[faulty_cuff]` | Definition of 'Faulty cuff', printed beside the row; the app shows its own wording as the hint. |
| 6. Glove Dispensing Inspection | Total | Total | computed | caption `dispensing_safedon.totalGroup`<br>`dispensing_safedon.boxDefects`<br>`dispensing_safedon.boxRatePct`<br>`dispensing_safedon.totalDefects`<br>`dispensing_safedon.glovesInspected`<br>`dispensing_safedon.ratePct` | Three unlabelled lines: two rows of 13 per-box cells, then one full-width cell. All computed. |
| 6. Glove Dispensing Inspection | Specification / Requirement | Specification / Requirement | text | custom `safedon_dispensing_notes.specRequirement`<br>caption `dispensing_safedon.specRow`<br>config `dispensing_safedon.maxRatePct` | Free text per block, kept as written in the custom module safedon_dispensing_notes and exported (onsite/SAFEDON_EG.md). The app judges the rate against the template's maxRatePct, which the report prints here (≤ 5%). |
| 6. Glove Dispensing Inspection | Conclusion | Conclusion | text | custom `safedon_dispensing_notes.conclusion`<br>`dispensing_safedon.result` | Free text per block, kept as written in the custom module safedon_dispensing_notes and exported (onsite/SAFEDON_EG.md). The report prints the computed Passed / Failed here (rule 6.2.2). |

<!-- /generated:coverage -->
