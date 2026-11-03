import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSchema, type ColumnInfo } from '../src/adapters/db-schema.js';

const T = { users: 'users', transactions: 'transactions' };
const good: ColumnInfo[] = [
  ...['user_id', 'full_name', 'email', 'address', 'phone', 'country', 'base_currency'].map(column => ({ table: 'users', column, type: 'text' })),
  ...['transaction_id', 'user_id', 'transaction_type', 'status', 'channel', 'sent_currency', 'received_currency', 'beneficiary_name', 'beneficiary_account', 'beneficiary_bank']
    .map(column => ({ table: 'transactions', column, type: 'text' })),
  ...['amount_sent', 'fx_rate', 'amount_received', 'fee'].map(column => ({ table: 'transactions', column, type: 'numeric' })),
  { table: 'transactions', column: 'transaction_date', type: 'timestamp with time zone' },
];
const withType = (table: string, column: string, type: string) => good.map(c => c.table === table && c.column === column ? { ...c, type } : c);

test('a matching schema has no findings', () => assert.deepEqual(checkSchema(good, T), []));
test('a numeric user_id is reported with the exact ALTER statement', () => {
  const [finding, ...rest] = checkSchema(withType('users', 'user_id', 'bigint'), T);
  assert.equal(rest.length, 0); assert.equal(finding.severity, 'error');
  assert.equal(finding.fix, 'ALTER TABLE public.users ALTER COLUMN user_id TYPE text USING user_id::text;');
});
test('numeric user_id columns in both tables give two findings', () => {
  const columns = withType('users', 'user_id', 'bigint').map(c => c.table === 'transactions' && c.column === 'user_id' ? { ...c, type: 'bigint' } : c);
  assert.equal(checkSchema(columns, T).length, 2);
});
test('a text transaction_date must become a timestamp', () => {
  const [finding] = checkSchema(withType('transactions', 'transaction_date', 'text'), T);
  assert.match(finding.fix!, /ALTER TABLE public\.transactions ALTER COLUMN transaction_date TYPE timestamptz USING transaction_date::timestamptz;/);
});
test('a missing column is named with its table', () => {
  const [finding] = checkSchema(good.filter(c => c.column !== 'beneficiary_bank'), T);
  assert.match(finding.message, /transactions\.beneficiary_bank/); assert.equal(finding.fix, undefined);
});
test('a missing table is reported once, not once per column', () => {
  const findings = checkSchema(good.filter(c => c.table !== 'users'), T);
  assert.equal(findings.length, 1); assert.match(findings[0].message, /users/);
});
