// The example reports' order tables (tests/fixtures/examples) as order_lots
// data: one line per size the report fills in. The printed totals stay in
// the fixture; the module computes its own (6.2 rule 2).
import type { OrderSection } from "@/tests/fixtures/examples";
import type { OrderLotsData } from "../schema";

export function orderData(order: OrderSection): OrderLotsData {
  return {
    sizes: Object.fromEntries(
      Object.entries(order.lines).map(([size, line]) => [
        size,
        { qtyCases: line.qtyCases, lotNumbers: [...line.lots], packingSite: line.packingSite ?? null },
      ]),
    ),
  };
}
