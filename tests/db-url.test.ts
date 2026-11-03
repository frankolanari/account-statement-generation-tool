import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDatabaseUrl } from '../src/adapters/db-url.js';

const codes = (url: string) => analyzeDatabaseUrl(url).findings.map(f => f.code);

test('a Supabase direct connection is flagged as IPv6-only', () => {
  const a = analyzeDatabaseUrl('postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres');
  assert.equal(a.kind, 'supabase-direct');
  assert.ok(codes('postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres').includes('IPV6_ONLY'));
});
test('a correct transaction-pooler URL has no errors', () => {
  const a = analyzeDatabaseUrl('postgres://postgres.abcdefghijklmnopqrst:secret@aws-0-eu-west-2.pooler.supabase.com:6543/postgres');
  assert.equal(a.kind, 'supabase-pooler'); assert.equal(a.poolerMode, 'transaction');
  assert.deepEqual(a.findings.filter(f => f.severity === 'error'), []);
});
test('a pooler URL whose user lacks the project ref is an error', () => {
  assert.ok(codes('postgres://postgres:secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres').includes('POOLER_USER_NEEDS_REF'));
});
test('sslmode=require is flagged because pg verifies the certificate chain', () => {
  assert.ok(codes('postgres://postgres.abcdefghijklmnopqrst:secret@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require').includes('SSLMODE_VERIFIES'));
  assert.ok(!codes('postgres://postgres.abcdefghijklmnopqrst:secret@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require&uselibpqcompat=true').includes('SSLMODE_VERIFIES'));
});
test('an unencoded @ in the password is detected, and the password is never reported', () => {
  const a = analyzeDatabaseUrl('postgres://postgres.abcdefghijklmnopqrst:p@ss-word@aws-0-eu-west-2.pooler.supabase.com:6543/postgres');
  assert.ok(a.findings.some(f => f.code === 'PASSWORD_NEEDS_ENCODING'));
  assert.ok(!JSON.stringify(a).includes('p@ss-word') && !JSON.stringify(a).includes('ss-word'));
});
test('the self-hosted placeholder tenant is called out', () => {
  assert.ok(codes('postgres://postgres.your-tenant-id:secret@my-server.example.com:5432/postgres').includes('SELF_HOSTED_TENANT'));
});
test('garbage input is reported as an unreadable URL, not a crash', () => {
  const a = analyzeDatabaseUrl('not a url');
  assert.equal(a.kind, 'unreadable'); assert.ok(a.findings.some(f => f.code === 'UNREADABLE' && f.severity === 'error'));
});
test('the transaction pooler is flagged as IPv6-by-default and the session pooler is recommended', () => {
  const tx = analyzeDatabaseUrl('postgres://postgres.abcdefghijklmnopqrst:secret@aws-0-eu-west-2.pooler.supabase.com:6543/postgres');
  const warning = tx.findings.find(f => f.code === 'TRANSACTION_POOLER_IPV6');
  assert.ok(warning && /Session pooler/.test(warning.message));
  const session = analyzeDatabaseUrl('postgres://postgres.abcdefghijklmnopqrst:secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres');
  assert.equal(session.poolerMode, 'session');
  assert.deepEqual(session.findings.filter(f => f.severity !== 'info'), []);
});
test('the direct-connection advice points at the Session pooler, not the transaction pooler', () => {
  const direct = analyzeDatabaseUrl('postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres');
  const message = direct.findings.find(f => f.code === 'IPV6_ONLY')!.message;
  assert.match(message, /Session pooler/); assert.doesNotMatch(message, /port 6543/);
});
