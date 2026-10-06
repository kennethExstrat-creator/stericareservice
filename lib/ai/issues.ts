import type { z } from "zod";

/** One line for an error message: "findings.0.severity: Invalid option; summary: Required; 2 more". */
export function summarizeIssues(error: z.ZodError, limit = 3): string {
  const shown = error.issues.slice(0, limit).map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  const more = error.issues.length - shown.length;
  return more > 0 ? `${shown.join("; ")}; ${more} more` : shown.join("; ");
}
