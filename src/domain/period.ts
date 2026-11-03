import { DomainError, type User } from './contracts.js';
export type RequestedPeriod = { from: string | null; to: string | null };
export type ResolvedPeriod = { from: string; to: string; fullHistory: boolean;
  fromDefaulted: boolean; toDefaulted: boolean; toCapped: boolean };
// Missing sides default to the full history: first transaction date through today (UTC).
export function resolvePeriod(requested: RequestedPeriod, user: Pick<User, 'first_transaction_date'>, today: string): ResolvedPeriod {
  if (!user.first_transaction_date) throw new DomainError('NO_TRANSACTION_HISTORY', 'This account has no transaction history.');
  const fromDefaulted = requested.from === null, toDefaulted = requested.to === null;
  const from = requested.from ?? user.first_transaction_date.slice(0, 10);
  const end = requested.to ?? today;
  const toCapped = end > today;
  const to = toCapped ? today : end;
  if (from > to) throw new DomainError('INVALID_DATE_RANGE', `The start date (${from}) is after the end date (${to}). Please check the dates and try again.`);
  return { from, to, fullHistory: fromDefaulted && toDefaulted, fromDefaulted, toDefaulted, toCapped };
}
