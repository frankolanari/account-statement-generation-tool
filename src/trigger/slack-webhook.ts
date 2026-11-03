import { webhook, webhooks } from '@trigger.dev/sdk';
import { webhookSource } from '@trigger.dev/slack';
import { normalizeSlackEvent } from '../services/slack-events.js';
import { slackStatement } from './slack.js';

// Trigger.dev verifies Slack signatures, handles the URL challenge and deduplicates deliveries.
export const slackEvents = webhooks.endpoint.define({
  id: 'account-statement-slack',
  source: webhookSource(),
});

export const receiveSlackMention = webhook({
  id: 'statement.receive-slack-mention',
  endpoint: slackEvents,
  retry: { maxAttempts: 1 },
  onEvent: async ({ event }) => {
    const normalized = normalizeSlackEvent(event);
    if (normalized.kind !== 'request') return;
    const result = await slackStatement.triggerAndWait(normalized.request, {
      idempotencyKey: `slack:${normalized.request.teamId}:${normalized.request.eventId}`,
      idempotencyKeyTTL: '24h',
    });
    if (!result.ok) throw new Error('Slack statement task failed');

  },
});
