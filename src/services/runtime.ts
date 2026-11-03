import { createStatementEngine } from './engine.js';
import { createDatabaseRuntime } from './database.js';
import { createBrowserlessRenderer } from '../adapters/browserless.js';
import { createOptionalStorage } from '../adapters/storage.js';
import { renderStatementHtml } from '../adapters/statement-html.js';
export function createRuntime() {
  const endpoint = process.env.BROWSERLESS_PDF_URL;
  const token = process.env.BROWSERLESS_TOKEN;
  if (!endpoint || !token) throw new Error('BROWSERLESS_PDF_URL and BROWSERLESS_TOKEN are required');
  const storage = createOptionalStorage();
  const pdf = createBrowserlessRenderer(endpoint, token);
  const database = createDatabaseRuntime();
  return { engine: createStatementEngine({ accounts: database.accounts,
    pdf, artifacts: storage?.store, renderHtml: renderStatementHtml }),
    close: () => database.close() };
}
