# ComrcexFlow Deployment Guide

## Prerequisites

- A GitHub repository with this codebase pushed
- A Shopify Partner account with the app created
- Your `client_id` from `shopify.app.comrcexflow.toml`

---

## Option A: Deploy to Render (Recommended for Simplicity)

Render provides managed PostgreSQL, Redis, persistent disks, and Docker support out of the box.

### Step 1: Push Code to GitHub

```bash
git add -A
git commit -m "Initial ComrcexFlow app"
git remote add origin https://github.com/YOUR_USERNAME/comrcexflow.git
git push -u origin main
```

### Step 2: Create Render Account & Services

1. Go to [render.com](https://render.com) and sign up
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub repo
4. Render will detect `render.yaml` and create all services automatically:
   - **comrcexflow-web** (Web Service - Docker)
   - **comrcexflow-worker** (Background Worker - Docker)
   - **comrcexflow-db** (PostgreSQL)
   - **comrcexflow-redis** (Redis)

### Step 3: Configure Environment Variables

In the Render dashboard, go to **comrcexflow-web** → **Environment**:

| Variable | Value |
|---|---|
| `SHOPIFY_API_KEY` | Your app's Client ID from Partner Dashboard |
| `SHOPIFY_API_SECRET` | Your app's Client Secret from Partner Dashboard |
| `SHOPIFY_APP_URL` | `https://comrcexflow-web.onrender.com` (your Render URL) |
| `HOST` | Same as `SHOPIFY_APP_URL` |
| `MASTER_BYPASS_KEY` | Your chosen secret bypass key |
| `NODE_ENV` | `production` |

> `DATABASE_URL`, `REDIS_URL`, and `INTERNAL_WORKER_SECRET` are auto-configured by the Blueprint.

For **comrcexflow-worker**, set the same `MASTER_BYPASS_KEY` and ensure `INTERNAL_WORKER_SECRET` matches the web service.

### Step 4: Deploy

1. Click **"Manual Deploy"** → **"Deploy latest commit"** on both services
2. Wait for the build (~5-8 minutes for first build due to Chromium)
3. Check logs to confirm:
   - Web: `"Starting web server on port 3000..."`
   - Worker: `"All workers started, waiting for jobs..."`

### Step 5: Verify

Visit `https://comrcexflow-web.onrender.com` — you should see the Shopify OAuth redirect.

### Render Pricing Estimate

| Service | Plan | Cost |
|---|---|---|
| Web Service | Standard | $7/mo |
| Worker | Standard | $7/mo |
| PostgreSQL | Starter | Free (first 90 days) then $7/mo |
| Redis | Starter | Free (first 90 days) then $10/mo |
| **Total** | | **~$14-31/mo** |

---

## Option B: Deploy to Fly.io (Better for Performance)

Fly.io provides faster cold starts, global edge routing, and persistent volumes.

### Step 1: Install Fly CLI

```bash
# Windows (PowerShell)
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

# macOS/Linux
curl -L https://fly.io/install.sh | sh
```

### Step 2: Login & Create App

```bash
fly auth login
fly launch --no-deploy
```

When prompted:
- App name: `comrcexflow`
- Region: Choose closest to your target audience (e.g., `iad` for US East)
- Don't create a Postgres database yet (we'll do it separately)

### Step 3: Create PostgreSQL Database

```bash
fly postgres create --name comrcexflow-db --region iad --vm-size shared-cpu-1x --initial-cluster-size 1 --volume-size 1
fly postgres attach comrcexflow-db --app comrcexflow
```

This automatically sets the `DATABASE_URL` secret.

### Step 4: Create Redis (via Upstash on Fly)

```bash
fly redis create --name comrcexflow-redis --region iad --plan free
```

Copy the Redis connection URL from the output.

### Step 5: Create Persistent Volume for WhatsApp Sessions

```bash
fly volumes create whatsapp_data --size 1 --region iad --app comrcexflow
```

### Step 6: Set Environment Secrets

```bash
fly secrets set \
  SHOPIFY_API_KEY="your_api_key" \
  SHOPIFY_API_SECRET="your_api_secret" \
  SHOPIFY_APP_URL="https://comrcexflow.fly.dev" \
  HOST="https://comrcexflow.fly.dev" \
  REDIS_URL="redis://your-redis-url" \
  MASTER_BYPASS_KEY="your-bypass-key" \
  INTERNAL_WORKER_SECRET="$(openssl rand -hex 32)" \
  NODE_ENV="production" \
  --app comrcexflow
```

### Step 7: Deploy

```bash
fly deploy --app comrcexflow
```

First deploy takes ~5-8 minutes (building Chromium layer).

### Step 8: Deploy the Worker

Create a separate Fly app for the worker:

