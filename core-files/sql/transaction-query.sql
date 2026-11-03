-- $1: confirmed user ID
-- $2: inclusive start date (YYYY-MM-DD, UTC)
-- $3: inclusive end date (YYYY-MM-DD, UTC)
-- $4: fetch limit, supplied by the engine's complete-day coverage policy
-- Keep total_count and oldest-first ordering: both are required for correct truncation.
SELECT
  transaction_id,
  to_char(transaction_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS transaction_date,
  transaction_type,
  CASE WHEN status = 'COMPLETED' THEN 'SUCCESS' ELSE status END AS status,
  channel,
  sent_currency,
  amount_sent::text,
  fx_rate::text,
  received_currency,
  amount_received::text,
  fee::text,
  beneficiary_name,
  beneficiary_account,
  beneficiary_bank,
  count(*) OVER()::text AS total_count
FROM transactions
WHERE user_id = $1
  AND transaction_date >= ($2::date::timestamp AT TIME ZONE 'UTC')
  AND transaction_date < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
ORDER BY transactions.transaction_date ASC, transaction_id ASC
LIMIT $4;
