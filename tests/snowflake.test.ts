import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { Connection, StatementOption, RowStatement, SnowflakeError } from 'snowflake-sdk';
import { selectedDatabaseProvider, createDatabaseRuntime, type DatabaseRuntime } from '../src/services/database.js';
import { snowflakeConnectionOptions, createSnowflakeRepository, createSnowflakeExecutor, type SnowflakeExecutor } from '../src/adapters/snowflake.js';
import { createStatementEngine } from '../src/services/engine.js';
import { renderStatementHtml } from '../src/adapters/statement-html.js';

const env = {
  SNOWFLAKE_ACCOUNT: 'example-account', SNOWFLAKE_USERNAME: 'statement-service',
  SNOWFLAKE_WAREHOUSE: 'COMPUTE_WH', SNOWFLAKE_DATABASE: 'APP_DB', SNOWFLAKE_SCHEMA: 'PUBLIC',
  SNOWFLAKE_AUTHENTICATOR: 'SNOWFLAKE', SNOWFLAKE_PASSWORD: 'synthetic password ',
};
const userRow = {
  USER_ID: 'test-account', FULL_NAME: 'Sample Customer', EMAIL: 'sample@example.com',
  ADDRESS: null, PHONE: null, COUNTRY: 'NG', BASE_CURRENCY: 'USD', TRANSACTION_COUNT: '1',
  FIRST_TRANSACTION_DATE: '2026-01-01', LAST_TRANSACTION_DATE: '2026-01-31',
};
const transactionRow = {
  TRANSACTION_ID: 'tx-1', TRANSACTION_DATE: '2026-01-31T23:59:59.123456Z', TRANSACTION_TYPE: 'DEPOSIT',
  STATUS: 'SUCCESS', CHANNEL: 'BANK', SENT_CURRENCY: 'USD', AMOUNT_SENT: '9007199254740993.123456',
  FX_RATE: '1500.123456789', RECEIVED_CURRENCY: 'NGN', AMOUNT_RECEIVED: '150000.00', FEE: null,
  BENEFICIARY_NAME: 'Sample Recipient', BENEFICIARY_ACCOUNT: '0000000000', BENEFICIARY_BANK: null,
  TOTAL_COUNT: '2000',
};

test('Postgres is selected when provider is missing or blank; names normalize and unknown values reject', () => {
  assert.equal(selectedDatabaseProvider({}), 'postgres');
  assert.equal(selectedDatabaseProvider({ DATABASE_PROVIDER: '  ' }), 'postgres');
  assert.equal(selectedDatabaseProvider({ DATABASE_PROVIDER: ' Postgres ' }), 'postgres');
  assert.equal(selectedDatabaseProvider({ DATABASE_PROVIDER: ' Snowflake ' }), 'snowflake');
  assert.throws(() => selectedDatabaseProvider({ DATABASE_PROVIDER: 'postgresql-typo' }), /DATABASE_PROVIDER/);
});

test('database factory initializes only the selected provider', async () => {
  const calls: string[] = [];
  const runtime: DatabaseRuntime = { accounts: {} as DatabaseRuntime['accounts'], close: async () => {} };
  const factories = { postgres: () => { calls.push('postgres'); return runtime; },
    snowflake: () => { calls.push('snowflake'); return runtime; } };
  assert.equal(createDatabaseRuntime(factories, {}), runtime);
  assert.deepEqual(calls, ['postgres']);
  calls.length = 0;
  assert.equal(createDatabaseRuntime(factories, { DATABASE_PROVIDER: 'snowflake' }), runtime);
  assert.deepEqual(calls, ['snowflake']);
});

test('Snowflake configuration validates only its own settings and preserves password whitespace', () => {
  const options = snowflakeConnectionOptions(env);
  assert.equal(options.password, env.SNOWFLAKE_PASSWORD);
  assert.equal(options.database, 'APP_DB');
  assert.equal(options.account, 'example-account');
  assert.equal(options.clientSessionKeepAlive, false);
  assert.throws(() => snowflakeConnectionOptions({ ...env, SNOWFLAKE_ACCOUNT: '' }), /SNOWFLAKE_ACCOUNT/);
  assert.throws(() => snowflakeConnectionOptions({ ...env, SNOWFLAKE_AUTHENTICATOR: 'EXTERNALBROWSER' }), /interactive sign-in/);
});

test('Snowflake accepts token-based authentication with no password or Postgres URL', () => {
  for (const authenticator of ['OAUTH', 'PROGRAMMATIC_ACCESS_TOKEN']) {
    const options = snowflakeConnectionOptions({ ...env, SNOWFLAKE_AUTHENTICATOR: authenticator,
      SNOWFLAKE_PASSWORD: undefined, SNOWFLAKE_TOKEN: 'synthetic-token' });
    assert.equal(options.token, 'synthetic-token');
    assert.equal(options.password, undefined);
  }
  assert.throws(() => snowflakeConnectionOptions({ ...env, SNOWFLAKE_AUTHENTICATOR: 'OAUTH' }), /SNOWFLAKE_TOKEN/);
});

