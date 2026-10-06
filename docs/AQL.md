# AQL engine

`lib/aql/` computes ISO 2859-1 single sampling plans for normal inspection (BUILD_SPEC section 7). It is pure TypeScript with no I/O, so the same code runs on the iPad and on the server.

> **Before go-live, the QC team checks every cell of Table 1 and Table 2-A in `lib/aql/tables.ts` against SteriCare's licensed copy of ISO 2859-1** (BUILD_SPEC 7). The tables were entered from, and checked against, public reproductions only. The procedure and the sign-off table are under [Go-live check](#go-live-check).

ISO 2859-1 Tables 1 and 2-A are identical to ANSI/ASQ Z1.4 Tables I and II-A, which come unchanged from MIL-STD-105E.

## API

| Function | Takes | Gives |
|---|---|---|
| `planFromSampleSize` | sample inspected, AQL | code letter of the sample, the plan after arrows, warnings |
| `sampleSizeFromLotSize` | lot size, inspection level, sample taken (optional) | Table 1 code letter and its n; flags a sample below the plan |
| `planFromLotSize` | lot size, inspection level, AQL, sample taken (optional) | Table 1, then Table 2-A after arrows; `n` is the sample to take |
| `decide` | defects found, plan | `reject` at Re or more; `accept` at Ac or fewer once the sample inspected reaches the plan's `n`; `incomplete` otherwise (rule 4) |
| `labelingPlan` | nothing | Accept 0 / Reject 1 |
| `DEFAULT_AQL`, `resolveAqls` | the template's overrides | watertight 1.5, critical 0, major 2.5, minor 4.0, with overrides on top |
| `describePlan`, `formatAql` | a plan, an AQL | one line of text; the AQL as printed (`0.010`, `4.0`) |
| `lookupPlan`, `codeLetterForLotSize`, `codeLetterForSampleSize` | checked values | raw table lookups; they throw on bad input |

Results are plain JSON. The zod schemas in `lib/aql/schema.ts` describe them (`SampleSizePlanSchema`, `LotSizePlanSchema`, `LotSampleSchema`, `DecisionSchema`) and the template config values (`InspectionLevelSchema`, `AqlSchema`).

```ts
planFromSampleSize({ sampleSize: 500, aql: 4.0 });
// { ok: true, plan: { codeLetter: "N", usedLetter: "M", n: 315, ac: 21, re: 22, arrow: "up",
//                     aql: 4, sampleSize: 500, warnings: [] } }
```

| Field | Meaning |
|---|---|
| `codeLetter` | where the table was entered: the sample size's letter, or Table 1's for the lot |
| `usedLetter` | whose plan applies: `codeLetter`, or where its cell's arrow led |
| `n` | sample size of `usedLetter`: the sample this plan needs |
| `ac`, `re` | accept and reject numbers of that plan; `re` is always `ac + 1` |
| `arrow` | `"up"`, `"down"` or `null`: the arrow in `codeLetter`'s cell |
| `warnings` | `{ code, message }`, the fields of an export issue, so modules pass them on with a `size` |

Input the tables cannot take comes back as `{ ok: false, error: { code, message } }` instead of a throw, because it is often a value still being typed: `invalid_sample_size` (below 2 or not whole), `invalid_lot_size`, `invalid_level`, `invalid_aql`.

| Warning code | When |
|---|---|
| `nonstandard_sample` | the sample size is not in Table 2-A; it is read as the largest standard size below it |
| `sample_too_small` | from a sample size, the cell holds an arrow down: this AQL needs the larger sample `n` |
| `sample_below_plan` | from a lot size, the sample taken is smaller than the plan's `n` |
| `sample_exceeds_lot` | the plan's `n` is not smaller than the lot: inspect every item |

zod 4 refuses `.pick()`, `.omit()` and `.partial()` on a schema with a refinement, and the plan schemas carry the Re = Ac + 1 check. A module composes its computed values from the unrefined `SampleSizePlanShape` or `LotSizePlanShape` and adds `singleSamplingCheck` back:

```ts
const WatertightSizeSchema = z
  .object(SampleSizePlanShape)
  .omit({ warnings: true }) // the warnings go into the module's export warnings
  .extend({ holes: z.int().min(0), decision: DecisionSchema })
  .check(singleSamplingCheck);
```

## Rules

