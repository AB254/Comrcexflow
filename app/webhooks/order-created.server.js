import prisma from "../db.server.js";
import { addToQueue, QUEUE_NAMES } from "../queues/queues.server.js";
import { extractOrderVariables } from "../services/templates.server.js";

export async function handleOrderCreated(shop, payload) {
  console.log(`[Webhook] ORDERS_CREATE for ${shop}, order #${payload.order_number}`);

  const storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!storeSettings?.orderConfirmationEnabled) {
    console.log(`[Webhook] Order confirmation disabled for ${shop}`);
    return;
  }

  const customer = payload.customer || {};
  const phone =
    customer.phone ||
    payload.shipping_address?.phone ||
    payload.billing_address?.phone ||
    payload.phone;

  if (!phone) {
    console.log(`[Webhook] No phone number for order #${payload.order_number}`);
    return;
  }

  const variables = extractOrderVariables(payload);

  await addToQueue(QUEUE_NAMES.ORDER_CONFIRMATION, {
    shop,
    phone,
    orderId: String(payload.id),
    orderNumber: payload.order_number,
    variables,
    messageType: "order_confirmation",
  });
}
