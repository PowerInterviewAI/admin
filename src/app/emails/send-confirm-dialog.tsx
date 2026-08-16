"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDuration, formatNumber } from "@/lib/format";
import { type EmailAudience, EMAIL_AUDIENCE_LABELS } from "@/lib/schemas/email";
import { Send } from "lucide-react";

/** Typed by hand before a send to the whole user base can start. */
const BULK_CONFIRM_WORD = "SEND";

interface SendConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  audience: EmailAudience;
  recipientCount: number;
  subject: string;
  delayMs: number;
  isSending: boolean;
  onConfirm: () => void;
}

export function SendConfirmDialog({
  open,
  onOpenChange,
  audience,
  recipientCount,
  subject,
  delayMs,
  isSending,
  onConfirm,
}: SendConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Send />
          </AlertDialogMedia>
          <AlertDialogTitle>
            Send to {formatNumber(recipientCount)}{" "}
            {recipientCount === 1 ? "recipient" : "recipients"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{subject}&rdquo; goes out to {EMAIL_AUDIENCE_LABELS[audience].toLowerCase()},
            paced at one message every {Math.round(delayMs / 100) / 10}s, taking about{" "}
            {formatDuration(recipientCount * delayMs)}. Sent mail cannot be recalled.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Remounted per opening so the confirmation word never arrives pre-filled from last time. */}
        {open && (
          <ConfirmFooter
            audience={audience}
            isSending={isSending}
            onConfirm={onConfirm}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmFooter({
  audience,
  isSending,
  onConfirm,
}: {
  audience: EmailAudience;
  isSending: boolean;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");

  // Only the whole-user-base send asks for it. A confirmation step that fires on every one-off
  // send is one people learn to type without reading.
  const needsWord = audience === "all";
  const canSend = !isSending && (!needsWord || typed.trim().toUpperCase() === BULK_CONFIRM_WORD);

  return (
    <>
      {needsWord && (
        <Field>
          <FieldLabel htmlFor="bulk-confirm">
            Type {BULK_CONFIRM_WORD} to confirm
          </FieldLabel>
          <Input
            id="bulk-confirm"
            autoComplete="off"
            autoFocus
            placeholder={BULK_CONFIRM_WORD}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isSending}>Cancel</AlertDialogCancel>
        <AlertDialogAction disabled={!canSend} onClick={onConfirm}>
          {isSending ? "Starting..." : "Send now"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
