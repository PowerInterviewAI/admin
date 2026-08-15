"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, toQueryString } from "@/lib/api";
import type { Page, Session } from "@/lib/types";

export interface SessionListParams {
  user_id?: string;
  offset?: number;
  limit?: number;
  [key: string]: string | number | undefined;
}

export function useSessions(params: SessionListParams) {
  return useQuery({
    queryKey: ["sessions", params],
    queryFn: () => api.get<Page<Session>>(`/api/sessions${toQueryString(params)}`),
    placeholderData: (prev) => prev,
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.delete(`/api/sessions/${sessionId}`),
    onSuccess: () => {
      toast.success("Session revoked");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error: Error) => toast.error(`Failed to revoke session: ${error.message}`),
  });
}
