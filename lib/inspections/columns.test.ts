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
    expect(admin.at(-2)).toEqual({ key: "inspector", label: "Inspector", from: "xl" });
    expect(admin.at(-1)).toEqual({ key: "actions", label: "Actions", srOnlyLabel: true });
    expect(inspectionListColumns("inspector").map((column) => column.key)).not.toContain("inspector");
  });

  it("keeps the actions on every screen and folds the rest on the iPad: date and manufacturer from 1024 px, the others on desktop only", () => {
    const from = Object.fromEntries(inspectionListColumns("inspector").map((column) => [column.key, column.from ?? "always"]));
    expect(from).toEqual({
      ref: "always",
      date: "lg",
      client: "always",
      manufacturer: "lg",
      product: "2xl",
      po: "xl",
      status: "always",
      result: "xl",
      actions: "always",
    });
  });

  it("has the product give way on desktops narrower than 1536 px for every role, so the names keep their room", () => {
    for (const role of ["inspector", "admin"] as const) {
      const from = Object.fromEntries(inspectionListColumns(role).map((column) => [column.key, column.from ?? "always"]));
      expect(from).toMatchObject({ product: "2xl", po: "xl", result: "xl", actions: "always" });
    }
    expect(inspectionListColumns("admin").find((column) => column.key === "inspector")?.from).toBe("xl");
  });
});
