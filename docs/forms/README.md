# Reference forms

Two kinds of source. Both feed the same modules (BUILD_SPEC section 6).

| Folder | What | Role |
|---|---|---|
| `reports/` | The finished 4-page preshipment reports (Excel), field by field | **Primary.** Build modules and seed templates from these first. |
| `onsite/` | The Word forms used on site (SG, EG, Safedon EG), field lists and PDFs | Secondary. Adds what the reports lack: R/L hand split, dye leak, sterile pouch sampling. |
| `../examples/` | The two filled reports as PDF, plus expected results | Test data, and the target layout for the AI report. Contains client data: never commit it. |

The labels in these folders are the clients' wording, verbatim. The app and the AI report write them in Title Case (Kenneth, 8 October 2026: `docs/DESIGN.md`, Capitalisation; `docs/AI.md`, The report's wording); the forms' wording stays in the coverage matrix of `docs/DATA_DICTIONARY.md`.

## Module coverage

✓ = recorded with results. "planned" = sample count on the form but nowhere to record results. Blank = not on the form.

| Module | STD_EG report | SAFEDON_EG report | SG onsite | EG onsite | Safedon EG onsite |
|---|---|---|---|---|---|
| `header` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `glove_info` | ✓ | ✓ | | | |
| `order_lots` | ✓ | ✓ (+ packing site) | qty only | qty only | qty only |
| `packing_config` | ✓ | ✓ | packing mode text | packing mode text | packing mode text |
| `sampling_plan` | ✓ | ✓ | ✓ (+ pouches) | ✓ | ✓ |
| `carton_sampling` | ✓ | ✓ | | | |
| `dimensions` | ✓ median | ✓ average | planned | planned | planned |
| `weight` | ✓ 13 gloves | ✓ 1 value | | | |
| `force_at_break` | ✓ | | planned | planned | planned |
| `tensile` | | ✓ | | | |
| `watertight` | ✓ | ✓ | ✓ R/L | ✓ | ✓ |
| `visual` critical | ✓ | ✓ | | | |
| `visual` major, minor | ✓ | ✓ | ✓ R/L | ✓ | ✓ |
| `dispensing_packing` | ✓ | | | ✓ | |
| `dispensing_safedon` | | ✓ | | | ✓ |
| `labeling` | ✓ | ✓ | | | |
| `dye_leak` | | | planned | | |
| `conclusion` | ✓ | ✓ | | | |
| `documents` | | | | | |
| `loading` | | | | | |

`documents` and `loading` are not on any current form. They are optional modules for services the website says SteriCare's QC covers.
