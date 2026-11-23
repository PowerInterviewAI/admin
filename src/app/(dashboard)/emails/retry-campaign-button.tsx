"use client";

import { RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";

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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { campaignUnsentCount } from "@/lib/schemas/email";

function recipients(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? "recipient" : "recipients"}`;
}

/**
 * Re-sends to the rows a campaign has not reached, behind the same kind of confirmation a send has:
 * a retry is real mail to real inboxes, and one click on a button in a history dialog should not be
 * enough to start it.
 *
 * `onConfirm` resolves whether the retry started, so the dialog closes on success and stays open
 * on a failure the caller has already toasted.
 */
export function RetryCampaignButton({
  campaign,
  onConfirm,
}: {
  campaign: { total: number; sent_count: number; failed_count: number };
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isRetrying, startRetrying] = useTransition();

  const unsent = campaignUnsentCount(campaign);
  const failed = Math.min(campaign.failed_count, unsent);
  const neverContacted = unsent - failed;

  const breakdown = [
    failed > 0 ? `${formatNumber(failed)} failed` : null,
    neverContacted > 0 ? `${formatNumber(neverContacted)} never contacted` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const confirm = () => {
    startRetrying(async () => {
      if (await onConfirm()) setOpen(false);
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isRetrying && setOpen(next)}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        <RotateCcw data-icon="inline-start" />
        Retry {formatNumber(unsent)} unsent
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <RotateCcw />
          </AlertDialogMedia>
          <AlertDialogTitle>Retry {recipients(unsent)}?</AlertDialogTitle>
          <AlertDialogDescription>
            Sends this campaign again to the {recipients(unsent)} it has not reached ({breakdown}).
            Anyone it already reached is skipped. Sent mail cannot be recalled.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRetrying}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={isRetrying} onClick={confirm}>
            {isRetrying ? "Starting..." : "Retry now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
