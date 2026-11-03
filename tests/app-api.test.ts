import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { User, Transaction } from '../src/domain/contracts.js';
import { createStatementEngine } from '../src/services/engine.js';
import { renderStatementHtml } from '../src/adapters/statement-html.js';
import { createAppApi } from '../src/app-api/handlers.js';
import { bearerTokenAuthorizer } from '../src/app-api/token.js';

const user: User = { user_id:'test-account', full_name:'Sample Customer', email:'sample@example.com', address:null, phone:null,
  country:'NG', base_currency:'USD', transaction_count:2, first_transaction_date:'2026-01-01', last_transaction_date:'2026-01-31' };
const tx: Transaction = { transaction_id:'000001', transaction_date:'2026-01-02T12:00:00.000000Z', transaction_type:'DEPOSIT', status:'SUCCESS',
  channel:'BANK', sent_currency:'USD', amount_sent:'100.00', fx_rate:'1500', received_currency:'NGN', amount_received:'150000', fee:'0',
  beneficiary_name:'Sample Recipient', beneficiary_account:'0000000000', beneficiary_bank:'Sample Bank' };
function api(opts: { authorized?: boolean; failing?: boolean; pdfBytes?: number } = {}) {
  const state = { opened: 0, closed: 0, fetched: [] as string[][] };
  const accounts = {
    findUsers: async () => { if (opts.failing) throw new Error('secret database detail'); return [user]; },
    getUser: async () => user,
    fetchTransactions: async (_id: string, from: string, to: string) => { state.fetched.push([from, to]); return { rows: [tx], total: 1 }; },
  };
  const app = createAppApi({
    authorize: async () => opts.authorized ?? true,
    openRuntime: () => { state.opened++; return { engine: createStatementEngine({ accounts, renderHtml: renderStatementHtml,
      pdf: { render: async () => opts.pdfBytes ? new Uint8Array(opts.pdfBytes) : new TextEncoder().encode('%PDF-mock') } }), close: async () => { state.closed++; } }; },
    today: () => '2026-10-28',
  });
  return { app, state };
}
const post = (body: unknown) => new Request('https://app.example/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('unauthorized requests are refused before any data access', async () => {
  const { app, state } = api({ authorized: false });
  assert.equal((await app.lookup(post({ identifier: 'sample@example.com' }))).status, 401);
  assert.equal(state.opened, 0);
});
test('lookup returns the account summary with the full-history default period', async () => {
  const { app, state } = api();
  const response = await app.lookup(post({ identifier: 'sample@example.com' }));
  const body = await response.json() as any;
  assert.equal(response.status, 200); assert.equal(body.status, 'USER_FOUND');
  assert.equal(body.account.full_name, 'Sample Customer');
  assert.deepEqual(body.defaultPeriod, { from: '2026-01-01', to: '2026-10-28' });
  assert.equal(state.closed, state.opened);
});
test('preview with only an end date starts at the first transaction', async () => {
  const { app } = api();
  const body = await (await app.preview(post({ userId: 'test-account', to: '2026-01-31' }))).json() as any;
  assert.equal(body.period.from, '2026-01-01'); assert.match(body.html, /Customer Account Statement/);
});
test('malformed dates are rejected with the field named', async () => {
  const { app } = api();
  const response = await app.preview(post({ userId: 'test-account', from: '2026-1-5' }));
  assert.equal(response.status, 400);
  assert.deepEqual(((await response.json()) as any).issues[0].path, ['from']);
});
test('pdf and csv downloads are attachments named after the statement', async () => {
  const { app } = api();
  const pdf = await app.pdf(post({ userId: 'test-account' }));
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition')!, /attachment; filename="Sample Customer Account Statement from 2026-01-01 to .*\.pdf"/);
  const csv = await app.csv(post({ userId: 'test-account' }));
  assert.match(csv.headers.get('content-type')!, /^text\/csv/);
  assert.match(await csv.text(), /^Transaction ID,/);
});
test('business rejections return their reason and code', async () => {
  const { app } = api();
  const response = await app.preview(post({ userId: 'test-account', from: '2030-01-01' }));
  assert.equal(response.status, 422);
  assert.equal(((await response.json()) as any).code, 'INVALID_DATE_RANGE');
});
test('unexpected failures return a reference without leaking details and still close', async () => {
  const { app, state } = api({ failing: true });
  const original = console.error; console.error = () => {};
  try {
    const response = await app.lookup(post({ identifier: 'sample@example.com' }));
    const text = await response.text();
    assert.equal(response.status, 500); assert.match(text, /ref: /); assert.ok(!text.includes('secret database detail'));
  } finally { console.error = original; }
  assert.equal(state.closed, state.opened);
});

