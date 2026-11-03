import type { AccountRepository } from '../domain/ports.js';

// Mondays and Fridays at 06:00 UTC: runs are 3 and 4 days apart, so every 7-day window holds at least two.
// Free Supabase projects pause after a week without activity; this keeps the database in use.
export const KEEP_ALIVE_CRON = '0 6 * * 1,5';

// Runs the app's real user lookup for an identifier no customer can have: it touches the tables, returns nothing,
// and doubles as a health check (a wrong schema or lost connection throws, which marks the scheduled run failed).
export async function pingDatabase(accounts: AccountRepository, now: () => number = Date.now) {
  const started = now();
  await accounts.findUsers('keep-alive@example.invalid');
  return { ok: true as const, durationMs: now() - started };
}
