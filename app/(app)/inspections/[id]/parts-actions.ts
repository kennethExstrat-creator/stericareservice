"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { authorizeAction } from "@/lib/auth/session";
import { createPart } from "@/lib/inspections/parts-server";
import { createClient } from "@/lib/supabase/server";
import { TEXT_MAX_LENGTH } from "@/modules/header/schema";

/*
 * PO parts on the capture screen (lib/inspections/parts.ts). A Server Action
 * is a public endpoint: this one checks the session and its input, and
 * createPart() reads the inspection through the caller's own client, so Row
 * Level Security decides what they see, and adds the part only where they
 * may change the inspection (draft or reopened, their own or an admin's).
 */

export type AddPartResult = { status: "added"; id: string } | { status: "error"; message: string };

const AddPartInputSchema = z.object({
  inspectionId: z.uuid(),
  // The new part's header takes it (Manufacturer Information, PO / SO Number): no longer than that field.
  poNo: z
    .string()
    .trim()
    .max(TEXT_MAX_LENGTH)
    .nullable()
    .transform((po) => po || null),
});

const ADD_FAILED = "The PO could not be added. Try again.";

/**
 * Adds a PO part to the inspection `inspectionId` belongs to, with its PO /
 * SO number when one is given, and answers the new part's id: the capture
 * screen opens it. Refused, it answers createPart's reason.
 */
export async function addInspectionPart(inspectionId: string, poNo: string | null): Promise<AddPartResult> {
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { status: "error", message: auth.error };

    const parsed = AddPartInputSchema.safeParse({ inspectionId, poNo });
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some((issue) => issue.path[0] === "poNo" && issue.code === "too_big");
      return {
        status: "error",
        message: tooLong
          ? `The PO / SO number is too long: up to ${TEXT_MAX_LENGTH} characters.`
          : "The request was not understood. Reload the page and try again.",
      };
    }

    const { user } = auth;
    const result = await createPart(
      await createClient(),
      { id: user.id, role: user.role },
      parsed.data.inspectionId,
      parsed.data.poNo,
    );
    return result.ok ? { status: "added", id: result.id } : { status: "error", message: result.message };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[parts] adding a part failed", error);
    return { status: "error", message: ADD_FAILED };
  }
}
