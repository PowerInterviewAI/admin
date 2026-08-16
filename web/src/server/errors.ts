import "server-only";

import { MongoServerError } from "mongodb";

export type AppErrorCode = "not_found" | "conflict" | "invalid" | "unavailable";

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export function notFound(what: string): AppError {
  return new AppError("not_found", `${what} no longer exists`);
}

const DUPLICATE_KEY = 11000;

/**
 * Turns a driver-level failure into something an admin can act on. A duplicate key is the only
 * write error this dashboard can produce on purpose (two users cannot share an email), so it gets
 * a specific message; everything else keeps the driver's text, which is more useful than a
 * generic "something went wrong" when the cause is a network or auth problem.
 */
export function describeWriteError(error: unknown, what: string): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
    const field = Object.keys((error.keyValue as Record<string, unknown> | undefined) ?? {})[0];
    const label = field ? field.replace(/_/g, " ") : "value";
    return new AppError("conflict", `Another ${what} already uses that ${label}`);
  }

  return new AppError("unavailable", error instanceof Error ? error.message : String(error));
}
