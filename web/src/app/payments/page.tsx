import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { parseSearchParams, paymentsSearchParamsSchema } from "@/lib/search-params";
import { listPayments } from "@/server/queries/payments";

import { PaymentsView } from "./payments-view";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const params = parseSearchParams(paymentsSearchParamsSchema, await searchParams);
  const page = await listPayments(params);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Payments"
        description="Every payment record, with manual status overrides."
      />
      <PaymentsView params={params} page={page} />
    </div>
  );
}