1. **From the sample size.** The example reports set n directly. n maps to its code letter: 2 A, 3 B, 5 C, 8 D, 13 E, 20 F, 32 G, 50 H, 80 J, 125 K, 200 L, 315 M, 500 N, 800 P, 1250 Q, 2000 R. Any other n is read as the largest standard n below it, with `nonstandard_sample` (100 reads as J, n 80; anything above 2000 as R). n below 2 is an error.
2. **From the lot size.** Table 1 gives the code letter for the lot and the template's inspection level. Ranges include both ends; a lot has at least 2 items. `sample_below_plan` gives the n required when the sample taken is smaller.
3. **Arrows.** An arrow up leads to the first plan above it in the same column (a smaller sample); that plan's Ac and Re apply. An arrow down leads to the first plan below it: from a sample size this raises `sample_too_small` with the n required, and the result still carries that plan's Ac and Re so the screen can explain. `usedLetter` names the letter whose plan was used. The smaller sample never accepts (rule 4).
4. **Decisions.** `decide(defects, plan)` rejects at Re or more. It accepts at Ac or fewer only when the sample inspected reaches the plan's `n`, or covers the whole lot when the lot is not larger than `n`. Otherwise the answer is `incomplete`: the items not inspected may hold more defects. This covers an arrow down from a sample size, a sample below a lot plan, and a lot plan with no sample yet. A reject on a short sample stands, because defects only add up. Limits alone, such as `labelingPlan()`, decide on Ac and Re. For example, a sample of 50 at AQL 0.65 needs code J (n 80, 1 / 2): 0 or 1 holes are `incomplete`, and 2 are `reject`.
5. **One sample for every class.** ISO 2859-1 10.3 says the new letter gives the sample size after an arrow, and lets the responsible authority use the largest sample for all classes. The app inspects one sample per size and applies the arrow's plan to it, as BUILD_SPEC 7 and the expected results specify: in the STD_EG example, minor defects at AQL 4.0 and code N follow the arrow up to code M and use 21 / 22 on the 500 gloves inspected.
6. **Critical.** AQL 0 is Accept 0 / Reject 1 at any n. It still reports the sample's code letter.
7. **Labelling.** `labelingPlan()` is Accept 0 / Reject 1 at every level, whatever the number inspected, including a carton level of 1, which the sample size lookup would reject.
8. **Whole lot.** When the plan's n is not smaller than the lot, `sample_exceeds_lot` says to inspect every item (footnote to Table 2-A).
9. **Defaults.** Watertight 1.5, major 2.5, minor 4.0, critical 0, overridable per template and per client.
10. **Inspection level.** ISO 2859-1 10.1 uses level II unless one is specified; the template specifies it. The STD_EG example matches level I; the SAFEDON_EG example sampled below level I (BUILD_SPEC 13).

## How the modules use it

