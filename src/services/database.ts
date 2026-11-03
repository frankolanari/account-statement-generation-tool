import type { AccountRepository } from '../domain/ports.js';
import { createPostgresRepository, databasePool } from '../adapters/postgres.js';
import { createSnowflakeDatabase } from '../adapters/snowflake.js';

export type DatabaseProvider = 'postgres' | 'snowflake';
export type DatabaseRuntime = { accounts: AccountRepository; close(): Promise<void> };
export function selectedDatabaseProvider(env: NodeJS.ProcessEnv = process.env): DatabaseProvider {
  const provider = env.DATABASE_PROVIDER?.trim().toLowerCase() || 'postgres';
  if (provider !== 'postgres' && provider !== 'snowflake') {
    throw new Error('DATABASE_PROVIDER must be postgres or snowflake');
  }
  return provider;
}
export function createDatabaseRuntime(factories: Record<DatabaseProvider, () => DatabaseRuntime> = {
  postgres: () => {
    const pool = databasePool();
    return { accounts: createPostgresRepository(pool), close: () => pool.end() };
  },
  snowflake: () => createSnowflakeDatabase(),
}, env: NodeJS.ProcessEnv = process.env): DatabaseRuntime {
  return factories[selectedDatabaseProvider(env)]();
}
