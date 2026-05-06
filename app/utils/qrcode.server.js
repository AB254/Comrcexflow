import QRCode from "qrcode";

export async function generateQRDataURL(qrString) {
  if (!qrString) return null;
  try {
    return await QRCode.toDataURL(qrString, {
      width: 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });
  } catch (err) {
    console.error("[QR] Failed to generate QR data URL:", err);
    return null;
  }
}
