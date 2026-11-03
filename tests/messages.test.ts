import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLongDate, formatShortDate, noTransactionsMessage, rejectionMessage } from '../src/domain/messages.js';

const user = { first_transaction_date: '2024-01-03', last_transaction_date: '2026-09-30' };
test('dates format in UTC long and short forms', () => {
  assert.equal(formatLongDate('2024-01-03'), 'January 3, 2024');
  assert.equal(formatShortDate('2024-01-03'), 'Jan 3, 2024');
});
test('empty period before history points to the first transaction', () => {
  assert.equal(noTransactionsMessage({ from: '2023-01-01', to: '2023-12-31' }, user),
    "I'm afraid there were no transactions during the requested period. The user's transaction history begins on January 3, 2024.");
});
test('empty period after history points to the most recent transaction', () => {
  assert.equal(noTransactionsMessage({ from: '2026-10-01', to: '2026-10-28' }, user),
    "I'm afraid there were no transactions during the requested period. The user's most recent transaction was on September 30, 2026.");
});
test('empty period inside history says so', () => {
  assert.equal(noTransactionsMessage({ from: '2025-02-01', to: '2025-02-28' }, user),
    "I'm afraid there were no transactions during the requested period, though it does fall within the user's overall transaction history.");
});
test('known codes map to fixed copy and unknown codes use the fallback', () => {
  assert.equal(rejectionMessage('NO_TRANSACTION_HISTORY'), "I'm afraid this user has no transaction history on record.");
  assert.equal(rejectionMessage('NOPE', 'x'), 'x');
  assert.equal(rejectionMessage('NOPE'), 'The request could not be completed.');
});
