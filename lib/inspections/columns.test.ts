import { describe, expect, it } from "vitest";
import { INSPECTOR_IN_CHARGE } from "@/lib/auth/org";
import { inspectionListColumns } from "./columns";

const INSPECTOR = { role: "inspector" } as const;
const LEAD = { role: "inspector", isLead: true } as const;
const ADMIN = { role: "admin" } as const;

describe("inspectionListColumns", () => {
  it("gives inspectors the list columns, status and result straight after the ref, without Inspector, and the row actions last", () => {
    expect(inspectionListColumns(INSPECTOR).map((column) => column.label)).toEqual([
      "Ref",
      "Status",
      "Result",
      "Date",
      "Client",
      "Manufacturer",
      "Product",
      "PO",
      "Actions",
    ]);
  });

  it("adds the Inspector in Charge column for admins and lead inspectors only, just before the actions", () => {
    const admin = inspectionListColumns(ADMIN);
    expect(admin.at(-2)).toEqual({ key: "inspector", label: INSPECTOR_IN_CHARGE });
    expect(inspectionListColumns(LEAD)).toEqual(admin);
    expect(admin.at(-1)).toEqual({ key: "actions", label: "Actions", srOnlyLabel: true });
    expect(inspectionListColumns(INSPECTOR).map((column) => column.key)).not.toContain("inspector");
  });

  it("shows every column at every size: none waits for a breakpoint (the list scrolls sideways instead)", () => {
    for (const viewer of [INSPECTOR, LEAD, ADMIN]) {
      for (const column of inspectionListColumns(viewer)) expect(Object.keys(column), column.key).not.toContain("from");
    }
  });
});
