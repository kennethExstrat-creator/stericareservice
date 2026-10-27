"use server";

import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";
import { fieldErrors, type DatabaseClient, type DatabaseError } from "@/lib/admin/reference";
import { authorizeAction } from "@/lib/auth/session";
import {
  DIRECTORY_SELECT,
  directoryFromRows,
  directoryOptions,
  findByName,
  planManufacturer,
  type DirectoryBrand,
  type DirectoryCompany,
  type DirectoryFactory,
  type ManufacturerDirectory,
} from "@/lib/inspections/reference-match";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CHECK_FIELDS,
  NewClientSchema,
  NewManufacturerSchema,
  NO_SWITCH,
  NOT_ADDED,
  NOTES,
  planWords,
  SEVERAL_CLIENTS,
  type AddClientResult,
  type AddManufacturerResult,
  type NewClientInput,
  type NewManufacturerInput,
} from "./_lib/new-entries";

/*
 * New Client and New Manufacturer on /inspections/new (docs/AI.md, "Reading
 * order documents"; Kenneth, 27 October 2026: "the Steri AI should be able to
 * read doc to use existing client and manufacturer or create new one"). When
 * Steri-AI reads a client or manufacturer neither list has, the form shows it
 * as new with what the document prints, editable, and one tap on Add adds it
 * and chooses it: never without that tap.
 *
 * Anyone whose role creates inspections may add this way (Kenneth's choice).
 * That widens who writes these tables: the database lets only roles with the
 * Clients or Manufacturers switch insert clients, brands, companies and
 * factories (has_permission), so these actions check Create Inspections and
 * then write with the secret key, as createInspection writes an inspector's
 * draft. They only add: editing and deleting stay with the switches, on
 * Admin > Clients and Admin > Manufacturers. A server without the key writes
 * through the caller's own session, which Row Level Security allows only
 * with the switch.
 *
 * Never a near-duplicate: the names are compared with the lists again here,
 * case, punctuation, spacing and legal suffixes aside
 * (lib/inspections/reference-match.ts). A name that reads like a listed one
 * is that one, chosen and not added; a manufacturer's listed brand or company
 * is reused and only what is missing is added. Two taps at once meet the
 * unique indexes (names ignoring case): the second one's 23505 reads the
 * lists again and chooses what the first added. A refused write is logged
 * by its code alone, never with the names typed.
 */

type Failed<Field extends string> = { status: "error"; message: string; fieldErrors?: Partial<Record<Field, string>> };

function failed<Field extends string>(message: string, errors?: Partial<Record<Field, string>>): Failed<Field> {
  return errors ? { status: "error", message, fieldErrors: errors } : { status: "error", message };
}

/** The secret-key client when the server has the key, else the caller's own (Row Level Security decides). */
function writerFor(supabase: DatabaseClient): DatabaseClient {
  return isAdminClientConfigured() ? createAdminClient() : supabase;
}

/** A refused insert in plain words: 42501 is a server without the key and a role without the switch. */
function notAdded(kind: "client" | "manufacturer", error: DatabaseError): string {
  return error.code === "42501" ? NO_SWITCH[kind] : NOT_ADDED[kind];
}

/** Someone added the same name (23505), or removed what a new row goes under (23503), since the lists were read. */
const changedMeanwhile = (error: DatabaseError) => error.code === "23505" || error.code === "23503";

/* ------------------------------------------------------------------ *
 * New Client
 * ------------------------------------------------------------------ */

/** Adds the client a document names and answers it for the picker, or the listed client its name reads like. */
export async function addClientFromDocument(input: NewClientInput): Promise<AddClientResult> {
  try {
    const auth = await authorizeAction({ permission: "create_inspections" });
    if (!auth.ok) return failed(auth.error);
    const parsed = NewClientSchema.safeParse(input);
    if (!parsed.success) return failed(CHECK_FIELDS, fieldErrors(parsed.error));
    const { name } = parsed.data;

    const supabase = await createClient();
    const writer = writerFor(supabase);
    // Twice at most: the second time, the client added meanwhile is in the list.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const clients = await supabase.from("clients").select("id, name");
      if (clients.error) {
        console.error("[inspections/new] addClientFromDocument: reading the clients failed", clients.error.code);
        return failed(NOT_ADDED.client);
      }
      const found = findByName(name, clients.data, (client) => client.name);
      if (found.kind === "one") return { status: "listed", option: { id: found.entry.id, label: found.entry.name }, note: NOTES.listed };
      if (found.kind === "several") return failed(SEVERAL_CLIENTS, { name: SEVERAL_CLIENTS });

      const added = await writer.from("clients").insert({ name }).select("id, name").single();
      if (!added.error) return { status: "added", option: { id: added.data.id, label: added.data.name }, note: NOTES.clientAdded };
      if (!changedMeanwhile(added.error)) {
        console.error("[inspections/new] addClientFromDocument: the insert was refused", added.error.code);
        return failed(notAdded("client", added.error));
      }
    }
    return failed(NOT_ADDED.client);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[inspections/new] addClientFromDocument failed", error);
    return failed(NOT_ADDED.client);
  }
}

