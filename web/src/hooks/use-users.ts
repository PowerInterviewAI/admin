"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, toQueryString } from "@/lib/api";
import type { Page, User, UserDetail, UserRole, UserStatus } from "@/lib/types";

export interface UserListParams {
  q?: string;
  role?: UserRole;
  status?: UserStatus;
  offset?: number;
  limit?: number;
  [key: string]: string | number | undefined;
}

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: ["users", params],
    queryFn: () => api.get<Page<User>>(`/api/users${toQueryString(params)}`),
    placeholderData: (prev) => prev,
  });
}

export function useUser(userId: string | null) {
  return useQuery({
    queryKey: ["users", userId],
    queryFn: () => api.get<UserDetail>(`/api/users/${userId}`),
    enabled: !!userId,
  });
}

export interface UserPatch {
  username?: string;
  email?: string;
  role?: UserRole;
  status?: UserStatus;
  credits?: number;
}

export function useUpdateUser(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UserPatch) => api.patch<User>(`/api/users/${userId}`, patch),
    onSuccess: () => {
      toast.success("User updated");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error: Error) => toast.error(`Failed to update user: ${error.message}`),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/api/users/${userId}`),
    onSuccess: () => {
      toast.success("User deleted");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error: Error) => toast.error(`Failed to delete user: ${error.message}`),
  });
}
