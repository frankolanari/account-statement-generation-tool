import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWebhookServer } from '../src/http/server.js';
import { normalizeSlackEvent } from '../src/services/slack-events.js';
import { createSlackClient } from '../src/adapters/slack-output.js';
import { deliverSlackRequest, notifySlackFailure } from '../src/services/slack-delivery.js';
import { successComment } from '../src/services/slack-copy.js';
const env = {SLACK_TEAM_ID: 'T123', SLACK_SIGNING_SECRET: 'synthetic-secret'};
const event = {type: 'event_callback', team_id: 'T123', event_id: 'Ev123', event: {
  type: 'app_mention', channel: 'C123', user: 'U123', ts: '1234.5678', text: '<@U999> statement for sample@example.com in January 2026',
}};
test('Slack event retries normalize to the same request ID and preserve thread', () => {
  const a = normalizeSlackEvent(event, env), b = normalizeSlackEvent(event, env);
  assert.deepEqual(a, b); assert.equal(a.kind, 'request');
  if (a.kind === 'request') assert.equal(a.request.threadTs, event.event.ts);
  const threaded = normalizeSlackEvent({...event, event: {...event.event, thread_ts: '1111.2222'}}, env);
  if (threaded.kind === 'request') assert.equal(threaded.request.threadTs, '1111.2222');
});
test('Slack rejects other workspaces, bots, event types, users and channels outside configured lists', () => {
  for (const input of [ {...event, team_id: 'T999'}, {...event, event: {...event.event, bot_id: 'B123'}},
    {...event, event: {...event.event, type: 'message'}} ]) assert.equal(normalizeSlackEvent(input, env).kind, 'ignored');
  assert.equal(normalizeSlackEvent(event, {...env, SLACK_ALLOWED_USER_IDS: 'U999'}).kind, 'ignored');
  assert.equal(normalizeSlackEvent(event, {...env, SLACK_ALLOWED_CHANNEL_IDS: 'C999'}).kind, 'ignored');
  assert.equal(normalizeSlackEvent(event, {...env, SLACK_ALLOWED_CHANNEL_IDS: 'C123', SLACK_ALLOWED_USER_IDS: 'U123'}).kind, 'request');
});
test('HTTP Slack route verifies raw signatures, handles challenge, and awaits durable dispatch', async () => {
  const calls: unknown[] = [];
  const server = createWebhookServer('x'.repeat(32), {slackEnv: env, dispatchSlack: async p => {calls.push(p);return {id: 'run_test'} as any;}});
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address() as {port: number};
  async function post(payload: unknown, signature = true, stale = false) {
    const body = JSON.stringify(payload), ts = String(Math.floor(Date.now()/1000) - (stale ? 600 : 0));
    return fetch(`http://127.0.0.1:${address.port}/webhooks/slack`, {method: 'POST', body, headers: {
      'content-type': 'application/json', 'x-slack-request-timestamp': ts,
      'x-slack-signature': signature ? `v0=${createHmac('sha256', env.SLACK_SIGNING_SECRET).update(`v0:${ts}:${body}`).digest('hex')}` : 'invalid',
    }});
  }
  try {
    assert.equal((await post(event, false)).status, 401);
    assert.equal((await post(event, true, true)).status, 401);
    assert.deepEqual(await (await post({type: 'url_verification', challenge: 'challenge'})).json(), {challenge: 'challenge'});
    assert.equal(calls.length, 0);
    assert.equal((await post(event)).status, 200); assert.equal(calls.length, 1);
    assert.equal((await post({...event, team_id: 'T999'})).status, 200); assert.equal(calls.length, 1);
  } finally { await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve())); }
});
test('failed Slack dispatch returns retryable HTTP failure rather than acknowledging lost work', async () => {
  const { handleSlack } = await import('../src/http/slack.js');
  const { Readable } = await import('node:stream');
  const body = JSON.stringify(event), ts = String(Math.floor(Date.now()/1000));
  const req = Readable.from([body]) as any;
  req.headers = {'x-slack-request-timestamp': ts, 'x-slack-signature': `v0=${createHmac('sha256', env.SLACK_SIGNING_SECRET).update(`v0:${ts}:${body}`).digest('hex')}`};
  await assert.rejects(() => handleSlack(req, async () => {throw new Error('Unavailable');}, env), /Unavailable/);
});
test('Slack uploads use current three-step API and never forward bot token to upload URL', async () => {
  const calls: {url: string; init?: RequestInit}[] = [];
  const request = (async (url: any, init: any) => {
    calls.push({url: String(url), init});
    return new Response(JSON.stringify(String(url).endsWith('files.getUploadURLExternal')
      ? {ok: true, upload_url: 'https://files.slack.com/upload/synthetic', file_id: 'F123'} : {ok: true}));
  }) as typeof fetch;
  await createSlackClient('synthetic-token', request).upload('C123', '1234.5678',
    [{bytes: Buffer.from('%PDF-mock'), fileName: 'statement.pdf'}, {bytes: Buffer.from('a,b'), fileName: 'statement.csv'}], 'Complete');
  assert.equal(calls.length, 5);
  assert.equal(new Headers(calls[1].init?.headers).has('authorization'), false);
  assert.equal(new Headers(calls[3].init?.headers).has('authorization'), false);
  const complete = new URLSearchParams(String(calls[4].init?.body));
  assert.equal(complete.get('thread_ts'), '1234.5678'); assert.equal(complete.get('channel_id'), 'C123'); assert.equal(JSON.parse(complete.get('files')!).length, 2);
});
test('Slack upload errors and unexpected upload hosts stop delivery without exposing tokens', async () => {
  for (const response of [{ok: false, error: 'synthetic-token'}, {ok: true, upload_url: 'https://example.com/upload'}]) {
    let calls = 0;
    const client = createSlackClient('synthetic-token', (async () => {calls++;return new Response(JSON.stringify(response));}) as typeof fetch);
    await assert.rejects(() => client.upload('C123', '1234.5678', [{bytes: Buffer.from('pdf'), fileName: 'statement.pdf'}], 'Complete'), e => {
      assert.equal(String(e).includes('synthetic-token'), false); return true;
    });
    assert.equal(calls, 1);
  }
});

