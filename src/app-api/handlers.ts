import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { DomainError, isoDate, type User } from '../domain/contracts.js';
import { resolvePeriod } from '../domain/period.js';
import { rejectionMessage } from '../domain/messages.js';
import type { StatementEngine } from '../services/engine.js';

// Synchronous Request -> Response handlers for the step-by-step web app (Next.js route handlers re-export these).
const lookupBody = z.object({ identifier: z.string().trim().min(1).max(254) }).strict();
const statementBody = z.object({ userId: z.string().trim().min(1).max(100), from: isoDate.optional(), to: isoDate.optional() }).strict();
const MAX_RESPONSE_BYTES = 4_400_000;
type Runtime ={ engine: Pick<StatementEngine, 'lookup' | 'buildStatement' | 'renderPdf'>; close(): Promise<void> };
const json = (status: number, data: unknown) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const summary = (u: User) => ({ user_id: u.user_id, full_name: u.full_name, email: u.email, country: u.country, base_currency: u.base_currency,
  transaction_count: u.transaction_count, first_transaction_date: u.first_transaction_date, last_transaction_date: u.last_transaction_date });
function attachment(body: BodyInit, contentType: string, fileName: string, extra: Record<string, string> = {}) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_');
  return new Response(body, { status: 200, headers: { 'content-type': contentType, 'cache-control': 'no-store',
    'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`, ...extra } });
}

export function createAppApi(deps: {
  authorize: (req: Request) => Promise<boolean>;
  openRuntime: () => Runtime;
  today?: () => string;
}) {
  const today = () => deps.today?.() ?? new Date().toISOString().slice(0, 10);
  const context = () => ({ requestId: randomUUID(), source: 'website' as const });
  async function handle(req: Request, work: (body: unknown, engine: Runtime['engine']) => Promise<Response>) {
    if (!(await deps.authorize(req))) return json(401, { error: 'Unauthorized' });
    let runtime: Runtime | undefined;
    try {
      const body = await req.json().catch(() => { throw new SyntaxError('Invalid JSON'); });
      runtime = deps.openRuntime();
      return await work(body, runtime.engine);
    } catch (error) {
      if (error instanceof SyntaxError) return json(400, { error: 'Invalid JSON' });
      if (error instanceof ZodError) return json(400, { error: 'Invalid request', issues: error.issues.map(i => ({ path: i.path, message: i.message })) });
      if (error instanceof DomainError) return json(error.code === 'USER_NOT_FOUND' ? 404 : 422, { code: error.code, message: rejectionMessage(error.code, error.message) });
      // Never return or log payloads, SQL or provider details; the reference links the response to the server log.
      const ref = randomUUID();
      console.error(`[app-api] ${ref}`, error instanceof Error ? error.name : typeof error);
      return json(500, { error: `Something went wrong (ref: ${ref})` });
    } finally { await runtime?.close(); }
  }
  async function findUser(engine: Runtime['engine'], identifier: string) {
    const lookup = await engine.lookup({ ...context(), identifier });
    if (lookup.status !== 'USER_FOUND') throw new DomainError(lookup.status, rejectionMessage(lookup.status));
    return lookup.users[0];
  }
  async function build(body: unknown, engine: Runtime['engine']) {
    const input = statementBody.parse(body);
    const user = await findUser(engine, input.userId);
    const period = resolvePeriod({ from: input.from ?? null, to: input.to ?? null }, user, today());
    const built = await engine.buildStatement({ ...context(), userId: user.user_id, from: period.from, to: period.to });
    return { ...built, period };
  }
  return {
    lookup: (req: Request) => handle(req, async (body, engine) => {
      const { identifier } = lookupBody.parse(body);
      const lookup = await engine.lookup({ ...context(), identifier });
      if (lookup.status === 'ACCOUNT_SELECTION_REQUIRED') return json(200, { status: lookup.status, accounts: lookup.users.map(summary) });
      if (lookup.status !== 'USER_FOUND') throw new DomainError(lookup.status, rejectionMessage(lookup.status));
      const user = lookup.users[0];
      const { from, to } = resolvePeriod({ from: null, to: null }, user, today());
      return json(200, { status: lookup.status, account: summary(user), defaultPeriod: { from, to } });
    }),
    preview: (req: Request) => handle(req, async (body, engine) => {
      const { html, statement, period } = await build(body, engine);
      return json(200, { html, meta: statement.meta, period });
    }),
    // The PDF doubles as the tool's preview, so it also carries the statement summary (URI-encoded JSON).
    pdf: (req: Request) => handle(req, async (body, engine) => {
      const { html, fileBase, statement, period } = await build(body, engine);
      return attachment(Buffer.from(await engine.renderPdf(html)), 'application/pdf', `${fileBase}.pdf`, {
        'x-statement-meta': encodeURIComponent(JSON.stringify({ meta: statement.meta, period })),
        'access-control-expose-headers': 'x-statement-meta, content-disposition',
      });
    }),
    csv: (req: Request) => handle(req, async (body, engine) => {
      const { csv, fileBase } = await build(body, engine);
      return attachment(csv, 'text/csv; charset=utf-8', `${fileBase}.csv`);
    }),
    // One-call API: PDF and CSV returned as base64 JSON for server-to-server callers.
    generate: (req: Request) => handle(req, async (body, engine) => {
      const { html, csv, fileBase, statement, period } = await build(body, engine);
      const pdf = await engine.renderPdf(html);
      const result = JSON.stringify({ status: 'COMPLETED', fileName: `${fileBase}.pdf`, contentType: 'application/pdf',
        contentBase64: Buffer.from(pdf).toString('base64'),
        csv: { fileName: `${fileBase}.csv`, contentType: 'text/csv', contentBase64: Buffer.from(csv).toString('base64') },
        meta: statement.meta, period });
      // Vercel rejects function responses above 4.5 MB; say so instead of failing opaquely.
      if (Buffer.byteLength(result) > MAX_RESPONSE_BYTES) {
        throw new DomainError('PDF_TOO_LARGE_FOR_INLINE_OUTPUT', 'The statement is too large to return in one response. Request a shorter period.');
      }
      return new Response(result, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }),
  };
}
