import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Statement, Transaction } from '../src/domain/contracts.js';
import { renderStatementCsv, statementFileBase } from '../src/domain/statement-csv.js';

const tx: Transaction = { transaction_id:'000001',transaction_date:'2026-01-02T12:00:00.000000Z',transaction_type:'DEPOSIT',
  status:'success',channel:'BANK',sent_currency:'USD',amount_sent:'-100.00',fx_rate:'1500',received_currency:'NGN',
  amount_received:'150000',fee:'0',beneficiary_name:'Sample Recipient',beneficiary_account:'0000000000',beneficiary_bank:'Sample Bank' };
function statement(records: Transaction[] = [tx], full_name = 'Sample Customer'): Statement {
  return { user_details: { user_id:'test-account',full_name,email:'sample@example.com',address:null,phone:null,country:'NG',
    base_currency:'USD',period_start:'2026-01-01',period_end:'2026-01-31',generated_on:'2026-02-01T10:00:00Z' },
    transaction_records: records,
    meta: { input_txn_count:records.length,output_txn_count:records.length,is_truncated:false,
      requested_period:{from:'2026-01-01',to:'2026-01-31'},effective_period:{from:'2026-01-01',to:'2026-01-31'},
      first_included_transaction:'000001',last_included_transaction:'000001' } };
}
const lines = (s: Statement) => renderStatementCsv(s).split('\n');
test('CSV header lists the statement columns in order', () => {
  assert.equal(lines(statement())[0], 'Transaction ID,Created At,Full Name,Email,Country,Channel,Status,Sent Currency,Amount Sent,FX Rate,Received Currency,Amount Received,Fee,Beneficiary Name,Beneficiary Account,Beneficiary Bank,Reference');
});
test('CSV rows upper-case status, keep negative amounts and repeat the ID as reference', () => {
  assert.equal(lines(statement())[1], '000001,2026-01-02T12:00:00.000000Z,Sample Customer,sample@example.com,NG,BANK,SUCCESS,USD,-100.00,1500,NGN,150000,0,Sample Recipient,0000000000,Sample Bank,000001');
});
test('CSV quotes commas and doubles quotes', () => {
  assert.match(lines(statement([{ ...tx, beneficiary_name: 'Smith, "Jo"' }]))[1], /,"Smith, ""Jo""",/);
});
test('CSV neutralises formula-like text fields', () => {
  assert.match(lines(statement([{ ...tx, beneficiary_name: '=HYPERLINK(1)' }]))[1], /,'=HYPERLINK\(1\),/);
});
test('file base uses title-cased name and statement period without unsafe characters', () => {
  assert.equal(statementFileBase(statement([tx], 'SAMPLE customer/x')), 'Sample Customer-x Account Statement from 2026-01-01 to 2026-01-31');
});
