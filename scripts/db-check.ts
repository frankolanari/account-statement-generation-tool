// Run: DATABASE_URL='postgres://...' npm run db:check
// Walks the connection layer by layer and says where it breaks. Never prints the password.
import dns from 'node:dns/promises';
import net from 'node:net';
import pg from 'pg';
import { analyzeDatabaseUrl } from '../src/adapters/db-url.js';
import { createPostgresRepository } from '../src/adapters/postgres.js';
import { checkSchema } from '../src/adapters/db-schema.js';

// Table names used by core-files/sql/*.sql.
const TABLES = { users: 'users', transactions: 'transactions' };

const raw = process.env.DATABASE_URL;
if (!raw) { console.error('Set DATABASE_URL first, for example:\n  DATABASE_URL=\'postgres://USER:PASSWORD@HOST:6543/postgres\' npm run db:check'); process.exit(2); }

const secrets = (() => { try { const u = new URL(raw); return [u.password, decodeURIComponent(u.password)].filter(s => s.length > 2); } catch { return []; } })();
const scrub = (text: string) => secrets.reduce((t, s) => t.split(s).join('***'), text);
const ok = (m: string) => console.log(`  ✓ ${m}`), bad = (m: string) => console.log(`  ✗ ${scrub(m)}`), note = (m: string) => console.log(`    ${scrub(m)}`);
const heading = (m: string) => console.log(`\n${m}`);
const ms = (t: number) => `${Date.now() - t} ms`;

function hint(e: { code?: string; message?: string }): string {
  const text = `${e.code ?? ''} ${e.message ?? ''}`;
  if (/Tenant or user not found/i.test(text)) return 'Wrong pooler user or region host. The user must be postgres.<project-ref>, and the host must be the exact one shown in Supabase > Connect (the region matters).';
  if (/28P01|password authentication failed/i.test(text)) return 'Wrong password, or the password has special characters that must be percent-encoded in the URL. Reset the database password in Supabase and encode it.';
  if (/ENETUNREACH|EHOSTUNREACH/.test(text)) return 'The network has no route to that address. If the host only has IPv6 (direct Supabase connection), use the pooler URL instead.';
  if (/ENOTFOUND|EAI_AGAIN/.test(text)) return 'The host name does not resolve. Check for a typo, or that the project is not paused.';
  if (/ETIMEDOUT|timeout/i.test(text)) return 'Nothing answered in time: wrong port, a firewall in front of the server, or a paused project.';
  if (/ECONNREFUSED/.test(text)) return 'The server refused the connection: wrong port, or the database/pooler is not running.';
  if (/SELF_SIGNED|self[- ]signed|UNABLE_TO_VERIFY|CERT/i.test(text)) return 'TLS certificate not trusted. Add &uselibpqcompat=true to the URL (or remove sslmode), or install the provider CA.';
  if (/unsupported startup parameter|options/i.test(text)) return 'The pooler rejected connection startup options. The app sends -c timezone/statement_timeout; drop them for pooler connections.';
  if (/42P01|does not exist/i.test(text)) return 'A table the app queries does not exist in this database (the app expects the names used in core-files/sql/*.sql).';
  if (/42703/.test(text)) return 'A column the app queries is missing or named differently. Compare core-files/sql/*.sql with your table.';
  return '';
}

