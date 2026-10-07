"use client";

// Search and filters for the list. The URL is the state (BUILD_SPEC 10: a
// filtered view can be shared), so every change is a navigation to the
// canonical href from lib/inspections. Picking a status, client or
// manufacturer applies at once; search text applies on Enter or Search, so
// the list is not re-queried on every keystroke. While the new list loads the
// form carries [data-pending], which dims the results (see page.tsx).
//
// Without JavaScript the form still works as a plain GET form. Long client and
// manufacturer names truncate in the pickers (the label span is what the
// picker shows once chosen).
//
// Focus stays in the bar: Clear search puts it back in the search box (on the
// iPad the keyboard stays up for the next search), and the pickers keep it.
// Should the bar itself go (nothing left to filter), the list moves focus to
// the results instead (list-focus.tsx).
import { SearchIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useRef, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { INSPECTION_STATUS_LABEL } from "@/lib/inspections/format";
import {
  buildInspectionsHref,
  INSPECTIONS_PATH,
  MAX_SEARCH_LENGTH,
  type FilterOption,
  type InspectionListFilters,
} from "@/lib/inspections/search-params";
import type { InspectionStatus } from "@/lib/schemas/common";
import { useRequestListFocus } from "./list-focus";
import { SEARCH_FOCUS_TARGET } from "./list-focus-target";

type Choices = Pick<InspectionListFilters, "status" | "client" | "manufacturer">;

/** Radix Select needs a non-empty value for "no filter". */
const ALL = "all";

const STATUSES = Object.keys(INSPECTION_STATUS_LABEL) as InspectionStatus[];

function isStatus(value: string): value is InspectionStatus {
  return (STATUSES as string[]).includes(value);
}

export function InspectionFilters({
  filters,
  clients,
  manufacturers,
}: {
  filters: InspectionListFilters;
  clients: FilterOption[];
  manufacturers: FilterOption[];
}) {
  const id = useId();
  const router = useRouter();
  const requestFocus = useRequestListFocus();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The pickers show a new choice on the same frame; the URL catches up.
  const [choices, setOptimisticChoices] = useOptimistic<Choices>({
    status: filters.status,
    client: filters.client,
    manufacturer: filters.manufacturer,
  });

  // The search box holds a draft until it is submitted. Whenever the list
  // moves to other filters (a search, a picker, Clear Filters, the back
  // button) the box follows the URL, so it never shows a search that is not
  // applied. The page number is not part of it: paging keeps a draft. Text
  // typed while this bar's own navigation is on its way is the next search,
  // so the box keeps that.
  const urlSearch = filters.q ?? "";
  const view = buildInspectionsHref({ ...filters, page: 1 });
  const [search, setSearch] = useState(urlSearch);
  const [syncedView, setSyncedView] = useState(view);
  const [typedWhilePending, setTypedWhilePending] = useState(false);
  if (view !== syncedView) {
    setSyncedView(view);
    setTypedWhilePending(false);
    if (!typedWhilePending) setSearch(urlSearch);
  } else if (typedWhilePending && !isPending) {
    setTypedWhilePending(false);
  }

  function apply(next: Choices, q: string) {
    // A new filter starts again at page 1.
    const href = buildInspectionsHref({ ...next, q, page: 1 });
    // Only if the bar has focus: a tap on Search in Safari leaves it on <body>.
    if (formRef.current?.contains(document.activeElement)) requestFocus({ href, target: "search" });
    startTransition(() => {
      setOptimisticChoices(next);
      router.push(href, { scroll: false });
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply(choices, search);
  }

  function onSearchChange(value: string) {
    setSearch(value);
    if (isPending) setTypedWhilePending(true);
  }

  function clearSearch() {
    setSearch("");
    // The clear button goes with the text: focus moves to the box first, so it
    // never drops to <body>, and on the iPad the keyboard stays up.
    searchRef.current?.focus();
    // Also overtakes a search still on its way.
    if (urlSearch || isPending) apply(choices, "");
  }

  return (
    <form
      ref={formRef}
      role="search"
      aria-label="Filter inspections"
      action={INSPECTIONS_PATH}
      method="get"
      onSubmit={onSubmit}
      data-pending={isPending ? "" : undefined}
      className="grid grid-cols-1 gap-x-3 gap-y-3 md:grid-cols-3 lg:grid-cols-[minmax(16rem,1fr)_11rem_13rem_16rem] lg:items-end"
    >
      <div className="flex flex-col gap-1.5 md:col-span-3 lg:col-span-1">
        <Label htmlFor={`${id}-q`}>Search</Label>
        {/* The Search button sits beside the field, the clear button inside it. */}
        <div className="flex items-center gap-2">
          <InputGroup className="flex-1">
            <InputGroupAddon>
              {isPending ? <Spinner aria-label="Updating the list" /> : <SearchIcon aria-hidden />}
            </InputGroupAddon>
            <InputGroupInput
              {...SEARCH_FOCUS_TARGET}
              ref={searchRef}
              id={`${id}-q`}
              name="q"
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Ref, PO, lot or carton"
              maxLength={MAX_SEARCH_LENGTH}
              enterKeyHint="search"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${id}-q-hint`}
              className="[&::-webkit-search-cancel-button]:appearance-none"
            />
            {search && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={clearSearch}>
                  <XIcon aria-hidden />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          <Button type="submit" variant="secondary" className="shrink-0">
            Search
          </Button>
        </div>
        <p id={`${id}-q-hint`} className="sr-only">
          Matches part of a ref or PO number, or a whole lot or carton number.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-status`}>Status</Label>
        <Select
          name="status"
          value={choices.status ?? ALL}
          onValueChange={(value) => apply({ ...choices, status: isStatus(value) ? value : undefined }, search)}
        >
          <SelectTrigger id={`${id}-status`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {INSPECTION_STATUS_LABEL[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-client`}>Client</Label>
        <Select
          name="client"
          value={choices.client ?? ALL}
          onValueChange={(value) => apply({ ...choices, client: value === ALL ? undefined : value }, search)}
        >
          <SelectTrigger id={`${id}-client`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Clients</SelectItem>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                <span className="truncate">{client.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-manufacturer`}>Manufacturer</Label>
        <Select
          name="manufacturer"
          value={choices.manufacturer ?? ALL}
          onValueChange={(value) => apply({ ...choices, manufacturer: value === ALL ? undefined : value }, search)}
        >
          <SelectTrigger id={`${id}-manufacturer`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Manufacturers</SelectItem>
            {manufacturers.map((manufacturer) => (
              <SelectItem key={manufacturer.id} value={manufacturer.id}>
                <span className="truncate">{manufacturer.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </form>
  );
}
