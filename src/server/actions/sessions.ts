"use server";

import { refresh } from "next/cache";

import { type ActionResult, failed, ok } from "@/lib/action-result";
import { denyUnless } from "@/server/auth/guard";
import { COLLECTIONS } from "@/server/db";
import { AppError } from "@/server/errors";
import { deleteById } from "@/server/repository";

/** Deleting the session document forces that device to authenticate again on its next request. */
export async function revokeSession(sessionId: string): Promise<ActionResult> {
  const denied = await denyUnless("sessions:write");
  if (denied) return denied;

  try {
    await deleteById(COLLECTIONS.sessions, sessionId, "session");
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not revoke this session");
  }

  refresh();
  return ok;
}
