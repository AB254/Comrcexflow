import prisma from "../db.server.js";
import { renderTemplate, extractOrderVariables } from "./templates.server.js";
import { tagOrder } from "./tagging.server.js";

const REMINDER_DELAY_MS = 12 * 60 * 60 * 1000;
const AUTO_CANCEL_DELAY_MS = 24 * 60 * 60 * 1000;

export function isCodOrder(payload) {
  const financialStatus = payload.financial_status?.toLowerCase();
  if (financialStatus === "paid" || financialStatus === "authorized") {
    return false;
  }

  const gateway = (payload.gateway || "").toLowerCase();
  const gatewayNames = (payload.payment_gateway_names || []).map((g) =>
    g.toLowerCase()
  );

  const codKeywords = ["cod", "cash", "cash on delivery", "manual"];
  const isCodGateway =
    codKeywords.some((k) => gateway.includes(k)) ||
    gatewayNames.some((g) => codKeywords.some((k) => g.includes(k)));

  return financialStatus === "pending" || isCodGateway;
}

export async function createCodConfirmation(shop, payload, phone) {
  const variables = extractOrderVariables(payload);
  const storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!storeSettings?.codConfirmationEnabled) return;

  const message = renderTemplate(
    storeSettings.codConfirmationTemplate,
    variables
  );

  const existing = await prisma.codConfirmation.findUnique({
    where: { shop_orderId: { shop, orderId: String(payload.id) } },
  });
  if (existing) return;

  const confirmation = await prisma.codConfirmation.create({
    data: {
      shop,
      orderId: String(payload.id),
      orderNumber: String(payload.order_number),
      customerPhone: phone,
      customerName: variables.customer_name,
      totalPrice: variables.total_price,
      status: "pending",
      messageSentAt: new Date(),
    },
  });

  const { sendMessageFromShop } = await import("./whatsapp.server.js");
  try {
    await sendMessageFromShop(shop, phone, message);
    await tagOrder(shop, payload.admin_graphql_api_id, "COD_Pending");

    await prisma.messageLog.create({
      data: {
        shop,
        recipientPhone: phone,
        recipientName: variables.customer_name,
        messageType: "cod_confirmation",
        messageBody: message,
        status: "sent",
        orderId: String(payload.id),
      },
    });
  } catch (err) {
    console.error(`[COD] Failed to send confirmation for ${shop}:`, err.message);
    await prisma.messageLog.create({
      data: {
        shop,
        recipientPhone: phone,
        recipientName: variables.customer_name,
        messageType: "cod_confirmation",
        messageBody: message,
        status: "failed",
        errorMessage: err.message,
        orderId: String(payload.id),
      },
    });
  }

  scheduleReminder(shop, confirmation.id, phone);
  scheduleAutoCancel(shop, confirmation.id, phone);
}

function scheduleReminder(shop, confirmationId, phone) {
  setTimeout(async () => {
    try {
      const confirmation = await prisma.codConfirmation.findUnique({
        where: { id: confirmationId },
      });
      if (!confirmation || confirmation.status !== "pending") return;

      const storeSettings = await prisma.storeSettings.findUnique({
        where: { shop },
      });
      if (!storeSettings) return;

      const message = renderTemplate(storeSettings.codReminderTemplate, {
        customer_name: confirmation.customerName || "Customer",
        order_number: confirmation.orderNumber,
        total_price: confirmation.totalPrice || "",
      });

      const { sendMessageFromShop } = await import("./whatsapp.server.js");
      await sendMessageFromShop(shop, phone, message);

      await prisma.codConfirmation.update({
        where: { id: confirmationId },
        data: { status: "reminder_sent", reminderSentAt: new Date() },
      });

      console.log(`[COD] Reminder sent for order #${confirmation.orderNumber}`);
    } catch (err) {
      console.error(`[COD] Reminder failed:`, err.message);
    }
  }, REMINDER_DELAY_MS);
}

