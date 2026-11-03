import { z } from 'zod';
import { DomainError, isoDate } from '../domain/contracts.js';
import type { RequestedPeriod } from '../domain/period.js';
export const extractedDatesSchema = z.object({
  from: z.string().nullable(), to: z.string().nullable(),
  from_month_only: z.boolean(), to_month_only: z.boolean(), needs_clarification: z.boolean(),
}).strict();
export type ExtractedDates = z.infer<typeof extractedDatesSchema>;
// Returns only what was requested; account defaults and the today cap are applied by resolvePeriod.
export function resolveExtractedDates(input: unknown, _today: string): RequestedPeriod {
  const parsed = extractedDatesSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('DATE_EXTRACTION_FAILED', 'The date response was invalid. Please provide explicit dates.');
  const dates = parsed.data;
  // A request without dates is never ambiguous, even if the model flags it.
  if (dates.needs_clarification && (dates.from !== null || dates.to !== null)) {
    throw new DomainError('DATE_CLARIFICATION_REQUIRED', 'Please clarify the requested statement dates.');
  }
  function resolve(value: string | null, monthOnly: boolean, end: boolean): string | null {
    if (value === null) {
      if (monthOnly) throw new DomainError('DATE_EXTRACTION_FAILED', 'A month was not supplied.');
      return null;
    }
    if (!monthOnly) {
      if (isoDate.safeParse(value).success) return value;
    } else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      if (!end) return `${value}-01`;
      const [year, month] = value.split('-').map(Number);
      const d = new Date(`${value}-01T00:00:00Z`);
      d.setUTCFullYear(year, month, 0);
      return d.toISOString().slice(0,10);
    }
    throw new DomainError('DATE_EXTRACTION_FAILED', 'The extracted date was invalid. Please provide explicit dates.');
  }
  const from = resolve(dates.from, dates.from_month_only, false);
  const to = resolve(dates.to, dates.to_month_only, true);
  if (from && to && from > to) throw new DomainError('INVALID_DATE_RANGE', `The start date (${from}) is after the end date (${to}). Please check the dates and try again.`);
  return { from, to };
}
