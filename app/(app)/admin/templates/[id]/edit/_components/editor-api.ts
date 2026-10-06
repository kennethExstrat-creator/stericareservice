// What the editor's parts share: the draft, its context and problems, and
// the one way to change it.
import type { DefectCodeOption } from "../_lib/load";
import type { Draft, EditorContext } from "../_lib/model";
import type { EditorProblem, ProblemPlace } from "../_lib/problems";

export type SizeOption = { value: string; label: string };

export type EditorApi = {
  draft: Draft;
  context: EditorContext;
  problems: readonly EditorProblem[];
  /** False for a version that cannot change (in use, active, retired): everything reads only. */
  editable: boolean;
  /** Changes the draft; `change` gets the latest draft and its context. */
  update: (change: (draft: Draft, context: EditorContext) => Draft) => void;
  /** A field holding text that is not a value yet, or null once it is. */
  reportDraftError: (place: ProblemPlace, message: string | null) => void;
  /** The template's sizes, canonical, for size pickers in config. */
  sizes: readonly SizeOption[];
  defectCodes: readonly DefectCodeOption[];
  /** "Use default" for a template of its own, "Use STD_EG's" for one that extends STD_EG. */
  resetLabel: string;
};
