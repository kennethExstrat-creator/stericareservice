"use client";

// What stops the draft from saving, each a link to where it is fixed
// (BUILD_SPEC 6.2: "list each problem with a link"), named by the labels the
// admin sees on the way there (../_lib/names.ts), never by schema keys.
import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, OctagonXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EditorProblem, ProblemPlace } from "../_lib/problems";

const SHOWN = 5;

export function ProblemsSummary({
  problems,
  whereOf,
  onGo,
}: {
  problems: readonly EditorProblem[];
  /** The steps to a problem's place: ["Weight (g)", "Settings", "Gloves weighed"]. */
  whereOf: (place: ProblemPlace) => readonly string[];
  onGo: (place: ProblemPlace) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (problems.length === 0) return null;
  const shown = expanded ? problems : problems.slice(0, SHOWN);
  const where = (place: ProblemPlace): string => whereOf(place).join(" › ");

  return (
    <section
      aria-labelledby="problems-heading"
      className="grid gap-3 rounded-xl border border-fail-border bg-fail-tint p-4"
      data-testid="problems"
    >
      <h2 id="problems-heading" className="flex items-center gap-2 text-base font-bold text-fail">
        <OctagonXIcon aria-hidden className="size-5" />
        {problems.length === 1 ? "1 Problem to Fix Before Saving" : `${problems.length} Problems to Fix Before Saving`}
      </h2>
      <ul className="grid gap-1">
        {shown.map((problem) => (
          <li key={problem.id}>
            <button
              type="button"
              onClick={() => onGo(problem.place)}
              className="grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-card focus-ring-inset touch:min-h-11"
            >
              <span className="font-semibold text-fail underline-offset-2 [button:hover>&]:underline">{where(problem.place)}</span>
              <span className="text-foreground">{problem.message}</span>
            </button>
          </li>
        ))}
      </ul>
      {problems.length > SHOWN && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {expanded ? <ChevronUpIcon aria-hidden /> : <ChevronDownIcon aria-hidden />}
            {expanded ? "Show Fewer" : `Show All ${problems.length}`}
          </Button>
        </div>
      )}
    </section>
  );
}
