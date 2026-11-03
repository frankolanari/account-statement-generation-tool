import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriod } from '../src/domain/period.js';

const user = { first_transaction_date: '2024-01-03' }; const today = '2026-10-28';
test('no dates means full history from first transaction to today', () => {
  assert.deepEqual(resolvePeriod({ from: null, to: null }, user, today),
    { from: '2024-01-03', to: '2026-10-28', fullHistory: true, fromDefaulted: true, toDefaulted: true, toCapped: false });
});
test('start only runs to today; end only starts at first transaction', () => {
  assert.equal(resolvePeriod({ from: '2025-03-01', to: null }, user, today).to, '2026-10-28');
  assert.equal(resolvePeriod({ from: null, to: '2025-06-30' }, user, today).from, '2024-01-03');
});
test('future end date is capped to today and flagged', () => {
  const p = resolvePeriod({ from: '2026-10-01', to: '2026-10-31' }, user, today);
  assert.equal(p.to, '2026-10-28'); assert.equal(p.toCapped, true);
});
test('future start date is rejected, not turned into an empty statement', () => {
  assert.throws(() => resolvePeriod({ from: '2026-11-01', to: null }, user, today), { code: 'INVALID_DATE_RANGE' });
});
test('account without history is rejected', () => {
  assert.throws(() => resolvePeriod({ from: null, to: null }, { first_transaction_date: null }, today), { code: 'NO_TRANSACTION_HISTORY' });
});
