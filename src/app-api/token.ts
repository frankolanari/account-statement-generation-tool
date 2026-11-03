import { createHash, timingSafeEqual } from 'node:crypto';
import { isoDate } from '../domain/contracts.js';

// "secret[:YYYY-MM-DD], secret2, ..." -> entries; an expiry date means the secret stops working after that UTC day.
export function parseSecretList(spec: string | undefined, name: string, minLength: number) {
  const error = `${name} must list secrets of at least ${minLength} characters, comma-separated, each optionally ":YYYY-MM-DD" (expires after that UTC day)`;
  const entries = (spec ?? '').split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const [secret, expires, ...rest] = entry.split(':');
    if (rest.length || secret.length < minLength || (expires !== undefined && !isoDate.safeParse(expires).success)) throw new Error(error);
    return { secret, expires };
  });
  if (!entries.length) throw new Error(error);
  return entries;
}

const digest = (value: string) => createHash('sha256').update(value).digest();
// Fixed shared-secret check for server-to-server callers. Several tokens may be active, each with an optional
// expiry date. Misconfiguration fails at startup rather than running unprotected.
export function bearerTokenAuthorizer(spec: string | undefined, now: () => Date = () => new Date()) {
  const entries = parseSecretList(spec, 'STATEMENT_API_TOKEN', 32).map(e => ({ expected: digest(`Bearer ${e.secret}`), expires: e.expires }));
  return async (req: Request) => {
    // Hashing first gives equal-length buffers, so comparisons never leak token length.
    const supplied = digest(req.headers.get('authorization') ?? '');
    const today = now().toISOString().slice(0, 10);
    return entries.some(e => timingSafeEqual(supplied, e.expected) && (!e.expires || today <= e.expires));
  };
}
