"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface TrendPoint {
  date: string;
  value: number;
}

interface TrendChartProps {
  data: TrendPoint[];
  label: string;
  color?: string;
  valueFormatter?: (value: number) => string;
}

const dateFormatter = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function TrendChart({ data, label, color = "var(--chart-1)", valueFormatter }: TrendChartProps) {
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
                valueFormatter ? valueFormatter(Number(value)) : String(value)
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

interface DistributionChartProps {
  data: Record<string, number>;
  labelFormatter?: (key: string) => string;
}

const DISTRIBUTION_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function DistributionChart({ data, labelFormatter = (k) => k }: DistributionChartProps) {
  const entries = Object.entries(data);
  const chartData = entries.map(([key, value], i) => ({
    key,
    label: labelFormatter(key),
    value,
    fill: DISTRIBUTION_COLORS[i % DISTRIBUTION_COLORS.length],
  }));

  const config = Object.fromEntries(
    entries.map(([key], i) => [
      key,
      { label: labelFormatter(key), color: DISTRIBUTION_COLORS[i % DISTRIBUTION_COLORS.length] },
    ]),
  ) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-55 w-full">
      <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap="30%">
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          axisLine={false}
          width={90}
        />
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
