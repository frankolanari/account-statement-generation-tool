import { z } from 'zod';
import { createHash } from 'node:crypto';

export const slackRequestSchema = z.object({
  requestId: z.string().uuid(), eventId: z.string().min(1), teamId: z.string().min(1),
  channel: z.string().regex(/^[CDG][A-Z0-9]+$/), user: z.string().regex(/^[UW][A-Z0-9]+$/),
  threadTs: z.string().regex(/^\d+\.\d+$/), text: z.string().trim().min(1).max(4000),
}).strict();
export type SlackRequest = z.infer<typeof slackRequestSchema>;
const ids = (value?: string) => value?.split(',').map(v => v.trim()).filter(Boolean) ?? [];
export function normalizeSlackEvent(input: unknown, env: NodeJS.ProcessEnv = process.env) {
  const envelope = z.object({ type: z.string(), team_id: z.string().optional(), event_id: z.string().optional(),
    challenge: z.string().optional(), event: z.record(z.unknown()).optional() }).parse(input);
  if (!env.SLACK_TEAM_ID) throw new Error('SLACK_TEAM_ID is required');
  if (envelope.type === 'url_verification') return { kind: 'challenge' as const, challenge: z.string().parse(envelope.challenge) };
  if (envelope.team_id !== env.SLACK_TEAM_ID) return { kind: 'ignored' as const };
  const event = envelope.event;
  if (envelope.type !== 'event_callback' || event?.type !== 'app_mention' || event.bot_id || event.subtype) return { kind: 'ignored' as const };
  const channels = ids(env.SLACK_ALLOWED_CHANNEL_IDS), users = ids(env.SLACK_ALLOWED_USER_IDS);
  if ((channels.length && !channels.includes(String(event.channel))) || (users.length && !users.includes(String(event.user)))) return { kind: 'ignored' as const };
  const eventId = z.string().min(1).parse(envelope.event_id);
  const hex = createHash('sha256').update(`${envelope.team_id}:${eventId}`).digest('hex');
  const requestId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  return { kind: 'request' as const, request: slackRequestSchema.parse({requestId, eventId, teamId: envelope.team_id,
    channel: event.channel, user: event.user, threadTs: event.thread_ts ?? event.ts, text: event.text }) };
}
