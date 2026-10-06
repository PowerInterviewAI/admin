import { z } from "zod";

/**
 * Backend's singleton `global_state` document, reduced to what this app reads. `active_sessions` is
 * deliberately absent: it is simulated, not a usage signal (see `queries/analytics.ts`).
 */
export const globalStateSchema = z.object({
  /** When the backend process last started, unix ms. Absent on a backend that predates it. */
  booted_at: z.number().nullish(),
});

export type GlobalState = z.infer<typeof globalStateSchema>;
