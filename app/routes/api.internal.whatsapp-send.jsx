import { json } from "@remix-run/node";
import { sendMessage } from "../services/whatsapp.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const secret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.INTERNAL_WORKER_SECRET || "worker-secret";

  if (secret !== expectedSecret) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const { shop, chatId, message } = await request.json();

  if (!shop || !chatId || !message) {
    return json({ error: "shop, chatId, and message are required" }, { status: 400 });
  }

  try {
    const phone = chatId.replace("@c.us", "");
    const result = await sendMessage(shop, phone, message);
    return json({ success: true, messageId: result.messageId });
  } catch (err) {
    return json({ success: false, error: err.message }, { status: 500 });
  }
};
