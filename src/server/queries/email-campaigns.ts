import "server-only";

import type { Filter } from "mongodb";

import { CAMPAIGNS_TABS } from "@/lib/list-tabs";
import type { CampaignsSummary } from "@/lib/schemas/analytics";
import type { Page } from "@/lib/schemas/common";
import {
  type EmailCampaign,
  type EmailCampaignRow,
  emailCampaignSchema,
  isCampaignInterrupted,
} from "@/lib/schemas/email";
import { type EmailCampaignsSearchParams, PAGE_SIZE } from "@/lib/search-params";
import { COLLECTIONS, type Document, getCollection, toObjectId } from "@/server/db";
import { heartbeatTimeoutMs } from "@/server/email/transport";
import { countListTabs, summarize } from "@/server/queries/list-stats";
import { findMany, findOne, findPage } from "@/server/repository";

/** The delivery log is the bulk of a campaign document and no list view renders it. */
const WITHOUT_RECIPIENTS: Document = { recipients: 0 };

const RECENT_CAMPAIGN_LIMIT = 5;

function toRow(campaign: EmailCampaign, timeoutMs: number): EmailCampaignRow {
  return { ...campaign, interrupted: isCampaignInterrupted(campaign, timeoutMs) };
}

function buildCampaignsFilter(params: EmailCampaignsSearchParams): Filter<Document> {
  const filter: Filter<Document> = {};
  if (params.status) filter.status = params.status;
  return filter;
}

export async function listEmailCampaigns(
  params: EmailCampaignsSearchParams,
): Promise<Page<EmailCampaignRow>> {
  const filter = buildCampaignsFilter(params);

  const page = await findPage({
    collection: COLLECTIONS.emailCampaigns,
    schema: emailCampaignSchema,
    filter,
    sort: { [params.sort_by]: params.sort_dir === "desc" ? -1 : 1 },
    offset: (params.page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
    projection: WITHOUT_RECIPIENTS,
  });

  const timeoutMs = heartbeatTimeoutMs();
  return { ...page, items: page.items.map((campaign) => toRow(campaign, timeoutMs)) };
}

/** Feeds the composer's "recent sends" strip, so the last campaign is visible while writing the next. */
export async function listRecentEmailCampaigns(): Promise<EmailCampaignRow[]> {
  const campaigns = await findMany({
    collection: COLLECTIONS.emailCampaigns,
    schema: emailCampaignSchema,
    sort: { created_at: -1 },
    limit: RECENT_CAMPAIGN_LIMIT,
    projection: WITHOUT_RECIPIENTS,
  });

  const timeoutMs = heartbeatTimeoutMs();
  return campaigns.map((campaign) => toRow(campaign, timeoutMs));
}

/**
 * Recipients, deliveries and failures are summed from the campaigns' own counters rather than from
 * their delivery logs: the counters are what the runner maintains, and reading the logs would pull
 * every recipient row of every campaign to count them.
 */
export async function getCampaignsSummary(
  params: EmailCampaignsSearchParams,
): Promise<CampaignsSummary> {
  return summarize<CampaignsSummary>({
    collection: COLLECTIONS.emailCampaigns,
    filter: buildCampaignsFilter(params),
    group: {
      total: { $sum: 1 },
      recipients: { $sum: { $ifNull: ["$total", 0] } },
      delivered: { $sum: { $ifNull: ["$sent_count", 0] } },
      failed: { $sum: { $ifNull: ["$failed_count", 0] } },
      latest: { $max: "$created_at" },
    },
    empty: { total: 0, recipients: 0, delivered: 0, failed: 0, latest: null },
  });
}

export function countCampaignsTabs(params: EmailCampaignsSearchParams) {
  return countListTabs(CAMPAIGNS_TABS, params, (tab) =>
    getCollection(COLLECTIONS.emailCampaigns).countDocuments(buildCampaignsFilter(tab)),
  );
}

/** The full document, delivery log included. Read only when a campaign's detail dialog opens. */
export async function getEmailCampaign(campaignId: string): Promise<EmailCampaign | null> {
  return findOne({
    collection: COLLECTIONS.emailCampaigns,
    schema: emailCampaignSchema,
    filter: { _id: toObjectId(campaignId) },
  });
}
