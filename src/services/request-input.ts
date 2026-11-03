import { DomainError } from '../domain/contracts.js';
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;
const USER_ID = /\b[A-Za-z0-9]{19,26}\b/g;
export function redactRequestIdentifiers(text: string): string {
  return text.replace(/<@[^>]+>/g, '').replace(EMAIL, '<identifier>')
    .replace(USER_ID, '<identifier>').replace(/\s+/g, ' ').trim();
}
export function extractRequestIdentifier(text: string) {
  const withoutMentions = text.replace(/<@[^>]+>/g, '');
  const emails = withoutMentions.match(EMAIL) ?? [];
  // Strip ALL emails before matching IDs so long email local parts cannot become IDs.
  const ids = withoutMentions.replace(EMAIL, '').match(USER_ID) ?? [];
  const candidates = [...new Set((ids.length ? ids : emails).map(s => s.toLowerCase()))];
  if (!candidates.length) throw new DomainError('INVALID_IDENTIFIER', 'Provide a user ID or email.');
  if (candidates.length > 1) throw new DomainError('AMBIGUOUS_IDENTIFIER', 'Please request one account at a time.');
  return { identifier: candidates[0], dateText: redactRequestIdentifiers(text) };
}