```bash
# Create worker app
fly launch --name comrcexflow-worker --no-deploy --dockerfile Dockerfile

# Set worker-specific env
fly secrets set \
  PROCESS_TYPE="worker" \
  DATABASE_URL="your-postgres-url" \
  REDIS_URL="your-redis-url" \
  SHOPIFY_APP_URL="https://comrcexflow.fly.dev" \
  INTERNAL_WORKER_SECRET="same-secret-as-web" \
  MASTER_BYPASS_KEY="your-bypass-key" \
  NODE_ENV="production" \
  --app comrcexflow-worker

fly deploy --app comrcexflow-worker
```

### Step 9: Verify

```bash
fly logs --app comrcexflow
fly status --app comrcexflow
```

Visit `https://comrcexflow.fly.dev` to confirm the app is running.

### Fly.io Pricing Estimate

| Service | Plan | Cost |
|---|---|---|
| Web VM (shared-cpu-2x, 1GB) | Pay-as-you-go | ~$10/mo |
| Worker VM (shared-cpu-1x, 512MB) | Pay-as-you-go | ~$5/mo |
| PostgreSQL (1GB) | Managed | ~$7/mo |
| Redis (Upstash Free) | Free tier | $0/mo |
| Volume (1GB) | Persistent | ~$0.15/mo |
| **Total** | | **~$22/mo** |

---

## Step 6C: Update Shopify Partner Dashboard

This is **critical** — the app won't work without correct URLs.

### 1. Go to Your App in the Partner Dashboard

Navigate to: [partners.shopify.com](https://partners.shopify.com) → Apps → ComrcexFlow

### 2. Update App URLs

In **App setup** → **URLs**:

| Field | Value |
|---|---|
| App URL | `https://YOUR_DEPLOYED_URL/app` |
| Allowed redirection URL(s) | `https://YOUR_DEPLOYED_URL/auth/callback` |
| | `https://YOUR_DEPLOYED_URL/auth/shopify/callback` |
| | `https://YOUR_DEPLOYED_URL/api/auth/callback` |

### 3. Update Privacy Compliance Webhooks

In **App setup** → **Privacy compliance webhooks**:

| Field | Value |
|---|---|
| Customer data request endpoint | `https://YOUR_DEPLOYED_URL/webhooks` |
| Customer data erasure endpoint | `https://YOUR_DEPLOYED_URL/webhooks` |
| Shop data erasure endpoint | `https://YOUR_DEPLOYED_URL/webhooks` |

### 4. Update shopify.app.comrcexflow.toml

Update the local config to match production:

```toml
application_url = "https://YOUR_DEPLOYED_URL"

[auth]
redirect_urls = [
  "https://YOUR_DEPLOYED_URL/auth/callback",
  "https://YOUR_DEPLOYED_URL/auth/shopify/callback",
  "https://YOUR_DEPLOYED_URL/api/auth/callback"
]

[webhooks.privacy_compliance]
customer_deletion_url = "https://YOUR_DEPLOYED_URL/webhooks"
customer_data_request_url = "https://YOUR_DEPLOYED_URL/webhooks"
shop_deletion_url = "https://YOUR_DEPLOYED_URL/webhooks"
```

Then deploy the config:

```bash
shopify app deploy
```

### 5. Get Your API Credentials

In the Partner Dashboard → **App setup** → **Client credentials**:
- **Client ID** = `SHOPIFY_API_KEY`
- **Client secret** = `SHOPIFY_API_SECRET`

These go into your deployment environment variables.

---

## Post-Deployment Checklist

- [ ] Web service is running and accessible
- [ ] Worker service is running (check logs for "All workers started")
- [ ] Database migrations ran successfully (check logs for "Running Prisma migrations")
- [ ] App URL in Partner Dashboard matches deployed URL
- [ ] Redirect URLs are configured correctly
- [ ] Privacy webhook URLs are set
- [ ] `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are set in production env
- [ ] `MASTER_BYPASS_KEY` is set to your chosen secret
- [ ] `INTERNAL_WORKER_SECRET` matches between web and worker services
- [ ] Test installing the app on a development store (Step 7)

---

## Troubleshooting

### Puppeteer/Chromium Issues
```
Error: Failed to launch the browser process
```
- Ensure Docker has `SYS_ADMIN` capability
- Check that Chromium is installed: `which chromium` inside the container
- Verify `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`

### WhatsApp Session Lost on Restart
- Ensure persistent volume is mounted at `/app/.wwebjs_auth`
- On Render: check the disk mount in service settings
- On Fly: verify `fly volumes list`

### Webhooks Not Firing
- Run `shopify app deploy` to register webhook subscriptions
- Check the webhook registration in Shopify admin: Settings → Notifications → Webhooks
- Verify your app URL is correct and publicly accessible

### Worker Not Processing Jobs
- Check `REDIS_URL` is correct and accessible from the worker
- Verify `INTERNAL_WORKER_SECRET` matches between web and worker
- Check worker logs: `fly logs --app comrcexflow-worker` or Render dashboard

### Database Migration Errors
- Check `DATABASE_URL` format: `postgresql://user:pass@host:5432/dbname?schema=public`
- Run manually: `npx prisma migrate deploy` inside the container
