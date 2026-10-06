import type { AiReview } from "@/lib/schemas";
import { FIXTURE_IDS } from "./std-eg-export";

/** A plausible second opinion on the STD_EG fixture, as a provider would return it. */
export function makeAiReview(): AiReview {
  return {
    suggestedResult: "hold",
    confidence: 0.7,
    summary:
      "The data supports a pass except for the weight. Size M averages 2.9 g against an indicative 3.5 g, 17% below the 10% threshold. Confirm the indicative weight before approving.",
    findings: [
      {
        id: "F1",
        module: "weight",
        size: "M",
        severity: "major",
        message: "Average weight is 17% below the indicative weight. Check the spec sheet and the scale.",
        evidence: {
          values: [
            { label: "Average weight, size M", value: "2.9", unit: "g" },
            { label: "Indicative weight, size M", value: "3.5", unit: "g" },
          ],
          boxes: [],
          photos: [FIXTURE_IDS.photoScale],
        },
      },
    ],
    questions: [{ id: "Q1", module: "conclusion", question: "Why is the remark empty when a weight warning is open?" }],
  };
}
