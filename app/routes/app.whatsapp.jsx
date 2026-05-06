import { useState, useCallback, useEffect, useRef } from "react";
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
  const autoConnectDone = useRef(false);

  const [connectionStatus, setConnectionStatus] = useState(initialData.status);
  const [qrDataUrl, setQrDataUrl] = useState(initialData.qrDataUrl);
  const [phoneNumber, setPhoneNumber] = useState(initialData.phoneNumber);
  const [polling, setPolling] = useState(false);

  const isConnected = connectionStatus === "connected";
  const isDisconnecting = disconnectFetcher.state === "submitting";

  // Auto-connect on page load if disconnected
  useEffect(() => {
    if (!autoConnectDone.current && connectionStatus === "disconnected" && connectFetcher.state === "idle") {
      autoConnectDone.current = true;
      connectFetcher.submit(null, {
        method: "POST",
        action: "/api/whatsapp/connect",
      });
    }
  }, [connectionStatus, connectFetcher.state]);

  // Start polling after connect request
  useEffect(() => {
    if (connectFetcher.data?.success) {
      setPolling(true);
    }
  }, [connectFetcher.data]);

  // Update state from status poll
  useEffect(() => {
    if (statusFetcher.data) {
      setConnectionStatus(statusFetcher.data.status);
      setQrDataUrl(statusFetcher.data.qrDataUrl);
      if (statusFetcher.data.phoneNumber) {
        setPhoneNumber(statusFetcher.data.phoneNumber);
      }
    }
  }, [statusFetcher.data]);

  // Handle disconnect response
  useEffect(() => {
    if (disconnectFetcher.data?.success) {
      setConnectionStatus("disconnected");
      setQrDataUrl(null);
      setPhoneNumber(null);
      setPolling(false);
      autoConnectDone.current = false;
    }
  }, [disconnectFetcher.data]);

  // Poll for status updates
  useEffect(() => {
    if (!polling) return;
    if (connectionStatus === "connected" || connectionStatus === "failed" || connectionStatus === "disconnected") {
      if (connectionStatus === "connected") {
        setPolling(false);
      }
      return;
    }

    const interval = setInterval(() => {
      if (statusFetcher.state === "idle") {
        statusFetcher.load("/api/whatsapp/status");
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [polling, connectionStatus, statusFetcher.state]);

  // Also poll when connected to detect remote logout
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      if (statusFetcher.state === "idle") {
        statusFetcher.load("/api/whatsapp/status");
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [isConnected, statusFetcher.state]);

  // Auto-reconnect if status changes to disconnected (remote logout)
  useEffect(() => {
    if (connectionStatus === "disconnected" && !autoConnectDone.current && connectFetcher.state === "idle") {
      autoConnectDone.current = true;
      connectFetcher.submit(null, {
        method: "POST",
        action: "/api/whatsapp/connect",
      });
    }
  }, [connectionStatus]);

  const handleConnect = useCallback(() => {
    autoConnectDone.current = true;
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
            <div className="animate-fade-in-up">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <span className={`status-dot ${isConnected ? "status-dot--connected" : connectionStatus === "qr_pending" || connectionStatus === "authenticating" ? "status-dot--pending" : "status-dot--disconnected"}`} />
                      <Text as="h2" variant="headingMd">
                        Connection Status
                      </Text>
                    </InlineStack>
                    {getStatusBadge()}
                  </InlineStack>

                  <Divider />

                  {isConnected && (
                    <div className="animate-scale-in">
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
                    </div>
                  )}

                  {connectionStatus === "disconnected" && connectFetcher.state === "idle" && (
                    <div className="animate-fade-in">
                      <BlockStack gap="300" inlineAlign="center">
                        <Spinner size="large" />
                        <Text as="p" variant="bodyMd" tone="subdued">
                          Initializing WhatsApp connection...
                        </Text>
                      </BlockStack>
                    </div>
                  )}

                  {connectionStatus === "failed" && (
                    <div className="animate-scale-in">
                      <BlockStack gap="300">
                        <Banner title="Connection Failed" tone="critical">
                          <p>Failed to connect WhatsApp. Please try again.</p>
                        </Banner>
                        <Button variant="primary" onClick={handleConnect}>
                          Retry Connection
                        </Button>
                      </BlockStack>
                    </div>
                  )}

                  {(connectionStatus === "qr_pending" ||
                    connectionStatus === "authenticating" ||
                    connectFetcher.state === "submitting") && (
                    <BlockStack gap="400" inlineAlign="center">
                      {qrDataUrl ? (
                        <div className="animate-scale-in">
                          <BlockStack gap="300" inlineAlign="center">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              Scan this QR code with your WhatsApp app
                            </Text>
                            <div className="qr-glow">
                              <Box padding="400" background="bg-surface" borderRadius="300">
                                <img
                                  src={qrDataUrl}
                                  alt="WhatsApp QR Code"
                                  style={{
                                    width: 280,
                                    height: 280,
                                    display: "block",
                                  }}
                                />
                              </Box>
                            </div>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Open WhatsApp → Settings → Linked Devices → Link a Device
                            </Text>
                          </BlockStack>
                        </div>
                      ) : (
                        <div className="animate-fade-in">
                          <BlockStack gap="200" inlineAlign="center">
                            <Spinner size="large" />
                            <Text as="p" variant="bodyMd">
                              Generating QR code...
                            </Text>
                          </BlockStack>
                        </div>
                      )}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </div>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <div className="animate-fade-in-up stagger-2">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">How It Works</Text>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd"><strong>1.</strong> QR code generates automatically</Text>
                      <Text as="p" variant="bodyMd"><strong>2.</strong> Open WhatsApp on your phone</Text>
                      <Text as="p" variant="bodyMd"><strong>3.</strong> Go to Settings → Linked Devices</Text>
                      <Text as="p" variant="bodyMd"><strong>4.</strong> Tap "Link a Device" and scan</Text>
                      <Text as="p" variant="bodyMd"><strong>5.</strong> Your WhatsApp is now connected!</Text>
                    </BlockStack>
                  </BlockStack>
                </Card>
              </div>

              <div className="animate-fade-in-up stagger-3">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Session Info</Text>
                    <Divider />
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">Phone</Text>
                        <Text as="span" fontWeight="semibold">{phoneNumber || "—"}</Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">Status</Text>
                        <InlineStack gap="100" blockAlign="center">
                          <span className={`status-dot ${isConnected ? "status-dot--connected" : "status-dot--disconnected"}`} />
                          <Text as="span" fontWeight="semibold">{connectionStatus}</Text>
                        </InlineStack>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">Shop</Text>
                        <Text as="span" fontWeight="semibold">{initialData.shop}</Text>
                      </InlineStack>
                    </BlockStack>
                  </BlockStack>
                </Card>
              </div>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
