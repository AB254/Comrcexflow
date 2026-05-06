import prisma from "../db.server.js";
import { addToQueue, QUEUE_NAMES } from "../queues/queues.server.js";
import { extractOrderVariables } from "../services/templates.server.js";

export async function handleOrderCancelled(shop, payload) {
  console.log(`[Webhook] ORDERS_CANCELLED for ${shop}, order #${payload.order_number}`);

  const storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!storeSettings?.orderCancellationEnabled) {
    console.log(`[Webhook] Order cancellation notifications disabled for ${shop}`);
    return;
  }

  const customer = payload.customer || {};
  const phone =
    customer.phone ||
    payload.shipping_address?.phone ||
    payload.billing_address?.phone ||
    payload.phone;

  if (!phone) {
    console.log(`[Webhook] No phone number for cancelled order #${payload.order_number}`);
    return;
  }

  const variables = extractOrderVariables(payload);

  await addToQueue(QUEUE_NAMES.ORDER_CANCELLATION, {
    shop,
    phone,
    orderId: String(payload.id),
    orderNumber: payload.order_number,
    variables,
    messageType: "order_cancellation",
  });
}
