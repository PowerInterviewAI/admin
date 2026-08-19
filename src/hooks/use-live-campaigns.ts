"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { usePoll } from "@/hooks/use-poll";
import {
  type EmailCampaignProgress,
  type EmailCampaignRow,
  isCampaignLive,
} from "@/lib/schemas/email";
import { getCampaignsProgress } from "@/server/actions/email-campaigns";

/**
 * Sending is paced at roughly one recipient per second and outlives the request that started it,
 * so any list of campaigns rendered on the server is stale within a second of reaching the
 * browser. Five seconds keeps the delivered count visibly moving while costing one counters-only
 * query per open tab - the delivery log is never read by this poll.
 */
export const CAMPAIGN_POLL_INTERVAL_MS = 5_000;

/**
 * Keeps the counters of any still-running campaign in `campaigns` up to date.
 *
 * Returns the same rows with live values merged in. The overlay is only ever applied to a row the
 * server still calls live, so once a re-render brings back an authoritative finished row, that row
 * wins - stale progress can never un-complete a campaign.
 *
 * A run that ends is followed by one `router.refresh()`, because the counters this polls are a
 * subset of what a row shows: `finished_at`, the campaign's final error, and the delivery log
 * behind the detail dialog all come from the server render.
 */
export function useLiveCampaigns(campaigns: EmailCampaignRow[]): EmailCampaignRow[] {
  const router = useRouter();
  const [progress, setProgress] = useState<Record<string, EmailCampaignProgress>>({});

  const rows = useMemo(
    () =>
      campaigns.map((campaign) => {
        const live = progress[campaign._id];
        if (!live || !isCampaignLive(campaign)) return campaign;

        return {
          ...campaign,
          status: live.status,
          interrupted: live.interrupted,
          total: live.total,
          sent_count: live.sent_count,
          failed_count: live.failed_count,
          error: live.error,
        };
      }),
    [campaigns, progress],
  );

  const activeIds = useMemo(
    () => rows.filter(isCampaignLive).map((row) => row._id),
    [rows],
  );

  const tick = useCallback(async () => {
    const result = await getCampaignsProgress(activeIds);
    // Silent on failure: this runs unattended in the background, and a database blip that the next
    // tick recovers from should not raise a toast on a page the admin is only reading.
    if (!result.ok) return;

    setProgress((current) => {
      let changed = false;
      const next = { ...current };

      for (const item of result.data) {
        const previous = current[item.id];
        if (
          previous?.status === item.status &&
          previous.interrupted === item.interrupted &&
          previous.total === item.total &&
          previous.sent_count === item.sent_count &&
          previous.failed_count === item.failed_count &&
          previous.error === item.error
        ) {
          continue;
        }
        next[item.id] = item;
        changed = true;
      }

      // Returning `current` unchanged matters: without it every tick would re-render the table and
      // throw away the rows' memoized cells for counters that did not move.
      return changed ? next : current;
    });

    if (result.data.every((item) => !isCampaignLive(item))) {
      router.refresh();
    }
  }, [activeIds, router]);

  usePoll(activeIds.length > 0, CAMPAIGN_POLL_INTERVAL_MS, tick);

  return rows;
}