test('key-pair authentication defaults to JWT and accepts escaped PEM newlines', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const options = snowflakeConnectionOptions({ ...env, SNOWFLAKE_AUTHENTICATOR: undefined,
    SNOWFLAKE_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'), SNOWFLAKE_PASSWORD: undefined });
  assert.equal(options.authenticator, 'SNOWFLAKE_JWT');
  assert.equal(options.privateKey, privateKey);
  assert.equal(options.password, undefined);
  assert.throws(() => snowflakeConnectionOptions({ ...env, SNOWFLAKE_AUTHENTICATOR: 'SNOWFLAKE_JWT',
    SNOWFLAKE_PRIVATE_KEY: 'invalid-synthetic-key' }), error =>
    error instanceof Error && !error.message.includes('invalid-synthetic-key') && error.message.includes('PEM'));
});

test('Snowflake repository binds user input, normalizes result keys, and preserves decimal strings', async () => {
  const queries: Array<{ sql: string; binds: unknown[] }> = [];
  const executor: SnowflakeExecutor = { close: async () => {}, execute: async (sql, binds) => {
    queries.push({ sql, binds });
    return sql.includes('QUALIFY') ? [transactionRow] : [userRow];
  } };
  const accounts = createSnowflakeRepository(executor);
  const identifier = "sample' OR 1=1 --";
  const users = await accounts.findUsers(identifier);
  assert.equal(users[0].transaction_count, 1);
  assert.equal(users[0].user_id, 'test-account');
  assert.equal(users[0].first_transaction_date, '2026-01-01');
  assert.ok(!queries[0].sql.includes(identifier));
  assert.deepEqual(queries[0].binds, [identifier, 'lookup']);
  await accounts.getUser('test-account');
  assert.deepEqual(queries[1].binds, ['test-account', 'confirmed']);
  const transactions = await accounts.fetchTransactions('test-account', '2026-01-01', '2026-01-31');
  assert.deepEqual(queries[2].binds, ['test-account', '2026-01-01', '2026-01-31', 1601]);
  assert.equal(transactions.total, 2000);
  assert.equal(transactions.rows[0].amount_sent, '9007199254740993.123456');
  assert.equal(transactions.rows[0].fee, null);
  assert.ok(!('total_count' in transactions.rows[0]));
});

test('Snowflake repository returns explicit empty results and rejects invalid counts', async () => {
  const empty = createSnowflakeRepository({ execute: async () => [], close: async () => {} });
  assert.deepEqual(await empty.findUsers('missing'), []);
  assert.equal(await empty.getUser('missing'), null);
  assert.deepEqual(await empty.fetchTransactions('missing', '2026-01-01', '2026-01-31'), { rows: [], total: 0 });
  const invalid = createSnowflakeRepository({ execute: async () => [{ ...userRow, TRANSACTION_COUNT: 'bad' }], close: async () => {} });
  await assert.rejects(() => invalid.getUser('test-account'), /invalid transaction count/);
});

function fakeDriver(failSession = false) {
  let connections = 0, disconnects = 0;
  const queries: string[] = [];
  const driver = {
    connectAsync: async () => { connections++; return driver; },
    execute: (options: StatementOption) => {
      queries.push(options.sqlText);
      options.complete?.(failSession && options.sqlText.startsWith('ALTER SESSION') ? new Error('session failed') as SnowflakeError : undefined,
        {} as RowStatement, options.sqlText.startsWith('ALTER SESSION') ? [] : [{ value: 'ok' }]);
      return {} as RowStatement;
    },
    destroy: (callback: (error?: Error) => void) => { disconnects++; callback(); },
  };
  return { driver: driver as unknown as Connection, queries,
    get connections() { return connections; }, get disconnects() { return disconnects; } };
}

test('Snowflake connects lazily, initializes UTC once, reuses connection, and closes once', async () => {
  const fake = fakeDriver();
  const executor = createSnowflakeExecutor(snowflakeConnectionOptions(env), async () => fake.driver);
  assert.equal(fake.connections, 0);
  assert.deepEqual(await executor.execute('SELECT :1', ['first']), [{ value: 'ok' }]);
  await executor.execute('SELECT :1', ['second']);
  assert.equal(fake.connections, 1);
  assert.equal(fake.queries.filter(sql => sql.startsWith('ALTER SESSION')).length, 1);
  assert.match(fake.queries[0], /TIMEZONE = 'UTC'/);
  await executor.close(); await executor.close();
  assert.equal(fake.disconnects, 1);
  await assert.rejects(() => executor.execute('SELECT 1', []), /closed/);
});

test('Snowflake closes a connection when session initialization fails', async () => {
  const fake = fakeDriver(true);
  const executor = createSnowflakeExecutor(snowflakeConnectionOptions(env), async () => fake.driver);
  await assert.rejects(() => executor.execute('SELECT 1', []), /session failed/);
  await executor.close();
  assert.equal(fake.disconnects, 1);
});

test('closing an unused Snowflake runtime never opens a connection', async () => {
  let factories = 0;
  const executor = createSnowflakeExecutor(snowflakeConnectionOptions(env), async () => { factories++; return fakeDriver().driver; });
  await executor.close();
  assert.equal(factories, 0);
});

test('shared statement engine generates an inline PDF from Snowflake adapter results', async () => {
  const accounts = createSnowflakeRepository({ close: async () => {},
    execute: async sql => sql.includes('QUALIFY') ? [{ ...transactionRow, TOTAL_COUNT: '1' }] : [userRow] });
  const engine = createStatementEngine({ accounts, renderHtml: renderStatementHtml,
    pdf: { render: async html => { assert.match(html, /Sample Customer/); return Buffer.from('%PDF-test'); } } });
  const result = await engine.generate({ requestId: randomUUID(), source: 'webhook', userId: 'test-account', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.meta.output_txn_count, 1);
  assert.equal(result.artifact.storage, 'inline');
});
