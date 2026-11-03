import { readCoreFile } from './read-core-file.js';

// This replaces n8n's HTML Payload node. Edit the request shape here;
// edit ordinary PDF settings in pdf-options.json.
// waitForSelector: the statement re-paginates by measuring rows once its font loads, then marks
// <html data-paginated>. Printing before that could use the unmeasured fallback pages.
export function buildHtmlPayload(html: string) {
  return {
    html,
    options: JSON.parse(readCoreFile('pdf-options.json')) as Record<string, unknown>,
    waitForSelector: { selector: 'html[data-paginated]', timeout: 15000 },
  };
}
