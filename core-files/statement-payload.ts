import type { Statement, Transaction, User } from '../src/domain/contracts.js';

// This is the editable mapping from query results to the statement document.
// Coverage selection happens before this function; records arrive newest first.
export function buildStatementPayload(input: {
  user: User;
  records: Transaction[];
  from: string;
  to: string;
  total: number;
  truncated: boolean;
  generatedOn: string;
}): Statement {
  const { user, records, from, to, total, truncated, generatedOn } = input;
  const effectiveTo = truncated ? records[0].transaction_date.slice(0, 10) : to;
  return {
    user_details: {
      ...user,
      address: user.address || user.country,
      period_start: from,
      period_end: effectiveTo,
      generated_on: generatedOn,
    },
    transaction_records: records,
    meta: {
      input_txn_count: total,
      output_txn_count: records.length,
      is_truncated: truncated,
      requested_period: { from, to },
      effective_period: { from, to: effectiveTo },
      first_included_transaction: records.at(-1)!.transaction_date,
      last_included_transaction: records[0].transaction_date,
    },
  };
}
