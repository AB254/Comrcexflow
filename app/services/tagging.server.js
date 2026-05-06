import prisma from "../db.server.js";
import { ORDER_TAGS } from "../utils/plans.js";

export async function tagOrder(shop, orderId, messageType, accessToken) {
  const tag = ORDER_TAGS[messageType];
  if (!tag || !orderId) return false;

  try {
    const shopDomain = shop.replace(".myshopify.com", "").replace(/^https?:\/\//, "");
    const gqlOrderId = orderId.toString().startsWith("gid://")
      ? orderId
      : `gid://shopify/Order/${orderId}`;

    const response = await fetch(
      `https://${shop}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: `
            mutation orderUpdate($input: OrderInput!) {
              orderUpdate(input: $input) {
                order { id tags }
                userErrors { field message }
              }
            }
          `,
          variables: {
            input: {
              id: gqlOrderId,
              tags: [tag],
            },
          },
        }),
      }
    );

    const result = await response.json();
    const errors = result.data?.orderUpdate?.userErrors;

    if (errors?.length) {
      console.error(`[Tagging] Failed for order ${orderId}:`, errors);
      return false;
    }

    console.log(`[Tagging] Tagged order ${orderId} with "${tag}"`);
    return true;
  } catch (err) {
    console.error(`[Tagging] Error tagging order ${orderId}:`, err);
    return false;
  }
}

export async function getAccessTokenForShop(shop) {
  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { id: "desc" },
  });
  return session?.accessToken || null;
}
