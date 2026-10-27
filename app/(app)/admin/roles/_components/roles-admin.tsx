"use client";

import { useRef, type MouseEvent } from "react";
import { PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import type { RoleItem } from "@/lib/admin/roles";
import { usePanel } from "../../manufacturers/_components/reference-panel";
import { RolePanel } from "./role-panel";
import { RolesTable } from "./roles-table";

/**
 * /admin/roles in the browser: the list and the panel that adds and edits.
 * No search: a handful of roles, the three built-in ones first. The list is
 * never empty, since the built-in roles come with the app.
 */
export function RolesAdmin({ roles }: { roles: RoleItem[] }) {
  // Where the keyboard goes when a panel closes and the button it opened from has gone.
  const addButton = useRef<HTMLButtonElement>(null);
  const panel = usePanel(addButton);

  const editingId = panel.target.mode === "edit" ? panel.target.id : null;
  const item = editingId ? (roles.find((role) => role.id === editingId) ?? null) : null;
  const add = (event: MouseEvent<HTMLButtonElement>) => panel.show({ mode: "create" }, event.currentTarget);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Roles & Permissions"
        actions={
          <Button ref={addButton} onClick={add}>
            <PlusIcon aria-hidden />
            Add Role
          </Button>
        }
      />

      <RolesTable
        rows={roles}
        selectedId={panel.open ? editingId : null}
        onOpen={(id, opener) => panel.show({ mode: "edit", id }, opener)}
      />

      <RolePanel
        key={panel.key}
        open={panel.open}
        target={panel.target}
        item={item}
        onClose={panel.close}
        onDeleted={panel.closeDeleted}
        returnFocus={panel.returnFocus}
      />
    </div>
  );
}
