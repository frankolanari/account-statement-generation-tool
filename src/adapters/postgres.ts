import pg from 'pg';
import type { AccountRepository } from '../domain/ports.js';
import type { User, Transaction } from '../domain/contracts.js';
import { HARD_LIMIT } from '../domain/coverage.js';
import { readCoreFile } from '../../core-files/read-core-file.js';

export function createPostgresRepository(pool: pg.Pool): AccountRepository {
  async function users(mode: 'lookup' | 'confirmed', value: string) {
    const result = await pool.query<User>(readCoreFile('sql/user-query.sql'), [value, mode]);
    return result.rows;
  }
  return {
    findUsers: id => users('lookup', id),
    async getUser(id) { return (await users('confirmed', id))[0] ?? null; },
    async fetchTransactions(userId, from, to) {
      const result = await pool.query<Transaction & { total_count: string }>(
        readCoreFile('sql/transaction-query.sql'),
        [userId, from, to, HARD_LIMIT + 1]);
      return { rows: result.rows.map(({ total_count, ...row }) => row), total: Number(result.rows[0]?.total_count ?? 0) };
    },
  };
}
export function databasePool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3,
    connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    options: '-c timezone=UTC -c statement_timeout=60000' });
}
