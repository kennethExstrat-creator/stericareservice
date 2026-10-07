// Defaults a template can override: the heading, the labels (STD_EG's
// wording) and the config (BUILD_SPEC 6.1: packing site on/off). The sizes
// offered are the template's own (`sizes`), not config.
import { z } from "zod";

/** The reports print no heading over the order table: "Order" is the app's. */
export const ORDER_LOTS_TITLE = "Order";

export const ORDER_LOTS_LABELS = {
  /** Caption of the size column. */
  size: "Size",
  qtyCases: "Qty (Cases)",
  lotNumbers: "Lot Number",
  packingSite: "Packing Site",
  lotSizeGloves: "Lot Size (Gloves)",
  totalCartons: "Total # Carton",
  totalGloves: "Total # Gloves",
} as const satisfies Readonly<Record<string, string>>;

export const OrderLotsConfigSchema = z.strictObject({
  fields: z
    .strictObject({ packingSite: z.boolean() })
    .describe("The Packing Site column on or off (SAFEDON_EG prints one per size)."),
});
export type OrderLotsConfig = z.infer<typeof OrderLotsConfigSchema>;

export const ORDER_LOTS_DEFAULT_CONFIG: OrderLotsConfig = {
  fields: { packingSite: false },
};
