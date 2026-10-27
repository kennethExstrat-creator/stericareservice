"use client";

import { useId } from "react";
import {
  FACTORY_FIELDS,
  factorySnapshot,
  factoryTitle,
  factoryValues,
  type BrandItem,
  type FactoryItem,
} from "@/lib/admin/manufacturers";
import { deleteFactory, saveFactory } from "../actions";
import { ChoiceField, EditPanel, useEditForm, type ChoiceGroup, type PanelProps } from "./edit-panel";
import { DeleteSection } from "./reference-delete";
import { TextField } from "./reference-field";

/** The companies to choose from, under their brands. */
function companyGroups(brands: readonly BrandItem[]): ChoiceGroup[] {
  return brands
    .filter((brand) => brand.companies.length > 0)
    .map((brand) => ({
      label: brand.name,
      options: brand.companies.map((company) => ({ value: company.id, label: company.name })),
    }));
}

/**
 * Add a factory to a company, or edit one: the company it belongs to (a
 * factory can move to another company), its name, address, country and
 * notes. Deleting sits at the end of the edit panel, blocked while
 * templates or inspections use the factory.
 */
export function FactoryPanel({
  open,
  target,
  item,
  companyName,
  brands,
  countries,
  onClose,
  onDeleted,
  returnFocus,
}: PanelProps<FactoryItem, "factory"> & {
  /** The edited factory's company, which names a factory without a name of its own. */
  companyName: string;
  /** Every brand with its companies, for the Company choice. */
  brands: readonly BrandItem[];
  /** Suggestions for the country field. */
  countries: readonly string[];
}) {
  const id = useId();
  const editing = target.mode === "edit";
  const form = useEditForm({
    id,
    fields: FACTORY_FIELDS,
    item,
    snapshotOf: factorySnapshot,
    blank: factoryValues(null, target.mode === "create" ? target.companyId : ""),
    save: saveFactory,
    onSaved: onClose,
  });

  return (
    <EditPanel
      open={open}
      busy={form.pending}
      onClose={onClose}
      returnFocus={returnFocus}
      title={editing ? "Edit Factory" : "Add Factory"}
      editing={editing}
      addLabel="Add Factory"
      gone={open && editing && !item ? "Someone has deleted this factory." : null}
      dirty={form.dirty}
      formId={`${id}-form`}
      formAction={form.formAction}
      target={{ id: editing ? target.id : "", version: editing ? (form.base?.version ?? "") : "" }}
      formError={form.formError}
      after={
        editing &&
        form.shown && (
          <DeleteSection
            kind="factory"
            id={form.shown.id}
            name={factoryTitle(form.shown.factoryName, companyName)}
            usage={form.shown.usage}
            action={deleteFactory}
            onDeleted={onDeleted}
          />
        )
      }
    >
      <ChoiceField {...form.choice("company_id")} label="Company" placeholder="Choose the company" groups={companyGroups(brands)} />
      <TextField {...form.text("factory_name")} label="Factory (Optional)" autoCapitalize="words" />
      <TextField {...form.text("address")} label="Address" multiline />
      <TextField {...form.text("country")} label="Country" autoCapitalize="words" list={`${id}-countries`} />
      <datalist id={`${id}-countries`}>
        {countries.map((country) => (
          <option key={country} value={country} />
        ))}
      </datalist>
      <TextField {...form.text("notes")} label="Notes" multiline />
    </EditPanel>
  );
}
