import { createPrivateKey } from 'node:crypto';
import type { Connection, ConnectionOptions, Bind } from 'snowflake-sdk';
import type { AccountRepository } from '../domain/ports.js';
import type { User, Transaction } from '../domain/contracts.js';
import { HARD_LIMIT } from '../domain/coverage.js';
import { readCoreFile } from '../../core-files/read-core-file.js';

type Row = Record<string, unknown>;
export interface SnowflakeExecutor {
  execute(sql: string, binds: Bind[]): Promise<Row[]>;
  close(): Promise<void>;
}
type DriverConnection = Pick<Connection, 'connectAsync' | 'execute' | 'destroy'>;
type ConnectionFactory = (options: ConnectionOptions) => Promise<DriverConnection>;

export function snowflakeConnectionOptions(env: NodeJS.ProcessEnv = process.env): ConnectionOptions {
  function required(name: string): string {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required when DATABASE_PROVIDER=snowflake`);
    return value;
  }
  const options: ConnectionOptions = {
    account: required('SNOWFLAKE_ACCOUNT'), username: required('SNOWFLAKE_USERNAME'),
    warehouse: required('SNOWFLAKE_WAREHOUSE'), database: required('SNOWFLAKE_DATABASE'),
    schema: required('SNOWFLAKE_SCHEMA'), role: env.SNOWFLAKE_ROLE?.trim() || undefined,
    authenticator: env.SNOWFLAKE_AUTHENTICATOR?.trim().toUpperCase() || 'SNOWFLAKE_JWT',
    timeout: 60000, clientSessionKeepAlive: false,
  };
  switch (options.authenticator) {
    case 'SNOWFLAKE_JWT': {
      const key = required('SNOWFLAKE_PRIVATE_KEY').replace(/\\n/g, '\n');
      try {
        options.privateKey = createPrivateKey({ key, format: 'pem',
          passphrase: env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE || undefined })
          .export({ format: 'pem', type: 'pkcs8' }).toString();
      } catch {
        throw new Error('SNOWFLAKE_PRIVATE_KEY must be a usable PEM private key with the correct passphrase');
      }
      break;
    }
    case 'SNOWFLAKE':
      // Preserve whitespace in credentials. Account policy must permit this method.
      if (!env.SNOWFLAKE_PASSWORD) throw new Error('SNOWFLAKE_PASSWORD is required for password authentication');
      options.password = env.SNOWFLAKE_PASSWORD;
      break;
    case 'OAUTH':
    case 'PROGRAMMATIC_ACCESS_TOKEN':
      options.token = required('SNOWFLAKE_TOKEN');
      break;
    default:
      throw new Error('SNOWFLAKE_AUTHENTICATOR must be SNOWFLAKE_JWT, SNOWFLAKE, OAUTH, or PROGRAMMATIC_ACCESS_TOKEN; interactive sign-in is not supported by this worker');
  }
  return options;
}

function executeOn(connection: DriverConnection, sql: string, binds: Bind[]): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    connection.execute({ sqlText: sql, binds, rowMode: 'object',
      complete: (error, _statement, rows) => error ? reject(error) : resolve(rows ?? []) });
  });
}
function destroy(connection: DriverConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.destroy(error => error ? reject(error) : resolve());
  });
}
export function createSnowflakeExecutor(options: ConnectionOptions, factory: ConnectionFactory = async config => {
  // Lazy import: selecting Postgres never loads or initializes the Snowflake SDK.
  const { default: snowflake } = await import('snowflake-sdk');
  return snowflake.createConnection(config);
}): SnowflakeExecutor {
  let pending: Promise<DriverConnection> | undefined;
  let closed = false;
  async function open() {
    const connection = await factory(options);
    try {
      await connection.connectAsync();
      await executeOn(connection, "ALTER SESSION SET TIMEZONE = 'UTC', STATEMENT_TIMEOUT_IN_SECONDS = 60", []);
      return connection;
    } catch (error) {
      await destroy(connection).catch(() => {});
      throw error;
    }
  }
  return {
    async execute(sql, binds) {
      if (closed) throw new Error('Snowflake connection is closed');
      pending ??= open();
      return executeOn(await pending, sql, binds);
    },
    async close() {
      if (closed) return;
      closed = true;
      if (!pending) return;
      const connection = await pending.catch(() => undefined);
      if (connection) await destroy(connection);
    },
  };
}
function lowercase(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
}
function count(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Snowflake returned an invalid transaction count');
  return result;
}
export function createSnowflakeRepository(executor: SnowflakeExecutor): AccountRepository {
  async function users(identifier: string, mode: string): Promise<User[]> {
    const rows = await executor.execute(readCoreFile('sql/snowflake/user-query.sql'), [identifier, mode]);
    return rows.map(raw => {
      const row = lowercase(raw);
      return { ...row, transaction_count: count(row.transaction_count) } as User;
    });
  }
  return {
    findUsers: id => users(id, 'lookup'),
    async getUser(id) { return (await users(id, 'confirmed'))[0] ?? null; },
    async fetchTransactions(userId, from, to) {
      const rows = (await executor.execute(readCoreFile('sql/snowflake/transaction-query.sql'),
        [userId, from, to, HARD_LIMIT + 1])).map(lowercase);
      return { rows: rows.map(({ total_count, ...row }) => row as Transaction),
        total: rows.length ? count(rows[0].total_count) : 0 };
    },
  };
}
export function createSnowflakeDatabase(env: NodeJS.ProcessEnv = process.env) {
  const executor = createSnowflakeExecutor(snowflakeConnectionOptions(env));
  return { accounts: createSnowflakeRepository(executor), close: () => executor.close() };
}
