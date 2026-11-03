import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { createPostgresRepository } from '../src/adapters/postgres.js';
import { buildHtmlPayload } from '../core-files/html-payload.js';

// Simulate a deployed worker directory containing editable assets. This checks
// that adapters consume those assets rather than retaining embedded copies.
test('runtime uses edited core SQL and PDF options from its packaged directory', async () => {
  const root = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), 'statement-core-'));
  mkdirSync(join(temporary, 'core-files/sql'), { recursive: true });
  const userSql = readFileSync(join(root, 'core-files/sql/user-query.sql'), 'utf8')
    .replace('FROM users u', 'FROM custom_users u');
  const transactionSql = readFileSync(join(root, 'core-files/sql/transaction-query.sql'), 'utf8')
    .replaceAll(/\btransactions\b/g, 'custom_transactions');
  writeFileSync(join(temporary, 'core-files/sql/user-query.sql'), userSql);
  writeFileSync(join(temporary, 'core-files/sql/transaction-query.sql'), transactionSql);
  writeFileSync(join(temporary, 'core-files/pdf-options.json'), JSON.stringify({ format: 'Letter', landscape: true }));
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const pool = { query: async (sql: string, values: unknown[]) => {
    queries.push({ sql, values }); return { rows: [] };
  } } as unknown as pg.Pool;
  try {
    process.chdir(temporary);
    const accounts = createPostgresRepository(pool);
    await accounts.findUsers('customer@example.com');
    await accounts.getUser('confirmed-ID');
    await accounts.fetchTransactions('confirmed-ID', '2026-01-01', '2026-01-31');
    assert.equal(queries[0].sql, userSql);
    assert.deepEqual(queries[0].values, ['customer@example.com', 'lookup']);
    assert.equal(queries[1].sql, userSql);
    assert.deepEqual(queries[1].values, ['confirmed-ID', 'confirmed']);
    assert.equal(queries[2].sql, transactionSql);
    assert.deepEqual(buildHtmlPayload('<p>Statement</p>'), {
      html: '<p>Statement</p>', options: { format: 'Letter', landscape: true },
      waitForSelector: { selector: 'html[data-paginated]', timeout: 15000 },
    });
  } finally {
    process.chdir(root);
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('statement HTML re-paginates by measurement in the PDF browser, with the fixed split as fallback', async () => {
  const { buildStatementPayload } = await import('../core-files/statement-payload.js');
  const { renderStatementHtml } = await import('../core-files/statement-html.js');
  const user = { user_id: 'u', full_name: 'Sample Customer', email: 's@example.com', address: null, phone: null, country: 'GB',
    base_currency: 'GBP', transaction_count: 30, first_transaction_date: '2026-01-01', last_transaction_date: '2026-01-30' };
  const records = Array.from({ length: 30 }, (_, i) => ({ transaction_id: `T${i}`, transaction_date: '2026-01-15T10:00:00Z', transaction_type: 'TRANSFER',
    status: 'SUCCESS', channel: 'BANK', sent_currency: 'GBP', amount_sent: '1.00', fx_rate: null, received_currency: 'GBP', amount_received: '1.00',
    fee: null, beneficiary_name: 'X', beneficiary_account: null, beneficiary_bank: null }));
  const html = renderStatementHtml(buildStatementPayload({ user, records, from: '2026-01-01', to: '2026-01-31', total: 30, truncated: false, generatedOn: '2026-02-01T00:00:00Z' }));
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script), 'embedded pagination script must be valid JavaScript');
  assert.ok(!/__name|__defProp|require\(/.test(script), 'no bundler helpers may leak into the embedded script');
  assert.match(script, /data-paginated/);
  for (const id of ['tpl-header-full', 'tpl-header-slim', 'tpl-thead', 'tpl-footer']) assert.ok(html.includes(`<template id="${id}">`), id);
  assert.equal((html.match(/class="page"/g) ?? []).length, 3, 'fallback split (10 + 13 + 7 rows) still renders without scripts');
  assert.equal((html.match(/<tr><td class="col-id">/g) ?? []).length, 30, 'every row is present exactly once outside templates');
});
