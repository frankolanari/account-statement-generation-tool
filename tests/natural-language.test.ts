import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createOpenRouterDateExtractor } from '../src/adapters/openrouter.js';
import { extractRequestIdentifier, redactRequestIdentifiers } from '../src/services/request-input.js';
import { parseNaturalLanguageRequest } from '../src/services/natural-language.js';
import { resolveExtractedDates } from '../src/services/date-range.js';
import { normalizeWebhook } from '../src/http/dispatch.js';
import { fulfilTextRequest } from '../src/services/text-request.js';

const dates = { from: '2026-01', to: '2026-01', from_month_only: true, to_month_only: true, needs_clarification: false };
const userId = '1234567890abcdef12345678';
const now = new Date('2026-10-27T12:00:00Z');

test('all emails, IDs, Slack mentions, and repeated occurrences are removed from model text', () => {
  const text = `<@U123ABC> statement for ${userId} or SAMPLE@EXAMPLE.COM, sample@example.com and ${userId.toUpperCase()} for January 2026`;
  const result = extractRequestIdentifier(text);
  assert.equal(result.identifier, userId);
  assert.ok(!result.dateText.toLowerCase().includes(userId));
  assert.ok(!result.dateText.toLowerCase().includes('sample@example.com'));
  assert.ok(!result.dateText.includes('U123ABC'));
  assert.match(result.dateText, /January 2026/);
});
test('all email local parts are excluded before ID matching', () => {
  const r = extractRequestIdentifier('statement unusuallylongemailname@example.com and UNUSUALLYLONGEMAILNAME@EXAMPLE.COM for January');
  assert.equal(r.identifier, 'unusuallylongemailname@example.com');
  assert.ok(!r.dateText.includes('@'));
});
test('multiple different account identifiers reject before calling the model', async () => {
  let calls = 0;
  await assert.rejects(() => parseNaturalLanguageRequest('a@example.com and b@example.com for January', {
    extract: async () => { calls++; return dates; },
  }, now), { code: 'AMBIGUOUS_IDENTIFIER' });
  assert.equal(calls, 0);
  await assert.rejects(() => parseNaturalLanguageRequest('a statement for January', {
    extract: async () => { calls++; return dates; },
  }, now), { code: 'INVALID_IDENTIFIER' });
  assert.equal(calls, 0);
});
test('OpenRouter receives only redacted text and returns date-only data', async () => {
  let sent: Record<string, unknown> = {};
  const fakeFetch: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    sent = JSON.parse(String(init?.body));
    assert.ok(!String(init?.body).includes('sample@example.com'));
    assert.ok(!String(init?.body).includes(userId));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(dates) } }] }));
  };
  const extractor = createOpenRouterDateExtractor({ OPENROUTER_API_KEY: 'synthetic-key' }, fakeFetch);
  const result = await parseNaturalLanguageRequest(`sample@example.com ${userId} for January 2026`, extractor, now);
  assert.deepEqual(result, { identifier: userId, from: '2026-01-01', to: '2026-01-31' });
  assert.equal(sent.model, 'google/gemini-2.5-flash-lite');
  assert.equal((sent.messages as Array<{ role: string }>).length, 2);
});
test('redaction is enforced again inside the network adapter for direct callers', async () => {
  const extractor = createOpenRouterDateExtractor({ OPENROUTER_API_KEY: 'synthetic-key', OPENROUTER_MODEL: 'custom/model' }, async (_url, init) => {
    const body = String(init?.body);
    assert.ok(!body.includes('other@example.com'));
    assert.ok(!body.includes(userId));
    assert.equal(JSON.parse(body).model, 'custom/model');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(dates) } }] }));
  });
  await extractor.extract(`other@example.com ${userId}`, '2026-10-27');
});
test('month boundaries, leap years, no-date defaults, and future end cap match Slack rules', () => {
  assert.deepEqual(resolveExtractedDates({ ...dates, from: '2024-02', to: '2024-02' }, '2026-10-27'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(resolveExtractedDates({ ...dates, from: null, to: null, from_month_only: false, to_month_only: false }, '2026-10-27'), { from: null, to: null });
  assert.deepEqual(resolveExtractedDates({ ...dates, from: '2026-10', to: '2026-10' }, '2026-10-27'), { from: '2026-10-01', to: '2026-10-31' });
});
test('model flagging clarification with no dates is treated as no dates', () => {
  assert.deepEqual(resolveExtractedDates({ from: null, to: null, from_month_only: false, to_month_only: false, needs_clarification: true }, '2026-10-27'), { from: null, to: null });
});
test('invalid, ambiguous, and reversed dates never silently broaden the requested period', () => {
  assert.throws(() => resolveExtractedDates({ ...dates, from: '2026-02-30', from_month_only: false }, '2026-10-27'), { code: 'DATE_EXTRACTION_FAILED' });
  assert.throws(() => resolveExtractedDates({ ...dates, needs_clarification: true }, '2026-10-27'), { code: 'DATE_CLARIFICATION_REQUIRED' });
  assert.throws(() => resolveExtractedDates({ ...dates, from: '2026-11', to: '2026-10' }, '2026-10-27'), { code: 'INVALID_DATE_RANGE' });
});
test('provider failures never echo response bodies or identifiers in errors', async () => {
  const extractor = createOpenRouterDateExtractor({ OPENROUTER_API_KEY: 'synthetic-key' }, async () => new Response('sample@example.com private provider details', { status: 401 }));
  await assert.rejects(() => extractor.extract('sample@example.com for January', '2026-10-27'), error => error instanceof Error && !error.message.includes('sample@example.com') && error.message.includes('401'));
  const bad = createOpenRouterDateExtractor({ OPENROUTER_API_KEY: 'synthetic-key' }, async () => new Response(JSON.stringify({ choices: [{ message: { content: 'bad JSON sample@example.com' } }] })));
  await assert.rejects(() => bad.extract('sample@example.com for January', '2026-10-27'), { code: 'DATE_EXTRACTION_FAILED' });
});
test('structured webhook requests still normalize without any OpenRouter configuration', () => {
  const r = normalizeWebhook({ operation: 'lookup', request: { requestId: randomUUID(), identifier: 'sample@example.com' } }, 'website');
  assert.equal(r.operation, 'lookup');
  const nl = normalizeWebhook({ operation: 'natural-language', request: { requestId: randomUUID(), text: 'sample@example.com for January' } }, 'webhook');
  assert.equal(nl.operation, 'natural-language');
  assert.equal(nl.request.source, 'webhook');
  assert.ok(!redactRequestIdentifiers('sample@example.com').includes('@'));
});

const account = { user_id:'test-account', full_name:'Sample Customer', email:'sample@example.com', address:null, phone:null,
  country:'NG', base_currency:'USD', transaction_count:2, first_transaction_date:'2026-01-01', last_transaction_date:'2026-01-31' };
function textDeps(users = [account], extracted = { from: null, to: null, from_month_only: false, to_month_only: false, needs_clarification: false }) {
  const calls: { identifier?: string; generate?: Record<string, unknown> } = {};
  const deps = {
    extractor: { extract: async () => extracted },
    openDatabase: () => ({ accounts: { findUsers: async (id: string) => { calls.identifier = id; return users; },
      getUser: async () => users[0] ?? null, fetchTransactions: async () => ({ rows: [], total: 0 }) }, close: async () => {} }),
    openRuntime: () => ({ engine: { generate: async (input: Record<string, unknown>) => { calls.generate = input;
      return { status: 'COMPLETED' as const, requestId: String(input.requestId) }; } }, close: async () => {} }),
    now: () => now,
  };
  return { deps, calls };
}
test('text request without dates generates the full history to today', async () => {
  const { deps, calls } = textDeps();
  const result = await fulfilTextRequest({ requestId: randomUUID(), source: 'slack', text: `statement for ${userId}` }, deps as never);
  assert.equal(calls.generate?.from, '2026-01-01'); assert.equal(calls.generate?.to, '2026-10-27');
  assert.equal(result.status, 'COMPLETED');
  if (result.status === 'COMPLETED') assert.equal(result.period.fullHistory, true);
});
test('text request for an unknown account is rejected with user-facing copy', async () => {
  const { deps } = textDeps([]);
  const result = await fulfilTextRequest({ requestId: randomUUID(), source: 'slack', text: 'statement for nobody@example.com' }, deps as never);
  assert.deepEqual({ status: result.status, code: (result as { code?: string }).code }, { status: 'REJECTED', code: 'USER_NOT_FOUND' });
  assert.match((result as { message: string }).message, /couldn't find a valid email address or User ID/);
});
test('Slack mailto links count as one identifier', async () => {
  const { deps, calls } = textDeps();
  await fulfilTextRequest({ requestId: randomUUID(), source: 'slack', text: 'statement for <mailto:a@b.com|a@b.com>' }, deps as never);
  assert.equal(calls.identifier, 'a@b.com');
});
test('unreadable dates ask for clarification instead of defaulting to full history', async () => {
  const unclear = { extract: async () => ({ from: null, to: null, from_month_only: false, to_month_only: false, needs_clarification: true }) };
  await assert.rejects(() => parseNaturalLanguageRequest(`statement for ${userId} for last tax year`, unclear, now), { code: 'DATE_CLARIFICATION_REQUIRED' });
  assert.deepEqual(await parseNaturalLanguageRequest(`statement for ${userId} please`, unclear, now), { identifier: userId, from: null, to: null });
});
