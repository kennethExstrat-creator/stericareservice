import { describe, expect, it } from "vitest";
import { inspectionListColumns } from "./columns";

describe("inspectionListColumns", () => {
  it("gives inspectors the list columns in BUILD_SPEC order, without Inspector", () => {
    expect(inspectionListColumns("inspector").map((column) => column.label)).toEqual([
      "Ref",
      "Date",
      "Client",
      "Manufacturer",
      "Product",
      "PO",
      "Status",
      "Result",
    ]);
  });

  it("adds the Inspector column for admins only", () => {
    expect(inspectionListColumns("admin").map((column) => column.key)).toContain("inspector");
    expect(inspectionListColumns("admin").at(-1)).toEqual({ key: "inspector", label: "Inspector", from: "xl" });
    expect(inspectionListColumns("inspector").map((column) => column.key)).not.toContain("inspector");
  });

  it("shows fewer columns on the iPad: PO and manufacturer from 1024 px, product and inspector from 1280 px", () => {
    const from = Object.fromEntries(inspectionListColumns("admin").map((column) => [column.key, column.from ?? "always"]));
    expect(from).toEqual({
      ref: "always",
      date: "always",
      client: "always",
      manufacturer: "lg",
      product: "xl",
      po: "lg",
      status: "always",
      result: "always",
      inspector: "xl",
    });
  });
});
