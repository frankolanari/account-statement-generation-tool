import type { Statement, Transaction } from './contracts.js';
type Row = { user: Statement['user_details']; tx: Transaction };
// [header, value, text]. Only text columns are guarded against spreadsheet formulas, so signed amounts stay intact.
const COLUMNS: Array<[string, (r: Row) => string | null, boolean]> = [
  ['Transaction ID', r => r.tx.transaction_id, false], ['Created At', r => r.tx.transaction_date, false],
  ['Full Name', r => r.user.full_name, true], ['Email', r => r.user.email, true], ['Country', r => r.user.country, true],
  ['Channel', r => r.tx.channel, true], ['Status', r => r.tx.status.toUpperCase(), true],
  ['Sent Currency', r => r.tx.sent_currency, false], ['Amount Sent', r => r.tx.amount_sent, false],
  ['FX Rate', r => r.tx.fx_rate, false], ['Received Currency', r => r.tx.received_currency, false],
  ['Amount Received', r => r.tx.amount_received, false], ['Fee', r => r.tx.fee, false],
  ['Beneficiary Name', r => r.tx.beneficiary_name, true], ['Beneficiary Account', r => r.tx.beneficiary_account, true],
  ['Beneficiary Bank', r => r.tx.beneficiary_bank, true], ['Reference', r => r.tx.transaction_id, false],
];
function field(value: string | null, text: boolean) {
  let s = value ?? '';
  if (text && /^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function renderStatementCsv(statement: Statement): string {
  const user = statement.user_details;
  const rows = statement.transaction_records.map(tx => COLUMNS.map(([, get, text]) => field(get({ user, tx }), text)).join(','));
  return [COLUMNS.map(([name]) => name).join(','), ...rows].join('\n') + '\n';
}
export function statementFileBase(statement: Statement): string {
  const { full_name, period_start, period_end } = statement.user_details;
  const name = full_name.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  return `${name} Account Statement from ${period_start} to ${period_end}`.replace(/[/\\:*?"<>|]/g, '-');
}
