-- $1: search identifier (normalized for lookup; exact user ID for confirmed account)
-- $2: 'lookup' searches ID/email; 'confirmed' fetches only the selected user ID
-- Keep the returned aliases: the statement engine depends on them.
SELECT
  u.user_id,
  u.full_name,
  u.email,
  u.address,
  u.phone,
  u.country,
  u.base_currency,
  COUNT(t.transaction_id)::int AS transaction_count,
  to_char(MIN(t.transaction_date AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS first_transaction_date,
  to_char(MAX(t.transaction_date AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS last_transaction_date
FROM users u
LEFT JOIN transactions t ON t.user_id = u.user_id
WHERE
  ($2::text = 'lookup' AND (
    LOWER(TRIM(u.user_id)) = $1
    OR LOWER(TRIM(u.email)) = $1
  ))
  OR ($2::text = 'confirmed' AND u.user_id = $1)
GROUP BY
  u.user_id, u.full_name, u.email, u.address, u.phone, u.country, u.base_currency;
