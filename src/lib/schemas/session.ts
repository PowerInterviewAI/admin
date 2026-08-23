import { z } from "zod";

import { objectIdSchema, timestampsSchema, userLabelSchema } from "@/lib/schemas/common";
import { SESSION_ACTIVITIES } from "@/lib/session-activity";

export const deviceInfoSchema = z.object({
  ip_address: z.string().default(""),
  user_agent: z.string().default(""),
});

export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

/**
 * `token` is deliberately absent. The stored document carries a live bearer credential; leaving
 * the field out of the schema means zod strips it during parsing, so it never crosses the
 * server/client boundary. The dashboard only ever lists sessions and revokes them by `_id`.
 */
export const sessionSchema = timestampsSchema.extend({
  _id: objectIdSchema,
  user_id: objectIdSchema,
  device_info: deviceInfoSchema.default({ ip_address: "", user_agent: "" }),
});

export type Session = z.infer<typeof sessionSchema>;

/**
 * `activity` and `last_active_at` are decided on the server, not derived in the cell. They compare
 * against the current clock, and a client recomputing them during hydration would be free to
 * disagree with the markup it is hydrating - the same reason a campaign's Interrupted badge is a
 * server-side field.
 */
export const sessionRowSchema = sessionSchema.extend({
  user: userLabelSchema.nullish().default(null),
  activity: z.enum(SESSION_ACTIVITIES),
  last_active_at: z.number().int().nullish().default(null),
});

export type SessionRow = z.infer<typeof sessionRowSchema>;
