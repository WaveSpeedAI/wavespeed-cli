// The predictions-search API is strict RFC3339, so bare dates the CLI's own
// hints suggest ("--since 2026-01-01") must be widened here, not rejected
// there. Shared by history, billings, and usage so every time flag accepts
// the same two forms: full ISO 8601 or YYYY-MM-DD.

/** Accepts ISO 8601 or YYYY-MM-DD; returns RFC3339. Day-only values span the
 * whole day: start-of-day normally, end-of-day when `endOfDay` is set. */
export function toIso(value: string, endOfDay = false): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value + (endOfDay ? 'T23:59:59Z' : 'T00:00:00Z');
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid time "${value}". Use ISO 8601 or YYYY-MM-DD.`);
  }
  return d.toISOString();
}
