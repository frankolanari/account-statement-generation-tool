import type { User } from './contracts.js';
// User-facing copy for every channel. Callers add their own greeting or mention.
const long = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const short = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
export const formatLongDate = (iso: string) => long.format(day(iso));
export const formatShortDate = (iso: string) => short.format(day(iso));

const NOT_FOUND = "I'm afraid I couldn't find a valid email address or User ID. Might I suggest checking the details and trying again?";
const DATES = "I couldn't work out the dates in that request. Please write them like 2026-01-01 to 2026-03-31, or leave them out for the full history.";
const TOO_MANY = 'That period has too many transactions for one statement. Please request a shorter period.';
const MESSAGES: Record<string, string> = {
  INVALID_IDENTIFIER: NOT_FOUND, USER_NOT_FOUND: NOT_FOUND,
  AMBIGUOUS_IDENTIFIER: 'I can only prepare one statement at a time. Please send one email address or User ID per request.',
  ACCOUNT_SELECTION_REQUIRED: 'More than one account matches that email address. Please send the request again using the User ID.',
  NO_TRANSACTION_HISTORY: "I'm afraid this user has no transaction history on record.",
  DATE_CLARIFICATION_REQUIRED: DATES, DATE_EXTRACTION_FAILED: DATES,
  PERIOD_TOO_DENSE: TOO_MANY, PDF_TOO_LARGE_FOR_INLINE_OUTPUT: TOO_MANY,
};
export function rejectionMessage(code: string, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? 'The request could not be completed.';
}

export function noTransactionsMessage(period: { from: string; to: string },
  user: Pick<User, 'first_transaction_date' | 'last_transaction_date'>): string {
  const none = "I'm afraid there were no transactions during the requested period";
  const first = user.first_transaction_date?.slice(0, 10), last = user.last_transaction_date?.slice(0, 10);
  if (first && period.to < first) return `${none}. The user's transaction history begins on ${formatLongDate(first)}.`;
  if (last && period.from > last) return `${none}. The user's most recent transaction was on ${formatLongDate(last)}.`;
  return `${none}, though it does fall within the user's overall transaction history.`;
}
