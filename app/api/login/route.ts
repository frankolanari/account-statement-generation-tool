import { passcodeGate } from '@/lib/server/statements';
import { SESSION_COOKIE } from '@/src/app-api/passcode';

export const runtime = 'nodejs';
const WEEK = 60 * 60 * 24 * 7;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { passcode?: unknown } | null;
  const session = typeof body?.passcode === 'string' ? passcodeGate().sessionFor(body.passcode) : null;
  if (!session) {
    // A short pause makes guessing slower without needing a rate-limit store.
    await new Promise(resolve => setTimeout(resolve, 700));
    return Response.json({ error: 'That passcode is not valid.' }, { status: 401 });
  }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json',
    'set-cookie': `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WEEK}${secure}` } });
}
