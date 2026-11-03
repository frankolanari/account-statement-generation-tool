// POST /api/statement with `Authorization: Bearer <STATEMENT_API_TOKEN>` and { userId, from?, to? }.
// Returns the PDF and CSV as base64 JSON. See docs/vercel.md.
import { statementApi } from '@/lib/server/statements';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = (req: Request) => statementApi().generate(req);
