import type { ReactNode } from "react";
import { Eyebrow } from "@/components/brand/eyebrow";
import { DesignSection, Specimen } from "./design-section";

type Row = { name: string; spec: string; sample: ReactNode };

const ROWS: Row[] = [
  {
    name: "Display",
    spec: "Red Hat Display 800 · 36/40 · tight",
    sample: (
      <p className="font-display text-4xl leading-10 font-extrabold tracking-tight text-foreground">
        Preshipment <span className="text-gradient-brand">Inspection</span>
      </p>
    ),
  },
  {
    name: "H1 · Page Title",
    spec: "Red Hat Display 700 · 30/36 · tight",
    sample: <p className="font-display text-3xl font-bold tracking-tight text-foreground">INS-2026-0001</p>,
  },
  {
    name: "H2 · Section",
    spec: "Red Hat Display 700 · 24/32",
    sample: <p className="font-display text-2xl font-bold tracking-tight text-foreground">Dimension - Size M</p>,
  },
  {
    name: "H3 · Module Card",
    spec: "Red Hat Display 700 · 18/28",
    sample: <p className="font-display text-lg font-bold text-foreground">Freedom from Holes by watertight test</p>,
  },
  {
    name: "H4 · Group",
    spec: "Red Hat Display 600 · 16/24",
    sample: <p className="font-display text-base font-semibold text-foreground">Major Defects (AQL 2.5)</p>,
  },
  {
    name: "Body",
    spec: "Outfit 400 · 16/24 · slate-900",
    sample: (
      <p className="text-base text-foreground">
        Inspectors capture on the iPad at the factory; the desktop finishes entry, review and approval.
      </p>
    ),
  },
  {
    name: "Small · Secondary",
    spec: "Outfit 400 · 14/20 · slate-600",
    sample: <p className="text-sm text-muted-foreground">Saved 2 minutes ago · 13 gloves per size</p>,
  },
  {
    name: "Label",
    spec: "Outfit 500 · 14/20",
    sample: <p className="text-sm font-medium text-foreground"># glove per inner box</p>,
  },
  {
    name: "Eyebrow",
    spec: "Outfit 700 · 12 · 0.2em · brand-600",
    sample: <Eyebrow dash>Preshipment Inspection</Eyebrow>,
  },
];

const DATA = ["111.1", "888.8", "0.11", "1,250", "7 / 8"];

export function TypeSection() {
  return (
    <DesignSection
      id="type"
      description="Outfit for body text, Red Hat Display for headings, as on the website. Sizes are smaller than the website's marketing scale: this is a data-entry tool. Field text never drops below 16 px on iPad."
      source="layout.tsx.txt, ui.tsx.txt (Eyebrow, Display)"
    >
      <Specimen>
        <dl className="divide-y divide-border">
          {ROWS.map((row) => (
            <div key={row.name} className="grid gap-1 py-4 first:pt-0 last:pb-0 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6">
              <dt className="space-y-0.5">
                <span className="block text-sm font-semibold text-foreground">{row.name}</span>
                <span className="block text-xs text-muted-foreground">{row.spec}</span>
              </dt>
              <dd className="min-w-0">{row.sample}</dd>
            </div>
          ))}
          <div className="grid gap-1 py-4 last:pb-0 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6">
            <dt className="space-y-0.5">
              <span className="block text-sm font-semibold text-foreground">Data</span>
              <span className="block text-xs text-muted-foreground">tabular numerals, right aligned</span>
            </dt>
            <dd className="grid max-w-md grid-cols-2 gap-6 text-sm">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Proportional</p>
                <ul className="space-y-0.5 text-right text-base text-foreground">
                  {DATA.map((value) => (
                    <li key={value}>{value}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">tabular-nums</p>
                <ul className="space-y-0.5 text-right text-base text-foreground tabular-nums">
                  {DATA.map((value) => (
                    <li key={value}>{value}</li>
                  ))}
                </ul>
              </div>
            </dd>
          </div>
        </dl>
      </Specimen>
    </DesignSection>
  );
}
