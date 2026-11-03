# Web app on Vercel

The web app uses the same statement core as Slack, but calls it step by step and synchronously, so every click is fast. Trigger.dev is not involved in this path.

```
identifier → POST lookup → confirm account → choose period (pre-filled) → POST preview (HTML) → POST pdf / POST csv
```

## Endpoints

All four are `POST` with a JSON body. Dates are `YYYY-MM-DD`.

| Route | Body | Success |
|---|---|---|
| `/api/statements/lookup` | `{ identifier }` (email or user ID) | `{ status: 'USER_FOUND', account, defaultPeriod }` or `{ status: 'ACCOUNT_SELECTION_REQUIRED', accounts }` |
| `/api/statements/preview` | `{ userId, from?, to? }` | `{ html, meta, period }` |
| `/api/statements/pdf` | same as preview | PDF download |
| `/api/statements/csv` | same as preview | CSV download |

Omit `from` / `to` (do not send `null`) to default to the full history: first transaction date through today. `period.fullHistory`, `period.toCapped` and `meta.is_truncated` tell the UI what to explain to the user. Render the preview `html` in a sandboxed iframe (`<iframe sandbox srcdoc=…>`).

Errors:
- `401` not signed in
- `400` `{ issues: [{ path, message }] }` for an invalid body or date
- `404` `{ code, message }` for an unknown account
- `422` `{ code, message }` for other business reasons, such as no transactions or a reversed range (show `message` as is)
- `500` `{ error: 'Something went wrong (ref: …)' }`, where the ref matches the server log

## Next.js wiring

Install this repo as a workspace package (or copy `src/` and `core-files/` into it), then create one shared instance:

```ts
// lib/statements.ts
import { createAppApi } from 'statement-engine/src/app-api/handlers';
import { createRuntime } from 'statement-engine/src/services/runtime';
import { auth } from '@/auth'; // your app's session check

export const statements = createAppApi({
  // REQUIRED: these routes return customer financial data. Being signed in is not enough:
  // allow only staff who may pull statements, and log who looked up which account.
  authorize: async () => {
    const session = await auth();
    const allowed = session?.user?.role === 'statements';
    if (allowed) console.info('[statements] access', session.user.id);
    return allowed;
  },
  openRuntime: createRuntime,
});
```

`authorize` is the only access control on these routes. Back it with a staff role or allowlist, never just "signed in", and keep an audit log of who requested which account.

```ts
// app/api/statements/lookup/route.ts   (likewise preview, csv)
import { statements } from '@/lib/statements';
export const runtime = 'nodejs';
export const POST = statements.lookup;
```

```ts
// app/api/statements/pdf/route.ts
import { statements } from '@/lib/statements';
export const runtime = 'nodejs';
export const maxDuration = 30; // Browserless rendering can take several seconds
export const POST = statements.pdf;
```

The routes must use the Node.js runtime, not Edge, because the Postgres and Snowflake drivers need Node.

## Environment variables

Connect the project in the Trigger.dev dashboard under **Integrations → Vercel**. That keeps the environment variables in step between the two. This path needs:

- `DATABASE_PROVIDER` plus `DATABASE_URL` (or the `SNOWFLAKE_*` variables)
- `BROWSERLESS_PDF_URL`, `BROWSERLESS_TOKEN`

OpenRouter and Slack variables are not used by the web app.

## One-call statement API (`app/api/statement/route.ts`)

This repo deploys to Vercel as a Next.js app. The route allows 60 s per request.

```bash
curl -s https://<your-project>.vercel.app/api/statement \
  -H "Authorization: Bearer $STATEMENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"<user id or email>","from":"2025-01-01","to":"2025-03-31"}' > statement.json

# Save the files (macOS: base64 -D)
jq -r .contentBase64 statement.json | base64 --decode > statement.pdf
jq -r .csv.contentBase64 statement.json | base64 --decode > statement.csv
```

`from` and `to` are optional and follow the same full-history default. The response is `{ status, fileName, contentType, contentBase64, csv: { fileName, contentType, contentBase64 }, meta, period }`; errors use the codes listed above. A statement too large for Vercel's 4.5 MB response limit returns `422 PDF_TOO_LARGE_FOR_INLINE_OUTPUT`.

Vercel environment variables for this endpoint:

- `STATEMENT_API_TOKEN`: one or more tokens, comma-separated, each at least 32 characters (`npm run token` makes one). Add `:YYYY-MM-DD` to a token to make it stop working after that UTC day, for example `3f9c…e1,7ab2…90:2026-11-30`. Without a valid value every request fails, so the endpoint never runs unprotected.

  To change tokens, edit the variable in Vercel (or `npx vercel env rm STATEMENT_API_TOKEN production` then `npx vercel env add STATEMENT_API_TOKEN --environment production`) and redeploy with `npx vercel deploy --prod`. Expiry dates take effect on their own, with no redeploy.
- `DATABASE_PROVIDER` plus `DATABASE_URL` (or the `SNOWFLAKE_*` variables)
- `BROWSERLESS_PDF_URL`, `BROWSERLESS_TOKEN`
