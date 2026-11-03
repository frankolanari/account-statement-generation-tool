import type { IncomingMessage } from 'node:http';
import { tasks, idempotencyKeys } from '@trigger.dev/sdk';
import { verifySlackSignature } from '../adapters/slack-input.js';
import { normalizeSlackEvent, type SlackRequest } from '../services/slack-events.js';
import type { slackStatement } from '../trigger/slack.js';
export async function dispatchSlack(request: SlackRequest) {
  return tasks.trigger<typeof slackStatement>('statement.slack', request, {
    idempotencyKey: await idempotencyKeys.create(`slack:${request.teamId}:${request.eventId}`, {scope: 'global'}),
    idempotencyKeyTTL: '24h', tags: ['source:slack'],
  });
}
export async function handleSlack(req: IncomingMessage, dispatch = dispatchSlack, env: NodeJS.ProcessEnv = process.env) {
  if (!env.SLACK_SIGNING_SECRET || !env.SLACK_TEAM_ID) return {status: 503, body: {error: 'Slack is not configured'}};
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 65536) return {status: 413, body: {error: 'Request too large'}};
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!verifySlackSignature(raw, String(req.headers['x-slack-request-timestamp'] ?? ''),
    String(req.headers['x-slack-signature'] ?? ''), env.SLACK_SIGNING_SECRET)) return {status: 401, body: {error: 'Invalid Slack signature'}};
  const result = normalizeSlackEvent(JSON.parse(raw), env);
  if (result.kind === 'challenge') return {status: 200, body: {challenge: result.challenge}};
  if (result.kind === 'request') {
    // Persist the task before acknowledging. A timeout/failure lets Slack retry; event ID deduplicates it.
    await dispatch(result.request);
  }
  return {status: 200, body: {ok: true}};
}
