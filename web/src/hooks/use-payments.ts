"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, toQueryString } from "@/lib/api";
import type { Page, Payment, PaymentPlan, PaymentStatus } from "@/lib/types";

export interface PaymentListParams {
  status?: PaymentStatus;
  plan?: PaymentPlan;
  user_id?: string;
  offset?: number;
  limit?: number;
  [key: string]: string | number | undefined;
}

export function usePayments(params: PaymentListParams) {
  return useQuery({
    queryKey: ["payments", params],
    queryFn: () => api.get<Page<Payment>>(`/api/payments${toQueryString(params)}`),
    placeholderData: (prev) => prev,
  });
}

export interface PaymentPatch {
  status?: PaymentStatus;
  credits_applied?: boolean;
}

export function useUpdatePayment(paymentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: PaymentPatch) => api.patch<Payment>(`/api/payments/${paymentId}`, patch),
    onSuccess: () => {
      toast.success("Payment updated");
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (error: Error) => toast.error(`Failed to update payment: ${error.message}`),
  });
}
