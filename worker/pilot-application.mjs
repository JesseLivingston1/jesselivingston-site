// Cloudflare Worker — receives Bento pilot-application form posts
// and creates a row in the "Pilot Applications" Notion database.
//
// Deploy:
//   1. Create a Notion integration at https://www.notion.so/profile/integrations
//      Internal integration → name "Bento pilot intake" → copy the
//      "Internal Integration Secret" (starts with "secret_" or "ntn_").
//   2. Open the Pilot Applications database in Notion → "..." menu →
//      "Connections" → add the integration you just created. The
//      worker needs this connection or the API will 404 on writes.
//   3. From this folder, deploy the worker:
//        wrangler deploy pilot-application.mjs --name bento-pilot
//      Or use the Cloudflare dashboard → Workers → Create →
//      paste this file's contents.
//   4. Set the worker's secrets:
//        wrangler secret put NOTION_TOKEN       # paste the integration secret
//        wrangler secret put NOTION_DATABASE_ID # paste e14702cc2f73498f80c334fe1e3f3816
//      (Database ID is the data source ID returned when the database
//      was created. No dashes.)
//   5. Optional: set NOTION_DATABASE_ID directly in wrangler.toml as a
//      vars entry instead of a secret — it's not sensitive on its own.
//   6. Bind the worker to a route or let it run on its
//      *.workers.dev URL. Whichever you pick, paste the URL into
//      `NOTION_WORKER_URL` in `bento-pilot/index.html`.
//
// CORS: this worker accepts requests from jesselivingston.com only.
// Edit ALLOWED_ORIGIN below if the page moves.
//
// What gets logged: the worker logs the email + platform of each
// submission to Cloudflare's tail. Useful for triage; not PII-heavy.

const ALLOWED_ORIGIN = 'https://jesselivingston.com';

// Notion property names — must match the database schema EXACTLY.
// If you rename a property in Notion, update this map (and only here).
const PROPS = {
  name: 'Name',
  email: 'Email',
  storeUrl: 'Store URL',
  platform: 'Platform',
  monthlyRevenue: 'Monthly revenue',
  biggestQuestion: 'Biggest question',
  currentStack: 'Current stack',
  status: 'Status',
  source: 'Source',
};

export default {
  /** @param {Request} request @param {{NOTION_TOKEN: string, NOTION_DATABASE_ID: string}} env */
  async fetch(request, env) {
    // CORS preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, request);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: 'invalid_json' }, 400, request);
    }

    // Minimal field validation — anything strange and we 400 fast.
    const required = ['name', 'email', 'store_url', 'platform', 'monthly_revenue', 'biggest_question'];
    for (const field of required) {
      if (typeof body[field] !== 'string' || body[field].trim().length === 0) {
        return jsonResponse({ ok: false, error: `missing_${field}` }, 400, request);
      }
      if (body[field].length > 4000) {
        return jsonResponse({ ok: false, error: `too_long_${field}` }, 400, request);
      }
    }

    // Notion API call. Database ID must be the *data source* ID.
    const notionPayload = {
      parent: { database_id: env.NOTION_DATABASE_ID },
      properties: {
        [PROPS.name]: { title: [{ text: { content: body.name.trim() } }] },
        [PROPS.email]: { email: body.email.trim() },
        [PROPS.storeUrl]: { url: body.store_url.trim() },
        [PROPS.platform]: { select: { name: body.platform.trim() } },
        [PROPS.monthlyRevenue]: { select: { name: body.monthly_revenue.trim() } },
        [PROPS.biggestQuestion]: {
          rich_text: [{ text: { content: body.biggest_question.trim().slice(0, 2000) } }],
        },
        [PROPS.currentStack]: {
          rich_text: [
            { text: { content: (body.current_stack || '').trim().slice(0, 2000) } },
          ],
        },
        [PROPS.status]: { select: { name: 'New' } },
        [PROPS.source]: {
          rich_text: [{ text: { content: body.source || 'bento-pilot landing page' } }],
        },
      },
    };

    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify(notionPayload),
    });

    if (!notionRes.ok) {
      const errBody = await notionRes.text();
      console.error('notion api error', notionRes.status, errBody);
      return jsonResponse(
        { ok: false, error: 'notion_api_error', status: notionRes.status },
        502,
        request
      );
    }

    console.log('pilot application received', {
      email: body.email,
      platform: body.platform,
      revenue: body.monthly_revenue,
    });

    return jsonResponse({ ok: true }, 200, request);
  },
};

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  // Allow the production site + GitHub Pages preview origin. Locked
  // down enough to keep random domains from spamming the worker.
  const isAllowed =
    origin === ALLOWED_ORIGIN ||
    origin === 'https://jesselivingston1.github.io' ||
    origin === 'http://localhost:8080' ||
    origin === 'http://127.0.0.1:8080';
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(payload, status, request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request),
    },
  });
}
