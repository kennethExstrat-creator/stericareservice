// The order table: the source of the ordered sizes, so not a per-size module itself.
import { defineModule } from "@/modules/_framework";
import { calcOrderLots, contributeOrderLots, type OrderLotsComputed } from "./calc";
import {
  ORDER_LOTS_DEFAULT_CONFIG,
  ORDER_LOTS_LABELS,
  ORDER_LOTS_TITLE,
  OrderLotsConfigSchema,
  type OrderLotsConfig,
} from "./config";
import { emptyOrderLots, OrderLotsDataSchema, type OrderLotsData } from "./schema";

export const definition = defineModule<OrderLotsData, OrderLotsConfig, OrderLotsComputed>({
  key: "order_lots",
  title: ORDER_LOTS_TITLE,
  labels: ORDER_LOTS_LABELS,
  dataSchema: OrderLotsDataSchema,
  emptyData: emptyOrderLots,
  configSchema: OrderLotsConfigSchema,
  defaultConfig: ORDER_LOTS_DEFAULT_CONFIG,
  calc: calcOrderLots,
  contribute: contributeOrderLots,
  loadCapture: () => import("./Capture"),
});

export type { OrderLotsData } from "./schema";
export type { OrderLotsConfig } from "./config";
export type { OrderLotsComputed } from "./calc";
