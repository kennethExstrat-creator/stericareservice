import { cn } from "@/lib/utils";
import { AA_LARGE, AA_TEXT, contrastRatio, formatRatio } from "@/lib/design/contrast";
import { STEPS, accent, brand, mist, semantic, slate, white, type Hex, type Scale } from "@/lib/design/tokens";
import { DesignSection, Specimen } from "./design-section";

function verdict(ratio: number) {
  if (ratio >= AA_TEXT) return { text: "AA", className: "text-pass" };
  if (ratio >= AA_LARGE) return { text: "large only", className: "text-warn" };
  return { text: "no text", className: "text-muted-foreground" };
}

function RatioLine({ label, ratio }: { label: string; ratio: number }) {
  const { text, className } = verdict(ratio);
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">
        <span className="text-foreground">{formatRatio(ratio).replace(":1", "")}</span>{" "}
        <span className={className}>{text}</span>
      </dd>
    </div>
  );
}

/** One colour step: the swatch with its best text colour, the hex, and two measured ratios. */
function Swatch({ name, hex }: { name: string; hex: Hex }) {
  const whiteOn = contrastRatio(white, hex);
  const darkText = whiteOn < AA_LARGE;
  return (
    <li className="overflow-hidden rounded-lg bg-card ring-1 ring-border">
      <div
        className={cn("flex h-12 items-end p-2 text-sm font-semibold", darkText ? "text-slate-900" : "text-white")}
        style={{ backgroundColor: hex }}
      >
        Aa
      </div>
      <div className="space-y-1.5 p-2.5 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-foreground">{name}</span>
          <span className="font-mono text-muted-foreground">{hex}</span>
        </div>
        <dl className="space-y-0.5">
          <RatioLine label="White Text" ratio={whiteOn} />
          <RatioLine label="On White" ratio={contrastRatio(hex, white)} />
        </dl>
      </div>
    </li>
  );
}

const GRID = "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6";

function ScaleRow({ scale }: { scale: Scale }) {
  return (
    <ul className={GRID}>
      {STEPS.map((step) => (
        <Swatch key={step} name={String(step)} hex={scale[step]} />
      ))}
    </ul>
  );
}

const MAPPING: { variable: keyof typeof semantic; token: string; use: string }[] = [
  { variable: "background", token: "mist", use: "Page ground" },
  { variable: "foreground", token: "slate-900", use: "Body text" },
  { variable: "card", token: "white", use: "Cards, popovers, fields" },
  { variable: "primary", token: "brand-500", use: "Primary buttons, checked controls" },
  { variable: "secondary", token: "brand-100", use: "Secondary buttons (text brand-700)" },
  { variable: "muted", token: "slate-100", use: "Quiet surfaces, read-only fields" },
  { variable: "muted-foreground", token: "slate-600", use: "Secondary text, never lighter" },
  { variable: "accent", token: "brand-50", use: "Hover and menu highlight (text brand-700)" },
  { variable: "destructive", token: "fail (red-700)", use: "Destructive actions, field errors" },
  { variable: "border", token: "slate-200", use: "Card and divider lines" },
  { variable: "input", token: "slate-300", use: "Text-field borders" },
  { variable: "control", token: "slate-500", use: "Checkbox, radio, switch edges (3:1)" },
  { variable: "ring", token: "brand-500", use: "Focus rings: opaque, 2 px" },
  { variable: "sidebar", token: "white", use: "Sidebar (primary brand-500)" },
];

export function ColourSection() {
  return (
    <DesignSection
      id="colours"
      description="Brand, accent and mist are copied exactly from the website. Ratios are measured from lib/design/tokens.ts; a test fails if the CSS drifts from it."
      source="globals.css (website); slate is Tailwind 4's"
    >
      <Specimen label="Brand: Logo Blue (600 Is the Exact Logo Blue)">
        <ScaleRow scale={brand} />
      </Specimen>
      <Specimen label="Accent: Logo Teal (The Brand, Never a Result)">
        <ScaleRow scale={accent} />
      </Specimen>
      <Specimen label="Grounds and Neutrals">
        <ul className={GRID}>
          <Swatch name="mist" hex={mist} />
          <Swatch name="white" hex={white} />
          {STEPS.filter((step) => step !== 50 && step !== 950).map((step) => (
            <Swatch key={step} name={`slate-${step}`} hex={slate[step]} />
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          Text is slate-900 (16.8:1 on mist). Secondary text stops at slate-600. Brand-500 text is for white
          surfaces only: on mist it measures {formatRatio(contrastRatio(brand[500], mist))}, so links use brand-600.
        </p>
      </Specimen>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Specimen label="shadcn/ui Variables">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">Variable</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Token</th>
                  <th scope="col" className="py-2 font-medium">Used For</th>
                </tr>
              </thead>
              <tbody>
                {MAPPING.map(({ variable, token, use }) => (
                  <tr key={variable} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">--{variable}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-4 rounded-sm ring-1 ring-slate-900/15"
                          style={{ backgroundColor: semantic[variable] }}
                        />
                        {token}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">{use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Specimen>
        <Specimen label="The Accent Naming Clash">
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>
              shadcn calls its hover surface <span className="font-mono text-foreground">accent</span>; the website
              calls its teal scale <span className="font-mono text-foreground">accent-50…950</span>. Both work:
            </p>
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex h-9 items-center rounded-md bg-accent px-3 font-mono text-xs text-accent-foreground ring-1 ring-border">
                bg-accent
              </span>
              <span className="inline-flex h-9 items-center rounded-md bg-accent-500 px-3 font-mono text-xs font-semibold text-slate-900">
                bg-accent-500
              </span>
              <span className="inline-flex h-9 items-center rounded-md bg-accent-700 px-3 font-mono text-xs text-white">
                bg-accent-700
              </span>
            </div>
            <p>
              Teal text needs accent-700 ({formatRatio(contrastRatio(accent[700], white))} on white); accent-600 is{" "}
              {formatRatio(contrastRatio(accent[600], white))}, large text only.
            </p>
          </div>
        </Specimen>
      </div>

      <Specimen label="Signature Gradient: Logo Blue to Logo Teal (brand-500 to accent-600)">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="h-12 rounded-lg bg-gradient-brand" />
          <p className="text-sm text-muted-foreground md:max-w-xs">
            Sparingly: logo, login screen, accents in large page titles and the active progress step. Never under body
            text.
          </p>
        </div>
      </Specimen>
    </DesignSection>
  );
}
