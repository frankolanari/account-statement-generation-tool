-- :1 = normalized search identifier or exact confirmed ID
-- :2 = 'lookup' or 'confirmed'
-- Edit source tables/columns as needed; preserve the quoted output aliases.
SELECT
  TO_VARCHAR(u.user_id) AS "user_id",
  u.full_name AS "full_name",
  u.email AS "email",
  u.address AS "address",
  u.phone AS "phone",
  u.country AS "country",
  u.base_currency AS "base_currency",
  TO_VARCHAR(COUNT(t.transaction_id)) AS "transaction_count",
  TO_VARCHAR(MIN(CONVERT_TIMEZONE('UTC', t.transaction_date))::DATE, 'YYYY-MM-DD') AS "first_transaction_date",
  TO_VARCHAR(MAX(CONVERT_TIMEZONE('UTC', t.transaction_date))::DATE, 'YYYY-MM-DD') AS "last_transaction_date"
FROM users u
LEFT JOIN transactions t ON t.user_id = u.user_id
WHERE
  (:2 = 'lookup' AND (
    LOWER(TRIM(u.user_id)) = :1
    OR LOWER(TRIM(u.email)) = :1
  ))
  OR (:2 = 'confirmed' AND u.user_id = :1)
GROUP BY
  u.user_id, u.full_name, u.email, u.address, u.phone, u.country, u.base_currency;
