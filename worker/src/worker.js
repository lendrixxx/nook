/**
 * Nook Calendar Auth Worker
 * ---------------------------------------------------------------------
 * This is the only place that ever holds your Google client_secret and
 * your Google refresh_token. Nook (the static site) never sees either —
 * it only ever holds an opaque session ID, generated here, that means
 * nothing outside this Worker.
 *
 * Endpoints:
 *   GET  /auth/start     -> redirects the browser to Google's consent screen
 *   GET  /auth/callback  -> Google redirects here after consent; exchanges
 *                           the code for tokens, stores the refresh_token,
 *                           redirects back to Nook with ?nook_session=...
 *   GET  /calendar/events -> given ?session=..., mints a fresh access token
 *                            from the stored refresh_token and proxies a
 *                            read-only call to the Google Calendar API
 *   GET  /auth/logout    -> revokes the refresh_token with Google and
 *                           deletes the session from KV
 * ---------------------------------------------------------------------
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function randomId() {
  return crypto.randomUUID().replace(/-/g, '');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      if (url.pathname === '/auth/start') return handleAuthStart(url, env);
      if (url.pathname === '/auth/callback') return handleAuthCallback(url, env);
      if (url.pathname === '/calendar/events') return handleCalendarEvents(url, env, origin);
      if (url.pathname === '/calendar/list') return handleCalendarList(url, env, origin);
      if (url.pathname === '/auth/logout') return handleLogout(url, env, origin);
      return json({ error: 'not_found' }, 404, origin);
    } catch (err) {
      return json({ error: 'server_error', message: String(err) }, 500, origin);
    }
  },
};

/* ---------------------------------------------------------------------
   /auth/start — kick off Google's consent screen. `return_to` is the
   Nook URL to send the browser back to once we're done. We store a
   short-lived `state` value in KV so /auth/callback can confirm this
   callback really followed a request we issued (basic CSRF guard) and
   know where to send the browser back to.
   --------------------------------------------------------------------- */
async function handleAuthStart(url, env) {
  const returnTo = url.searchParams.get('return_to');
  if (!returnTo) return new Response('Missing return_to', { status: 400 });

  const state = randomId();
  await env.NOOK_KV.put(`state:${state}`, JSON.stringify({ returnTo }), { expirationTtl: 600 });

  const redirectUri = new URL('/auth/callback', url).toString();
  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', CAL_SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  // prompt=consent forces Google to hand back a refresh_token every time,
  // not just the very first time this Google account ever connected.
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

/* ---------------------------------------------------------------------
   /auth/callback — Google lands here with ?code=...&state=...
   Exchanges the code for tokens, stores only the refresh_token (server
   side, in KV, keyed by a new random session id), then redirects the
   browser back to Nook with that session id in the URL.
   --------------------------------------------------------------------- */
async function handleAuthCallback(url, env) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const stateRaw = state && (await env.NOOK_KV.get(`state:${state}`));
  if (!stateRaw) {
    return new Response('This sign-in link expired or was already used. Go back to Nook and tap Connect again.', { status: 400 });
  }
  const { returnTo } = JSON.parse(stateRaw);
  await env.NOOK_KV.delete(`state:${state}`);

  if (errorParam) {
    return Response.redirect(`${returnTo}?gcal_error=${encodeURIComponent(errorParam)}`, 302);
  }

  const redirectUri = new URL('/auth/callback', url).toString();
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = await tokenRes.json();

  if (!tokenRes.ok || !tokenData.refresh_token) {
    return Response.redirect(`${returnTo}?gcal_error=no_refresh_token`, 302);
  }

  const sessionId = randomId();
  await env.NOOK_KV.put(
    `session:${sessionId}`,
    JSON.stringify({ refresh_token: tokenData.refresh_token, created_at: Date.now() })
  );

  return Response.redirect(`${returnTo}?nook_session=${sessionId}`, 302);
}

/* ---------------------------------------------------------------------
   Given a session id, look up its refresh_token and mint a fresh
   short-lived access_token from Google. Always mints a new one rather
   than caching — simpler, and well within free-tier request limits for
   a single-user app.
   --------------------------------------------------------------------- */
async function getFreshAccessToken(sessionId, env) {
  const raw = await env.NOOK_KV.get(`session:${sessionId}`);
  if (!raw) return { error: 'no_session' };
  const { refresh_token } = JSON.parse(raw);

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await tokenRes.json();

  if (!tokenRes.ok) {
    // The refresh_token itself was rejected — usually means the person
    // revoked access from their Google Account settings.
    await env.NOOK_KV.delete(`session:${sessionId}`);
    return { error: 'invalid_grant' };
  }
  return { accessToken: data.access_token };
}

/* ---------------------------------------------------------------------
   /calendar/events — the only "real" API Nook calls day to day.
   Read-only proxy to Google's Calendar API; Nook never sees a Google
   token of any kind, only its own opaque session id. Accepts an
   optional calendarId (defaults to "primary") so Nook can pull from
   any calendar the account has access to, one at a time.
   --------------------------------------------------------------------- */
async function handleCalendarEvents(url, env, origin) {
  const sessionId = url.searchParams.get('session');
  const timeMin = url.searchParams.get('timeMin');
  const timeMax = url.searchParams.get('timeMax');
  const calendarId = url.searchParams.get('calendarId') || 'primary';
  if (!sessionId) return json({ error: 'missing_session' }, 401, origin);

  const { accessToken, error } = await getFreshAccessToken(sessionId, env);
  if (error) return json({ error }, 401, origin);

  const evUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  );
  if (timeMin) evUrl.searchParams.set('timeMin', timeMin);
  if (timeMax) evUrl.searchParams.set('timeMax', timeMax);
  evUrl.searchParams.set('singleEvents', 'true');
  evUrl.searchParams.set('orderBy', 'startTime');

  const evRes = await fetch(evUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!evRes.ok) return json({ error: 'calendar_api_error', status: evRes.status }, 502, origin);

  const data = await evRes.json();
  return json({ items: data.items || [] }, 200, origin);
}

/* ---------------------------------------------------------------------
   /calendar/list — returns the account's calendars (id, name, color) so
   Nook can offer a picker instead of being stuck on just "primary".
   --------------------------------------------------------------------- */
async function handleCalendarList(url, env, origin) {
  const sessionId = url.searchParams.get('session');
  if (!sessionId) return json({ error: 'missing_session' }, 401, origin);

  const { accessToken, error } = await getFreshAccessToken(sessionId, env);
  if (error) return json({ error }, 401, origin);

  const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) return json({ error: 'calendar_api_error', status: listRes.status }, 502, origin);

  const data = await listRes.json();
  const items = (data.items || []).map((c) => ({
    id: c.id,
    summary: c.summaryOverride || c.summary,
    backgroundColor: c.backgroundColor || '#7C9A92',
    primary: !!c.primary,
  }));
  return json({ items }, 200, origin);
}

/* ---------------------------------------------------------------------
   /auth/logout — best-effort revoke with Google, then forget the session.
   --------------------------------------------------------------------- */
async function handleLogout(url, env, origin) {
  const sessionId = url.searchParams.get('session');
  if (sessionId) {
    const raw = await env.NOOK_KV.get(`session:${sessionId}`);
    if (raw) {
      const { refresh_token } = JSON.parse(raw);
      try {
        await fetch(GOOGLE_REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refresh_token }),
        });
      } catch (e) {
        /* best effort — still delete our own record either way */
      }
    }
    await env.NOOK_KV.delete(`session:${sessionId}`);
  }
  return json({ ok: true }, 200, origin);
}
