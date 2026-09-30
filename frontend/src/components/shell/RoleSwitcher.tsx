"use client";

import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ds/overlays";
import { useRole, roleLabels, type Role } from "@/lib/roleContext";

const roles: Role[] = ["district_admin", "phc_staff", "state_officer"];

export function RoleSwitcher() {
  const { role, setRole } = useRole();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Viewing as ${roleLabels[role]}`}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 text-[12px] text-text hover:bg-surface-3"
      >
        <span className="eyebrow hidden xl:inline">Viewing as</span>
        <span className="max-w-[9rem] truncate font-medium">{roleLabels[role]}</span>
        <ChevronDown size={13} className="text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {roles.map((r) => (
          <DropdownMenuItem key={r} onSelect={() => setRole(r)}>
            <Check size={12} className={r === role ? "text-brand" : "opacity-0"} />
            {roleLabels[r]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