/* ------------------------------------------------------------------ *
 * New Manufacturer
 * ------------------------------------------------------------------ */

type Inserted<Row> = { row: Row } | { changed: true } | { error: DatabaseError };

/** One insert's outcome: the row, a change someone made meanwhile (read the lists again), or a refusal. */
async function inserted<Row>(query: PromiseLike<PostgrestSingleResponse<Row>>, what: "brand" | "company" | "factory"): Promise<Inserted<Row>> {
  const response = await query;
  if (!response.error) return { row: response.data };
  if (changedMeanwhile(response.error)) return { changed: true };
  console.error(`[inspections/new] addManufacturerFromDocument: adding the ${what} was refused`, response.error.code);
  return { error: response.error };
}

/**
 * Adds the manufacturer a document names, only what the list lacks (a
 * factory under a listed company, a company under a listed brand, or all
 * three), and answers its factory for the picker; or the listed factory its
 * names lead to.
 */
export async function addManufacturerFromDocument(input: NewManufacturerInput): Promise<AddManufacturerResult> {
  try {
    const auth = await authorizeAction({ permission: "create_inspections" });
    if (!auth.ok) return failed(auth.error);
    const parsed = NewManufacturerSchema.safeParse(input);
    if (!parsed.success) return failed(CHECK_FIELDS, fieldErrors(parsed.error));
    const entry = parsed.data;

    const supabase = await createClient();
    const writer = writerFor(supabase);
    // Twice at most: after a change made meanwhile, the plan is made again on the lists as they are now.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const brands = await supabase.from("manufacturer_brands").select(DIRECTORY_SELECT);
      if (brands.error) {
        console.error("[inspections/new] addManufacturerFromDocument: reading the manufacturers failed", brands.error.code);
        return failed(NOT_ADDED.manufacturer);
      }
      const directory = directoryFromRows(brands.data);
      const label = (factoryId: string) => directoryOptions(directory).find((option) => option.id === factoryId)?.label ?? "";
      const plan = planManufacturer(entry, directory);
      if (plan.kind === "listed") {
        return { status: "listed", option: { id: plan.factoryId, label: label(plan.factoryId) }, note: NOTES.listed, directory };
      }
      if (plan.kind !== "add") {
        const words = planWords(plan, label);
        return failed(words.text, words.field ? { [words.field]: words.text } : undefined);
      }

      // What the list lacks, in order: the brand, its company, the factory.
      let brandId = plan.brand.id;
      let brand: DirectoryBrand | null = null;
      if (brandId === null) {
        const result = await inserted(writer.from("manufacturer_brands").insert({ name: plan.brand.name }).select("id, name").single(), "brand");
        if ("changed" in result) continue;
        if ("error" in result) return failed(notAdded("manufacturer", result.error));
        brand = result.row;
        brandId = brand.id;
      }

      let companyId = plan.company.id;
      let company: DirectoryCompany | null = null;
      if (companyId === null) {
        const result = await inserted(
          writer.from("manufacturer_companies").insert({ brand_id: brandId, name: plan.company.name }).select("id, name").single(),
          "company",
        );
        if ("changed" in result) {
          // The company was added meanwhile, under a brand of its own: the brand just added would stay empty.
          if (brand) await writer.from("manufacturer_brands").delete().eq("id", brand.id);
          continue;
        }
        if ("error" in result) return failed(notAdded("manufacturer", result.error));
        company = { id: result.row.id, brandId, name: result.row.name };
        companyId = company.id;
      }

      // manufacturers.name is left out: a trigger copies the company's name into it.
      const result = await inserted(
        writer
          .from("manufacturers")
          .insert({ company_id: companyId, factory_name: entry.factory, address: entry.address, country: entry.country })
          .select("id, factory_name, country")
          .single(),
        "factory",
      );
      if ("changed" in result) continue;
      if ("error" in result) return failed(notAdded("manufacturer", result.error));

      const factory: DirectoryFactory = { id: result.row.id, companyId, factoryName: result.row.factory_name, country: result.row.country };
      const now: ManufacturerDirectory = {
        brands: brand ? [...directory.brands, brand] : directory.brands,
        companies: company ? [...directory.companies, company] : directory.companies,
        factories: [...directory.factories, factory],
      };
      return {
        status: "added",
        option: directoryOptions(now).find((option) => option.id === factory.id) ?? { id: factory.id, label: plan.company.name },
        note: planWords(plan, label, "Added").text,
        directory: now,
      };
    }
    return failed(NOT_ADDED.manufacturer);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[inspections/new] addManufacturerFromDocument failed", error);
    return failed(NOT_ADDED.manufacturer);
  }
}
