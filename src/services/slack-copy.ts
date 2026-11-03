import type { Statement } from '../domain/contracts.js';
import type { ResolvedPeriod } from '../domain/period.js';
import { formatShortDate } from '../domain/messages.js';
// Slack wording for the statement thread. Rejection reasons come from domain/messages.ts.
// Customer data is untrusted: Slack would otherwise turn <!channel>, <@U…> or <url|label> in it into pings and links.
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const ackText = (user: string) => `Hi <@${user}>,\nI’m tending to it now...`;
export const rejectionText = (user: string, message: string) => `Hi <@${user}>,\n${message}`;
export const failureText = (user: string, runId: string) =>
  `Hi <@${user}>,\nSomething went wrong while preparing this statement (ref: ${runId}). Please try again in a few minutes.`;
export function successComment(input: { user: string; fullName: string; meta: Statement['meta']; period?: ResolvedPeriod }): string {
  const { meta, period } = input;
  const { from, to } = meta.effective_period;
  const lines = [`Account Statement for *${escape(input.fullName)}*`, `Period: *_${formatShortDate(from)}_* – *_${formatShortDate(to)}_*`];
  if (period?.fullHistory) lines.push(meta.is_truncated
    ? '_No dates were given, so this starts from the first transaction. It does not cover the full history because of the record limit below._'
    : '_No dates were given, so this covers the full transaction history._');
  if (period?.toCapped) lines.push('_The end date was in the future, so the statement runs to today._');
  if (meta.is_truncated) lines.push(`> ⚠️ *Note:* Only ${meta.output_txn_count} of ${meta.input_txn_count} records were included because the result exceeded the maximum limit.`,
    '> For best results, request up to 365 days (one year) at a time.');
  lines.push(`<@${input.user}>`);
  return lines.join('\n');
}
