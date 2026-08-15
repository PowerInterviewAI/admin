"use client";

import { useQuery } from "@tanstack/react-query";

import { api, toQueryString } from "@/lib/api";
import type { AuditEventType, AuditLog, AuditStatus, Page } from "@/lib/types";

export interface AuditLogListParams {
  event_type?: AuditEventType;
  status?: AuditStatus;
  user_id?: string;
  from?: number;
  to?: number;
  offset?: number;
  limit?: number;
  [key: string]: string | number | undefined;
}

export function useAuditLogs(params: AuditLogListParams) {
  return useQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => api.get<Page<AuditLog>>(`/api/audit-logs${toQueryString(params)}`),
    placeholderData: (prev) => prev,
  });
}
