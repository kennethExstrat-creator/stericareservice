// The example reports' Manufacturer Information (tests/fixtures/examples) as
// header data, plus what the inspection row holds instead: the manufacturer
// and client picked on /inspections/new and the logged-in inspector.
import type { InspectionMeta } from "@/modules/_framework";
import { TEST_INSPECTOR } from "@/modules/_framework/testing";
import type { FictionalDate, HeaderSection } from "@/tests/fixtures/examples";
import type { HeaderData } from "../schema";

export const TEST_MANUFACTURER_ID = "00000000-0000-4000-8000-000000000201";
export const TEST_CLIENT_ID = "00000000-0000-4000-8000-000000000301";

/** A date picker's value: a month the report prints as "Feb-25" is stored as its first day. */
export function pickedDate(date: FictionalDate): string {
  return date.iso.length === 7 ? `${date.iso}-01` : date.iso;
}

export function headerData(header: HeaderSection): HeaderData {
  return {
    factoryAddress: header.factoryAddress,
    poNo: header.po.printed,
    productName: header.productName,
    productCode: header.productCode,
    factoryGloveCode: header.factoryGloveCode ?? null,
    inspectionDate: pickedDate(header.inspectionDate),
    mfgDate: pickedDate(header.mfgDate),
    expiryDate: pickedDate(header.expiryDate),
  };
}

/** The inspection row: the manufacturer as the reports print it, the client (or its logo), the inspector. */
export function headerMeta(header: HeaderSection): InspectionMeta {
  const manufacturer = header.factory ? `${header.manufacturer} (${header.factory})` : header.manufacturer;
  const client = header.client ?? header.clientLogo ?? null;
  return {
    inspectionDate: header.inspectionDate.iso,
    manufacturer: { id: TEST_MANUFACTURER_ID, name: manufacturer },
    client: client === null ? null : { id: TEST_CLIENT_ID, name: client },
    inspector: { ...TEST_INSPECTOR },
  };
}
