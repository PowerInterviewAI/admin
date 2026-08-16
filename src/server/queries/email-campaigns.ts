import "server-only";

import type { Filter } from "mongodb";

import type { Page } from "@/lib/schemas/common";
import {
  type EmailCampaign,
  type EmailCampaignRow,
  emailCampaignSchema,
  isCampaignInterrupted,
} from "@/lib/schemas/email";
import { type EmailCampaignsSearchParams, PAGE_SIZE } from "@/lib/search-params";
import { COLLECTIONS, type Document, toObjectId } from "@/server/db";
import { findMany, findOne, findPage } from "@/server/repository";

/** The delivery log is the bulk of a campaign document and no list view renders it. */
const WITHOUT_RECIPIENTS: Document = { recipients: 0 };

const RECENT_CAMPAIGN_LIMIT = 5;

function toRow(campaign: EmailCampaign): EmailCampaignRow {
  return { ...campaign, interrupted: isCampaignInterrupted(campaign) };
}

export async function listEmailCampaigns(
  params: EmailCampaignsSearchParams,
): Promise<Page<EmailCampaignRow>> {
  const filter: Filter<Document> = {};
  if (params.status) filter.status = params.status;

  const page = await findPage({
    collection: COLLECTIONS.emailCampaigns,
    schema: emailCampaignSchema,
    filter,
    sort: { [params.sort_by]: params.sort_dir === "desc" ? -1 : 1 },
    offset: (params.page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
    projection: WITHOUT_RECIPIENTS,
  });

  return { ...page, items: page.items.map(toRow) };
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

  return campaigns.map(toRow);
}

/** The full document, delivery log included. Read only when a campaign's detail dialog opens. */
export async function getEmailCampaign(campaignId: string): Promise<EmailCampaign | null> {
  return findOne({
    collection: COLLECTIONS.emailCampaigns,
    schema: emailCampaignSchema,
    filter: { _id: toObjectId(campaignId) },
  });
}