async function main() {
  heading('1. The URL');
  const a = analyzeDatabaseUrl(raw!);
  console.log(`  host ${a.host || '?'}  port ${a.port ?? '?'}  user ${a.user || '?'}  database ${a.database || '?'}  type ${a.kind}${a.poolerMode ? ` (${a.poolerMode} mode)` : ''}`);
  if (!a.findings.length) ok('nothing suspicious in the URL');
  for (const f of a.findings) (f.severity === 'error' ? bad : note)(`${f.severity.toUpperCase()}: ${f.message}`);
  if (a.kind === 'unreadable') return 1;

  heading('2. Finding the server (DNS)');
  const [v4, v6] = await Promise.all([dns.resolve4(a.host).catch(() => []), dns.resolve6(a.host).catch(() => [])]);
  if (!v4.length && !v6.length) { bad(`${a.host} did not resolve at all`); return 1; }
  v4.length ? ok(`IPv4 address: ${v4[0]}`) : bad('no IPv4 address. Trigger.dev and many servers can only use IPv4, so they cannot reach this host.');
  v6.length ? ok('IPv6 address available') : note('no IPv6 address (fine)');

  heading('3. Opening a connection (TCP)');
  const t0 = Date.now();
  const tcp = await new Promise<string | null>(resolve => {
    const s = net.connect({ host: a.host, port: a.port ?? 5432, timeout: 8000, family: v4.length ? 4 : 6 });
    s.once('connect', () => { s.destroy(); resolve(null); });
    s.once('timeout', () => { s.destroy(); resolve('ETIMEDOUT'); });
    s.once('error', e => resolve((e as NodeJS.ErrnoException).code ?? e.message));
  });
  if (tcp) { bad(`could not connect to port ${a.port}: ${tcp}`); note(hint({ code: tcp })); return 1; }
  ok(`port ${a.port} is reachable (${ms(t0)}, over ${v4.length ? 'IPv4' : 'IPv6'})`);

  heading('4. Logging in (three variants, to find what the server dislikes)');
  const startup = '-c timezone=UTC -c statement_timeout=60000';
  const variants: Array<[string, pg.ClientConfig]> = [
    ['as the app connects today (with startup options)', { connectionString: raw, options: startup }],
    ['without startup options', { connectionString: raw }],
    ['without startup options, TLS not verified', { connectionString: raw, ssl: { rejectUnauthorized: false } }],
  ];
  let working: pg.ClientConfig | undefined, firstOk = '';
  for (const [label, config] of variants) {
    const client = new pg.Client({ ...config, connectionTimeoutMillis: 8000 });
    try {
      await client.connect();
      const r = await client.query("select current_user as u, current_setting('TimeZone') as tz");
      ok(`${label}: connected as ${r.rows[0].u}, session timezone ${r.rows[0].tz}`);
      if (!working) { working = config; firstOk = label; }
    } catch (e) {
      bad(`${label}: ${(e as { code?: string }).code ?? ''} ${(e as Error).message}`);
      const h = hint(e as { code?: string; message?: string }); if (h) note(`→ ${h}`);
    } finally { await client.end().catch(() => {}); }
  }
  if (!working) return 1;

  heading('5. Running the app\'s real queries');
  const pool = new pg.Pool({ ...working, max: 1, connectionTimeoutMillis: 8000 });
  try {
    const cols = await pool.query<{ table: string; column: string; type: string }>(
      `select table_name as "table", column_name as "column", data_type as type from information_schema.columns where table_schema = 'public' and table_name = any($1)`,
      [[TABLES.users, TABLES.transactions]]);
    const problems = checkSchema(cols.rows, TABLES);
    if (problems.length) {
      for (const p of problems) { bad(p.message); if (p.fix) note(`fix, run in the Supabase SQL editor: ${p.fix}`); }
      note('Fix these, then run db:check again.');
      return 1;
    }
    ok('column types match what the app expects');
    const repo = createPostgresRepository(pool);
    await repo.findUsers('db-check@example.invalid'); ok('user lookup query runs');
    await repo.fetchTransactions('db-check', '2026-01-01', '2026-01-31'); ok('transaction query runs');
    const count = await pool.query('select (select count(*) from users)::int as users, (select count(*) from transactions)::int as txns').catch(() => null);
    if (count) ok(`tables have ${count.rows[0].users} users and ${count.rows[0].txns} transactions`);
  } catch (e) {
    bad(`${(e as { code?: string }).code ?? ''} ${(e as Error).message}`);
    const h = hint(e as { code?: string; message?: string }); if (h) note(`→ ${h}`);
    const tables = await pool.query("select table_schema || '.' || table_name as t from information_schema.tables where table_schema not in ('pg_catalog','information_schema') order by 1 limit 40").catch(() => null);
    if (tables) note(`tables I can see: ${tables.rows.map(r => r.t).join(', ') || '(none)'}`);
    return 1;
  } finally { await pool.end().catch(() => {}); }

  heading('Result');
  ok(`connection works ("${firstOk}")`);
  if (!firstOk.startsWith('as the app')) note('The app\'s current settings fail but this variant works: tell me which one and I will change the adapter to match.');
  return 0;
}

main().then(code => process.exit(code), e => { console.error(scrub(String(e))); process.exit(1); });
