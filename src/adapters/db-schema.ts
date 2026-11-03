// Compares the columns found in the database with what core-files/sql/*.sql needs.
// Pure, so it is tested without a database; used by scripts/db-check.ts.

export type ColumnInfo = { table: string; column: string; type: string };
export type SchemaFinding = { severity: 'error'; message: string; fix?: string };

const TEXT = ['text', 'character varying', 'character'];
const TIMESTAMP = ['timestamp with time zone', 'timestamp without time zone'];

// Columns the two queries read. `types` is set only where the SQL needs a specific kind of value.
const USERS: Array<[string, string[]?]> = [['user_id', TEXT], ['full_name'], ['email', TEXT], ['address'], ['phone'], ['country'], ['base_currency']];
const TRANSACTIONS: Array<[string, string[]?]> = [['transaction_id'], ['user_id', TEXT], ['transaction_date', TIMESTAMP], ['transaction_type'], ['status'], ['channel'],
  ['sent_currency'], ['amount_sent'], ['fx_rate'], ['received_currency'], ['amount_received'], ['fee'], ['beneficiary_name'], ['beneficiary_account'], ['beneficiary_bank']];

export function checkSchema(columns: ColumnInfo[], tables: { users: string; transactions: string }): SchemaFinding[] {
  const findings: SchemaFinding[] = [];
  for (const [table, wanted] of [[tables.users, USERS], [tables.transactions, TRANSACTIONS]] as const) {
    const have = columns.filter(c => c.table === table);
    if (!have.length) { findings.push({ severity: 'error', message: `Table public.${table} was not found (or has no readable columns).` }); continue; }
    for (const [column, types] of wanted) {
      const found = have.find(c => c.column === column);
      if (!found) { findings.push({ severity: 'error', message: `Column ${table}.${column} is missing; the app's SQL reads it.` }); continue; }
      if (types && !types.includes(found.type)) {
        const to = types === TIMESTAMP ? 'timestamptz' : 'text';
        findings.push({ severity: 'error',
          message: `${table}.${column} is "${found.type}" but the app expects ${types === TIMESTAMP ? 'a timestamp' : 'text'}.`,
          fix: `ALTER TABLE public.${table} ALTER COLUMN ${column} TYPE ${to} USING ${column}::${to};` });
      }
    }
  }
  return findings;
}
