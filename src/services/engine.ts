import { createHash } from 'node:crypto';
import { DomainError, generationRequestSchema, lookupRequestSchema, type Statement, type User } from '../domain/contracts.js';
import type { AccountRepository, ArtifactStore, PdfRenderer } from '../domain/ports.js';
import { selectCoverage } from '../domain/coverage.js';
import { noTransactionsMessage } from '../domain/messages.js';
import { renderStatementCsv, statementFileBase } from '../domain/statement-csv.js';
import { buildStatementPayload } from '../../core-files/statement-payload.js';

export function createStatementEngine(deps: {
  accounts: AccountRepository; pdf: PdfRenderer; artifacts?: ArtifactStore;
  renderHtml: (statement: Statement) => string; now?: () => Date;
}) {
  return {
    async lookup(input: unknown) {
      return lookupAccountService(deps.accounts, input);
    },
    // Data, HTML and CSV only: fast enough for an interactive preview.
    async buildStatement(input: unknown, report: (stage: string) => void = () => {}) {
      const request = generationRequestSchema.parse(input);
      report('resolving_account');
      const user = await deps.accounts.getUser(request.userId);
      if (!user) throw new DomainError('USER_NOT_FOUND', 'No matching account was found.');
      if (!user.transaction_count) throw new DomainError('NO_TRANSACTION_HISTORY', 'This account has no transaction history.');
      report('fetching_transactions');
      const { rows, total } = await deps.accounts.fetchTransactions(user.user_id, request.from, request.to);
      if (!total) throw new DomainError('NO_TRANSACTIONS_IN_PERIOD', noTransactionsMessage(request, user));
      const { records, truncated } = selectCoverage(rows, total);
      const statement = buildStatementPayload({ user, records, from: request.from, to: request.to,
        total, truncated, generatedOn: (deps.now?.() ?? new Date()).toISOString() });
      return { statement, html: deps.renderHtml(statement), csv: renderStatementCsv(statement), fileBase: statementFileBase(statement) };
    },
    renderPdf: (html: string) => deps.pdf.render(html),
    async generate(input: unknown, report: (stage: string) => void = () => {}) {
      const request = generationRequestSchema.parse(input);
      const { statement, html, csv, fileBase } = await this.buildStatement(request, report);
      report('rendering_pdf');
      const bytes = await deps.pdf.render(html);
      const csvBytes = new TextEncoder().encode(csv);
      const common = { status: 'COMPLETED' as const, requestId: request.requestId, meta: statement.meta,
        fullName: statement.user_details.full_name };
      const pdfFile = { contentType: 'application/pdf' as const, fileName: `${fileBase}.pdf` };
      const csvFile = { contentType: 'text/csv' as const, fileName: `${fileBase}.csv` };
      if (!deps.artifacts) {
        const inline = (bytes: Uint8Array) => ({ storage: 'inline' as const, encoding: 'base64' as const,
          contentBase64: Buffer.from(bytes).toString('base64') });
        const output = { ...common, artifact: { ...inline(bytes), ...pdfFile }, csv: { ...inline(csvBytes), ...csvFile } };
        // Leave headroom below Trigger.dev's 10 MB task-output limit.
        if (Buffer.byteLength(JSON.stringify(output), 'utf8') > 9_500_000) {
          throw new DomainError('PDF_TOO_LARGE_FOR_INLINE_OUTPUT',
            'The generated PDF is too large to return inline. Select a shorter period or enable PDF storage.');
        }
        return output;
      }
      report('saving_pdf');
      const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0,24);
      const key = `statements/${request.requestId}/${fingerprint}`;
      await deps.artifacts.put(`${key}.pdf`, bytes, pdfFile.contentType);
      await deps.artifacts.put(`${key}.csv`, csvBytes, csvFile.contentType);
      return { ...common, artifact: { storage: 's3' as const, key: `${key}.pdf`, ...pdfFile },
        csv: { storage: 's3' as const, key: `${key}.csv`, ...csvFile } };
    },
  };
}
export type StatementEngine = ReturnType<typeof createStatementEngine>;

export async function lookupAccountService(accounts: AccountRepository, input: unknown) {
      const request = lookupRequestSchema.parse(input);
      const users = await accounts.findUsers(request.identifier);
      if (!users.length) return { status: 'USER_NOT_FOUND' as const, users: [] as User[] };
      if (users.length > 1) return { status: 'ACCOUNT_SELECTION_REQUIRED' as const, users };
      return { status: users[0].transaction_count ? 'USER_FOUND' as const : 'NO_TRANSACTION_HISTORY' as const, users };
}