- `sampling_plan`: per size, lot size = cases ordered x gloves per case. With an inspection level set, `sampleSizeFromLotSize({ lotSize, level, sampleSize })` suggests n and flags a sample below the plan. In the SAFEDON_EG example at level I, the 80-glove samples of 120,000-glove lots need 200 and the 200-glove samples of lots over 500,000 need 500.
- `watertight`: per size (and hand), `planFromSampleSize({ sampleSize: tested, aql })`, then `decide(holes, plan)`. `accept` is pass and `reject` is fail. `incomplete` is never shown as passed: the module shows not done (BUILD_SPEC 6.2 rule 5, since the rest of the sample is missing) with the plan's `sample_too_small` warning, which names the n required.
- `visual`: the same per class, with the class's AQL; critical is AQL 0.
- `labeling`: `decide(defects, labelingPlan())` per level. Limits alone only give `accept` or `reject`.
- Modules store the plan in `computed`, composing its schema as shown under [API](#api), and copy its warnings into the export with the size.

`lib/aql/plan.test.ts` holds every row of the BUILD_SPEC 7 table and the AQL checks of `docs/examples/expected-results.md`, including the corrected STD_EG limits (code N: watertight 14 / 15, major 21 / 22, minor 21 / 22 via code M). `lib/aql/decision.test.ts` checks every Table 2-A cell: no arrow down accepts on the smaller sample.

## Sources and verification

The tables were entered from two independent printings, read cell by cell from scans at high zoom, and then cross-checked against a separate transcription and a partial chart.

| Source | What it covers | How it was used |
|---|---|---|
| MIL-STD-105E, *Sampling procedures and tables for inspection by attributes*, US Department of Defense, 10 May 1989 (public domain): Table I (page 13) and Table II-A (page 14). Scan: <https://archive.org/details/MIL-STD-105E_1> | Table 1 and Table 2-A in full, all AQL columns, arrows as printed | entered and read cell by cell |
| IS 2500 (Part 1):2000, the Bureau of Indian Standards' identical adoption of ISO 2859-1:1999, with amendments 1 (2006), 2 (2016) and 3 (2022): Table 1 (page 19) and Table 2-A (page 20). Scan published by Public.Resource.Org: <https://archive.org/details/gov.in.is.2500.1.2000> | Table 1 and Table 2-A in full, in the ISO layout | read cell by cell against the entry |
| AQLSchemes 1.7-2 by John Lawson, R package on CRAN, `R/AAZ14Single.R`: <https://CRAN.R-project.org/package=AQLSchemes> | Table 1 letters, and n, Ac and Re for every letter and AQL with arrows already followed | compared by script: all 105 Table 1 cells and all 416 resolved Table 2-A cells match. Both comparisons are in `lib/aql/tables.test.ts` |
| QCADVISOR, *Sample size table* and *Single sampling plan for normal inspection (ISO 2859-1)*: <https://www.qcadvisor.com/wp-content/uploads/2023/05/AQL-QCADVISOR.pdf> | Table 1 as sample sizes; Table 2-A for AQL 0.010 to 10 only | read against the entry: matches |
| ISO 2859-1:2026 sample pages (cover, contents, foreword): <https://standards.iteh.ai/catalog/standards/iso/298db90e-798c-4669-a982-d1120b6c7993/iso-2859-1-2026>; status of the 1999 edition: <https://www.iso.org/standard/1141.html> | edition history only, no tables | see the edition note below |

**What the sources disagreed on.** No cell value differs between any of them. The differences are presentation only:

- ISO prints decimal commas (`0,010`, `1 000`) and says *acceptance quality limit*; MIL-STD-105E prints points and says *acceptable quality level*.
- AQLSchemes stores plans with arrows already followed, so it confirms where each arrow leads but not the arrow itself; both scans confirm the arrows. Its URL field cites the same MIL-STD-105E scan, so it is an independent transcription, not an independent printing.
- QCADVISOR stops at AQL 10 and gives Table 1 as sample sizes rather than letters.
- The corrections to ISO 2859-1:1999 do not touch these tables: Technical Corrigendum 1 (2001) changes the code H sample size in Table 11-C, and Amendment 1 (2011) changes references, clause 9.3.3.1 a) and Table 9 (IS 2500 amendments 1 and 2 reproduce them).

**Cells to look at twice.** All sources agree on these, but they are where a transcription goes wrong:

- Code letter A at AQL 10 and 15: arrows down, because there is no plan above A. They lead to C 1 / 2 (n 5) and B 1 / 2 (n 3).
- Code letter B at AQL 6.5: arrow up to A 0 / 1 (n 2).
- Code letter R at AQL 0.010 and 0.015: arrows up, because there is no plan below R. AQL 0.015 passes code Q's arrow and lands on P 0 / 1 (n 800).
- The top right corner: Ac 30 and 44 appear in rows A to E only. Rows F to R stop at 21 / 22, with arrows up to the right of it.

**Edition note.** ISO 2859-1:2026 (third edition, January 2026) replaced ISO 2859-1:1999 on 22 January 2026. Its foreword lists a new switch to skip-lot inspection, guidance on qualifying producers and products for it, and per-plan OC curves replaced by a method to construct them (Annex E); it lists no change to the code letters or the single sampling plans. It moves the tables into clause 15 (sample size code letters) and clause 16 (single sampling plans), so the table numbers may differ from "Table 1" and "Table 2-A". The 2026 tables were not available to check here.

## Go-live check

1. Note which edition SteriCare's licensed copy is: ISO 2859-1:1999 (with Cor 1:2001 and Amd 1:2011) or ISO 2859-1:2026.
2. Open `lib/aql/tables.ts`. `SAMPLE_SIZES` gives n per code letter. `TABLE_1` has one row per lot size range, then the code letters for S-1, S-2, S-3, S-4, I, II and III. `TABLE_2A` has one row per code letter and one column per AQL, named in the comment above the rows: `[Ac, Re]` is a plan, `"↓"` and `"↑"` are the arrows.
3. Check every value against the licensed copy: 16 sample sizes, 15 lot size ranges with 105 code letters, and 416 Table 2-A cells. A printout of the file next to the standard works; tick each row.
4. If a cell differs, record it in the notes column below, check the printed copy again, and only then change `tables.ts`. The cross-checks in `lib/aql/tables.test.ts` will then fail on that cell; update them with a note of why.
5. Sign off below.

| Edition checked | Checked by | Date | Table 1 | Table 2-A | Notes |
|---|---|---|---|---|---|
| | | | | | |
