import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { sendMessage } from "../services/whatsapp.server";
import prisma from "../db.server";
import { canSendMessage } from "../utils/plans";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const body = await request.json();
  const { phoneNumber, message, messageType, orderId, checkoutId } = body;

  if (!phoneNumber || !message) {
    return json({ error: "phoneNumber and message are required" }, { status: 400 });
  }

  const storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!storeSettings) {
    return json({ error: "Store not configured" }, { status: 404 });
  }

  if (!canSendMessage(storeSettings)) {
    await prisma.messageLog.create({
      data: {
        shop,
        recipientPhone: phoneNumber,
        messageType: messageType || "manual",
        messageBody: message,
        status: "limit_reached",
        orderId,
        checkoutId,
      },
    });
    return json(
      { error: "Monthly message limit reached. Please upgrade your plan." },
      { status: 429 }
    );
  }

  try {
    const result = await sendMessage(shop, phoneNumber, message);

    await prisma.messageLog.create({
      data: {
        shop,
        recipientPhone: phoneNumber,
        messageType: messageType || "manual",
        messageBody: message,
        status: "sent",
        orderId,
        checkoutId,
      },
    });

    await prisma.storeSettings.update({
      where: { shop },
      data: { monthlyMessageCount: { increment: 1 } },
    });

    return json({ success: true, ...result });
  } catch (err) {
    await prisma.messageLog.create({
      data: {
        shop,
        recipientPhone: phoneNumber,
        messageType: messageType || "manual",
        messageBody: message,
        status: "failed",
        errorMessage: err.message,
        orderId,
        checkoutId,
      },
    });

    return json({ success: false, error: err.message }, { status: 500 });
  }
};
