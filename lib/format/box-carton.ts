// Box and carton numbers are one number (Kenneth, 13 October 2026: "now only
// i found out that box# and carton# is the same thing. If thats so, all
// regarding to box and carton use Box/Carton #"). How the app words it
// (docs/DESIGN.md, Capitalisation): a label, column heading or caption says
// "Box/Carton #"; a sentence, a tag or a name gives one number as
// "Box/Carton #1003" and several as "box/carton numbers". "Carton" alone
// still means the packaging level, as labelling's inner unit and carton.
import { formatCount } from "./number";

/** The label: a column heading, a field's name, a caption ("M (Box/Carton #)"). */
export const BOX_CARTON_LABEL = "Box/Carton #";

/** Several, inside a sentence: "12 of 50 box/carton numbers." */
export const BOX_CARTON_NUMBERS = "box/carton numbers";

/** One number in a sentence, a photo tag or a control's name: "Box/Carton #1003". */
export function boxCartonNumber(value: number | string): string {
  return `${BOX_CARTON_LABEL}${value}`;
}

/** A count of them in a sentence: "1 box/carton number", "2,000 box/carton numbers". */
export function countBoxCartonNumbers(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "box/carton number" : BOX_CARTON_NUMBERS}`;
}
