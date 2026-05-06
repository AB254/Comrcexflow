import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { disconnectClient } from "../services/whatsapp.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const result = await disconnectClient(shop);
    return json({ success: true, ...result });
  } catch (err) {
    console.error(`[API] WhatsApp disconnect error for ${shop}:`, err);
    return json(
      { success: false, error: "Failed to disconnect WhatsApp" },
      { status: 500 }
    );
  }
};
