import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { createRedisConnection } from "./connection.server.js";
import { QUEUE_NAMES } from "./queues.server.js";

const prisma = new PrismaClient();

const TEMPLATE_FIELDS = {
  order_confirmation: "orderConfirmationTemplate",
  abandoned_checkout: "abandonedCheckoutTemplate",
  order_fulfillment: "orderFulfillmentTemplate",
  order_cancellation: "orderCancellationTemplate",
};

const PLAN_LIMITS = {
  free: 50,
  starter: 1250,
  growth: 2500,
  professional: 4250,
};

function renderTemplate(template, variables) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}

async function processWhatsAppJob(job) {
  const { shop, phone, orderId, checkoutId, variables, messageType } = job.data;
  console.log(`[Worker] Processing ${messageType} for ${shop} -> ${phone}`);

  const storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!storeSettings) {
    throw new Error(`Store settings not found for ${shop}`);
  }

  if (!storeSettings.isBillingBypassed) {
    const limit = PLAN_LIMITS[storeSettings.billingPlan] || 50;
    if (storeSettings.monthlyMessageCount >= limit) {
      await prisma.messageLog.create({
        data: {
          shop,
          recipientPhone: phone,
          messageType,
          messageBody: "Message limit reached",
          status: "limit_reached",
          orderId,
          checkoutId,
        },
      });
      console.log(`[Worker] Limit reached for ${shop} (${storeSettings.monthlyMessageCount}/${limit})`);
      return { status: "limit_reached" };
    }
  }

  const whatsappSession = await prisma.whatsAppSession.findUnique({
    where: { shop },
  });

  if (!whatsappSession?.isConnected) {
    await prisma.messageLog.create({
      data: {
        shop,
        recipientPhone: phone,
        messageType,
        messageBody: "WhatsApp not connected",
        status: "failed",
        errorMessage: "WhatsApp session not connected",
        orderId,
        checkoutId,
      },
    });
    throw new Error("WhatsApp not connected for " + shop);
  }

  const templateField = TEMPLATE_FIELDS[messageType];
  const template = storeSettings[templateField];
  if (!template) {
    throw new Error(`No template found for ${messageType}`);
  }

  const messageBody = renderTemplate(template, variables);

  const sanitizedPhone = phone.replace(/[^0-9]/g, "");
  const chatId = `${sanitizedPhone}@c.us`;

  // The worker communicates with the main process WhatsApp client via HTTP
  // In production, the worker runs in the same container and calls the internal API
  const sendUrl = `${process.env.SHOPIFY_APP_URL || "http://localhost:3000"}/api/internal/whatsapp-send`;

  try {
    const response = await fetch(sendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": process.env.INTERNAL_WORKER_SECRET || "worker-secret",
      },
      body: JSON.stringify({ shop, chatId, message: messageBody }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Send failed");
    }

    await prisma.messageLog.create({
      data: {
        shop,
        recipientPhone: phone,
        recipientName: variables.customer_name,
        messageType,
        messageBody,
        status: "sent",
        orderId,
        checkoutId,
      },
    });

    await prisma.storeSettings.update({
      where: { shop },
      data: { monthlyMessageCount: { increment: 1 } },
    });

    // Tag the order
    if (orderId) {
      try {
        const session = await prisma.session.findFirst({
          where: { shop, isOnline: false },
          orderBy: { id: "desc" },
        });

        if (session?.accessToken) {
          const ORDER_TAGS = {
            order_confirmation: "WA_Confirmed",
            abandoned_checkout: "WA_CartRecovery",
            order_fulfillment: "WA_Fulfilled",
            order_cancellation: "WA_Cancelled",
          };

          const tag = ORDER_TAGS[messageType];
          if (tag) {
            const gqlOrderId = `gid://shopify/Order/${orderId}`;
            await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": session.accessToken,
              },
              body: JSON.stringify({
                query: `mutation orderUpdate($input: OrderInput!) {
                  orderUpdate(input: $input) {
                    order { id tags }
                    userErrors { field message }
                  }
                }`,
                variables: { input: { id: gqlOrderId, tags: [tag] } },
              }),
            });
            console.log(`[Worker] Tagged order ${orderId} with "${tag}"`);
          }
        }
      } catch (tagErr) {
        console.error(`[Worker] Tagging failed for ${orderId}:`, tagErr.message);
      }
    }

    // Update daily analytics
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const updateData = { messagesSent: { increment: 1 } };
    if (messageType === "abandoned_checkout") {
      updateData.abandonedCartsSent = { increment: 1 };
    }

    await prisma.analyticsDaily.upsert({
      where: { shop_date: { shop, date: today } },
      update: updateData,
      create: {
        shop,
        date: today,
        messagesSent: 1,
        abandonedCartsSent: messageType === "abandoned_checkout" ? 1 : 0,
      },
    });

    console.log(`[Worker] Message sent to ${phone} for ${shop}`);
    return { status: "sent", messageId: result.messageId };
  } catch (err) {
    await prisma.messageLog.create({
      data: {
        shop,
        recipientPhone: phone,
        recipientName: variables.customer_name,
        messageType,
        messageBody,
        status: "failed",
        errorMessage: err.message,
        orderId,
        checkoutId,
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.analyticsDaily.upsert({
      where: { shop_date: { shop, date: today } },
      update: { messagesFailed: { increment: 1 } },
      create: { shop, date: today, messagesFailed: 1 },
    });

    throw err;
  }
}

// Create workers for all queues
const allQueues = Object.values(QUEUE_NAMES);
const workers = [];

for (const queueName of allQueues) {
  const worker = new Worker(queueName, processWhatsAppJob, {
    connection: createRedisConnection(),
    concurrency: 3,
    limiter: {
      max: 10,
      duration: 60000,
    },
  });

  worker.on("completed", (job) => {
    console.log(`[Worker] Job ${job.id} completed on ${queueName}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed on ${queueName}:`, err.message);
  });

  worker.on("error", (err) => {
    console.error(`[Worker] Error on ${queueName}:`, err.message);
  });

  workers.push(worker);
  console.log(`[Worker] Started worker for ${queueName}`);
}

async function shutdown() {
  console.log("[Worker] Shutting down...");
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("[Worker] All workers started, waiting for jobs...");
