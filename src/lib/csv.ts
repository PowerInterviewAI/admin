/**
 * RFC 4180 serialization, shared by the four export actions.
 *
 * The escaping here is not only about commas. Every string in these exports came out of the
 * database, and most of it was typed by a user - a username, an email, a user agent. A cell whose
 * first character is `=`, `+`, `-`, `@`, or a leading tab/CR is executed as a formula when the file
 * is opened in Excel or Sheets, which turns "export the user list" into running whatever a signup
 * form was willing to accept. Prefixing those with an apostrophe is what the spreadsheet reads as
 * "this is text"; it costs a leading quote in the cell and closes the whole class of problem.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Prepended to the downloaded file. Without it Excel reads the bytes in the system codepage and
 * every non-ASCII name in the export arrives mojibaked. Built from its code point rather than
 * written literally, because a zero-width character sitting in source is invisible to review.
 */
export const CSV_BOM = String.fromCharCode(0xfeff);

export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";

  const raw = typeof value === "string" ? value : String(value);
  const guarded = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;

  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  // CRLF, per RFC 4180 - Excel is the consumer these files exist for.
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/**
 * A filename that carries what the file is and when it was taken, in local time. Two exports of the
 * same table on the same day differ by their minute rather than landing as "users (1).csv".
 */
export function csvFilename(prefix: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${prefix}-${stamp}.csv`;
}