function scheduleAutoCancel(shop, confirmationId, phone) {
  setTimeout(async () => {
    try {
      const confirmation = await prisma.codConfirmation.findUnique({
        where: { id: confirmationId },
      });
      if (
        !confirmation ||
        (confirmation.status !== "pending" &&
          confirmation.status !== "reminder_sent")
      )
        return;

      await cancelCodOrder(shop, confirmation);

      const { sendMessageFromShop } = await import("./whatsapp.server.js");
      try {
        await sendMessageFromShop(
          shop,
          phone,
          `Your order #${confirmation.orderNumber} has been automatically cancelled as we did not receive a confirmation. If this was a mistake, please place a new order.`
        );
      } catch {}

      console.log(
        `[COD] Auto-cancelled order #${confirmation.orderNumber} after 24h`
      );
    } catch (err) {
      console.error(`[COD] Auto-cancel failed:`, err.message);
    }
  }, AUTO_CANCEL_DELAY_MS);
}

export async function handleCodReply(shop, senderPhone, replyText) {
  const reply = replyText.trim();

  const confirmation = await prisma.codConfirmation.findFirst({
    where: {
      shop,
      customerPhone: senderPhone,
      status: { in: ["pending", "reminder_sent"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!confirmation) return false;

  if (reply === "1") {
    await prisma.codConfirmation.update({
      where: { id: confirmation.id },
      data: { status: "confirmed", respondedAt: new Date() },
    });

    try {
      await tagOrder(
        shop,
        `gid://shopify/Order/${confirmation.orderId}`,
        "COD_Confirmed"
      );
    } catch (err) {
      console.error(`[COD] Tag error:`, err.message);
    }

    const { sendMessageFromShop } = await import("./whatsapp.server.js");
    try {
      await sendMessageFromShop(
        shop,
        senderPhone,
        `Thank you! Your order #${confirmation.orderNumber} has been confirmed and will be shipped soon.`
      );
    } catch {}

    console.log(`[COD] Order #${confirmation.orderNumber} CONFIRMED by customer`);
    return true;
  }

  if (reply === "2") {
    await cancelCodOrder(shop, confirmation);

    const { sendMessageFromShop } = await import("./whatsapp.server.js");
    try {
      await sendMessageFromShop(
        shop,
        senderPhone,
        `Your order #${confirmation.orderNumber} has been cancelled as per your request. Thank you.`
      );
    } catch {}

    console.log(`[COD] Order #${confirmation.orderNumber} CANCELLED by customer`);
    return true;
  }

  const { sendMessageFromShop } = await import("./whatsapp.server.js");
  try {
    await sendMessageFromShop(
      shop,
      senderPhone,
      `Please reply *1* to Confirm or *2* to Cancel your order #${confirmation.orderNumber}.`
    );
  } catch {}

  return true;
}

async function cancelCodOrder(shop, confirmation) {
  await prisma.codConfirmation.update({
    where: { id: confirmation.id },
    data: {
      status: confirmation.status === "pending" || confirmation.status === "reminder_sent"
        ? "auto_cancelled"
        : "cancelled",
      respondedAt: new Date(),
    },
  });

  try {
    const session = await prisma.session.findFirst({
      where: { shop, isOnline: false },
    });

    if (session?.accessToken) {
      const response = await fetch(
        `https://${shop}/admin/api/2024-04/orders/${confirmation.orderId}/cancel.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": session.accessToken,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        console.error(`[COD] Cancel API error:`, await response.text());
      }
    }

    await tagOrder(
      shop,
      `gid://shopify/Order/${confirmation.orderId}`,
      confirmation.status === "auto_cancelled" ? "COD_AutoCancelled" : "COD_Cancelled"
    );
  } catch (err) {
    console.error(`[COD] Cancel order error:`, err.message);
  }
}

export async function getCodStats(shop) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const stats = await prisma.codConfirmation.groupBy({
    by: ["status"],
    where: { shop, createdAt: { gte: startOfMonth } },
    _count: { id: true },
  });

  const getCount = (status) =>
    stats.find((s) => s.status === status)?._count?.id || 0;

  const pending = getCount("pending") + getCount("reminder_sent");
  const confirmed = getCount("confirmed");
  const cancelled = getCount("cancelled");
  const autoCancelled = getCount("auto_cancelled");
  const total = confirmed + cancelled + autoCancelled;
  const confirmRate = total > 0 ? Math.round((confirmed / total) * 100) : 0;

  return { pending, confirmed, cancelled, autoCancelled, confirmRate, total };
}
