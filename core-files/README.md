# Editable core files

Edit the statement's queries, document, and payloads here. These are the files the application actually uses, not backup copies. The existing adapters and task structure remain in place and reference them.

| File | What to edit | Used by |
|---|---|---|
| `sql/user-query.sql` | User details, transaction count, first/last transaction dates | Postgres account lookup and confirmed-account fetch |
| `sql/transaction-query.sql` | Transaction fields, status mapping, period filtering | Postgres transaction retrieval |
| `sql/snowflake/user-query.sql` | Snowflake user details and transaction dates | Snowflake account lookup |
| `sql/snowflake/transaction-query.sql` | Snowflake transaction retrieval | Snowflake transaction adapter |
| `statement-payload.ts` | Mapping of user/transaction data into the statement payload and metadata | Shared statement engine |
| `statement-html.ts` | PDF HTML, CSS, logo, labels, formatting, and pagination | Existing HTML renderer adapter |
| `html-payload.ts` | Request body sent to the PDF service (`html` and `options`) | Existing Browserless adapter |
| `pdf-options.json` | Page size, orientation, background printing, and margins | HTML payload builder |
| `date-extraction-prompt.ts` | Natural-language date extraction instructions sent with redacted request text | OpenRouter adapter |
| `read-core-file.ts` | Internal file loader; normally leave this alone | SQL and PDF settings loaders |

## Editing on GitHub

1. Open the file you want to change and use GitHub's edit button.
2. Make and commit your changes (or open a pull request).
3. Run TypeScript checks and the tests; deploy the updated commit to Trigger.dev. If automatic GitHub deployment is connected, follow that configured branch workflow.

Editing GitHub does not update an already deployed Trigger.dev task until a new deployment runs. Local development also needs the edited commit checked out. Run the local webhook server from the repository root.

## SQL parameters

Use bound parameters; do not replace them with string interpolation. The files below are for Postgres (the default). Selecting `DATABASE_PROVIDER=snowflake` uses the files in `sql/snowflake/` instead; those use numbered `:1` bindings. See that folder's README.

`user-query.sql`:

- `$1`: normalized ID/email for a lookup, or the exact confirmed user ID.
- `$2`: `lookup` to search ID/email; `confirmed` to retrieve only the selected ID.

`transaction-query.sql`:

- `$1`: confirmed user ID.
- `$2`: inclusive start date, in UTC.
- `$3`: inclusive end date, in UTC.
- `$4`: maximum rows to fetch, provided by the existing complete-day coverage policy.

Keep the returned column aliases and `total_count`; the engine reads those names. Keep transaction ordering oldest first in SQL so the coverage policy can choose complete days; the document still displays retained transactions newest first. Table and source column names can be edited while preserving those aliases.

## HTML and payloads

The original n8n statement node builds HTML with JavaScript to support multiple pages, transaction rows, and conditional labels. That builder is preserved in `statement-html.ts`; it has not been replaced with a new template language. HTML/CSS, page row counts, status labels, and the embedded logo are all in that file. Keep its `renderStatementHtml` export and customer-data escaping intact.

`statement-payload.ts` returns the document's user details, transaction records, and coverage metadata. `html-payload.ts` prepares the PDF service request. Edit ordinary PDF settings in `pdf-options.json`; there is no second embedded copy of these settings in the service adapter.

The `.sql` and `.json` assets are explicitly included by `additionalFiles` in `trigger.config.ts`. TypeScript core modules are imported into the worker bundle. Deployment packaging has been configured, but it still needs verification in a real Trigger.dev deployment.

Do not add passwords, API tokens, database connection strings, or customer records to this folder. Those belong in the service environment, not the repository.
