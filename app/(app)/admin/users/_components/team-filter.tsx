"use client";

// The Team picker above the user list: everyone, one lead inspector's team,
// or the inspectors who are in no team yet. The URL is the state
// (?team=, _lib/team-filter.ts): a pick navigates at once, as the
// inspections list's pickers do, and the picker shows it on the same frame.
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useTransition } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { teamHref, type FilterOption } from "../_lib/team-filter";

export function TeamFilter({ value, options }: { value: string; options: readonly FilterOption[] }) {
  const id = useId();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(value);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-pending={isPending ? "" : undefined}>
      <Label htmlFor={`${id}-team`}>Team</Label>
      <Select
        value={shown}
        onValueChange={(next) => {
          startTransition(() => {
            setShown(next);
            router.push(teamHref(next), { scroll: false });
          });
        }}
      >
        <SelectTrigger id={`${id}-team`} className="w-72 max-w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="truncate">{option.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isPending && <Spinner aria-label="Updating the list" />}
    </div>
  );
}
