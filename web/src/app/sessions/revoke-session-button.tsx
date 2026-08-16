"use client";

import { LogOut } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { SessionRow } from "@/lib/schemas/session";
import { revokeSession } from "@/server/actions/sessions";

/**
 * Owns its own confirmation and pending state so the sessions table's column definitions stay a
 * module-level constant instead of being rebuilt on every render to close over a handler.
 */
export function RevokeSessionButton({ session }: { session: SessionRow }) {
  const [open, setOpen] = useState(false);
  const [isRevoking, startRevoking] = useTransition();

  const onConfirm = () => {
    startRevoking(async () => {
      const result = await revokeSession(session._id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Session revoked");
      setOpen(false);
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        <LogOut data-icon="inline-start" />
        Revoke
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
          <AlertDialogDescription>
            The user on {session.device_info.ip_address || "this device"} will be signed out
            immediately.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={isRevoking} onClick={onConfirm}>
            {isRevoking ? "Revoking..." : "Revoke"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
