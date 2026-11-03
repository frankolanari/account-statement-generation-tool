import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountRepository } from '../src/domain/ports.js';
import { KEEP_ALIVE_CRON, pingDatabase } from '../src/services/keep-alive.js';

function repo(overrides: Partial<AccountRepository> = {}): AccountRepository {
  return { findUsers: async () => [], getUser: async () => null, fetchTransactions: async () => ({ rows: [], total: 0 }), ...overrides };
}

test('the ping runs the real user query with an identifier no customer can have', async () => {
  const seen: string[] = [];
  const result = await pingDatabase(repo({ findUsers: async id => { seen.push(id); return []; } }));
  assert.equal(result.ok, true);
  assert.deepEqual(seen, ['keep-alive@example.invalid']);
});
test('the ping reports how long the query took', async () => {
  let clock = 1000;
  const result = await pingDatabase(repo({ findUsers: async () => { clock += 42; return []; } }), () => clock);
  assert.equal(result.durationMs, 42);
});
test('a database failure is not swallowed, so the scheduled run is marked failed and retried', async () => {
  await assert.rejects(() => pingDatabase(repo({ findUsers: async () => { throw new Error('connection refused'); } })), /connection refused/);
});
test('every 7-day window contains at least two scheduled runs', () => {
  const [minute, hour, , , weekdays] = KEEP_ALIVE_CRON.split(' ');
  const days = weekdays.split(',').map(Number);
  const runs: number[] = [];
  const start = Date.UTC(2026, 0, 5); // a Monday
  for (let d = 0; d < 7 * 12; d++) {
    const at = new Date(start + d * 864e5);
    if (days.includes(at.getUTCDay())) runs.push(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), Number(hour), Number(minute)));
  }
  for (let t = start; t < start + 7 * 864e5 * 8; t += 3600e3) {
    const inWindow = runs.filter(r => r >= t && r < t + 7 * 864e5).length;
    assert.ok(inWindow >= 2, `window starting ${new Date(t).toISOString()} has only ${inWindow} run(s)`);
  }
});
