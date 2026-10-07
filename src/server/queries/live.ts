import "server-only";

import type { ObjectId } from "mongodb";

import type { InterviewKind } from "@/lib/schemas/interview";
import { globalStateSchema } from "@/lib/schemas/global-state";
import { COLLECTIONS, currentTimestampMs, getCollection } from "@/server/db";
import { findOne } from "@/server/repository";

/** A signed-in client pings every 5s, and on a slow link a ping can take up to 10s more. */
const APP_ONLINE_WINDOW_MS = 30_000;

/**
 * Bounds the open-socket scan. Backend's `booted_at` is the real bound - a restart drops every
 * socket without writing its `asr_stop` - and this one only caps the scan on a backend that has
 * been up for weeks. No interview runs for a day.
 */
const RUNNING_LOOKBACK_MS = 24 * 3_600_000;

/**
 * Who has an app open, read once per page so every count and row on it agrees.
 *
 * `runningSince` is the earliest an open socket may have opened and still count as running: before
 * it, a missing `asr_stop` means the backend restarted (or the write was lost), not that the
 * interview is still going.
 */
export interface LiveState {
  now: number;
  apps: number;
  userIds: ObjectId[];
  /** Latest `sessions.updated_at` per online account, keyed by hex id. */
  lastSeen: Map<string, number>;
  runningSince: number;
}

export interface RunningInterview {
  user_id: string;
  client_session_id: string;
  kind: InterviewKind;
  started_at: number;
}

export async function getLiveState(): Promise<LiveState> {
  const now = currentTimestampMs();

  const [online, state] = await Promise.all([
    getCollection(COLLECTIONS.sessions)
      .aggregate<{ _id: ObjectId; apps: number; last_seen: number }>([
        { $match: { updated_at: { $gte: now - APP_ONLINE_WINDOW_MS } } },
        {
          $group: {
            _id: "$user_id",
            apps: { $sum: 1 },
            last_seen: { $max: "$updated_at" },
          },
        },
      ])
      .toArray(),
    findOne({
      collection: COLLECTIONS.globalState,
      schema: globalStateSchema,
      filter: { singleton_key: "global" },
    }),
  ]);

  return {
    now,
    apps: online.reduce((sum, row) => sum + row.apps, 0),
    userIds: online.map((row) => row._id),
    lastSeen: new Map(online.map((row) => [String(row._id), row.last_seen])),
    runningSince: Math.max(state?.booted_at ?? 0, now - RUNNING_LOOKBACK_MS),
  };
}

/**
 * The interviews running right now, one row per `{user, client_session_id}`.
 *
 * A socket is open while it has an `asr_start` and no `asr_stop`. Backend writes the stop even for
 * a killed app or a dead network, within about 40s, so the two rows pair up on every path but a
 * backend restart (excluded by `runningSince`) or a failed write. Requiring the user to have an app
 * online narrows that last case without closing it: the check is per account, not per app, so an
 * orphan start reads as running for up to `RUNNING_LOOKBACK_MS` while that account has any app
 * online. It takes a lost write to get there, which is rare enough to accept.
 */
export async function getRunningInterviews(live: LiveState): Promise<RunningInterview[]> {
  if (live.userIds.length === 0) return [];

  const isStart = { $eq: ["$event_type", "asr_start"] };

  const rows = await getCollection(COLLECTIONS.auditLogs)
    .aggregate<{
      _id: { user: ObjectId; session: string };
      first: { created_at: number; kind: string };
    }>([
      {
        $match: {
          event_type: { $in: ["asr_start", "asr_stop"] },
          created_at: { $gte: live.runningSince },
          user_id: { $in: live.userIds },
          "metadata.client_session_id": { $type: "string" },
        },
      },
      {
        $group: {
          _id: "$metadata.asr_session_id",
          starts: { $sum: { $cond: [isStart, 1, 0] } },
          stops: { $sum: { $cond: [isStart, 0, 1] } },
          user: { $first: "$user_id" },
          session: { $first: "$metadata.client_session_id" },
          opened: {
            $min: { created_at: "$created_at", kind: "$metadata.kind" },
          },
        },
      },
      { $match: { $expr: { $gt: ["$starts", "$stops"] } } },
      // One interview, one kind: its earliest open socket decides, as its first start does in
      // `dailyInterviews`, so sockets that disagree cannot count it under both.
      {
        $group: {
          _id: { user: "$user", session: "$session" },
          first: { $min: "$opened" },
        },
      },
    ])
    .toArray();

  return rows
    .filter((row) => row.first.kind === "live" || row.first.kind === "mock")
    .map((row) => ({
      user_id: String(row._id.user),
      client_session_id: row._id.session,
      kind: row.first.kind as InterviewKind,
      started_at: row.first.created_at,
    }));
}
