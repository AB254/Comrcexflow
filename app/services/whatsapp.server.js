import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import prisma from "../db.server.js";

const clients = new Map();
const qrCodes = new Map();
const clientStates = new Map();

const STATES = {
  DISCONNECTED: "disconnected",
  QR_PENDING: "qr_pending",
  AUTHENTICATING: "authenticating",
  CONNECTED: "connected",
  FAILED: "failed",
};

function getClientState(shop) {
  return clientStates.get(shop) || STATES.DISCONNECTED;
}

function getQRCode(shop) {
  return qrCodes.get(shop) || null;
}

async function initializeClient(shop) {
  if (clients.has(shop)) {
    const existing = clients.get(shop);
    const state = await existing.getState().catch(() => null);
    if (state === "CONNECTED") {
      clientStates.set(shop, STATES.CONNECTED);
      return { status: STATES.CONNECTED };
    }
    try {
      await existing.destroy();
    } catch {}
    clients.delete(shop);
  }

  clientStates.set(shop, STATES.AUTHENTICATING);
  qrCodes.delete(shop);

  const savedSession = await prisma.whatsAppSession.findUnique({
    where: { shop },
  });

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: shop.replace(/[^a-zA-Z0-9_-]/g, "_") }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
      ],
    },
  });

  client.on("qr", async (qr) => {
    qrCodes.set(shop, qr);
    clientStates.set(shop, STATES.QR_PENDING);
    console.log(`[WhatsApp] QR code generated for ${shop}`);
  });

  client.on("authenticated", async () => {
    clientStates.set(shop, STATES.AUTHENTICATING);
    qrCodes.delete(shop);
    console.log(`[WhatsApp] Authenticated for ${shop}`);
  });

  client.on("ready", async () => {
    clientStates.set(shop, STATES.CONNECTED);
    qrCodes.delete(shop);

    const info = client.info;
    const phoneNumber = info?.wid?.user || "unknown";

    await prisma.whatsAppSession.upsert({
      where: { shop },
      update: {
        isConnected: true,
        phoneNumber,
        lastConnectedAt: new Date(),
      },
      create: {
        shop,
        isConnected: true,
        phoneNumber,
        lastConnectedAt: new Date(),
      },
    });

    console.log(`[WhatsApp] Ready for ${shop} (${phoneNumber})`);
  });

  client.on("auth_failure", async (msg) => {
    clientStates.set(shop, STATES.FAILED);
    qrCodes.delete(shop);
    console.error(`[WhatsApp] Auth failure for ${shop}:`, msg);

    await prisma.whatsAppSession.upsert({
      where: { shop },
      update: { isConnected: false },
      create: { shop, isConnected: false },
    });
  });

  client.on("disconnected", async (reason) => {
    clientStates.set(shop, STATES.DISCONNECTED);
    qrCodes.delete(shop);
    clients.delete(shop);
    console.log(`[WhatsApp] Disconnected for ${shop}:`, reason);

    await prisma.whatsAppSession.upsert({
      where: { shop },
      update: { isConnected: false },
      create: { shop, isConnected: false },
    });
  });

  clients.set(shop, client);

  client.initialize().catch((err) => {
    clientStates.set(shop, STATES.FAILED);
    clients.delete(shop);
    console.error(`[WhatsApp] Init error for ${shop}:`, err);
  });

  return { status: getClientState(shop) };
}

async function disconnectClient(shop) {
  const client = clients.get(shop);
  if (client) {
    try {
      await client.logout();
      await client.destroy();
    } catch {}
    clients.delete(shop);
  }

  clientStates.set(shop, STATES.DISCONNECTED);
  qrCodes.delete(shop);

  await prisma.whatsAppSession.upsert({
    where: { shop },
    update: { isConnected: false, sessionData: null },
    create: { shop, isConnected: false },
  });

  return { status: STATES.DISCONNECTED };
}

async function sendMessage(shop, phoneNumber, message) {
  const client = clients.get(shop);
  if (!client) {
    throw new Error("WhatsApp client not initialized for this shop");
  }

  const state = getClientState(shop);
  if (state !== STATES.CONNECTED) {
    throw new Error(`WhatsApp not connected (state: ${state})`);
  }

  const sanitized = phoneNumber.replace(/[^0-9]/g, "");
  const chatId = `${sanitized}@c.us`;

  const isRegistered = await client.isRegisteredUser(chatId);
  if (!isRegistered) {
    throw new Error(`Phone number ${phoneNumber} is not registered on WhatsApp`);
  }

  const result = await client.sendMessage(chatId, message);
  return {
    success: true,
    messageId: result.id?.id,
    timestamp: result.timestamp,
  };
}

async function getSessionStatus(shop) {
  const dbSession = await prisma.whatsAppSession.findUnique({
    where: { shop },
  });

  const memoryState = getClientState(shop);
  const qr = getQRCode(shop);

  if (memoryState === STATES.CONNECTED) {
    return {
      status: STATES.CONNECTED,
      phoneNumber: dbSession?.phoneNumber || null,
      lastConnectedAt: dbSession?.lastConnectedAt || null,
      qr: null,
    };
  }

  return {
    status: memoryState,
    phoneNumber: dbSession?.phoneNumber || null,
    lastConnectedAt: dbSession?.lastConnectedAt || null,
    qr,
  };
}

async function restoreSession(shop) {
  const dbSession = await prisma.whatsAppSession.findUnique({
    where: { shop },
  });

  if (dbSession?.isConnected) {
    try {
      await initializeClient(shop);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export {
  initializeClient,
  disconnectClient,
  sendMessage,
  getSessionStatus,
  getQRCode,
  getClientState,
  restoreSession,
  STATES,
};