test('Slack message returns its timestamp and remove deletes by timestamp', async () => {
  const bodies: Record<string, any>[] = [];
  const client = createSlackClient('synthetic-token', (async (url: any, init: any) => {
    bodies.push({url: String(url), ...JSON.parse(String(init.body))}); return new Response(JSON.stringify({ok: true, ts: '99.1'}));
  }) as typeof fetch);
  assert.deepEqual(await client.message('C123', '1.2', 'hi'), {ts: '99.1'});
  await client.remove('C123', '99.1');
  assert.match(bodies[1].url, /chat\.delete$/); assert.equal(bodies[1].ts, '99.1');
});

const slackPayload = {requestId: '3bbe4e18-63a4-495b-ae45-8fcc748742df', eventId: 'Ev1', teamId: 'T123', channel: 'C123', user: 'U123', threadTs: '1.2', text: 'statement for x'};
const meta = {input_txn_count: 2, output_txn_count: 2, is_truncated: false, requested_period: {from: '2024-01-03', to: '2026-10-28'},
  effective_period: {from: '2024-01-03', to: '2026-10-28'}, first_included_transaction: '1', last_included_transaction: '2'};
const period = {from: '2024-01-03', to: '2026-10-28', fullHistory: true, fromDefaulted: true, toDefaulted: true, toCapped: false};
const inline = (fileName: string, contentType: any) => ({storage: 'inline' as const, encoding: 'base64' as const, contentBase64: 'eA==', fileName, contentType});
const completed = {status: 'COMPLETED' as const, requestId: slackPayload.requestId, meta, fullName: 'Sample Customer', period,
  artifact: inline('s.pdf', 'application/pdf'), csv: inline('s.csv', 'text/csv')};
