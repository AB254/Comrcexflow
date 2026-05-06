import { Queue } from "bullmq";
import { getRedisConnection } from "./connection.server.js";

const queueInstances = new Map();

function getOrCreateQueue(name) {
  if (!queueInstances.has(name)) {
    const queue = new Queue(name, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
    queueInstances.set(name, queue);
  }
  return queueInstances.get(name);
}

export const QUEUE_NAMES = {
  ORDER_CONFIRMATION: "whatsapp:order-confirmation",
  ABANDONED_CHECKOUT: "whatsapp:abandoned-checkout",
  ORDER_FULFILLMENT: "whatsapp:order-fulfillment",
  ORDER_CANCELLATION: "whatsapp:order-cancellation",
};

export function getOrderConfirmationQueue() {
  return getOrCreateQueue(QUEUE_NAMES.ORDER_CONFIRMATION);
}

export function getAbandonedCheckoutQueue() {
  return getOrCreateQueue(QUEUE_NAMES.ABANDONED_CHECKOUT);
}

export function getOrderFulfillmentQueue() {
  return getOrCreateQueue(QUEUE_NAMES.ORDER_FULFILLMENT);
}

export function getOrderCancellationQueue() {
  return getOrCreateQueue(QUEUE_NAMES.ORDER_CANCELLATION);
}

export async function addToQueue(queueName, data) {
  const queue = getOrCreateQueue(queueName);
  const job = await queue.add(queueName, data, {
    delay: queueName === QUEUE_NAMES.ABANDONED_CHECKOUT ? 15 * 60 * 1000 : 0,
  });
  console.log(`[Queue] Job ${job.id} added to ${queueName} for ${data.shop}`);
  return job;
}
