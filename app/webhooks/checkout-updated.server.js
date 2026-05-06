import prisma from "../db.server.js";
import { addToQueue, QUEUE_NAMES } from "../queues/queues.server.js";
import { extractCheckoutVariables } from "../services/templates.server.js";

export async function handleCheckoutUpdated(shop, payload) {
  console.log(`[Webhook] CHECKOUTS_UPDATE for ${shop}, checkout ${payload.id}`);

  if (payload.completed_at) {
    console.log(`[Webhook] Checkout already completed, skipping`);
    return;
  }

  const storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!storeSettings?.abandonedCheckoutEnabled) {
    console.log(`[Webhook] Abandoned checkout notifications disabled for ${shop}`);
    return;
  }

  const customer = payload.customer || {};
  const phone = customer.phone || payload.phone || payload.shipping_address?.phone;

  if (!phone) {
    console.log(`[Webhook] No phone number for checkout ${payload.id}`);
    return;
  }

  if (!payload.abandoned_checkout_url && !payload.recovery_url) {
    console.log(`[Webhook] No recovery URL for checkout ${payload.id}`);
    return;
  }

  const existing = await prisma.messageLog.findFirst({
    where: {
      shop,
      checkoutId: String(payload.id),
      messageType: "abandoned_checkout",
      status: { in: ["queued", "sent"] },
    },
  });

  if (existing) {
    console.log(`[Webhook] Already queued/sent for checkout ${payload.id}`);
    return;
  }

  const variables = extractCheckoutVariables(payload);

  await addToQueue(QUEUE_NAMES.ABANDONED_CHECKOUT, {
    shop,
    phone,
    checkoutId: String(payload.id),
    variables,
    messageType: "abandoned_checkout",
  });
}
