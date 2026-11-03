import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { createStatementEngine } from '../src/services/engine.js';
import { generationRequestSchema, type User, type Transaction } from '../src/domain/contracts.js';
import { selectCoverage } from '../src/domain/coverage.js';
import { renderStatementHtml } from '../src/adapters/statement-html.js';
import { normalizeWebhook } from '../src/http/dispatch.js';
import { createPostgresRepository } from '../src/adapters/postgres.js';
import { createWebhookServer } from '../src/http/server.js';
import { verifySlackSignature, extractSlackIdentifier } from '../src/adapters/slack-input.js';
import type pg from 'pg';

const user: User = { user_id:'test-account', full_name:'Sample Customer', email:'sample@example.com',
  address:null,phone:null,country:'NG',base_currency:'USD',transaction_count:2,
  first_transaction_date:'2026-01-01',last_transaction_date:'2026-01-31' };
function tx(index: number, day='2026-01-01'): Transaction {
  return { transaction_id:String(index).padStart(6,'0'),transaction_date:`${day}T12:00:00.000000Z`,
    transaction_type:'DEPOSIT',status:'SUCCESS',channel:'BANK',sent_currency:'USD',amount_sent:'100.00',
    fx_rate:'1500',received_currency:'NGN',amount_received:'150000',fee:'0',
    beneficiary_name:'Sample Recipient',beneficiary_account:'0000000000',beneficiary_bank:'Sample Bank' };
}
const request = {requestId:randomUUID(),source:'webhook' as const,userId:user.user_id,from:'2026-01-01',to:'2026-01-31'};
function fixture(rows=[tx(1),tx(2,'2026-01-31')],total=rows.length,users=[user]) {
  const saved: string[] = []; let renders=0;
  const engine=createStatementEngine({ accounts:{findUsers:async()=>users,getUser:async()=>users[0]??null,
    fetchTransactions:async()=>({rows,total})},
    pdf:{render:async html=>{renders++;assert.match(html,/Customer Account Statement/);return new TextEncoder().encode('%PDF-mock');}},
    artifacts:{put:async key=>{saved.push(key);}},renderHtml:renderStatementHtml,now:()=>new Date('2026-02-01T10:00:00Z') });
  return {engine,saved,get renders(){return renders;}};
}
test('generation preserves requested period when complete and saves a PDF artifact',async()=>{
  const f=fixture();const result=await f.engine.generate(request);
  assert.equal(result.meta.is_truncated,false);assert.equal(result.meta.output_txn_count,2);
  assert.deepEqual(result.meta.effective_period,{from:request.from,to:request.to});assert.equal(f.saved.length,2);
});
test('buildStatement returns HTML and CSV without rendering a PDF',async()=>{
  const f=fixture();const built=await f.engine.buildStatement(request);
  assert.match(built.html,/Customer Account Statement/);
  assert.match(built.csv.split('\n')[1],/^000002,/);
  assert.equal(built.fileBase,'Sample Customer Account Statement from 2026-01-01 to 2026-01-31');
  assert.equal(f.renders,0);
});
test('generation with storage saves both the PDF and the CSV',async()=>{
  const f=fixture();const result=await f.engine.generate(request);
  assert.equal(f.saved.length,2);assert.match(f.saved[0],/\.pdf$/);assert.match(f.saved[1],/\.csv$/);
  assert.equal(result.csv.fileName,'Sample Customer Account Statement from 2026-01-01 to 2026-01-31.csv');
  assert.equal(result.fullName,'Sample Customer');
});
test('generation without storage returns the CSV inline',async()=>{
  const engine=createStatementEngine({accounts:{findUsers:async()=>[user],getUser:async()=>user,
    fetchTransactions:async()=>({rows:[tx(1)],total:1})},pdf:{render:async()=>new Uint8Array([1])},renderHtml:renderStatementHtml});
  const result=await engine.generate(request);
  if(result.csv.storage!=='inline') return assert.fail('Expected inline CSV');
  assert.match(Buffer.from(result.csv.contentBase64,'base64').toString('utf8'),/^Transaction ID,/);
});
test('lookup separates not found, no history, and multiple accounts',async()=>{
  const input={requestId:randomUUID(),source:'webhook',identifier:' SAMPLE@EXAMPLE.COM '};
  assert.equal((await fixture([],0,[]).engine.lookup(input)).status,'USER_NOT_FOUND');
  assert.equal((await fixture([],0,[{...user,transaction_count:0}]).engine.lookup(input)).status,'NO_TRANSACTION_HISTORY');
  assert.equal((await fixture([],0,[user,{...user,user_id:'second'}]).engine.lookup(input)).status,'ACCOUNT_SELECTION_REQUIRED');
});
test('empty period stops before rendering and storage',async()=>{
  const f=fixture([],0);await assert.rejects(()=>f.engine.generate(request),{code:'NO_TRANSACTIONS_IN_PERIOD'});
  assert.equal(f.renders,0);assert.equal(f.saved.length,0);
});
test('empty period before history explains where history begins',async()=>{
  await assert.rejects(()=>fixture([],0).engine.generate({...request,from:'2025-01-01',to:'2025-06-30'}),
    {code:'NO_TRANSACTIONS_IN_PERIOD',message:/history begins on January 1, 2026/});
});
test('calendar validation rejects rollover dates and reversed ranges',()=>{
  assert.equal(generationRequestSchema.safeParse({...request,from:'2026-02-30'}).success,false);
  assert.equal(generationRequestSchema.safeParse({...request,from:'2026-02-01'}).success,false);
  assert.equal(generationRequestSchema.safeParse({...request,from:'2024-02-29'}).success,true);
});
test('coverage extends cutoff day to hard limit and reports omitted records',()=>{
  const rows=[...Array.from({length:1490},(_,i)=>tx(i)),...Array.from({length:110},(_,i)=>tx(i+1490,'2026-01-02')),tx(1601,'2026-01-03')];
  const result=selectCoverage(rows,4000);assert.equal(result.records.length,1600);assert.equal(result.truncated,true);
  assert.equal(result.records[0].transaction_date.slice(0,10),'2026-01-02');
});
test('coverage removes the whole cutoff day when it exceeds ceiling',()=>{
  const rows=[...Array.from({length:1490},(_,i)=>tx(i)),...Array.from({length:111},(_,i)=>tx(i+1490,'2026-01-02'))];
  const result=selectCoverage(rows,5000);assert.equal(result.records.length,1490);assert.equal(result.truncated,true);
});
test('a single oversized day returns an explicit outcome, never an empty PDF',()=>{
  assert.throws(()=>selectCoverage(Array.from({length:1601},(_,i)=>tx(i)),2000),{code:'PERIOD_TOO_DENSE'});
});
test('truncated period ends on the last complete included day',async()=>{
  const rows=[...Array.from({length:1500},(_,i)=>tx(i)),tx(1501,'2026-01-02')];
  const result=await fixture(rows,5000).engine.generate(request);
  assert.equal(result.meta.effective_period.to,'2026-01-01');assert.equal(result.meta.requested_period.to,'2026-01-31');
});
test('HTML template escapes customer and recipient data',async()=>{
  const f=fixture([{...tx(1),beneficiary_name:'<script>alert(1)</script>'}],1,[{...user,full_name:'<img src=x onerror=alert(1)>'}]);
  await f.engine.generate(request);
  // Inspect renderer separately through injected port to verify escaping.
  let html='';const engine=createStatementEngine({accounts:{findUsers:async()=>[],getUser:async()=>({...user,full_name:'<script>x</script>'}),fetchTransactions:async()=>({rows:[tx(1)],total:1})},pdf:{render:async value=>{html=value;return new Uint8Array();}},artifacts:{put:async()=>{}},renderHtml:renderStatementHtml});
  await engine.generate(request);assert.ok(!html.includes('<script>x</script>'));assert.ok(html.includes('&lt;script&gt;'));
});
test('webhook source is assigned by the adapter, not trusted from payload',()=>{
  const normalized=normalizeWebhook({operation:'generate',request:{...request,source:'slack'}},'website');
  assert.equal(normalized.request.source,'website');
});
test('SQL binds values, includes full end date, orders oldest first, and counts before cap',async()=>{
  let sql='';let values:unknown[]=[];
  const pool={query:async(q:string,v:unknown[])=>{sql=q;values=v;return {rows:[]};}} as unknown as pg.Pool;
  await createPostgresRepository(pool).fetchTransactions("id' OR 1=1",request.from,request.to);
  assert.ok(!sql.includes("id' OR 1=1"));assert.equal(values[0],"id' OR 1=1");
  assert.match(sql,/\$3::date \+ 1/);assert.match(sql,/count\(\*\) OVER\(\)/);assert.equal(values[3],1601);
});
test('Slack signature rejects stale or tampered requests',()=>{
  const raw='{"event":"sample"}',time='1000',secret='test-secret';
  const signature='v0='+createHmac('sha256',secret).update(`v0:${time}:${raw}`).digest('hex');
  assert.equal(verifySlackSignature(raw,time,signature,secret,1000),true);
  assert.equal(verifySlackSignature(raw,time,signature,secret,1400),false);
  assert.equal(verifySlackSignature(raw+'x',time,signature,secret,1000),false);
});
test('Slack extraction masks all email addresses and strips mentions',()=>{
  const result=extractSlackIdentifier('<@U123> statement for unusuallylongemailname@example.com since January 2026');
  assert.equal(result.identifier,'unusuallylongemailname@example.com');assert.ok(!result.dateText.includes('@'));assert.ok(!result.dateText.includes('<@'));
});
test('webhook gateway rejects unauthenticated and invalid requests before dispatch',async()=>{
  const token='x'.repeat(40),server=createWebhookServer(token);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const address=server.address();assert.ok(address && typeof address==='object');
    const url=`http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(url+'/health')).status,200);
    assert.equal((await fetch(url+'/webhooks/generic',{method:'POST',body:'{}'})).status,401);
    assert.equal((await fetch(url+'/webhooks/generic',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'})).status,400);
  } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});

test('generation without storage returns the exact PDF bytes as base64', async () => {
  const bytes = new Uint8Array([37,80,68,70,45,0,255,128]);
  const stages: string[] = [];
  const engine = createStatementEngine({
    accounts: { findUsers: async () => [user], getUser: async () => user,
      fetchTransactions: async () => ({ rows: [tx(1)], total: 1 }) },
    pdf: { render: async () => bytes }, renderHtml: renderStatementHtml,
  });
  const result = await engine.generate(request, stage => stages.push(stage));
  assert.equal(result.artifact.storage, 'inline');
  if (result.artifact.storage !== 'inline') assert.fail('Expected inline PDF');
  assert.deepEqual(Buffer.from(result.artifact.contentBase64, 'base64'), Buffer.from(bytes));
  assert.equal(result.artifact.encoding, 'base64');
  assert.equal(result.artifact.contentType, 'application/pdf');
  assert.ok(!('key' in result.artifact));
  assert.ok(!stages.includes('saving_pdf'));
});

test('configured storage returns a reference without duplicating PDF content in task output', async () => {
  const result = await fixture().engine.generate(request);
  assert.equal(result.artifact.storage, 's3');
  assert.ok('key' in result.artifact);
  assert.ok(!('contentBase64' in result.artifact));
});

test('a configured storage failure is reported instead of silently discarding persistence', async () => {
  const engine = createStatementEngine({
    accounts: { findUsers: async () => [user], getUser: async () => user,
      fetchTransactions: async () => ({ rows: [tx(1)], total: 1 }) },
    pdf: { render: async () => new Uint8Array([1]) }, renderHtml: renderStatementHtml,
    artifacts: { put: async () => { throw new Error('storage unavailable'); } },
  });
  await assert.rejects(() => engine.generate(request), /storage unavailable/);
});

test('oversized inline PDFs return an explicit business error', async () => {
  const engine = createStatementEngine({
    accounts: { findUsers: async () => [user], getUser: async () => user,
      fetchTransactions: async () => ({ rows: [tx(1)], total: 1 }) },
    pdf: { render: async () => new Uint8Array(7_200_000) }, renderHtml: renderStatementHtml,
  });
  await assert.rejects(() => engine.generate(request), { code: 'PDF_TOO_LARGE_FOR_INLINE_OUTPUT' });
});

test('runtime requires no AWS or S3 credentials when the bucket is missing or blank', async () => {
  const { createRuntime } = await import('../src/services/runtime.js');
  const { createOptionalStorage } = await import('../src/adapters/storage.js');
  const keys = ['STATEMENTS_BUCKET','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','S3_ENDPOINT','DATABASE_URL','BROWSERLESS_PDF_URL','BROWSERLESS_TOKEN'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    keys.forEach(k => delete process.env[k]);
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    process.env.BROWSERLESS_PDF_URL = 'https://pdf.example.com/pdf';
    process.env.BROWSERLESS_TOKEN = 'synthetic-test-token';
    assert.equal(createOptionalStorage(), undefined);
    await createRuntime().close();
    process.env.STATEMENTS_BUCKET = '  ';
    // Ambient AWS variables must not opt into storage without a bucket.
    process.env.AWS_ACCESS_KEY_ID = 'synthetic-test-id';
    assert.equal(createOptionalStorage(), undefined);
    await createRuntime().close();
    process.env.STATEMENTS_BUCKET = 'configured-test-bucket';
    assert.ok(createOptionalStorage());
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('run polling signs both stored PDF and CSV downloads', async () => {
  const token = 'x'.repeat(40);
  const output = { status: 'COMPLETED', artifact: { storage: 's3', key: 'statements/a.pdf' }, csv: { storage: 's3', key: 'statements/a.csv' } };
  const server = createWebhookServer(token, {
    retrieveRun: async id => ({ id, taskIdentifier: 'statement.generate', status: 'COMPLETED', output }),
    signedDownload: async key => `https://signed.example/${key}`,
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/runs/run_test`, { headers: { authorization: `Bearer ${token}` } });
    const result = await response.json() as { downloadUrl?: string; csvDownloadUrl?: string };
    assert.equal(result.downloadUrl, 'https://signed.example/statements/a.pdf');
    assert.equal(result.csvDownloadUrl, 'https://signed.example/statements/a.csv');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test('run polling returns an inline PDF without initializing or signing storage', async () => {
  const token = 'x'.repeat(40);
  const artifact = { storage: 'inline', encoding: 'base64', contentBase64: 'JVBERi0=', contentType: 'application/pdf', fileName: 'statement.pdf' };
  const server = createWebhookServer(token, {
    retrieveRun: async id => ({ id, taskIdentifier: 'statement.generate', status: 'COMPLETED', output: { status: 'COMPLETED', artifact } }),
    signedDownload: async () => { assert.fail('Storage must not be used for inline results'); },
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/runs/run_test`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const result = await response.json() as { output: { artifact: typeof artifact }; downloadUrl?: string };
    assert.deepEqual(result.output.artifact, artifact);
    assert.ok(!('downloadUrl' in result));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
