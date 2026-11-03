import { DomainError } from '../domain/contracts.js';
import type { AccountRepository } from '../domain/ports.js';
import { resolvePeriod, type ResolvedPeriod } from '../domain/period.js';
import { rejectionMessage } from '../domain/messages.js';
import type { ExtractedDates } from './date-range.js';
import type { StatementEngine } from './engine.js';
import { lookupAccountService } from './engine.js';
import { parseNaturalLanguageRequest } from './natural-language.js';

type Generated = Awaited<ReturnType<StatementEngine['generate']>>;
export type TextOutcome =
  | { status: 'REJECTED'; code: string; message: string; requestId: string }
  | (Generated & { period: ResolvedPeriod });
export type TextRequestDeps = {
  extractor: { extract(text: string, today: string): Promise<ExtractedDates> };
  openDatabase: () => { accounts: AccountRepository; close(): Promise<void> };
  openRuntime: () => { engine: Pick<StatementEngine, 'generate'>; close(): Promise<void> };
  now?: () => Date;
  report?: (stage: string) => void;
};
// Natural language in, one outcome out. Business rejections never throw; operational failures do.
export async function fulfilTextRequest(payload: { requestId: string; source: 'slack' | 'webhook' | 'website'; text: string },
  deps: TextRequestDeps): Promise<TextOutcome> {
  const { requestId, source } = payload;
  const report = deps.report ?? (() => {});
  const now = deps.now?.() ?? new Date();
  try {
    report('interpreting_dates');
    const parsed = await parseNaturalLanguageRequest(payload.text, deps.extractor, now);
    report('resolving_account');
    const database = deps.openDatabase();
    let lookup;
    try { lookup = await lookupAccountService(database.accounts, { requestId, source, identifier: parsed.identifier }); }
    finally { await database.close(); }
    if (lookup.status !== 'USER_FOUND') return { status: 'REJECTED', code: lookup.status, message: rejectionMessage(lookup.status), requestId };
    const user = lookup.users[0];
    const period = resolvePeriod(parsed, user, now.toISOString().slice(0, 10));
    const runtime = deps.openRuntime();
    try {
      const result = await runtime.engine.generate({ requestId, source, userId: user.user_id, from: period.from, to: period.to }, report);
      return { ...result, period };
    } finally { await runtime.close(); }
  } catch (error) {
    if (error instanceof DomainError) return { status: 'REJECTED', code: error.code, message: rejectionMessage(error.code, error.message), requestId };
    throw error;
  }
}
