import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, 'Use a real calendar date in YYYY-MM-DD format');
const context = {
  requestId: z.string().uuid(),
  source: z.enum(['webhook', 'website', 'slack']),
};
export const lookupRequestSchema = z.object({
  ...context,
  identifier: z.string().trim().min(1).max(254).transform(s => s.toLowerCase()),
}).strict();
export const generationRequestSchema = z.object({
  ...context,
  userId: z.string().trim().min(1).max(100),
  from: isoDate,
  to: isoDate,
}).strict().refine(r => r.from <= r.to, { message: 'Start date must be on or before end date', path: ['from'] });
export const naturalLanguageRequestSchema = z.object({
  ...context,
  text: z.string().trim().min(1).max(4000),
}).strict();
export type LookupRequest = z.infer<typeof lookupRequestSchema>;
export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type User = {
  user_id: string; full_name: string; email: string; address: string | null;
  phone: string | null; country: string; base_currency: string;
  transaction_count: number; first_transaction_date: string | null; last_transaction_date: string | null;
};
export type Transaction = {
  transaction_id: string; transaction_date: string; transaction_type: string; status: string;
  channel: string | null; sent_currency: string; amount_sent: string; fx_rate: string | null;
  received_currency: string; amount_received: string; fee: string | null;
  beneficiary_name: string | null; beneficiary_account: string | null; beneficiary_bank: string | null;
};
export type Statement = {
  user_details: Omit<User, 'transaction_count' | 'first_transaction_date' | 'last_transaction_date'> & {
    period_start: string; period_end: string; generated_on: string;
  };
  transaction_records: Transaction[];
  meta: {
    input_txn_count: number; output_txn_count: number; is_truncated: boolean;
    requested_period: { from: string; to: string };
    effective_period: { from: string; to: string };
    first_included_transaction: string; last_included_transaction: string;
  };
};
export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'DomainError'; }
}
