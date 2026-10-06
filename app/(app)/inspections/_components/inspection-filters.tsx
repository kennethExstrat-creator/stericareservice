"use client";

// Search and filters for the list. The URL is the state (BUILD_SPEC 10: a
// filtered view can be shared), so every change is a navigation to the
// canonical href from lib/inspections. Picking a status, client or
// manufacturer applies at once; search text applies on Enter or Search, so
// the list is not re-queried on every keystroke. While the new list loads the
// form carries [data-pending], which dims the results (see page.tsx).
//
// Without JavaScript the form still works as a plain GET form.
import { SearchIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition, type FormEvent } from "react";
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
  const [isPending, startTransition] = useTransition();

  // The pickers show a new choice on the same frame; the URL catches up.
  const [choices, setOptimisticChoices] = useOptimistic<Choices>({
    status: filters.status,
    client: filters.client,
    manufacturer: filters.manufacturer,
  });

  // The search box holds a draft until it is submitted, and follows the URL
  // when the URL changes some other way (Clear filters, the back button).
  const urlSearch = filters.q ?? "";
  const [search, setSearch] = useState(urlSearch);
  const [lastUrlSearch, setLastUrlSearch] = useState(urlSearch);
  if (urlSearch !== lastUrlSearch) {
    setLastUrlSearch(urlSearch);
    setSearch(urlSearch);
  }

  function apply(next: Choices, q: string) {
    startTransition(() => {
      setOptimisticChoices(next);
      // A new filter starts again at page 1.
      router.push(buildInspectionsHref({ ...next, q, page: 1 }), { scroll: false });
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply(choices, search);
  }

  function clearSearch() {
    setSearch("");
    if (urlSearch) apply(choices, "");
  }

  return (
    <form
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
        <InputGroup>
          <InputGroupAddon>
            {isPending ? <Spinner aria-label="Updating the list" /> : <SearchIcon aria-hidden />}
          </InputGroupAddon>
          <InputGroupInput
            id={`${id}-q`}
            name="q"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ref, PO or lot number"
            maxLength={MAX_SEARCH_LENGTH}
            enterKeyHint="search"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-q-hint`}
            className="[&::-webkit-search-cancel-button]:appearance-none"
          />
          <InputGroupAddon align="inline-end">
            {search && (
              <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={clearSearch}>
                <XIcon aria-hidden />
              </InputGroupButton>
            )}
            <InputGroupButton type="submit" variant="secondary" size="sm">
              Search
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <p id={`${id}-q-hint`} className="sr-only">
          Matches part of a ref or PO number, or a whole lot number.
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
            <SelectItem value={ALL}>All statuses</SelectItem>
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
            <SelectItem value={ALL}>All clients</SelectItem>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.label}
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
            <SelectItem value={ALL}>All manufacturers</SelectItem>
            {manufacturers.map((manufacturer) => (
              <SelectItem key={manufacturer.id} value={manufacturer.id}>
                {manufacturer.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </form>
  );
}
