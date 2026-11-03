import type { SlackRequest } from './slack-events.js';
import type { SlackClient } from '../adapters/slack-output.js';
import type { TextOutcome } from './text-request.js';
import { ackText, failureText, rejectionText, successComment } from './slack-copy.js';

type Artifact = { storage: 'inline'; contentBase64: string; fileName: string } | { storage: 's3'; key: string; fileName: string };
export async function deliverSlackRequest(payload: SlackRequest, deps: {
  slack: SlackClient;
  generate: (request: { requestId: string; source: 'slack'; text: string }) => Promise<TextOutcome>;
  readStored: (key: string) => Promise<Uint8Array>;
}): Promise<{ status: 'DELIVERED' | 'REJECTED'; requestId: string }> {
  const { slack, readStored } = deps;
  const { channel, threadTs, user, requestId } = payload;
  const ack = await slack.message(channel, threadTs, ackText(user));
  try {
    const result = await deps.generate({ requestId, source: 'slack', text: payload.text });
    if (result.status === 'REJECTED') {
      await slack.message(channel, threadTs, rejectionText(user, result.message));
      return { status: 'REJECTED', requestId };
    }
    const read = async (a: Artifact) => ({ fileName: a.fileName,
      bytes: a.storage === 'inline' ? Buffer.from(a.contentBase64, 'base64') : await readStored(a.key) });
    const files = await Promise.all([read(result.artifact), read(result.csv)]);
    await slack.upload(channel, threadTs, files, successComment({ user, fullName: result.fullName, meta: result.meta, period: result.period }));
    return { status: 'DELIVERED', requestId };
  } finally {
    // The acknowledgement is only a progress marker; failing to clear it must not hide the real outcome.
    try { await slack.remove(channel, ack.ts); } catch { /* best effort */ }
  }
}

// Last-resort reply when the task fails. Never throws, so it cannot mask the original error.
export async function notifySlackFailure(payload: SlackRequest, runId: string, slack: SlackClient): Promise<void> {
  try { await slack.message(payload.channel, payload.threadTs, failureText(payload.user, runId)); } catch { /* Slack itself is unavailable */ }
}
