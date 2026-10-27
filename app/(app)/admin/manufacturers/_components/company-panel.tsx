"use client";

import { useId } from "react";
import {
  COMPANY_FIELDS,
  DELETABLE,
  companyDeleteBlocker,
  companySnapshot,
  companyValues,
  type BrandItem,
  type CompanyItem,
} from "@/lib/admin/manufacturers";
import { deleteCompany, saveCompany } from "../actions";
import { ChoiceField, EditPanel, useEditForm, type PanelProps } from "./edit-panel";
import { DeleteSection } from "./reference-delete";
import { TextField } from "./reference-field";

/**
 * Add a company to a brand, or edit one: its name, and the brand it trades
 * under (a company can move to another brand). Deleting, once it has no
 * factories, sits at the end of the edit panel.
 */
export function CompanyPanel({
  open,
  target,
  item,
  brands,
  onClose,
  onDeleted,
  returnFocus,
}: PanelProps<CompanyItem, "company"> & {
  /** Every brand, for the Brand choice. */
  brands: readonly BrandItem[];
}) {
  const id = useId();
  const editing = target.mode === "edit";
  const form = useEditForm({
    id,
    fields: COMPANY_FIELDS,
    item,
    snapshotOf: companySnapshot,
    blank: companyValues(null, target.mode === "create" ? target.brandId : ""),
    save: saveCompany,
    onSaved: onClose,
  });

  return (
    <EditPanel
      open={open}
      busy={form.pending}
      onClose={onClose}
      returnFocus={returnFocus}
      title={editing ? "Edit Company" : "Add Company"}
      editing={editing}
      addLabel="Add Company"
      gone={open && editing && !item ? "Someone has deleted this company." : null}
      dirty={form.dirty}
      formId={`${id}-form`}
      formAction={form.formAction}
      target={{ id: editing ? target.id : "", version: editing ? (form.base?.version ?? "") : "" }}
      formError={form.formError}
      after={
        editing &&
        form.shown && (
          <DeleteSection
            kind="company"
            id={form.shown.id}
            name={form.shown.name}
            blocker={companyDeleteBlocker(form.shown.factories.length)}
            deletable={DELETABLE.company}
            action={deleteCompany}
            onDeleted={onDeleted}
          />
        )
      }
    >
      <ChoiceField
        {...form.choice("brand_id")}
        label="Brand"
        placeholder="Choose the brand"
        groups={[{ label: null, options: brands.map((brand) => ({ value: brand.id, label: brand.name })) }]}
      />
      <TextField {...form.text("name")} label="Name" autoCapitalize="words" />
    </EditPanel>
  );
}
