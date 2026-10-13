import { z } from "zod";

import { objectIdSchema, timestampsSchema, type UserLabel } from "@/lib/schemas/common";
import { userStatusSchema } from "@/lib/schemas/user";

/**
 * Backend's reseller ledger and daily settlements, as this app reads them. Backend owns both
 * collections (`app/models/reseller.py`); if a field changes there, change it here.
 *
 * Only `committed` ledger rows are ever read: a `pending` row is a request still in flight or one
 * that died before its side effect, and it bills nothing. That filter lives in the queries, not
 * here, so a pending row can never be parsed into a sale in the first place.
 */
export const ledgerKindSchema = z.enum(["user_created", "subscription_granted", "credits_granted"]);
export type LedgerKind = z.infer<typeof ledgerKindSchema>;
export const LEDGER_KINDS = ledgerKindSchema.options;

export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  user_created: "New customer",
  subscription_granted: "Extension",
  // Sold before subscriptions; still settled and shown, never written any more.
  credits_granted: "Credit top-up",
};

/**
 * Where a ledger row is in its life. Backend reserves a row `pending`, commits it once the customer
 * or the days exist, and parks one it cannot decide as `unresolved` (a grant whose extension may or
 * may not have landed). This app reads `committed` rows as sales and `unresolved` ones as a review
 * queue; `pending` and `void` are never shown.
 */
export const saleStateSchema = z.enum(["pending", "committed", "unresolved", "void"]);
export type SaleState = z.infer<typeof saleStateSchema>;

export const resellerSaleSchema = z.object({
  _id: objectIdSchema,
  reseller_id: objectIdSchema,
  user_id: objectIdSchema.nullish().default(null),
  customer_email: z.string().default(""),
  // A kind this build has never heard of reads as an extension rather than failing the whole page:
  // the amounts on the row are what billing cares about, and those still count.
  kind: ledgerKindSchema.catch("subscription_granted"),
  /** A row sells days at a per-month rate, or (before subscriptions) credits at a per-hour rate. */
  days: z.number().int().default(0),
  rate_cents_per_month: z.number().int().nullish().default(null),
  credits: z.number().int().default(0),
  rate_cents_per_hour: z.number().int().nullish().default(null),
  reference: z.string().nullish().default(null),
  price_amount: z.number().nullish().default(null),
  price_currency: z.string().nullish().default(null),
  note: z.string().nullish().default(null),
  // Committed rows are the only ones backend bills, so anything unrecognised reads as the state that
  // bills nothing and asks for review rather than as a sale.
  state: saleStateSchema.catch("unresolved"),
  created_at: z.number().int().nullish().default(null),
  committed_at: z.number().int().nullish().default(null),
});

export type ResellerSale = z.infer<typeof resellerSaleSchema>;

/** The reseller a row belongs to, resolved for a whole page at once. Null if the account is gone. */
export interface ResellerLabel {
  id: string;
  name: string;
  email: string;
}

export interface ResellerSaleRow extends ResellerSale {
  reseller: ResellerLabel | null;
  user: UserLabel | null;
}

export const settlementStatusSchema = z.enum(["open", "paid"]);
export type SettlementStatus = z.infer<typeof settlementStatusSchema>;
export const SETTLEMENT_STATUSES = settlementStatusSchema.options;

export const resellerSettlementSchema = z.object({
  _id: objectIdSchema,
  reseller_id: objectIdSchema,
  day: z.string(),
  days: z.number().int().default(0),
  credits: z.number().int().default(0),
  users_created: z.number().int().default(0),
  /** Null when anything that day was sold without a rate: unknown, never understated. */
  amount_owed_cents: z.number().int().nullish().default(null),
  unpriced_days: z.number().int().default(0),
  unpriced_credits: z.number().int().default(0),
  status: settlementStatusSchema.catch("open"),
  paid_at: z.number().int().nullish().default(null),
  paid_by: z.string().nullish().default(null),
  created_at: z.number().int().nullish().default(null),
});

export type ResellerSettlement = z.infer<typeof resellerSettlementSchema>;

export interface ResellerSettlementRow extends ResellerSettlement {
  reseller: ResellerLabel | null;
}

/** What an admin decides about a grant backend could not: it did land (bill it), or it did not. */
export const saleResolutionSchema = z.object({ state: z.enum(["committed", "void"]) });

export const settlementStatusUpdateSchema = z.object({ status: settlementStatusSchema });

/**
 * A reseller's customer as their portal shows it. Deliberately not `userSchema`: that carries the
 * customer's CV and job description, which are none of the reseller's business, and the query reads
 * through a projection that never fetches them.
 */
export const resellerCustomerSchema = timestampsSchema.extend({
  _id: objectIdSchema,
  username: z.string().default(""),
  email: z.string().default(""),
  subscription_expires_at: z.number().int().nullish().default(null),
  /** Decided on the server against one clock, like the admin's own user list. */
  subscribed: z.boolean().default(false),
  status: userStatusSchema.catch("inactive"),
});

export type ResellerCustomer = z.infer<typeof resellerCustomerSchema>;

/** What the dashboard knows about a reseller's key: enough to recognise it, never enough to use it. */
export interface ApiKeyStatus {
  prefix: string | null;
  created_at: number | null;
}

/** One row of the admin's reseller overview. */
export interface ResellerOverviewRow {
  id: string;
  name: string;
  email: string;
  status: string;
  key: ApiKeyStatus;
  rate_cents_per_month: number | null;
  /** Within the selected window. */
  customers: number;
  days: number;
  last_sale_at: number | null;
  /** Across every open settlement, regardless of the window: what is owed now. */
  owed_open_cents: number;
  unpriced_open_days: number;
  unpriced_open_credits: number;
}

/**
 * The rate an admin types, in dollars per 30 days of subscription. Stored as integer cents, because
 * it is money. `null` clears it, which makes every sale from then on unpriced.
 */
export const resellerRateSchema = z.object({
  usd_per_month: z.number().min(0, "A rate cannot be negative").max(100_000).nullable(),
});

export type ResellerRateInput = z.infer<typeof resellerRateSchema>;

export const CREDITS_PER_HOUR = 600;
export const DAYS_PER_MONTH = 30;

/**
 * Days are priced per 30-day month and legacy credits per 600-credit hour. Scaling
 * `days x rate_per_month` by 600 / 30 puts both on one denominator, as backend's settlement does.
 */
export const DAY_PRICE_SCALE = CREDITS_PER_HOUR / DAYS_PER_MONTH;

/**
 * Mirrors backend's `amount_owed_cents`: one rounding, half up, on the summed numerator
 * `sum(credits x rate_per_hour) + sum(days x rate_per_month) x 20`.
 */
export function owedCents(priced: number): number {
  return Math.floor((priced + CREDITS_PER_HOUR / 2) / CREDITS_PER_HOUR);
}
