import {
  CheckCircle2,
  Coins,
  CreditCard,
  GraduationCap,
  Mic,
  Monitor,
  Radio,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";

import {
  DistributionChart,
  HourHistogram,
  MultiTrendChart,
  StackedDayChart,
  TrendChart,
} from "@/components/charts";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { formatNumber, formatUsd } from "@/lib/format";
import { dashboardSearchParamsSchema, parseSearchParams } from "@/lib/search-params";
import { isAdminRequest } from "@/server/auth/guard";
import { getAnalyticsOverview, windowStartDate } from "@/server/queries/analytics";

import { RangeSelect } from "./range-select";
import { RecentActivityTable } from "./recent-activity-table";

const ACTIVITY_SERIES = [
  { key: "logins", label: "Logins", color: "var(--chart-1)" },
  { key: "signups", label: "Signups", color: "var(--chart-2)" },
  { key: "asr", label: "ASR sessions", color: "var(--chart-3)" },
];

const INTERVIEW_SERIES = [
  { key: "live", label: "Live", color: "var(--chart-1)" },
  { key: "mock", label: "Mock", color: "var(--chart-4)" },
];

const OUTCOME_SERIES = [
  { key: "failure", label: "Failed", color: "var(--chart-5)" },
  { key: "success", label: "Succeeded", color: "var(--chart-2)" },
];

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio >= 0.1 ? 0 : 1)}%`;
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const { days } = parseSearchParams(dashboardSearchParamsSchema, await searchParams);
  const [data, isAdmin] = await Promise.all([getAnalyticsOverview(days), isAdminRequest()]);

  const window = `last ${days} days`;

  // Joined on the date rather than by index. The three series are each densified over the same
  // window so they do line up today, but that is an invariant of a helper three awaits away - a
  // silently misaligned chart is not something the shape of this code should be able to produce.
  const signupsByDate = new Map(data.activity.signups_per_day.map((day) => [day.date, day.count]));
  const asrByDate = new Map(data.activity.asr_sessions_per_day.map((day) => [day.date, day.count]));
  const activitySeries = data.activity.logins_per_day.map((day) => ({
    date: day.date,
    logins: day.count,
    signups: signupsByDate.get(day.date) ?? 0,
    asr: asrByDate.get(day.date) ?? 0,
  }));

  const mockByDate = new Map(data.interviews.mock_per_day.map((day) => [day.date, day.count]));
  const interviewSeries = data.interviews.live_per_day.map((day) => ({
    date: day.date,
    live: day.count,
    mock: mockByDate.get(day.date) ?? 0,
  }));
  const running = data.now.live_interviews + data.now.mock_interviews;

  const from = windowStartDate(days);

  const conversion = data.users.total > 0 ? data.revenue.paying_users / data.users.total : 0;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Dashboard"
        description="Real usage and revenue data, read directly from the Power Interview AI database."
        actions={<RangeSelect value={days} />}
      />

      <div className="stale-dim grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Apps Online"
          href="/users?online=yes"
          value={formatNumber(data.now.apps_online)}
          icon={Monitor}
          hint={`${formatNumber(data.now.users_online)} signed-in user${data.now.users_online === 1 ? "" : "s"}, right now`}
        />
        <StatCard
          label="Interviews Running"
          href="/interviews?state=running"
          value={formatNumber(running)}
          icon={Radio}
          hint={`${formatNumber(data.now.live_interviews)} live / ${formatNumber(data.now.mock_interviews)} mock, right now`}
        />
        <StatCard
          label="Live Interviews"
          href={`/interviews?kind=live&from=${from}`}
          value={formatNumber(data.interviews.live_in_window)}
          icon={Mic}
          hint={`Started in the ${window}`}
        />
        <StatCard
          label="Mock Interviews"
          href={`/interviews?kind=mock&from=${from}`}
          value={formatNumber(data.interviews.mock_in_window)}
          icon={GraduationCap}
          hint={`Started in the ${window}`}
        />
        <StatCard
          label="Total Users"
          href="/users"
          value={formatNumber(data.users.total)}
          icon={Users}
          hint={`${formatNumber(data.users.new_in_window)} new in the ${window}`}
        />
        <StatCard
          label="Active Users"
          href={isAdmin ? `/audit-logs?from=${from}` : undefined}
          value={formatNumber(data.activity.active_users)}
          icon={UserCheck}
          hint={`Distinct accounts with any event, ${window}`}
        />
        <StatCard
          label="Paying Users"
          href="/payments?bucket=finished"
          value={formatNumber(data.revenue.paying_users)}
          icon={CreditCard}
          hint={`${formatPercent(conversion)} of all accounts`}
        />
        <StatCard
          label="Payment Success"
          href="/payments"
          value={formatPercent(data.revenue.success_rate)}
          icon={CheckCircle2}
          hint="Finished, as a share of every payment"
        />
      </div>

      <div className="stale-dim mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Revenue (finished)"
          href="/payments?bucket=finished"
          value={formatUsd(data.revenue.total_usd)}
          icon={Wallet}
          hint={`${formatUsd(data.revenue.window_usd)} in the ${window}`}
        />
        <StatCard
          label="Revenue per Payer"
          href="/payments?bucket=finished"
          value={formatUsd(data.revenue.avg_per_paying_user)}
          icon={TrendingUp}
          hint="Lifetime, across paying accounts"
        />
        <StatCard
          label="Credits Outstanding"
          href="/users?role=user&min_credits=1&sort_by=credits"
          value={formatNumber(data.credits_outstanding)}
          icon={Coins}
          hint="Sum across all users"
        />
      </div>

      <div className="stale-dim mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Signups"
          description={`New users per day, ${window}`}
          isEmpty={data.users.new_in_window === 0}
        >
          <TrendChart
            data={data.users.signups_per_day.map((day) => ({ date: day.date, value: day.count }))}
            label="Signups"
            color="var(--chart-1)"
          />
        </ChartCard>

        <ChartCard
          title="Total users"
          description={`Running total, ${window}`}
          isEmpty={data.users.total === 0}
        >
          <TrendChart
            data={data.users.cumulative_per_day.map((day) => ({
              date: day.date,
              value: day.count,
            }))}
            label="Users"
            color="var(--chart-3)"
          />
        </ChartCard>

        <ChartCard
          title="Revenue"
          description={`Finished payments per day, ${window}`}
          isEmpty={data.revenue.window_usd === 0}
        >
          <TrendChart
            data={data.revenue.per_day.map((day) => ({ date: day.date, value: day.amount }))}
            label="Revenue"
            color="var(--chart-2)"
            format="usd"
          />
        </ChartCard>

        <ChartCard
          title="Interviews"
          description={`Live and mock interviews started per day, ${window}`}
          isEmpty={data.interviews.live_in_window + data.interviews.mock_in_window === 0}
        >
          <MultiTrendChart data={interviewSeries} series={INTERVIEW_SERIES} />
        </ChartCard>

        <ChartCard
          title="Activity"
          description={`Logins, signups, and ASR sessions per day, ${window}`}
          isEmpty={activitySeries.every((day) => !day.logins && !day.signups && !day.asr)}
        >
          <MultiTrendChart data={activitySeries} series={ACTIVITY_SERIES} />
        </ChartCard>

        <ChartCard
          title="Sign-in outcomes"
          description={`Login and signup attempts by result, ${window}`}
          isEmpty={data.activity.logins_by_outcome.every((day) => !day.success && !day.failure)}
        >
          <StackedDayChart
            data={data.activity.logins_by_outcome.map((day) => ({ ...day }))}
            series={OUTCOME_SERIES}
          />
        </ChartCard>

        <ChartCard
          title="Usage by hour"
          description={`Logins and ASR starts by hour of day, ${window}`}
          isEmpty={data.activity.by_hour.every((hour) => hour.count === 0)}
        >
          <HourHistogram data={data.activity.by_hour} />
        </ChartCard>

        <ChartCard
          title="Users by role"
          description="Current distribution"
          isEmpty={Object.keys(data.users.by_role).length === 0}
        >
          <DistributionChart data={data.users.by_role} />
        </ChartCard>

        <ChartCard
          title="Users by status"
          description="Active against inactive accounts"
          isEmpty={Object.keys(data.users.by_status).length === 0}
        >
          <DistributionChart data={data.users.by_status} />
        </ChartCard>

        <ChartCard
          title="Payments by status"
          description="All-time, every payment record"
          isEmpty={Object.keys(data.revenue.payments_by_status).length === 0}
        >
          <DistributionChart data={data.revenue.payments_by_status} />
        </ChartCard>

        <ChartCard
          title="Revenue by plan"
          description="All-time, finished payments only"
          isEmpty={Object.keys(data.revenue.by_plan_usd).length === 0}
        >
          <DistributionChart data={data.revenue.by_plan_usd} format="usd" />
        </ChartCard>
      </div>

      {/* Audit rows, named addresses and all, which is the thing `/audit-logs` is gated to withhold.
          Gating the page and leaving the newest twenty of it on the landing page would have been a
          hole in the gate rather than a smaller version of it. The charts above stay: they are
          counts per day, and a guest reading "eleven logins on Tuesday" learns about the product,
          not about a person. Not passed to the client component at all for a guest, so the rows are
          never serialised into the response. */}
      {isAdmin && (
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
      )}
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
