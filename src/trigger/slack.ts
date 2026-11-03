import { schemaTask } from '@trigger.dev/sdk';
import { slackRequestSchema } from '../services/slack-events.js';
import { createSlackClient } from '../adapters/slack-output.js';
import { generateFromText } from './statements.js';
import { createStorage } from '../adapters/storage.js';
import { deliverSlackRequest, notifySlackFailure } from '../services/slack-delivery.js';

// Generation has its own retries. Do not automatically repeat a possibly successful Slack upload.
export const slackStatement = schemaTask({
  id: 'statement.slack', schema: slackRequestSchema, queue: {concurrencyLimit: 3}, retry: {maxAttempts: 1},
  run: async payload => {
    if (payload.teamId !== process.env.SLACK_TEAM_ID) throw new Error('Slack workspace mismatch');
    return deliverSlackRequest(payload, {
      slack: createSlackClient(),
      generate: async request => {
        const run = await generateFromText.triggerAndWait(request);
        if (!run.ok) throw new Error('Statement generation failed');
        return run.output;
      },
      readStored: key => createStorage().read(key),
    });
  },
  // Every request gets a reply: if anything above throws, tell the requester and give them a reference.
  onFailure: async ({ payload, ctx }) => {
    await notifySlackFailure(payload, ctx.run.id, createSlackClient());
  },
});
