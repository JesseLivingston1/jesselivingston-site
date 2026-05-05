# Bento pilot application worker

Cloudflare Worker that receives pilot-application form posts from
[`/bento-pilot/`](../bento-pilot/) and writes a row into the
**Pilot Applications** Notion database.

Source: `pilot-application.mjs`.

## Why this exists

The pilot landing page is a static GitHub Pages site. Static pages
can't safely call Notion's API directly — the integration token
would have to be embedded in client JS, where any visitor could
read it and use it to spam the database (or, depending on the
token's scope, do worse). The worker holds the token server-side
and exposes a single, scoped endpoint the form can hit.

## Notion side (one-time)

1. Create an internal integration:
   <https://www.notion.so/profile/integrations> → **+ New integration**
   → name "Bento pilot intake", workspace = Bento Box Research,
   capabilities = "Insert content" only (no read needed).
2. Copy the **Internal Integration Secret** (starts with `secret_`
   or `ntn_`). Treat it like a password.
3. Open the **Pilot Applications** database in Notion → "..." menu
   → **Connections** → **Add connection** → pick the integration.
   Without this connection, every API call will 404.
4. The database ID we'll need for `NOTION_DATABASE_ID`:
   `faf683ad7c8741efb71428a59ba9c6e7` (no dashes). This is the
   **database ID** — the UUID in the database's URL, e.g.
   `notion.so/<database-id>`. **Not** the data source / collection
   ID (those look similar but live under `collection://...`); the
   `/v1/pages` API rejects data-source IDs with a 404.

## Worker side

### Option A — Wrangler CLI

```bash
# from this folder
npm install -g wrangler         # if you don't have it
wrangler login
wrangler deploy pilot-application.mjs --name bento-pilot

# Set the secrets (will prompt for each value)
wrangler secret put NOTION_TOKEN        --name bento-pilot
wrangler secret put NOTION_DATABASE_ID  --name bento-pilot
```

Wrangler will print the deployed URL — something like
`https://bento-pilot.<your-subdomain>.workers.dev/`.

### Option B — Cloudflare dashboard (no CLI)

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create**
   → **Create Worker** → name `bento-pilot`.
2. Click **Edit code** → paste the contents of
   `pilot-application.mjs` → **Save and deploy**.
3. Settings → **Variables and secrets** → add two secrets:
   - `NOTION_TOKEN` = the integration secret
   - `NOTION_DATABASE_ID` = `faf683ad7c8741efb71428a59ba9c6e7`
4. Copy the worker's `*.workers.dev` URL.

## Wire it up to the form

Open `bento-pilot/index.html` and find the line:

```js
var NOTION_WORKER_URL = ''; // e.g. 'https://bento-pilot.jesselivingston.workers.dev/'
```

Paste the worker URL between the quotes. Commit + push. From the
next form submission onward:

- The form posts to **both** Web3Forms (email backup) and the worker
  (Notion). `Promise.allSettled` means a failure in either path
  doesn't kill the merchant's submission — they care that it landed
  somewhere; you'll get the email if Notion is having a bad day.

## Test it

```bash
curl -X POST https://bento-pilot.<your-subdomain>.workers.dev/ \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://jesselivingston.com' \
  -d '{
    "name": "Test merchant",
    "email": "test@example.com",
    "store_url": "https://test-store.myshopify.com",
    "platform": "Shopify",
    "monthly_revenue": "$10K–$50K/mo",
    "biggest_question": "Why are returning customers waiting before they buy again?",
    "current_stack": "Hotjar, Klaviyo",
    "source": "manual test"
  }'
```

Expected: HTTP 200 with `{"ok": true}` and a new row in the
**Pilot Applications** Notion database with `Status = New`.

## Costs

Cloudflare Workers free tier: 100K requests/day. The pilot landing
page won't come close. **$0/mo until traffic gets serious.**

## CORS

The worker only accepts POSTs from `https://jesselivingston.com`,
the GitHub Pages preview origin, and localhost (for testing). Edit
`ALLOWED_ORIGIN` and the allow-list in the source if the page
moves.

## When the form fields change

If you rename a field in the Notion database, update the `PROPS`
map at the top of `pilot-application.mjs` and redeploy. The form
field names in `index.html` and the keys this worker reads from
the JSON body must stay in sync.
