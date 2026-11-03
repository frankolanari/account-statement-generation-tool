import { DomainError } from '../domain/contracts.js';
import { extractedDatesSchema, type ExtractedDates } from '../services/date-range.js';
import { redactRequestIdentifiers } from '../services/request-input.js';
import { dateExtractionPrompt } from '../../core-files/date-extraction-prompt.js';

export function createOpenRouterDateExtractor(env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for natural-language requests');
  const model = env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash-lite';
  return { async extract(text: string, today: string): Promise<ExtractedDates> {
    // Redact again at the network boundary, even if callers already sanitized the text.
    const sanitized = redactRequestIdentifiers(text);
    const response = await request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 512,
        provider: { require_parameters: true },
        messages: [{ role: 'system', content: dateExtractionPrompt(today) }, { role: 'user', content: sanitized }],
        response_format: { type: 'json_schema', json_schema: { name: 'statement_dates', strict: true,
          schema: { type: 'object', additionalProperties: false,
            properties: { from: { type: ['string','null'] }, to: { type: ['string','null'] },
              from_month_only: { type: 'boolean' }, to_month_only: { type: 'boolean' }, needs_clarification: { type: 'boolean' } },
            required: ['from','to','from_month_only','to_month_only','needs_clarification'] } } },
      }), signal: AbortSignal.timeout(30000),
    });
    // Never echo provider response bodies or request text into errors/logs.
    if (!response.ok) throw new Error(`OpenRouter date extraction failed (HTTP ${response.status})`);
    try {
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response');
      return extractedDatesSchema.parse(JSON.parse(content));
    } catch {
      throw new DomainError('DATE_EXTRACTION_FAILED', 'The date response was invalid. Please provide explicit dates.');
    }
  } };
}
