import { createHash } from 'node:crypto';
import { tasks, idempotencyKeys } from '@trigger.dev/sdk';
import { z } from 'zod';
import { lookupRequestSchema, generationRequestSchema, naturalLanguageRequestSchema } from '../domain/contracts.js';
import type { lookupAccount, generateStatement, generateFromText } from '../trigger/statements.js';

const envelope = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('lookup'), request: lookupRequestSchema }).strict(),
  z.object({ operation: z.literal('generate'), request: generationRequestSchema }).strict(),
  z.object({ operation: z.literal('natural-language'), request: naturalLanguageRequestSchema }).strict(),
]);
export function normalizeWebhook(input: unknown, source: 'website' | 'webhook') {
  const body = z.object({ operation: z.enum(['lookup','generate','natural-language']), request: z.record(z.unknown()) }).strict().parse(input);
  return envelope.parse({ ...body, request: { ...body.request, source } });
}
export async function dispatchWebhook(input: unknown, source: 'website' | 'webhook') {
  const payload = normalizeWebhook(input, source);
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const options = { idempotencyKey: await idempotencyKeys.create(digest, { scope: 'global' }),
    idempotencyKeyTTL: '24h', tags: [`source:${source}`] };
  if (payload.operation === 'lookup') return tasks.trigger<typeof lookupAccount>('statement.lookup-account', payload.request, options);
  if (payload.operation === 'natural-language') return tasks.trigger<typeof generateFromText>('statement.generate-from-text', payload.request, options);
  return tasks.trigger<typeof generateStatement>('statement.generate', payload.request, options);
}
