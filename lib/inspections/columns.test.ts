import { describe, expect, it } from "vitest";
import { inspectionListColumns } from "./columns";

describe("inspectionListColumns", () => {
  it("gives inspectors the list columns in BUILD_SPEC order, without Inspector, and the row actions last", () => {
    expect(inspectionListColumns("inspector").map((column) => column.label)).toEqual([
      "Ref",
      "Date",
      "Client",
      "Manufacturer",
      "Product",
      "PO",
      "Status",
      "Result",
      "Actions",
    ]);
  });

  it("adds the Inspector column for admins only, just before the actions", () => {
    const admin = inspectionListColumns("admin");
    expect(admin.at(-2)).toEqual({ key: "inspector", label: "Inspector" });
    expect(admin.at(-1)).toEqual({ key: "actions", label: "Actions", srOnlyLabel: true });
    expect(inspectionListColumns("inspector").map((column) => column.key)).not.toContain("inspector");
  });

  it("shows every column at every size: none waits for a breakpoint (the list scrolls sideways instead)", () => {
    for (const role of ["inspector", "admin"] as const) {
      for (const column of inspectionListColumns(role)) expect(Object.keys(column), column.key).not.toContain("from");
    }
  });
});
