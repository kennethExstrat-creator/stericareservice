"use client";

import { useId } from "react";
import {
  BRAND_FIELDS,
  DELETABLE,
  brandDeleteBlocker,
  brandSnapshot,
  brandValues,
  type BrandItem,
} from "@/lib/admin/manufacturers";
import { deleteBrand, saveBrand } from "../actions";
import { EditPanel, useEditForm, type PanelProps } from "./edit-panel";
import { DeleteSection } from "./reference-delete";
import { TextField } from "./reference-field";

const BLANK = brandValues(null);

/** Add or edit a brand; deleting, once it has no companies, sits at the end of the edit panel. */
export function BrandPanel({ open, target, item, onClose, onDeleted, returnFocus }: PanelProps<BrandItem, "brand">) {
  const id = useId();
  const editing = target.mode === "edit";
  const form = useEditForm({
    id,
    fields: BRAND_FIELDS,
    item,
    snapshotOf: brandSnapshot,
    blank: BLANK,
    save: saveBrand,
    onSaved: onClose,
  });

  return (
    <EditPanel
      open={open}
      busy={form.pending}
      onClose={onClose}
      returnFocus={returnFocus}
      title={editing ? "Edit Brand" : "Add Brand"}
      editing={editing}
      addLabel="Add Brand"
      gone={open && editing && !item ? "Someone has deleted this brand." : null}
      dirty={form.dirty}
      formId={`${id}-form`}
      formAction={form.formAction}
      target={{ id: editing ? target.id : "", version: editing ? (form.base?.version ?? "") : "" }}
      formError={form.formError}
      after={
        editing &&
        form.shown && (
          <DeleteSection
            kind="brand"
            id={form.shown.id}
            name={form.shown.name}
            blocker={brandDeleteBlocker(form.shown.companies.length)}
            deletable={DELETABLE.brand}
            action={deleteBrand}
            onDeleted={onDeleted}
          />
        )
      }
    >
      <TextField {...form.text("name")} label="Name" autoCapitalize="words" />
    </EditPanel>
  );
}
