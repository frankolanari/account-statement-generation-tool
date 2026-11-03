# Editable Snowflake SQL

These queries are used only when `DATABASE_PROVIDER=snowflake`. Postgres remains the default and continues to use the parent folder's queries.

Edit the table and source column names for your Snowflake database. The initial templates target the same `users` and `transactions` structure supplied for Postgres. `SNOWFLAKE_DATABASE` and `SNOWFLAKE_SCHEMA` select the default namespace; you can also use fully qualified source table names in these SQL files.

Keep the quoted, lowercase output aliases: they are the shared interface consumed by statement generation. Quoted source identifiers that differ in case from ordinary Snowflake identifiers must be edited to match your actual schema.

`user-query.sql` binds:

- `:1`: normalized identifier for lookup, or the exact confirmed ID.
- `:2`: `lookup` or `confirmed`.

`transaction-query.sql` binds:

- `:1`: confirmed user ID.
- `:2`: inclusive start date, `YYYY-MM-DD` in UTC.
- `:3`: inclusive end date, `YYYY-MM-DD` in UTC.
- `:4`: maximum rows to return, provided by the complete-day coverage policy.

The SDK receives a separate binds array; inputs are never interpolated into the query text. Snowflake supports reusing numbered bindings, so `:1` and `:2` can appear more than once.

The adapter sets the session timezone to UTC before querying. Templates use `CONVERT_TIMEZONE` and `TO_VARCHAR` to return consistent timestamp/date strings; timestamp-without-timezone source values are assumed to store UTC. Monetary values are explicitly returned as strings to preserve precision.

The transaction query counts all matches before applying `QUALIFY ROW_NUMBER() <= :4`. Keep this count and the oldest-first ordering so the existing whole-day coverage policy works. Final PDF output remains newest first.

Changes need to be committed and deployed before an existing worker uses them. The templates have local simulated-service tests; they have not yet been executed against your live Snowflake schema.
