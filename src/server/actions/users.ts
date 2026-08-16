"use server";

import { refresh } from "next/cache";

import { type ActionResult, failed, ok } from "@/lib/action-result";
import { userPatchSchema } from "@/lib/schemas/user";
import { COLLECTIONS } from "@/server/db";
import { AppError } from "@/server/errors";
import { deleteById, updateById } from "@/server/repository";

export async function updateUser(userId: string, input: unknown): Promise<ActionResult> {
  const parsed = userPatchSchema.safeParse(input);
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "The submitted values are not valid");
  }

  try {
    // `$set` replaces `interview_config` wholesale rather than merging into it, which is why the
    // edit sheet always submits all three inner fields.
    await updateById(COLLECTIONS.users, userId, parsed.data, "user");
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not update this user");
  }

  refresh();
  return ok;
}

export async function deleteUser(userId: string): Promise<ActionResult> {
  try {
    await deleteById(COLLECTIONS.users, userId, "user");
  } catch (error) {
    return failed(error instanceof AppError ? error.message : "Could not delete this user");
  }

  refresh();
  return ok;
}
