# Nook Calendar Auth Worker — setup

One-time setup, entirely from a browser (Cloudflare dashboard + GitHub), no CLI needed on your phone.

## 1. Create a Cloudflare account (if you don't have one)
Free tier is plenty for this. cloudflare.com → sign up.

## 2. Create the KV namespace (stores sessions + refresh tokens)
Cloudflare dashboard → **Workers & Pages → KV** → **Create a namespace** → name it e.g. `nook-kv` → Create.
Copy the **Namespace ID** it shows you, and paste it into `worker/wrangler.toml` here:
```toml
kv_namespaces = [
  { binding = "NOOK_KV", id = "PASTE_IT_HERE" }
]
```

## 3. Create a Cloudflare API token (so GitHub Actions can deploy on your behalf)
Dashboard → profile icon → **My Profile → API Tokens → Create Token** → use the **Edit Cloudflare Workers** template → scope it to your account → Create → copy the token (shown once).

Also grab your **Account ID** — it's on the right sidebar of the Workers & Pages overview page.

## 4. Create the Google OAuth Client (different from before — this one holds a secret)
Same Google Cloud project as last time is fine.
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. **Authorized redirect URIs** — add:
   `https://nook-calendar-auth.<your-subdomain>.workers.dev/auth/callback`
   (You'll get the exact `<your-subdomain>.workers.dev` part after the first deploy — come back and add this once you know it, or deploy once first, check the Worker's URL in the Cloudflare dashboard, then add this redirect URI.)
4. Copy the **Client ID** and **Client secret** — you'll need both in the next step.

## 5. Add GitHub repo secrets
On your `nook` repo → **Settings → Secrets and variables → Actions → New repository secret**, add all four:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## 6. Deploy
Push this `worker/` folder to `main` (or run the workflow manually from the **Actions** tab → "Deploy Calendar Worker" → **Run workflow**). The Action installs Wrangler, pushes your two Google secrets into the Worker's own environment (they never touch the repo or the static site), and deploys.

Once deployed, find your Worker's URL in the Cloudflare dashboard (**Workers & Pages** → `nook-calendar-auth`) — it'll look like:
```
https://nook-calendar-auth.YOUR-SUBDOMAIN.workers.dev
```
Go back to step 4 and make sure that exact URL + `/auth/callback` is saved as an authorized redirect URI.

## 7. Point Nook at it
In Nook → Settings → Google Calendar, paste that Worker URL into the "Worker URL" field and tap Connect. Nook itself never needs the Client ID or secret anymore — those live only in the Worker's environment.

## Updating later
Any push to `worker/**` redeploys automatically. To rotate the Google client secret, just update the `GOOGLE_CLIENT_SECRET` GitHub secret and re-run the workflow.
