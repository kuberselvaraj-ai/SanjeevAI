# Deploying Sanjeev AI to sanjeevai.com (Railway)

> Using Google Cloud instead? See **DEPLOY-GCP.md** (Cloud Run + Cloud SQL —
> recommended if you already run XYeed on GCP).

Stack: Node 20 + Hono API + React SPA, MySQL-compatible database, Dockerfile included.
Time: ~30 minutes. Cost: Railway ~$5–20/mo + TiDB Cloud Serverless free tier.

---

## Step 1 — Database (TiDB Cloud Serverless, free)

1. Sign up at https://tidbcloud.com → **Create cluster** → Serverless → pick a US region.
2. Create a database named `sanjeevai` and a user with a password.
3. Build the connection string **with TLS** (Serverless requires it):

```
mysql://USER:PASSWORD@HOST:4000/sanjeevai?ssl=%7B%22minVersion%22%3A%22TLSv1.2%22%2C%22rejectUnauthorized%22%3Atrue%7D
```

(the query part is just `ssl={"minVersion":"TLSv1.2","rejectUnauthorized":true}`, URL-encoded)

4. Create the schema — from your laptop, in this repo:

```bash
npm install
DATABASE_URL="<the string above>" npx drizzle-kit push
```

That creates every table (users, conversations, usage, schedules, invite codes…).

## Step 2 — Railway

1. https://railway.app → **New Project** → **Deploy from GitHub repo** → pick `kuberselvaraj-ai/SanjeevAI`.
   Railway auto-detects the Dockerfile (see `railway.toml`).
2. **Variables** tab — add:

| Variable | Value | Required |
|---|---|---|
| `DATABASE_URL` | the TiDB string from Step 1 | ✅ |
| `APP_ID` / `APP_SECRET` | copy from your existing local `.env` (Kimi auth app) | ✅ |
| `VITE_APP_ID` / `VITE_KIMI_AUTH_URL` / `KIMI_AUTH_URL` / `KIMI_OPEN_URL` | copy from local `.env` | ✅ |
| `OWNER_UNION_ID` | copy from local `.env` | ✅ |
| `MOONSHOT_API_KEY` | your Kimi key — powers all chat, agents, briefs | ✅ |
| `OPENROUTER_API_KEY` | one key → Claude Fable 5.1 + GPT-6 Astra + all customs | recommended |
| `E2B_API_KEY` | Python execution in agent runs | optional |
| `FAL_KEY` / `GEMINI_API_KEY` | Image Studio | optional |
| `ELEVENLABS_API_KEY` / `DASHSCOPE_API_KEY` | voice | optional |
| `MINIMAX_API_KEY` | video | optional |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | first-party premium (instead of OpenRouter) | optional |
| `EXTRA_MODELS` | e.g. `[{"id":"google/gemini-4-pro","label":"Gemini 4 Pro"}]` | optional |
| `PORT` | leave unset — Railway injects it | — |

3. Deploy. Railway gives you a `*.up.railway.app` URL — open it to verify.

## Step 3 — Your account + invite codes

Signup is invite-only. In the TiDB console SQL editor:

```sql
-- create invite codes (plan decides what the new user gets)
INSERT INTO invite_codes (code, plan, maxUses) VALUES
  ('SANJ-LAUNCH-001', 'pro', 1),
  ('SANJ-FRIENDS', 'free', 20);

-- after you register yourself, make yourself admin (unlimited usage + admin panel)
UPDATE users SET role = 'admin', plan = 'pro' WHERE email = 'you@example.com';
```

## Step 4 — DNS for sanjeevai.com

1. Railway → your service → **Settings → Networking → Custom Domain** → enter `sanjeevai.com` and `www.sanjeevai.com`. Railway shows the target values.
2. At your registrar (where you bought the domain):
   - `www` → **CNAME** → the Railway target
   - apex `sanjeevai.com` → **ALIAS/ANAME** (if the registrar supports it) or **A record** to the IP Railway shows
3. TLS is automatic once DNS resolves (can take 5–60 min).

## Notes

- **Never commit `.env`** — the repo is public; all values above go into Railway's variable panel only.
- New models: add them via `EXTRA_MODELS` and restart — no code change needed.
- Scheduled briefs (Level 4) run inside the server process — keep the Railway service always-on.
- Updating: push to `main`, Railway redeploys automatically.
