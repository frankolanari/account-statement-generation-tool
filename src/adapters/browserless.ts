import { buildHtmlPayload } from '../../core-files/html-payload.js';
import type { PdfRenderer } from '../domain/ports.js';
export function createBrowserlessRenderer(endpoint: string, token: string): PdfRenderer {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new Error('PDF endpoint must use HTTPS');
  url.searchParams.set('token', token);
  return { async render(html) {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildHtmlPayload(html)), signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`PDF renderer failed (HTTP ${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw new Error('PDF renderer returned an invalid PDF');
    return bytes;
  } };
}
