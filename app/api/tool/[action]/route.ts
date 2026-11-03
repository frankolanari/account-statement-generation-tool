// The internal tool's steps: lookup -> preview -> pdf / csv. Requires a passcode session cookie.
import { toolApi } from '@/lib/server/statements';

export const runtime = 'nodejs';
export const maxDuration = 60;
const ACTIONS = ['lookup', 'preview', 'pdf', 'csv'] as const;

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const name = ACTIONS.find(a => a === action);
  if (!name) return Response.json({ error: 'Not found' }, { status: 404 });
  return toolApi()[name](req);
}
