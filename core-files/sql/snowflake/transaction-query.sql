-- :1 = confirmed user ID; :2/:3 = inclusive UTC dates; :4 = engine fetch limit
-- Numbers are returned as strings to preserve monetary precision.
-- Keep total_count and oldest-first ordering for the complete-day coverage policy.
SELECT
  TO_VARCHAR(t.transaction_id) AS "transaction_id",
  TO_VARCHAR(CONVERT_TIMEZONE('UTC', t.transaction_date), 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') AS "transaction_date",
  t.transaction_type AS "transaction_type",
  CASE WHEN t.status = 'COMPLETED' THEN 'SUCCESS' ELSE t.status END AS "status",
  t.channel AS "channel",
  t.sent_currency AS "sent_currency",
  TO_VARCHAR(t.amount_sent) AS "amount_sent",
  TO_VARCHAR(t.fx_rate) AS "fx_rate",
  t.received_currency AS "received_currency",
  TO_VARCHAR(t.amount_received) AS "amount_received",
  TO_VARCHAR(t.fee) AS "fee",
  t.beneficiary_name AS "beneficiary_name",
  t.beneficiary_account AS "beneficiary_account",
  t.beneficiary_bank AS "beneficiary_bank",
  TO_VARCHAR(COUNT(*) OVER()) AS "total_count"
FROM transactions t
WHERE t.user_id = :1
  AND t.transaction_date >= TO_TIMESTAMP_TZ(:2 || ' 00:00:00 +00:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM')
  AND t.transaction_date < DATEADD(day, 1, TO_TIMESTAMP_TZ(:3 || ' 00:00:00 +00:00', 'YYYY-MM-DD HH24:MI:SS TZH:TZM'))
QUALIFY ROW_NUMBER() OVER (ORDER BY t.transaction_date ASC, t.transaction_id ASC) <= :4
ORDER BY t.transaction_date ASC, t.transaction_id ASC;
