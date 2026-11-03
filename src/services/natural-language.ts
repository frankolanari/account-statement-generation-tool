import { extractRequestIdentifier } from './request-input.js';
import { resolveExtractedDates, type ExtractedDates } from './date-range.js';
import { DomainError } from '../domain/contracts.js';
const DATE_HINT = /\d|\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(last|since|until|between|year|years|month|months|quarter|week|weeks|yesterday|ytd|q[1-4])\b/i;
export async function parseNaturalLanguageRequest(text: string,
  extractor: { extract(text: string, today: string): Promise<ExtractedDates> }, now = new Date()) {
  const { identifier, dateText } = extractRequestIdentifier(text);
  const today = now.toISOString().slice(0,10);
  const dates = await extractor.extract(dateText, today);
  // The model may flag dates it could not read while returning none. Only a request with no date words at all
  // defaults to the full history; otherwise ask, rather than disclose more than was requested.
  if (dates.needs_clarification && dates.from === null && dates.to === null && DATE_HINT.test(dateText)) {
    throw new DomainError('DATE_CLARIFICATION_REQUIRED', 'Please clarify the requested statement dates.');
  }
  return { identifier, ...resolveExtractedDates(dates, today) };
}
