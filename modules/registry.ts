// Every module key (lib/schemas/module-result.ts) mapped to its definition in
// modules/<key>/index.ts. Building a module replaces only its folder; this
// file does not change. Module code never imports it: the registry imports
// the modules.
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { AnyModuleDefinition, ModuleRegistry } from "./_framework";
import { definition as carton_sampling } from "./carton_sampling";
import { definition as conclusion } from "./conclusion";
import { definition as dimensions } from "./dimensions";
import { definition as dispensing_packing } from "./dispensing_packing";
import { definition as dispensing_safedon } from "./dispensing_safedon";
import { definition as documents } from "./documents";
import { definition as dye_leak } from "./dye_leak";
import { definition as force_at_break } from "./force_at_break";
import { definition as glove_info } from "./glove_info";
import { definition as header } from "./header";
import { definition as labeling } from "./labeling";
import { definition as loading } from "./loading";
import { definition as order_lots } from "./order_lots";
import { definition as packing_config } from "./packing_config";
import { definition as sampling_plan } from "./sampling_plan";
import { definition as tensile } from "./tensile";
import { definition as visual } from "./visual";
import { definition as watertight } from "./watertight";
import { definition as weight } from "./weight";

export const MODULE_REGISTRY: ModuleRegistry = {
  header,
  glove_info,
  order_lots,
  packing_config,
  sampling_plan,
  carton_sampling,
  dimensions,
  weight,
  force_at_break,
  tensile,
  watertight,
  visual,
  dispensing_packing,
  dispensing_safedon,
  labeling,
  conclusion,
  dye_leak,
  documents,
  loading,
};

export function getModuleDefinition(key: ModuleKey): AnyModuleDefinition {
  return MODULE_REGISTRY[key];
}
