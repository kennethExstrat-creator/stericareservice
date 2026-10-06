// Display text for the capture kit (docs/CAPTURE_KIT.md): pure, locale-free
// helpers for numbers, specs, rates, AQL limits and size labels.
export {
  formatNumber,
  formatCount,
  formatPercent,
  toPercent,
  withUnit,
  type NumberFormat,
} from "./number";
export { formatSpec, hasLimit, type SpecFormat } from "./spec";
export { ratio, ratePercent, formatRatio, formatRatioDecimal, formatRate } from "./rate";
export { formatLimits, type AcceptanceLimits, type LimitsFormat } from "./limits";
export {
  formatSize,
  formatSizeList,
  formatHand,
  formatSizeHand,
  type SizeOption,
  type SizeFormat,
  type HandCode,
} from "./size";
