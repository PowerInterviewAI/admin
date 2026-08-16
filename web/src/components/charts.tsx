"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatUsd, titleCase } from "@/lib/format";

interface TrendPoint {
  date: string;
  value: number;
}

interface TrendChartProps {
  data: TrendPoint[];
  label: string;
  color?: string;
  /**
   * A name rather than a formatter function: these charts are rendered from a Server Component,
   * and a function prop cannot cross that boundary.
   */
  format?: "number" | "usd";
}

const dateFormatter = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
              formatter={(value) =>
                format === "usd" ? formatUsd(Number(value)) : String(value)
              }
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

const DISTRIBUTION_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Keys are snake_case enum values from the database, so they are always title-cased for display. */
export function DistributionChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
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
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={90} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" radius={4} maxBarSize={36}>
          {chartData.map((entry) => (
            <Cell key={entry.key} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
