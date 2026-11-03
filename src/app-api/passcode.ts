import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseSecretList } from './token.js';

export const SESSION_COOKIE = 'stmt_session';
// The session is an HMAC keyed by the passcode, so it never contains the passcode and every session
// dies as soon as its passcode is removed from TOOL_PASSCODES or expires.
const sessionOf = (passcode: string) => createHmac('sha256', passcode).update('statement-tool-session:v1').digest('hex');

export function createPasscodeGate(spec: string | undefined, now: () => Date = () => new Date()) {
  const entries = parseSecretList(spec, 'TOOL_PASSCODES', 8).map(e => ({ ...e, session: sessionOf(e.secret) }));
  const active = () => { const today = now().toISOString().slice(0, 10); return entries.filter(e => !e.expires || today <= e.expires); };
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const isValidSession = (value: string | undefined) => !!value && active().some(e => same(value, e.session));
  return {
    sessionFor: (passcode: string) => active().find(e => same(sessionOf(passcode), e.session))?.session ?? null,
    isValidSession,
    isValidRequest: (req: Request) => isValidSession(readCookie(req.headers.get('cookie'), SESSION_COOKIE)),
  };
}

function readCookie(header: string | null, name: string) {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}
