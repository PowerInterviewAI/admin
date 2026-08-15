"use client";

import { Users, Wallet, Coins, Activity } from "lucide-react";

import { useAnalyticsOverview } from "@/hooks/use-analytics";
import { PageHeader } from "@/components/custom/page-header";
import { StatCard } from "@/components/custom/stat-card";
import { DistributionChart, TrendChart } from "@/components/custom/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { QueryError } from "@/components/custom/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatNumber, formatUsd, titleCase } from "@/lib/format";

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useAnalyticsOverview();

  if (error) {
    return (
      <div className="flex flex-col">
        <PageHeader
          title="Dashboard"
          description="Real usage and revenue data, read directly from the Power Interview AI database."
        />
        <Card>
          <CardContent className="py-12">
            <QueryError error={error} onRetry={() => void refetch()} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Dashboard"
        description="Real usage and revenue data, read directly from the Power Interview AI database."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Users"
          value={data ? formatNumber(data.users.total) : "—"}
          icon={Users}
          hint={data ? `${data.users.by_role.admin ?? 0} admins` : undefined}
          isLoading={isLoading}
        />
        <StatCard
          label="Revenue (finished)"
          value={data ? formatUsd(data.revenue.total_usd) : "—"}
          icon={Wallet}
          hint="Lifetime, status = finished"
          isLoading={isLoading}
        />
        <StatCard
          label="Credits Outstanding"
          value={data ? formatNumber(data.credits_outstanding) : "—"}
          icon={Coins}
          hint="Sum across all users"
          isLoading={isLoading}
        />
        <StatCard
          label="ASR Sessions (30d)"
          value={
            data ? formatNumber(data.activity.asr_sessions_per_day.reduce((sum, d) => sum + d.count, 0)) : "—"
          }
          icon={Activity}
          hint="asr_start events, last 30 days"
          isLoading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Signups</CardTitle>
            <CardDescription>New users per day, last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? (
              <Skeleton className="h-55 w-full" />
            ) : data.users.signups_per_day.length === 0 ? (
              <ChartEmpty />
            ) : (
              <TrendChart
                data={data.users.signups_per_day.map((d) => ({ date: d.date, value: d.count }))}
                label="Signups"
                color="var(--chart-1)"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue</CardTitle>
            <CardDescription>Finished payments per day, last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? (
              <Skeleton className="h-55 w-full" />
            ) : data.revenue.per_day.length === 0 ? (
              <ChartEmpty />
            ) : (
              <TrendChart
                data={data.revenue.per_day.map((d) => ({ date: d.date, value: d.amount }))}
                label="Revenue"
                color="var(--chart-2)"
                valueFormatter={(v) => formatUsd(v)}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users by role</CardTitle>
            <CardDescription>Current distribution</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? (
              <Skeleton className="h-55 w-full" />
            ) : Object.keys(data.users.by_role).length === 0 ? (
              <ChartEmpty />
            ) : (
              <DistributionChart data={data.users.by_role} labelFormatter={titleCase} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments by status</CardTitle>
            <CardDescription>All-time, every payment record</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? (
              <Skeleton className="h-55 w-full" />
            ) : Object.keys(data.revenue.payments_by_status).length === 0 ? (
              <ChartEmpty />
            ) : (
              <DistributionChart data={data.revenue.payments_by_status} labelFormatter={titleCase} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Latest 20 audit log events</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : data.recent_activity.length === 0 ? (
            <ChartEmpty />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent_activity.map((entry) => (
                    <TableRow key={entry._id}>
                      <TableCell className="font-medium">{titleCase(entry.event_type)}</TableCell>
                      <TableCell className="text-muted-foreground">{entry.email ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={entry.status === "success" ? "secondary" : "destructive"}>
                          {entry.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(entry.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChartEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No data yet</EmptyTitle>
        <EmptyDescription>Nothing in this window.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
