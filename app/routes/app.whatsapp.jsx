import { useState, useCallback, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Badge,
  Spinner,
  Box,
  Divider,
} from "@shopify/polaris";
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
    shop,
    status: status.status,
    phoneNumber: status.phoneNumber,
    lastConnectedAt: status.lastConnectedAt,
    qrDataUrl,
  });
};

export default function WhatsAppSettings() {
  const initialData = useLoaderData();
  const connectFetcher = useFetcher();
  const disconnectFetcher = useFetcher();
  const statusFetcher = useFetcher();

  const [connectionStatus, setConnectionStatus] = useState(initialData.status);
  const [qrDataUrl, setQrDataUrl] = useState(initialData.qrDataUrl);
  const [phoneNumber, setPhoneNumber] = useState(initialData.phoneNumber);
  const [polling, setPolling] = useState(
    initialData.status === "authenticating" || initialData.status === "qr_pending"
  );

  const isConnecting =
    connectFetcher.state === "submitting" ||
    connectionStatus === "authenticating" ||
    connectionStatus === "qr_pending";

  const isConnected = connectionStatus === "connected";
  const isDisconnecting = disconnectFetcher.state === "submitting";

  useEffect(() => {
    if (statusFetcher.data) {
      setConnectionStatus(statusFetcher.data.status);
      setQrDataUrl(statusFetcher.data.qrDataUrl);
      if (statusFetcher.data.phoneNumber) {
        setPhoneNumber(statusFetcher.data.phoneNumber);
      }
    }
  }, [statusFetcher.data]);

  useEffect(() => {
    if (connectFetcher.data?.success) {
      setPolling(true);
    }
  }, [connectFetcher.data]);

  useEffect(() => {
    if (disconnectFetcher.data?.success) {
      setConnectionStatus("disconnected");
      setQrDataUrl(null);
      setPhoneNumber(null);
      setPolling(false);
    }
  }, [disconnectFetcher.data]);

  useEffect(() => {
    if (!polling) return;
    if (connectionStatus === "connected" || connectionStatus === "failed") {
      setPolling(false);
      return;
    }

    const interval = setInterval(() => {
      statusFetcher.load("/api/whatsapp/status");
    }, 3000);

    return () => clearInterval(interval);
  }, [polling, connectionStatus]);

  const handleConnect = useCallback(() => {
    connectFetcher.submit(null, {
      method: "POST",
      action: "/api/whatsapp/connect",
    });
  }, [connectFetcher]);

  const handleDisconnect = useCallback(() => {
    disconnectFetcher.submit(null, {
      method: "POST",
      action: "/api/whatsapp/disconnect",
    });
  }, [disconnectFetcher]);

  const getStatusBadge = () => {
    switch (connectionStatus) {
      case "connected":
        return <Badge tone="success">Connected</Badge>;
      case "qr_pending":
        return <Badge tone="attention">Scan QR Code</Badge>;
      case "authenticating":
        return <Badge tone="info">Authenticating...</Badge>;
      case "failed":
        return <Badge tone="critical">Failed</Badge>;
      default:
        return <Badge>Disconnected</Badge>;
    }
  };

  return (
    <Page
      title="WhatsApp Connection"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Connection Status
                  </Text>
                  {getStatusBadge()}
                </InlineStack>

                <Divider />

                {isConnected && (
                  <BlockStack gap="300">
                    <Banner title="WhatsApp Connected" tone="success">
                      <p>
                        Your WhatsApp number <strong>{phoneNumber}</strong> is
                        connected and ready to send automated messages.
                      </p>
                    </Banner>

                    <InlineStack gap="300">
                      <Button
                        variant="primary"
                        tone="critical"
                        onClick={handleDisconnect}
                        loading={isDisconnecting}
                      >
                        Disconnect WhatsApp
                      </Button>
                    </InlineStack>
                  </BlockStack>
                )}

                {connectionStatus === "disconnected" && (
                  <BlockStack gap="300">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Connect your WhatsApp account to start sending automated
                      messages to your customers. Click the button below to
                      generate a QR code.
                    </Text>
                    <Button
                      variant="primary"
                      onClick={handleConnect}
                      loading={connectFetcher.state === "submitting"}
                    >
                      Generate QR Code
                    </Button>
                  </BlockStack>
                )}

                {connectionStatus === "failed" && (
                  <BlockStack gap="300">
                    <Banner title="Connection Failed" tone="critical">
                      <p>
                        Failed to connect WhatsApp. Please try again.
                      </p>
                    </Banner>
                    <Button variant="primary" onClick={handleConnect}>
                      Retry Connection
                    </Button>
                  </BlockStack>
                )}

                {(connectionStatus === "qr_pending" ||
                  connectionStatus === "authenticating") && (
                  <BlockStack gap="400" inlineAlign="center">
                    {qrDataUrl ? (
                      <BlockStack gap="300" inlineAlign="center">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          Scan this QR code with your WhatsApp app
                        </Text>
                        <Box
                          padding="400"
                          background="bg-surface"
                          borderRadius="200"
                          borderWidth="025"
                          borderColor="border"
                        >
                          <img
                            src={qrDataUrl}
                            alt="WhatsApp QR Code"
                            style={{
                              width: 300,
                              height: 300,
                              display: "block",
                            }}
                          />
                        </Box>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Open WhatsApp → Settings → Linked Devices → Link a
                          Device
                        </Text>
                      </BlockStack>
                    ) : (
                      <BlockStack gap="200" inlineAlign="center">
                        <Spinner size="large" />
                        <Text as="p" variant="bodyMd">
                          {connectionStatus === "authenticating"
                            ? "Authenticating..."
                            : "Generating QR code..."}
                        </Text>
                      </BlockStack>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    How It Works
                  </Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      <strong>1.</strong> Click "Generate QR Code"
                    </Text>
                    <Text as="p" variant="bodyMd">
                      <strong>2.</strong> Open WhatsApp on your phone
                    </Text>
                    <Text as="p" variant="bodyMd">
                      <strong>3.</strong> Go to Settings → Linked Devices
                    </Text>
                    <Text as="p" variant="bodyMd">
                      <strong>4.</strong> Tap "Link a Device" and scan the QR
                      code
                    </Text>
                    <Text as="p" variant="bodyMd">
                      <strong>5.</strong> Your WhatsApp is now connected!
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Session Info
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">Phone</Text>
                      <Text as="span">{phoneNumber || "—"}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">Status</Text>
                      <Text as="span">{connectionStatus}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">Shop</Text>
                      <Text as="span">{initialData.shop}</Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
