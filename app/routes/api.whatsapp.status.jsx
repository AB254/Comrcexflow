import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getSessionStatus } from "../services/whatsapp.server";
import { generateQRDataURL } from "../utils/qrcode.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const status = await getSessionStatus(shop);

  let qrDataUrl = null;
  if (status.qr) {
    qrDataUrl = await generateQRDataURL(status.qr);
  }

  return json({
    status: status.status,
    phoneNumber: status.phoneNumber,
    lastConnectedAt: status.lastConnectedAt,
    qrDataUrl,
  });
};
