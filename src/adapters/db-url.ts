// Explains a DATABASE_URL without ever returning or logging its password.
// Used by scripts/db-check.ts; pure so it can be tested.

export type Finding = { severity: 'error' | 'warn' | 'info'; code: string; message: string };
export type UrlAnalysis = {
  kind: 'supabase-direct' | 'supabase-pooler' | 'other' | 'unreadable';
  host: string; port: number | null; user: string; database: string; poolerMode?: 'session' | 'transaction';
  findings: Finding[];
};

export function analyzeDatabaseUrl(raw: string): UrlAnalysis {
  const findings: Finding[] = [];
  const add = (severity: Finding['severity'], code: string, message: string) => findings.push({ severity, code, message });
  const base = { host: '', port: null as number | null, user: '', database: '' };
  let url: URL;
  try { url = new URL(raw.trim()); } catch {
    add('error', 'UNREADABLE', 'The URL could not be parsed. Expected postgres://USER:PASSWORD@HOST:PORT/DATABASE. If the password contains @ : / # ? or %, percent-encode it.');
    return { kind: 'unreadable', ...base, findings };
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) add('error', 'UNREADABLE', `The URL must start with postgres:// or postgresql:// (found "${url.protocol}//").`);

  const host = url.hostname, port = url.port ? Number(url.port) : 5432, user = decodeURIComponent(url.username), database = url.pathname.replace(/^\//, '');
  // More than one "@" before the path means a raw "@" inside the password.
  const authority = raw.trim().replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0];
  if ((authority.match(/@/g) ?? []).length > 1) {
    add('error', 'PASSWORD_NEEDS_ENCODING', 'The password seems to contain an unencoded "@". Percent-encode special characters in the password (@ becomes %40, # becomes %23, / becomes %2F, : becomes %3A).');
  }
  const ref = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host)?.[1];
  const pooler = /\.pooler\.supabase\.com$/.test(host);
  const kind: UrlAnalysis['kind'] = ref ? 'supabase-direct' : pooler ? 'supabase-pooler' : 'other';
  let poolerMode: UrlAnalysis['poolerMode'];

  if (kind === 'supabase-direct') {
    add('warn', 'IPV6_ONLY', 'Supabase direct connections (db.<ref>.supabase.co) resolve to IPv6 only, unless you buy the IPv4 add-on. Trigger.dev and many hosts only reach IPv4, so use the Session pooler URL instead (Supabase > Connect > Connection Method > Session pooler, port 5432). It works over IPv4 at no extra cost.');
  }
  if (kind === 'supabase-pooler') {
    poolerMode = port === 6543 ? 'transaction' : 'session';
    if (!/^[^.]+\.[a-z0-9]{20}$/.test(user)) {
      add('error', 'POOLER_USER_NEEDS_REF', 'On the Supabase pooler the username must be postgres.<project-ref> (for example postgres.abcdefghijklmnopqrst), not just "postgres". This causes "Tenant or user not found".');
    }
    if (port !== 5432 && port !== 6543) add('warn', 'POOLER_PORT', `Supabase pooler ports are 5432 (session) and 6543 (transaction); this URL uses ${port}.`);
    if (poolerMode === 'transaction') add('warn', 'TRANSACTION_POOLER_IPV6', 'Supabase\'s Transaction pooler (port 6543) uses IPv6 by default; IPv4-only networks (such as Trigger.dev) need the paid IPv4 add-on. The Session pooler (port 5432) works over IPv4 without it, so choose "Session pooler" in Supabase > Connect.');
    if (poolerMode === 'transaction') add('info', 'TRANSACTION_MODE', 'Transaction mode does not support session settings or named prepared statements. The app uses unnamed statements, so it works, but connection startup options (like -c timezone) may be rejected.');
  }
  if (/^[^.]+\.your-tenant-id$/.test(user)) {
    add('error', 'SELF_HOSTED_TENANT', 'The username still has the placeholder tenant "your-tenant-id". On self-hosted Supabase use postgres.<POOLER_TENANT_ID> with the value from your .env, or connect to Postgres directly on its own port.');
  }
  const params = url.searchParams;
  if (/^(require|verify-ca|verify-full)$/.test(params.get('sslmode') ?? '') && params.get('uselibpqcompat') !== 'true') {
    add('warn', 'SSLMODE_VERIFIES', 'With node-postgres, sslmode=require now means "verify the certificate chain". Supabase certificates are signed by Supabase\'s own CA, so this fails with "self-signed certificate in certificate chain". Add &uselibpqcompat=true (encrypt without verification), or remove sslmode.');
  }
  if (!database) add('warn', 'NO_DATABASE', 'No database name in the URL (usually /postgres on Supabase).');
  return { kind, host, port, user, database, poolerMode, findings };
}
