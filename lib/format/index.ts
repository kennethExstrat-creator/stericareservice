// Display text for the capture kit (docs/CAPTURE_KIT.md): pure, locale-free
// helpers for numbers, specs, rates, AQL limits, size labels and captions.
export { fillCaption, formatCodeLetters, plainLabel } from "./caption";
export { BOX_CARTON_LABEL, BOX_CARTON_NUMBERS, boxCartonNumber, countBoxCartonNumbers } from "./box-carton";
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
export { formatLimits, formatLimitParts, type AcceptanceLimits, type LimitsFormat } from "./limits";
export {
  formatSize,
  formatSizeList,
  formatHand,
  formatSizeHand,
  type SizeOption,
  type SizeFormat,
  type HandCode,
} from "./size";
