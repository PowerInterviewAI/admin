/**
 * Escapes a user-supplied string for use inside a `RegExp`.
 *
 * Every list view offering a text search turns the typed value into a case-insensitive Mongo
 * regex, so an unescaped `.` or `+` would quietly widen the match and an unbalanced `(` would
 * throw where the admin expects an empty result.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