function fakeSlack(fail: {message?: number} = {}) {
  const calls: {kind: string; text?: string; files?: string[]}[] = []; let messages = 0;
  return {calls, client: {
    async message(_c: string, _t: string, text: string) { messages++; calls.push({kind: 'message', text});
      if (fail.message === messages) throw new Error('slack down'); return {ts: `ts${messages}`}; },
    async remove(_c: string, ts: string) { calls.push({kind: 'remove', text: ts}); },
    async upload(_c: string, _t: string, files: {fileName: string}[], comment: string) { calls.push({kind: 'upload', text: comment, files: files.map(f => f.fileName)}); },
  }};
}
const deps = (slack: any, outcome: any) => ({slack, generate: async () => outcome, readStored: async () => new Uint8Array()});
test('successful Slack delivery acknowledges, uploads PDF and CSV, then clears the acknowledgement', async () => {
  const s = fakeSlack();
  assert.equal((await deliverSlackRequest(slackPayload, deps(s.client, completed))).status, 'DELIVERED');
  assert.deepEqual(s.calls.map(c => c.kind), ['message', 'upload', 'remove']);
  assert.deepEqual(s.calls[1].files, ['s.pdf', 's.csv']);
  assert.match(s.calls[1].text!, /covers the full transaction history/);
  assert.match(s.calls[1].text!, /Period: \*_Jan 3, 2024_\* – \*_Oct 28, 2026_\*/);
  assert.equal(s.calls[2].text, 'ts1');
});
test('rejected Slack request replies with the reason and never uploads', async () => {
  const s = fakeSlack();
  const result = await deliverSlackRequest(slackPayload, deps(s.client, {status: 'REJECTED', code: 'X', message: 'Nope.', requestId: slackPayload.requestId}));
  assert.equal(result.status, 'REJECTED');
  assert.deepEqual(s.calls.map(c => c.kind), ['message', 'message', 'remove']);
  assert.equal(s.calls[1].text, 'Hi <@U123>,\nNope.');
});
test('a failed rejection reply fails the run but still clears the acknowledgement', async () => {
  const s = fakeSlack({message: 2});
  await assert.rejects(() => deliverSlackRequest(slackPayload, deps(s.client, {status: 'REJECTED', code: 'X', message: 'Nope.', requestId: slackPayload.requestId})), /slack down/);
  assert.equal(s.calls.at(-1)?.kind, 'remove');
});
test('failure notice includes the run reference and never throws', async () => {
  const s = fakeSlack();
  await notifySlackFailure(slackPayload, 'run_123', s.client as any);
  assert.match(s.calls[0].text!, /ref: run_123/);
  await notifySlackFailure(slackPayload, 'run_123', fakeSlack({message: 1}).client as any);
});
test('customer names cannot inject Slack mentions or links into the thread', () => {
  const comment = successComment({user: 'U123', fullName: '<!channel> <https://phish.example|Verify> & co', meta, period});
  assert.ok(!comment.includes('<!channel>')); assert.ok(!comment.includes('<https://'));
  assert.match(comment, /&lt;!channel&gt; &lt;https:\/\/phish\.example\|Verify&gt; &amp; co/);
});
test('a truncated default period never claims to cover the full history', () => {
  const comment = successComment({user: 'U123', fullName: 'Sample', meta: {...meta, is_truncated: true, input_txn_count: 5000, output_txn_count: 1500}, period});
  assert.ok(!comment.includes('covers the full transaction history'));
  assert.match(comment, /starts from the first transaction/);
});
test('Slack file upload methods are sent form-encoded, not JSON', async () => {
  const calls: {url: string; init?: RequestInit}[] = [];
  const request = (async (url: any, init: any) => {
    calls.push({url: String(url), init});
    return new Response(JSON.stringify(String(url).endsWith('files.getUploadURLExternal')
      ? {ok: true, upload_url: 'https://files.slack.com/upload/synthetic', file_id: 'F123'} : {ok: true}));
  }) as typeof fetch;
  await createSlackClient('synthetic-token', request).upload('C123', '1234.5678', [{bytes: Buffer.from('%PDF'), fileName: 'A B.pdf'}], 'Done');
  for (const i of [0, 2]) assert.equal(new Headers(calls[i].init?.headers).get('content-type'), 'application/x-www-form-urlencoded');
  const first = new URLSearchParams(String(calls[0].init?.body));
  assert.equal(first.get('filename'), 'A B.pdf'); assert.equal(first.get('length'), '4');
  const complete = new URLSearchParams(String(calls[2].init?.body));
  assert.deepEqual(JSON.parse(complete.get('files')!), [{id: 'F123', title: 'A B.pdf'}]);
  assert.equal(complete.get('thread_ts'), '1234.5678');
});
test('Slack API failures name the Slack error code', async () => {
  const client = createSlackClient('synthetic-token', (async () => new Response(JSON.stringify({ok: false, error: 'missing_scope'}))) as typeof fetch);
  await assert.rejects(() => client.message('C123', '1.2', 'hi'), /chat\.postMessage failed: missing_scope/);
});
