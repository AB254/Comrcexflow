import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { handleOrderCreated } from "../webhooks/order-created.server";
import { handleOrderCancelled } from "../webhooks/order-cancelled.server";
import { handleOrderFulfilled } from "../webhooks/order-fulfilled.server";
import { handleCheckoutUpdated } from "../webhooks/checkout-updated.server";

export const action = async ({ request }) => {
  const { topic, shop, session, admin, payload } =
    await authenticate.webhook(request);

  if (!admin && topic !== "SHOP_REDACT") {
    throw new Response();
  }

  switch (topic) {
    case "APP_UNINSTALLED":
      if (session) {
        await prisma.session.deleteMany({ where: { shop } });
        await prisma.storeSettings.deleteMany({ where: { shop } });
      }
      break;

    case "ORDERS_CREATE":
      await handleOrderCreated(shop, payload);
      break;

    case "ORDERS_CANCELLED":
      await handleOrderCancelled(shop, payload);
      break;

    case "ORDERS_FULFILLED":
      await handleOrderFulfilled(shop, payload);
      break;

    case "CHECKOUTS_UPDATE":
      await handleCheckoutUpdated(shop, payload);
      break;

    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
    case "SHOP_REDACT":
      break;

    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  throw new Response();
};
