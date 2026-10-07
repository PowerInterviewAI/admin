import { z } from "zod";

import { userLabelSchema } from "@/lib/schemas/common";

export const INTERVIEW_KINDS = ["live", "mock"] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

/**
 * `dropped` is an interview with a socket that never got its `asr_stop` and can no longer be
 * running: the backend restarted under it, the stop write was lost, or the account has no app
 * online. It has no honest end time, so it has no duration either.
 */
export const INTERVIEW_STATES = ["running", "ended", "dropped"] as const;
export type InterviewState = (typeof INTERVIEW_STATES)[number];

export const INTERVIEW_STATE_LABELS: Record<InterviewState, string> = {
  running: "Running",
  ended: "Ended",
  dropped: "Dropped",
};

/**
 * One interview: every ASR socket backend opened under one `client_session_id` for one account.
 * There is no interview document; this is assembled from the `asr_start`/`asr_stop` audit rows.
 *
 * `state` and `duration_ms` compare against the clock, so they are decided on the server for the
 * same reason a session's activity badge is.
 */
export const interviewRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  user: userLabelSchema.nullable(),
  client_session_id: z.string(),
  kind: z.enum(INTERVIEW_KINDS),
  state: z.enum(INTERVIEW_STATES),
  started_at: z.number(),
  ended_at: z.number().nullable(),
  duration_ms: z.number().nullable(),
  /** How many sockets it opened: two for a live interview, plus one per reconnect. */
  sockets: z.number().int(),
});

export type InterviewRow = z.infer<typeof interviewRowSchema>;
