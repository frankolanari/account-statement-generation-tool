// Pure helpers for the internal tool's screens. No React, no imports: tested in tests/statement-ui.test.ts.

export type DateRange = { from: string; to: string };
export type Preset = { label: string; range: DateRange };
export type ApiProblem = { code: string; message: string; ref?: string };

// Dates travel as YYYY-MM-DD. Local Date parts avoid timezone shifts when formatting.
export const toDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const todayIso = () => toIso(new Date());
export const showDate = (iso: string | null | undefined) =>
  iso ? toDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
export const daysBetween = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / 864e5) + 1;
export const dayAfter = (iso: string) => { const d = toDate(iso); d.setDate(d.getDate() + 1); return toIso(d); };
export const flagEmoji = (country: string) =>
  country?.length === 2 ? String.fromCodePoint(...[...country.toUpperCase()].map(c => 127397 + c.charCodeAt(0))) : '';

// The earliest selectable start is January 1 of the year of the first transaction.
export const earliestStart = (firstTransaction: string) => `${firstTransaction.slice(0, 4)}-01-01`;
// Hand-picked dates start at the earliest start, unless a preset already reaches further back.
export const pickerMin = (firstTransaction: string, rangeFrom: string) => {
  const earliest = earliestStart(firstTransaction);
  return rangeFrom < earliest ? rangeFrom : earliest;
};

// Rolling presets always cover their true window, even if it starts before the account existed.
export function buildPresets(firstTransaction: string, today: string): Preset[] {
  const back = (days: number) => { const d = toDate(today); d.setDate(d.getDate() - days + 1); return toIso(d); };
  return [
    { label: 'Full history', range: { from: firstTransaction.slice(0, 10), to: today } },
    { label: 'This year', range: { from: `${today.slice(0, 4)}-01-01`, to: today } },
    { label: '30 days', range: { from: back(30), to: today } },
    { label: '90 days', range: { from: back(90), to: today } },
    { label: '12 months', range: { from: back(365), to: today } },
  ];
}

// Turns an API error response into one shape the screens can render.
// Business rejections arrive as { code, message }; unexpected failures as { error: "... (ref: <id>)" }.
export function parseApiError(status: number, body: unknown): ApiProblem {
  const b = (body ?? {}) as { code?: string; message?: string; error?: string; issues?: { path: (string | number)[]; message: string }[] };
  if (b.code && b.message) return { code: b.code, message: b.message, ref: undefined };
  if (b.issues?.length) return { code: 'INVALID', message: b.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), ref: undefined };
  const ref = b.error?.match(/ref: ([\w-]+)/)?.[1];
  return { code: 'SERVER', message: b.error ?? `Request failed (${status})`, ref };
}
