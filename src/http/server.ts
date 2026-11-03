import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runs } from '@trigger.dev/sdk';
import { ZodError } from 'zod';
import { handleSlack, dispatchSlack } from './slack.js';
import { dispatchWebhook } from './dispatch.js';
import { createStorage } from '../adapters/storage.js';

type RunView = { id: string; taskIdentifier: string; status: string; metadata?: Record<string, unknown>; output?: unknown };
type GatewayDependencies = {
  dispatchSlack?: typeof dispatchSlack;
  slackEnv?: NodeJS.ProcessEnv;
  retrieveRun?: (id: string) => Promise<RunView>;
  signedDownload?: (key: string) => Promise<string>;
};
export function createWebhookServer(token: string, deps: GatewayDependencies = {}) {
  if (token.length < 32) throw new Error('WEBHOOK_SERVICE_TOKEN must contain at least 32 characters');
  return createServer(async (req,res) => {
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type':'application/json', 'cache-control':'no-store' });
      res.end(JSON.stringify(data));
    };
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/health') return send(200, { status:'ok' });
    if (req.method === 'POST' && path === '/webhooks/slack') {
      try {
        const result = await handleSlack(req, deps.dispatchSlack, deps.slackEnv);
        return send(result.status, result.body);
      } catch (error) {
        if (error instanceof ZodError || error instanceof SyntaxError) return send(400, {error: 'Invalid Slack event'});
        return send(503, {error: 'Slack dispatch failed; retry the event'});
      }
    }
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) return send(401,{error:'Unauthorized'});
    try {
      if (req.method === 'POST' && ['/webhooks/generic','/webhooks/website'].includes(path)) {
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415,{error:'Use application/json'});
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          size += Buffer.byteLength(chunk);
          if (size > 16384) { send(413,{error:'Request too large'}); req.destroy(); return; }
          chunks.push(Buffer.from(chunk));
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const handle = await dispatchWebhook(input, path.endsWith('/website') ? 'website' : 'webhook');
        return send(202,{runId:handle.id, statusUrl:`/runs/${handle.id}`});
      }
      const match = path.match(/^\/runs\/(run_[A-Za-z0-9_-]+)$/);
      if (req.method === 'GET' && match) {
        const run = await (deps.retrieveRun ?? (id => runs.retrieve(id)))(match[1]);
        if (!['statement.lookup-account','statement.generate','statement.generate-from-text'].includes(run.taskIdentifier)) return send(404,{error:'Run not found'});
        const output = run.output as { status?: string; artifact?: { key?: string }; csv?: { key?: string } } | undefined;
        const sign = (key?: string) => output?.status === 'COMPLETED' && key
          ? (deps.signedDownload ?? (k => createStorage().signedDownload(k)))(key) : undefined;
        const [downloadUrl, csvDownloadUrl] = await Promise.all([sign(output?.artifact?.key), sign(output?.csv?.key)]);
        return send(200,{runId:run.id,status:run.status,stage:run.metadata?.stage,output,downloadUrl,csvDownloadUrl});
      }
      return send(404,{error:'Not found'});
    } catch(error) {
      if (error instanceof ZodError) return send(400,{error:'Invalid request',issues:error.issues.map(i=>({path:i.path,message:i.message}))});
      if (error instanceof SyntaxError) return send(400,{error:'Invalid JSON'});
      // Do not expose upstream URLs, database errors, or payloads.
      return send(502,{error:'The backend request failed. Check server-side service configuration.'});
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createWebhookServer(process.env.WEBHOOK_SERVICE_TOKEN || '');
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 3001), '0.0.0.0', () => console.log('Statement webhook server ready'));
}
