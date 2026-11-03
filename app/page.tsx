import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { passcodeGate } from '@/lib/server/statements';
import { SESSION_COOKIE } from '@/src/app-api/passcode';
import { StatementTool } from '@/components/statement-tool';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!passcodeGate().isValidSession(session)) redirect('/login');
  return <StatementTool />;
}
