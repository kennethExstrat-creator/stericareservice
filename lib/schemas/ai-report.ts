import { z } from "zod";
import { HttpUrlSchema } from "./common";

/* ------------------------------------------------------------------ *
 * AI report (BUILD_SPEC 9.1)
 *
 * The report service receives the inspection export and answers with
 * where the finished client report is. The app stores the URL in
 * inspections.report_url.
 * ------------------------------------------------------------------ */

export const AiReportResponseSchema = z.object({
  /** The finished report, e.g. a PDF on the report service. */
  reportUrl: HttpUrlSchema,
});
export type AiReportResponse = z.infer<typeof AiReportResponseSchema>;
