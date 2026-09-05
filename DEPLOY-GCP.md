# Deploying Sanjeev AI to sanjeevai.com (Google Cloud Run)

Stack: Node 20 + Hono API + React SPA, MySQL-compatible database, Dockerfile included.
Same shape as XYeed: Cloud Run (container) + Cloud SQL (MySQL). ~45 minutes.

Cost estimate: Cloud Run with min-instances 1 (~$13–25/mo) + $0 if you reuse the
existing XYeed Cloud SQL instance (new database, same server).

---

## Step 1 — Database (reuse your Cloud SQL instance)

In the GCP console (or gcloud) on your existing Cloud SQL MySQL instance:

```sql
CREATE DATABASE sanjeevai CHARACTER SET utf8mb4;
CREATE USER 'sanjeevai'@'%' IDENTIFIED BY '<strong-password>';
GRANT ALL PRIVILEGES ON sanjeevai.* TO 'sanjeevai'@'%';
```

Connection string — Cloud Run reaches Cloud SQL through the built-in Cloud SQL
connector (unix socket, no public IP or authorized-network changes needed):

```
DATABASE_URL=mysql://sanjeevai:<password>@localhost/sanjeevai?socketPath=/cloudsql/<PROJECT>:<REGION>:<INSTANCE>
```

(Remember to URL-encode the password: `@` → `%40`.)

Create the schema — from your laptop, in this repo:

```bash
npm install
DATABASE_URL="<the string above>" npx drizzle-kit push
```

(Prefer TiDB Cloud Serverless instead? See DEPLOY.md Step 1 — the TLS connection
string there works unchanged.)

## Step 2 — Build & deploy the container

```bash
gcloud auth login
gcloud config set project <YOUR_PROJECT>

# build straight from source with Cloud Build (no local docker needed)
gcloud builds submit --tag gcr.io/<YOUR_PROJECT>/sanjeevai

gcloud run deploy sanjeevai \
  --image gcr.io/<YOUR_PROJECT>/sanjeevai \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 1 \
  --memory 1Gi --cpu 1 \
  --add-cloudsql-instances <PROJECT>:<REGION>:<INSTANCE> \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "DATABASE_URL=<from step 1>" \
  --set-env-vars "APP_ID=<from local .env>" \
  --set-env-vars "APP_SECRET=<from local .env>" \
  --set-env-vars "VITE_APP_ID=<from local .env>" \
  --set-env-vars "VITE_KIMI_AUTH_URL=<from local .env>" \
  --set-env-vars "KIMI_AUTH_URL=<from local .env>" \
  --set-env-vars "KIMI_OPEN_URL=<from local .env>" \
  --set-env-vars "OWNER_UNION_ID=<from local .env>" \
  --set-env-vars "MOONSHOT_API_KEY=<your Kimi key>"
```

Notes:
- **`--min-instances 1` is required** — scheduled briefs (Level 4) run on a 60s
  in-process timer; scale-to-zero would pause them while idle.
- Cloud Run injects `PORT` automatically; the server already honors it.
- For production, move the keys into Secret Manager and use
  `--set-secrets "MOONSHOT_API_KEY=sanjeevai-moonshot:latest"` etc.

Optional env vars (same meanings as in `.env`):

```
OPENROUTER_API_KEY   # one key → Claude Fable 5.1 + GPT-6 Astra + customs (recommended)
E2B_API_KEY          # Python execution in agent runs
FAL_KEY GEMINI_API_KEY        # Image Studio
ELEVENLABS_API_KEY DASHSCOPE_API_KEY  # voice
MINIMAX_API_KEY      # video
EXTRA_MODELS         # e.g. [{"id":"google/gemini-4-pro","label":"Gemini 4 Pro"}]
```

Verify: open the `https://sanjeevai-….run.app` URL — signup screen should load.

## Step 3 — Your account + invite codes

Signup is invite-only. In Cloud SQL Studio:

```sql
INSERT INTO sanjeevai.invite_codes (code, plan, maxUses) VALUES
  ('SANJ-LAUNCH-001', 'pro', 1),
  ('SANJ-FRIENDS', 'free', 20);

-- after you register yourself:
UPDATE sanjeevai.users SET role = 'admin', plan = 'pro' WHERE email = 'you@example.com';
```

## Step 4 — Map sanjeevai.com

```bash
gcloud run domain-mappings create \
  --service sanjeevai --domain sanjeevai.com --region us-central1
gcloud run domain-mappings create \
  --service sanjeevai --domain www.sanjeevai.com --region us-central1
```

Each command prints the DNS records to create at your registrar
(typically an A + AAAA for the apex, a CNAME for `www`). Managed TLS
provisions automatically once DNS resolves (5–60 min).

## Updating

```bash
git push        # then:
gcloud builds submit --tag gcr.io/<YOUR_PROJECT>/sanjeevai
gcloud run deploy sanjeevai --image gcr.io/<YOUR_PROJECT>/sanjeevai --region us-central1
```

(Or wire a Cloud Build trigger on `main` for push-to-deploy.)

## Notes

- **Never commit `.env`** — the repo is public; secrets live in GCP only.
- New models: update `EXTRA_MODELS` on the service and redeploy — no code change.
- Cloud SQL free advice: if XYeed's instance is production, a separate small
  instance (~$7–10/mo) keeps the two apps isolated.

## Google connector (Gmail + Calendar voice/chat commands)

One-time setup so users can say "check my email / what's on my calendar":

1. Google Cloud Console → APIs & Services → enable **Gmail API** and
   **Google Calendar API** (project xyeed-503223).
2. APIs & Services → OAuth consent screen → External → fill app name
   "Sanjeev AI", your email. Add scopes: gmail.readonly, gmail.compose,
   gmail.send, calendar.readonly. (Unverified apps work with a warning
   screen while in testing; publish/verify later for the public.)
3. APIs & Services → Credentials → Create Credentials → **OAuth client ID**
   → Web application. Authorized redirect URI:
   `https://sanjeevai-796272357891.us-central1.run.app/api/connect/google/callback`
   (add `https://sanjeevai.com/api/connect/google/callback` once the domain
   is mapped).
4. Set the credentials on the service:

```bash
gcloud run services update sanjeevai --region us-central1 \
  --update-env-vars "GOOGLE_CLIENT_ID=<client-id>,GOOGLE_CLIENT_SECRET=<client-secret>"
```

5. Create the connections table (once per database):

```bash
cloud-sql-proxy xyeed-503223:us-central1:xyeed-db --port 3307 &
mysql -h 127.0.0.1 -P 3307 -u sanjeevai -p sanjeevai -e "
CREATE TABLE IF NOT EXISTS connections (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  userId bigint unsigned NOT NULL,
  provider varchar(32) NOT NULL,
  label varchar(320),
  scopes text,
  accessTokenEnc text NOT NULL,
  refreshTokenEnc text,
  expiresAt timestamp NULL,
  createdAt timestamp NOT NULL DEFAULT now(),
  updatedAt timestamp NOT NULL DEFAULT now(),
  CONSTRAINT connections_user FOREIGN KEY (userId) REFERENCES users(id)
);"
```

Users then connect via Settings → Connections → Google. Tokens are
AES-256-GCM encrypted at rest; sends always require explicit user approval.
