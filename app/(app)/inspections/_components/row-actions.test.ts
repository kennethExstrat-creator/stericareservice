import { describe, expect, it } from "vitest";
import type { InspectionStatus } from "@/lib/schemas/common";
import { primaryRowAction, rowActions, type ListViewer } from "./row-actions";

const ID = "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0001";
const OWNER = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const OTHER = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
const ADMIN = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const INSPECTOR: ListViewer = { id: OWNER, role: "inspector" };
const ADMIN_VIEWER: ListViewer = { id: ADMIN, role: "admin" };

const CAPTURE = `/inspections/${ID}`;
const REVIEW = `/inspections/${ID}/review`;
const STATUSES: InspectionStatus[] = ["draft", "reopened", "submitted", "approved"];

function labels(viewer: ListViewer, inspectorId = OWNER) {
  return Object.fromEntries(
    STATUSES.map((status) => {
      const { label, href } = primaryRowAction({ id: ID, status, inspectorId }, viewer);
      return [status, `${label} ${href}`];
    }),
  );
}

describe("primaryRowAction", () => {
  it("lets the inspector continue their own open inspections and view the rest", () => {
    expect(labels(INSPECTOR)).toEqual({
      draft: `Continue ${CAPTURE}`,
      reopened: `Continue ${CAPTURE}`,
      submitted: `View ${REVIEW}`,
      approved: `View ${REVIEW}`,
    });
  });

  it("lets an admin continue any open inspection, review a submitted one and view an approved one", () => {
    for (const inspectorId of [OWNER, ADMIN]) {
      expect(labels(ADMIN_VIEWER, inspectorId)).toEqual({
        draft: `Continue ${CAPTURE}`,
        reopened: `Continue ${CAPTURE}`,
        submitted: `Review ${REVIEW}`,
        approved: `View ${REVIEW}`,
      });
    }
  });

  it("only offers View on an inspection the viewer may not edit", () => {
    expect(labels(INSPECTOR, OTHER)).toEqual({
      draft: `View ${REVIEW}`,
      reopened: `View ${REVIEW}`,
      submitted: `View ${REVIEW}`,
      approved: `View ${REVIEW}`,
    });
  });
});

describe("rowActions", () => {
  const row = (status: InspectionStatus, inspectorId = OWNER) => ({ id: ID, refNo: "INS-2026-0001", status, inspectorId });

  it("names the main action with the words on the button, then the ref", () => {
    expect(rowActions(row("draft"), INSPECTOR).primary.name).toBe("Continue INS-2026-0001");
    expect(rowActions(row("submitted"), ADMIN_VIEWER).primary.name).toBe("Review INS-2026-0001");
    expect(rowActions(row("approved"), INSPECTOR).primary.name).toBe("View INS-2026-0001");
  });

  it("offers Delete on drafts only: the inspector's own, or anyone's for an admin", () => {
    const deletable = (viewer: ListViewer, inspectorId = OWNER) =>
      STATUSES.filter((status) => rowActions(row(status, inspectorId), viewer).deleteName !== null);
    expect(deletable(INSPECTOR)).toEqual(["draft"]);
    expect(deletable(INSPECTOR, OTHER)).toEqual([]);
    expect(deletable(ADMIN_VIEWER, OTHER)).toEqual(["draft"]);
    expect(rowActions(row("draft"), INSPECTOR).deleteName).toBe("Delete INS-2026-0001");
  });
});
