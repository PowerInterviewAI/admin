"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { AnalyticsOverview } from "@/lib/types";

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => api.get<AnalyticsOverview>("/api/analytics/overview"),
  });
}
