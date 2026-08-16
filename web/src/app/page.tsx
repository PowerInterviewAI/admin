import { Activity, Coins, Users, Wallet } from "lucide-react";
import { connection } from "next/server";

import { DistributionChart, TrendChart } from "@/components/charts";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { formatNumber, formatUsd } from "@/lib/format";
import { ANALYTICS_WINDOW_DAYS, getAnalyticsOverview } from "@/server/queries/analytics";

import { RecentActivityTable } from "./recent-activity-table";

export default async function DashboardPage() {
  // This route takes no search params, so without an explicit request dependency Next would try
  // to prerender it at build time - against a database that is not running during the build.
  await connection();

  const data = await getAnalyticsOverview();
  const asrSessions = data.activity.asr_sessions_per_day.reduce((sum, day) => sum + day.count, 0);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Dashboard"
        description="Real usage and revenue data, read directly from the Power Interview AI database."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Users"
          value={formatNumber(data.users.total)}
          icon={Users}
          hint={`${formatNumber(data.users.by_role.admin ?? 0)} admins`}
        />
        <StatCard
          label="Revenue (finished)"
          value={formatUsd(data.revenue.total_usd)}
          icon={Wallet}
          hint="Lifetime, status = finished"
        />
        <StatCard
          label="Credits Outstanding"
          value={formatNumber(data.credits_outstanding)}
          icon={Coins}
          hint="Sum across all users"
        />
        <StatCard
          label={`ASR Sessions (${ANALYTICS_WINDOW_DAYS}d)`}
          value={formatNumber(asrSessions)}
          icon={Activity}
          hint={`asr_start events, last ${ANALYTICS_WINDOW_DAYS} days`}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Signups"
          description={`New users per day, last ${ANALYTICS_WINDOW_DAYS} days`}
          isEmpty={data.users.signups_per_day.length === 0}
        >
          <TrendChart
            data={data.users.signups_per_day.map((day) => ({ date: day.date, value: day.count }))}
            label="Signups"
            color="var(--chart-1)"
          />
        </ChartCard>

        <ChartCard
          title="Revenue"
          description={`Finished payments per day, last ${ANALYTICS_WINDOW_DAYS} days`}
          isEmpty={data.revenue.per_day.length === 0}
        >
          <TrendChart
            data={data.revenue.per_day.map((day) => ({ date: day.date, value: day.amount }))}
            label="Revenue"
            color="var(--chart-2)"
            format="usd"
          />
        </ChartCard>

        <ChartCard
          title="Users by role"
          description="Current distribution"
          isEmpty={Object.keys(data.users.by_role).length === 0}
        >
          <DistributionChart data={data.users.by_role} />
        </ChartCard>

        <ChartCard
          title="Payments by status"
          description="All-time, every payment record"
          isEmpty={Object.keys(data.revenue.payments_by_status).length === 0}
        >
          <DistributionChart data={data.revenue.payments_by_status} />
        </ChartCard>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Latest {data.recent_activity.length || 20} audit log events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecentActivityTable entries={data.recent_activity} />
        </CardContent>
      </Card>
    </div>
  );
}

function ChartCard({
  title,
  description,
  isEmpty,
  children,
}: {
  title: string;
  description: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No data yet</EmptyTitle>
              <EmptyDescription>Nothing in this window.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