test('generate returns the PDF and CSV as base64 in one response', async () => {
  const { app } = api();
  const response = await app.generate(post({ userId: 'test-account', from: '2026-01-01', to: '2026-01-31' }));
  const body = await response.json() as any;
  assert.equal(response.status, 200); assert.equal(body.status, 'COMPLETED');
  assert.equal(body.contentType, 'application/pdf');
  assert.equal(body.fileName, 'Sample Customer Account Statement from 2026-01-01 to 2026-01-31.pdf');
  assert.equal(Buffer.from(body.contentBase64, 'base64').toString(), '%PDF-mock');
  assert.match(Buffer.from(body.csv.contentBase64, 'base64').toString(), /^Transaction ID,/);
  assert.deepEqual([body.period.from, body.period.to], ['2026-01-01', '2026-01-31']);
});
test('generate refuses responses above the hosting size limit with an explicit reason', async () => {
  const { app } = api({ pdfBytes: 4_000_000 });
  const response = await app.generate(post({ userId: 'test-account' }));
  assert.equal(response.status, 422);
  assert.equal(((await response.json()) as any).code, 'PDF_TOO_LARGE_FOR_INLINE_OUTPUT');
});
test('fixed bearer token authorizes only the exact token', async () => {
  const token = 'a'.repeat(40);
  const authorize = bearerTokenAuthorizer(token);
  const req = (header?: string) => new Request('https://x', { headers: header ? { authorization: header } : {} });
  assert.equal(await authorize(req(`Bearer ${token}`)), true);
  assert.equal(await authorize(req(`Bearer ${token}x`)), false);
  assert.equal(await authorize(req('Bearer short')), false);
  assert.equal(await authorize(req()), false);
  assert.throws(() => bearerTokenAuthorizer(undefined), /STATEMENT_API_TOKEN/);
  assert.throws(() => bearerTokenAuthorizer('too-short'), /STATEMENT_API_TOKEN/);
});
test('several tokens can be active at once', async () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40);
  const authorize = bearerTokenAuthorizer(` ${a} , ${b} `);
  const req = (t: string) => new Request('https://x', { headers: { authorization: `Bearer ${t}` } });
  assert.equal(await authorize(req(a)), true); assert.equal(await authorize(req(b)), true);
  assert.equal(await authorize(req('c'.repeat(40))), false);
});
test('a token with an expiry date stops working after that UTC day', async () => {
  const token = 'a'.repeat(40);
  const req = new Request('https://x', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(await bearerTokenAuthorizer(`${token}:2026-11-30`, () => new Date('2026-11-30T23:59:00Z'))(req), true);
  assert.equal(await bearerTokenAuthorizer(`${token}:2026-11-30`, () => new Date('2026-12-01T00:00:00Z'))(req), false);
});
test('malformed token configuration fails at startup', () => {
  assert.throws(() => bearerTokenAuthorizer(`${'a'.repeat(40)}:next-week`), /STATEMENT_API_TOKEN/);
  assert.throws(() => bearerTokenAuthorizer(` , `), /STATEMENT_API_TOKEN/);
});
test('pdf responses carry the statement summary so the PDF itself can be the preview', async () => {
  const { app } = api();
  const pdf = await app.pdf(post({ userId: 'test-account', from: '2026-01-01', to: '2026-01-31' }));
  const summary = JSON.parse(decodeURIComponent(pdf.headers.get('x-statement-meta')!));
  assert.deepEqual(summary.meta.effective_period, { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(summary.meta.output_txn_count, 1);
  assert.equal(summary.period.from, '2026-01-01');
  assert.equal(pdf.headers.get('access-control-expose-headers'), 'x-statement-meta, content-disposition');
});
