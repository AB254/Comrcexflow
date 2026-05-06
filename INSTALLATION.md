# ComrcexFlow — Installation & Verification Guide

This guide walks you through installing the app on a development store and verifying every feature works end-to-end.

---

## Part 1: Create a Development Store

If you don't already have one:

1. Go to [partners.shopify.com](https://partners.shopify.com)
2. Click **Stores** → **Add store**
3. Select **Development store**
4. Choose **"Create a store to test and build"**
5. Fill in store name (e.g., `comrcexflow-test`)
6. Set password, select region
7. Click **Save**

> Keep this store's `.myshopify.com` URL handy — you'll need it.

---

## Part 2: Local Development Installation

Use this method to test during development before deploying to production.

### Step 1: Start Infrastructure

Open a terminal and start Postgres + Redis:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Verify they're running:

```bash
docker compose -f docker-compose.dev.yml ps
```

You should see both `postgres` and `redis` with status `Up (healthy)`.

### Step 2: Create your .env file

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
SHOPIFY_API_KEY=6c7c620214c5d83ebe07b6eb4376c58b
SHOPIFY_API_SECRET=<your client secret from Partner Dashboard>
DATABASE_URL=postgresql://comrcexflow:comrcexflow_dev@localhost:5432/comrcexflow?schema=public
REDIS_URL=redis://localhost:6379
MASTER_BYPASS_KEY=my-secret-agency-key-2024
INTERNAL_WORKER_SECRET=dev-worker-secret
```

### Step 3: Run Database Migrations

```bash
npx prisma migrate dev --name init
```

This creates all tables. Verify with:

```bash
npx prisma studio
```

This opens a browser UI showing your database tables (Session, StoreSettings, WhatsAppSession, MessageLog, AnalyticsDaily).

### Step 4: Start the App

```bash
npm run dev
```

The Shopify CLI will:
1. Create a Cloudflare tunnel automatically
2. Output a URL like: `https://abc123.trycloudflare.com`
3. Update your app's URLs in the Partner Dashboard automatically
4. Open the app installation page

### Step 5: Install on Your Dev Store

When the CLI outputs `"Press p to open..."`, press **p**. This opens:

```
https://abc123.trycloudflare.com/auth?shop=comrcexflow-test.myshopify.com
```

Or manually visit:

```
https://<your-tunnel-url>/auth?shop=YOUR-DEV-STORE.myshopify.com
```

Click **"Install app"** when Shopify prompts for permissions.

### Step 6: Start the Worker (in a second terminal)

```bash
node app/queues/worker.js
```

You should see:

```
[Worker] Started worker for whatsapp:order-confirmation
[Worker] Started worker for whatsapp:abandoned-checkout
[Worker] Started worker for whatsapp:order-fulfillment
[Worker] Started worker for whatsapp:order-cancellation
[Worker] All workers started, waiting for jobs...
```

---

## Part 3: Production Installation

After deploying to Render or Fly.io (see DEPLOYMENT.md):

### Step 1: Generate Install Link

**Method A — From Partner Dashboard:**

1. Go to [partners.shopify.com](https://partners.shopify.com) → **Apps** → **ComrcexFlow**
2. Click **"Select store"** button at the top
3. Choose your development store
4. Click **"Install"**

**Method B — Direct URL:**

Construct this URL manually:

```
https://{YOUR-DEV-STORE}.myshopify.com/admin/oauth/authorize?client_id=6c7c620214c5d83ebe07b6eb4376c58b&scope=write_products,read_orders,write_orders,read_checkouts,write_checkouts,read_customers&redirect_uri=https://YOUR-DEPLOYED-URL/auth/callback
```

Replace:
- `{YOUR-DEV-STORE}` with your store's subdomain
- `YOUR-DEPLOYED-URL` with your Render/Fly URL

**Method C — From Shopify CLI:**

```bash
shopify app dev --store=YOUR-DEV-STORE.myshopify.com
```

### Step 2: Approve Permissions

Shopify will show a permissions screen listing:
- Read/write orders
- Read/write checkouts
- Read customers
- Read/write products

Click **"Install app"**.

### Step 3: Verify App Loads

After installation, you should see the **ComrcexFlow Dashboard** with:
- Current Plan: Free
- Monthly Usage: 0 / 50
- WhatsApp Status: Disconnected
- Warning banner: "WhatsApp Not Connected"

---

## Part 4: Feature Verification Tests

### Test 1: Developer Bypass Key

1. Navigate to **Settings** (sidebar or `/app/settings`)
2. In the "Agency / Developer Key" section, enter your `MASTER_BYPASS_KEY` value
3. Click **"Validate Key"**
4. **Expected:** Green banner "Developer key validated! Billing has been bypassed."
5. Go to **Dashboard** — should show "Lifetime Free Access Active" banner
6. Go to **Billing** — should show "Developer Bypass Active" banner
7. **Test invalid key:** Enter a wrong key → should show "Invalid developer key"

### Test 2: WhatsApp Connection

1. Navigate to **WhatsApp** (`/app/whatsapp`)
2. Click **"Generate QR Code"**
3. Wait for the QR code to appear (~5-10 seconds)
4. Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
5. Scan the QR code
6. **Expected:** Status changes to "Connected" with your phone number displayed
7. The sidebar should show your phone number and "connected" status

> **Note:** In local dev, Puppeteer must be able to run Chromium on your machine.
> On Windows, whatsapp-web.js will download Chromium automatically on first run.
> If you see errors, install Chromium manually: `npx puppeteer browsers install chrome`

### Test 3: Message Templates

1. Navigate to **Templates** (`/app/templates`)
2. Edit the **Order Confirmation** template:
   ```
   Hi {{customer_name}}! Order #{{order_number}} confirmed! Total: {{currency}} {{total_price}}. Items: {{items_summary}}. Thank you!
   ```
3. Check the **Preview** section — should show sample data filled in
4. Toggle **Abandoned Checkout** to disabled (uncheck)
5. Click **"Save All Templates"**
6. **Expected:** Green "Templates saved!" banner
7. Refresh the page — your changes should persist

### Test 4: Billing Plans

1. Navigate to **Billing** (`/app/billing`)
2. You should see 4 plan cards: Free, Starter, Growth, Professional
3. Click **"Upgrade"** on the **Starter** plan ($4.99)
4. **Expected:** Shopify redirects to a charge approval page
5. Since this is a dev store, accept the **test charge**
6. You'll be redirected back to `/app/billing`
7. **Expected:** Current Plan shows "Starter", usage shows "0 / 1,250 messages"
8. Click **"Cancel Subscription"** to go back to Free

> **Note:** On dev stores, all charges are test charges (no real money).

### Test 5: Webhook Processing (Order Confirmation)

1. Ensure WhatsApp is connected and the worker is running
2. In your dev store admin, create a test order:
   - Go to **Orders** → **Create order**
   - Add any product
   - Add a customer **with a phone number** (must be a real WhatsApp number for the message to deliver)
   - Click **"Collect payment"** → **"Mark as paid"**
3. **Check worker terminal** — should show:
   ```
   [Webhook] ORDERS_CREATE for your-store.myshopify.com, order #1001
   [Queue] Job xxx added to whatsapp:order-confirmation
   [Worker] Processing order_confirmation for your-store...
   [Worker] Message sent to +1234567890
   [Worker] Tagged order 123456 with "WA_Confirmed"
   ```
4. **Check WhatsApp** on the recipient's phone — should receive the confirmation message
5. **Check Shopify** — the order should have the tag `WA_Confirmed`
6. **Check Analytics** (`/app/analytics`) — should show 1 message sent

### Test 6: Webhook Processing (Order Fulfillment)

1. In the dev store, go to the order you just created
2. Click **"Fulfill items"** → Add a tracking number (optional) → **"Fulfill items"**
3. **Check worker terminal** — should show fulfillment processing
4. **Check WhatsApp** — recipient should get the fulfillment notification
5. **Check Shopify order tags** — should now have `WA_Fulfilled`

### Test 7: Webhook Processing (Order Cancellation)

1. In the dev store, create another test order (mark as paid)
2. Click **"More actions"** → **"Cancel order"**
3. **Check worker terminal** — should process the cancellation
4. **Check WhatsApp** — recipient gets cancellation message
5. **Check Shopify order tags** — should have `WA_Cancelled`

### Test 8: Abandoned Checkout Recovery

1. This is harder to test manually. You can trigger it via the Shopify CLI:
   ```bash
   shopify app webhook trigger --topic checkouts/update --address https://YOUR-URL/webhooks
   ```
2. Or create a checkout in the storefront, add items, enter contact info with a phone number, then abandon it
3. The message is **delayed by 15 minutes** (configured in the queue)
4. **Check worker terminal** after 15 minutes — should process the abandoned checkout
5. **Check WhatsApp** — recipient should receive the recovery message with a checkout link

### Test 9: Message Limit Enforcement

1. Remove the bypass key (Settings → "Remove Developer Key")
2. Ensure you're on the **Free** plan (50 messages)
3. In the database, manually set a high message count:
   ```bash
   npx prisma studio
   ```
   Find your `StoreSettings` record, set `monthlyMessageCount` to `50`
4. Create a new order
5. **Check worker terminal** — should show `"Limit reached"`
6. **Check Dashboard** — should show usage at 50/50
7. **Check Analytics** — should show "limit_reached" status in recent messages
8. The message will NOT be sent — banner should prompt upgrade

### Test 10: Analytics Dashboard

1. Navigate to **Analytics** (`/app/analytics`)
2. Verify:
   - Summary cards show correct counts
   - "Messages by Type" shows breakdown
   - "Daily Breakdown" table has entries for today
   - "Recent Messages" tab shows all message logs with statuses
3. Switch between "Daily Overview" and "Recent Messages" views

---

## Part 5: Shopify CLI Webhook Testing Shortcut

You can trigger test webhooks without creating real orders:

```bash
# Order created
shopify app webhook trigger --topic orders/create --address https://YOUR-URL/webhooks

# Order fulfilled
shopify app webhook trigger --topic orders/fulfilled --address https://YOUR-URL/webhooks

# Order cancelled
shopify app webhook trigger --topic orders/cancelled --address https://YOUR-URL/webhooks

# Checkout updated (abandoned)
shopify app webhook trigger --topic checkouts/update --address https://YOUR-URL/webhooks
```

These send sample payloads from Shopify to your webhook endpoint.

---

## Part 6: Production Go-Live Checklist

Before going live with real merchants:

- [ ] All 10 tests above pass
- [ ] `NODE_ENV=production` is set on deployed services
- [ ] `MASTER_BYPASS_KEY` is a strong, unique secret
- [ ] `INTERNAL_WORKER_SECRET` is a random 64-char hex string
- [ ] WhatsApp sessions persist across container restarts (test by restarting the web service)
- [ ] Worker auto-recovers after restart (check BullMQ picks up queued jobs)
- [ ] Billing charges work in production mode (remove `test: true` in billing service)
- [ ] App listing is complete in the Partner Dashboard (app icon, description, screenshots)
- [ ] Privacy policy URL is set
- [ ] Terms of service URL is set
- [ ] GDPR webhooks respond correctly (customer data request, erasure, shop deletion)
- [ ] Rate limiting is appropriate (10 messages/min default — adjust if needed)
- [ ] Error alerting is set up (Render/Fly logs, or add Sentry)

---

## Quick Reference: Key URLs

| Page | Local Dev URL | Production URL |
|---|---|---|
| Dashboard | `/app` | `https://YOUR-URL/app` |
| WhatsApp Setup | `/app/whatsapp` | `https://YOUR-URL/app/whatsapp` |
| Message Templates | `/app/templates` | `https://YOUR-URL/app/templates` |
| Analytics | `/app/analytics` | `https://YOUR-URL/app/analytics` |
| Billing | `/app/billing` | `https://YOUR-URL/app/billing` |
| Settings | `/app/settings` | `https://YOUR-URL/app/settings` |

> The app is embedded — merchants access it through their Shopify admin at:
> `https://THEIR-STORE.myshopify.com/admin/apps/comrcexflow`
