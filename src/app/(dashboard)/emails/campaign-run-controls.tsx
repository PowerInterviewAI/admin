"use client";

import { Pause, Play, Square } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import type { ActionData } from "@/lib/action-result";
import { formatNumber } from "@/lib/format";
import {
  type EmailCampaignControl,
  type EmailCampaignProgress,
  type EmailCampaignStatus,
  campaignUnsentCount,
  canPauseCampaign,
  canResumeCampaign,
  canStopCampaign,
} from "@/lib/schemas/email";
import {
  pauseEmailCampaign,
  resumeEmailCampaign,
  stopEmailCampaign,
} from "@/server/actions/email-campaigns";

interface ControllableCampaign {
  id: string;
  status: EmailCampaignStatus;
  interrupted: boolean;
  control: EmailCampaignControl | null;
  total: number;
  sent_count: number;
}

type Operation = "pause" | "resume" | "stop";

const ACTIONS: Record<Operation, (id: string) => Promise<ActionData<EmailCampaignProgress>>> = {
  pause: pauseEmailCampaign,
  resume: resumeEmailCampaign,
  stop: stopEmailCampaign,
};

function recipients(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? "recipient" : "recipients"}`;
}

/**
 * Pause, Resume and Stop for one campaign, shared by the composer's progress card and the history
 * dialog so the two offer the same controls under the same rules.
 *
 * Pause and Resume are not confirmed: pausing sends nothing and is undone by Resume, and Resume
 * only continues a send that was confirmed when it started. Stop is, because it ends the campaign
 * for everyone not reached yet.
 *
 * A pause or stop is a request the running loop acts on after the message in flight, so while one
 * is pending the button that asked for it says so instead of disappearing.
 */
export function CampaignRunControls({
  campaign,
  onChange,
}: {
  campaign: ControllableCampaign;
  /** The campaign's state right after the action, for callers that hold it in local state. */
  onChange?: (progress: EmailCampaignProgress) => void;
}) {
  const [pending, setPending] = useState<Operation | null>(null);
  const [isWorking, startWorking] = useTransition();
  const [stopOpen, setStopOpen] = useState(false);

  const run = (operation: Operation, onDone?: () => void) => {
    setPending(operation);
    startWorking(async () => {
      const result = await ACTIONS[operation](campaign.id);
      setPending(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onDone?.();
      onChange?.(result.data);
    });
  };

  const canPause = canPauseCampaign(campaign);
  const canResume = canResumeCampaign(campaign);
  const canStop = canStopCampaign(campaign);
  const pausing = campaign.status === "sending" && campaign.control === "pause";
  const stopping = campaign.status === "sending" && campaign.control === "stop" && !campaign.interrupted;

  if (!canPause && !canResume && !canStop && !pausing && !stopping) return null;

  const unsent = campaignUnsentCount(campaign);

  return (
    <div className="flex items-center gap-2">
      {(canPause || pausing) && (
        <Button
          variant="outline"
          size="sm"
          disabled={isWorking || pausing}
          onClick={() => run("pause")}
        >
          <Pause data-icon="inline-start" />
          {pausing || pending === "pause" ? "Pausing..." : "Pause"}
        </Button>
      )}

      {canResume && (
        <Button size="sm" disabled={isWorking} onClick={() => run("resume")}>
          <Play data-icon="inline-start" />
          {pending === "resume" ? "Resuming..." : "Resume"}
        </Button>
      )}

      {(canStop || stopping) && (
        <AlertDialog open={stopOpen} onOpenChange={(next) => !isWorking && setStopOpen(next)}>
          <AlertDialogTrigger
            render={<Button variant="outline" size="sm" disabled={isWorking || stopping} />}
          >
            <Square data-icon="inline-start" />
            {stopping ? "Stopping..." : "Stop"}
          </AlertDialogTrigger>
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Stop this campaign?</AlertDialogTitle>
              <AlertDialogDescription>
                {unsent > 0
                  ? `The ${recipients(unsent)} not reached yet will not receive it. `
                  : ""}
                {campaign.status === "sending" && !campaign.interrupted
                  ? "The message being sent right now still goes out. "
                  : ""}
                You can send to anyone left out later with Retry.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isWorking}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={isWorking}
                onClick={() => run("stop", () => setStopOpen(false))}
              >
                {pending === "stop" ? "Stopping..." : "Stop campaign"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
