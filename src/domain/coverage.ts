import { DomainError, type Transaction } from './contracts.js';
export const BASE_LIMIT = 1500;
export const HARD_LIMIT = 1600;
export function selectCoverage(rows: Transaction[], total: number) {
  const ascending = [...rows].sort((a,b) => a.transaction_date.localeCompare(b.transaction_date) || a.transaction_id.localeCompare(b.transaction_id));
  let kept = ascending;
  if (ascending.length > BASE_LIMIT) {
    const cutoffDay = ascending[BASE_LIMIT - 1].transaction_date.slice(0,10);
    let end = BASE_LIMIT;
    while (end < ascending.length && ascending[end].transaction_date.slice(0,10) === cutoffDay) end++;
    if (end <= HARD_LIMIT) kept = ascending.slice(0,end);
    else kept = ascending.filter(t => t.transaction_date.slice(0,10) < cutoffDay);
  }
  if (total > 0 && kept.length === 0) {
    throw new DomainError('PERIOD_TOO_DENSE', 'The earliest transaction day exceeds the PDF row limit. A separate high-volume export policy is required.');
  }
  return { records: kept.reverse(), truncated: kept.length < total };
}
