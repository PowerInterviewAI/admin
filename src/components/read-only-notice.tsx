"use client";

import { Eye } from "lucide-react";

import { useCan } from "@/components/session-context";
import type { Permission } from "@/lib/rbac";
import { cn } from "@/lib/utils";

/**
 * Says why the controls beside it are missing or disabled. Renders nothing for an account holding
 * `permission`, so a call site can drop it in unconditionally.
 *
 * A disabled button with no explanation reads as a bug in the page; this is the difference between
 * "the save button is broken" and "this account cannot save". It states the rule, not the failure -
 * the toast from a refused action states the failure.
 */
export function ReadOnlyNotice({
  permission,
  message = "Your account has read-only access.",
  className,
}: {
  permission: Permission;
  message?: string;
  className?: string;
}) {
  const allowed = useCan(permission);
  if (allowed) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <Eye className="size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
