"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatNumber, formatUsd, titleCase } from "@/lib/format";

/**
 * A name rather than a formatter function: these charts are rendered from Server Components, and a
 * function prop cannot cross that boundary.
 */
export type ValueFormat = "number" | "usd";

function formatValue(value: number, format: ValueFormat): string {
  return format === "usd" ? formatUsd(value) : formatNumber(value);
}

interface TrendPoint {
  date: string;
  value: number;
}

interface TrendChartProps {
  data: TrendPoint[];
  label: string;
  color?: string;
  format?: ValueFormat;
}

/**
 * The bucket is a calendar day, not an instant. `new Date("2026-08-17")` is parsed as UTC midnight
 * and `toLocaleDateString` then renders it in local time, which lands on the day before anywhere
 * west of Greenwich; appending a time makes it a local-time parse instead.
 */
const dateFormatter = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function TrendChart({
  data,
  label,
  color = "var(--chart-1)",
  format = "number",
}: TrendChartProps) {
  const config = {
    value: { label, color },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-55 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={dateFormatter}
          minTickGap={24}
        />
        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => dateFormatter(String(value))}
              formatter={(value) => formatValue(Number(value), format)}
            />
          }
        />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          fill="url(#trend-fill)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

/**
 * Several counts against one date axis. Lines rather than stacked areas: these series answer
 * different questions (who signed in, who started a session) and stacking them would invite reading
 * the top edge as a total that means nothing.
 */
export function MultiTrendChart({
  data,
  series,
  format = "number",
}: {
  data: Record<string, string | number>[];
  series: ChartSeries[];
  format?: ValueFormat;
}) {
  const config = Object.fromEntries(
    series.map((item) => [item.key, { label: item.label, color: item.color }]),
  ) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-55 w-full">
      <LineChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={dateFormatter}
          minTickGap={24}
        />
        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => dateFormatter(String(value))}
              formatter={(value, name) => (
                <span className="flex w-full justify-between gap-3">
                  <span className="text-muted-foreground">
                    {config[name as string]?.label ?? name}
                  </span>
                  <span className="font-mono font-medium">
                    {formatValue(Number(value), format)}
                  </span>
                </span>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((item) => (
          <Line
            key={item.key}
            dataKey={item.key}
            type="monotone"
            stroke={`var(--color-${item.key})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

/**
 * Two mutually exclusive outcomes of the same attempt, so stacking is the honest shape here: the
 * column height is the day's total attempts and the split is what happened to them.
 */
export function StackedDayChart({
  data,
  series,
}: {
  data: Record<string, string | number>[];
  series: ChartSeries[];
}) {
  const config = Object.fromEntries(
    series.map((item) => [item.key, { label: item.label, color: item.color }]),
  ) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-55 w-full">
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={dateFormatter}
          minTickGap={24}
        />
        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(value) => dateFormatter(String(value))} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            stackId="outcome"
            fill={`var(--color-${item.key})`}
            // Only the topmost bar of a stack gets the rounded cap, or the corners cut into the
            // segment beneath.
            radius={index === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            maxBarSize={28}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

const DISTRIBUTION_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Keys are snake_case enum values from the database, so they are always title-cased for display. */
export function DistributionChart({
  data,
  format = "number",
}: {
  data: Record<string, number>;
  format?: ValueFormat;
}) {
  // Largest first: a distribution read top-to-bottom should answer "what is most of this" without
  // the eye having to scan every bar.
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a);
  const chartData = entries.map(([key, value], index) => ({
    key,
    label: titleCase(key),
    value,
    fill: DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length],
  }));

  const config = Object.fromEntries(
    entries.map(([key], index) => [
      key,
      { label: titleCase(key), color: DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length] },
    ]),
  ) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-55 w-full">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ left: 8, right: 16 }}
        barCategoryGap="30%"
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={format === "usd"} />
        <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={90} />
        <ChartTooltip
          content={
            <ChartTooltipContent formatter={(value) => formatValue(Number(value), format)} />
          }
        />
        <Bar dataKey="value" radius={4} maxBarSize={36}>
          {chartData.map((entry) => (
            <Cell key={entry.key} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Usage by hour of the day, in the reporting time zone - the one chart here whose x-axis is not a
 * date. It answers a question the daily series structurally cannot: when a maintenance window or a
 * bulk send would land on the fewest people.
 */
export function HourHistogram({ data }: { data: { hour: number; count: number }[] }) {
  const config = {
    count: { label: "Events", color: "var(--chart-4)" },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-55 w-full">
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="hour"
          tickLine={false}
          axisLine={false}
          interval={2}
          tickFormatter={(value: number) => `${String(value).padStart(2, "0")}h`}
        />
        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => `${String(value).padStart(2, "0")}:00`}
            />
          }
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ChartContainer>
  );
}
