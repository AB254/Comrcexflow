import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  InlineGrid,
  Banner,
  Button,
  InlineStack,
  Box,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
    include: { whatsappSession: true },
  });

  if (!storeSettings) {
    storeSettings = await prisma.storeSettings.create({
      data: { shop },
      include: { whatsappSession: true },
    });
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const messageStats = await prisma.messageLog.groupBy({
    by: ["status"],
    where: {
      shop,
      createdAt: { gte: startOfMonth },
    },
    _count: { id: true },
  });

  const totalSent = messageStats.find((s) => s.status === "sent")?._count?.id || 0;
  const totalFailed = messageStats.find((s) => s.status === "failed")?._count?.id || 0;
  const totalQueued = messageStats.find((s) => s.status === "queued")?._count?.id || 0;

  const abandonedRecovered = await prisma.messageLog.count({
    where: {
      shop,
      messageType: "abandoned_checkout",
      status: "sent",
      createdAt: { gte: startOfMonth },
    },
  });

  const PLAN_LIMITS = {
    free: 50,
    starter: 1250,
    growth: 2500,
    professional: 4250,
  };

  const limit = storeSettings.isBillingBypassed
    ? 999999
    : PLAN_LIMITS[storeSettings.billingPlan] || 50;

  return json({
    shop,
    plan: storeSettings.billingPlan,
    isBypassed: storeSettings.isBillingBypassed,
    isWhatsAppConnected: storeSettings.whatsappSession?.isConnected || false,
    phoneNumber: storeSettings.whatsappSession?.phoneNumber || null,
    monthlyUsage: storeSettings.monthlyMessageCount,
    monthlyLimit: storeSettings.isBillingBypassed ? "Unlimited" : limit,
    usagePercent: storeSettings.isBillingBypassed ? 0 : Math.min(100, Math.round((storeSettings.monthlyMessageCount / limit) * 100)),
    totalSent,
    totalFailed,
    totalQueued,
    abandonedRecovered,
  });
};

export default function Index() {
  const data = useLoaderData();

  const usageColor = data.usagePercent > 90 ? "critical" : data.usagePercent > 70 ? "warning" : "success";
  const progressClass = data.usagePercent > 90 ? "progress-bar-fill--danger" : data.usagePercent > 70 ? "progress-bar-fill--warning" : "";

  return (
    <Page title="Dashboard">
      <BlockStack gap="500">
        {!data.isWhatsAppConnected && (
          <div className="animate-fade-in-up">
            <Banner
              title="WhatsApp Not Connected"
              tone="warning"
              action={{ content: "Connect Now", url: "/app/whatsapp" }}
            >
              <p>Connect your WhatsApp to start sending automated messages to customers.</p>
            </Banner>
          </div>
        )}

        {data.isBypassed && (
          <div className="animate-fade-in-up">
            <Banner title="Developer Access Active" tone="success">
              <p>Unlimited messages enabled. No billing required.</p>
            </Banner>
          </div>
        )}

        <InlineGrid columns={3} gap="400">
          <div className="animate-fade-in-up stagger-1 stat-card">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingSm" tone="subdued">Current Plan</Text>
                  <div className={data.isBypassed ? "connected-badge" : ""}>
                    <Text as="span" variant="bodySm" fontWeight="semibold" tone="success">
                      {data.isBypassed ? "Unlimited" : "Active"}
                    </Text>
                  </div>
                </InlineStack>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {data.isBypassed ? "Dev Mode" : data.plan.charAt(0).toUpperCase() + data.plan.slice(1)}
                </Text>
              </BlockStack>
            </Card>
          </div>

          <div className="animate-fade-in-up stagger-2 stat-card">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingSm" tone="subdued">Monthly Usage</Text>
                  <Text as="span" variant="bodySm" tone={usageColor}>
                    {data.usagePercent}%
                  </Text>
                </InlineStack>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {data.monthlyUsage} <Text as="span" variant="bodyMd" tone="subdued">/ {data.monthlyLimit}</Text>
                </Text>
                <div className="progress-bar-container">
                  <div
                    className={`progress-bar-fill ${progressClass}`}
                    style={{ width: `${data.usagePercent}%` }}
                  />
                </div>
              </BlockStack>
            </Card>
          </div>

          <div className="animate-fade-in-up stagger-3 stat-card">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingSm" tone="subdued">WhatsApp</Text>
                  <InlineStack gap="200" blockAlign="center">
                    <span className={`status-dot ${data.isWhatsAppConnected ? "status-dot--connected" : "status-dot--disconnected"}`} />
                    <Text as="span" variant="bodySm" tone={data.isWhatsAppConnected ? "success" : "critical"}>
                      {data.isWhatsAppConnected ? "Connected" : "Offline"}
                    </Text>
                  </InlineStack>
                </InlineStack>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {data.isWhatsAppConnected ? data.phoneNumber || "Active" : "---"}
                </Text>
              </BlockStack>
            </Card>
          </div>
        </InlineGrid>

        <div className="animate-fade-in-up stagger-4">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">This Month&apos;s Performance</Text>
              <Divider />
              <InlineGrid columns={4} gap="400">
                <BlockStack gap="200">
                  <Text as="h3" variant="bodySm" tone="subdued">Messages Sent</Text>
                  <Text as="p" variant="headingXl" fontWeight="bold">{data.totalSent}</Text>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="h3" variant="bodySm" tone="subdued">Failed</Text>
                  <Text as="p" variant="headingXl" fontWeight="bold" tone="critical">{data.totalFailed}</Text>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="h3" variant="bodySm" tone="subdued">In Queue</Text>
                  <Text as="p" variant="headingXl" fontWeight="bold">{data.totalQueued}</Text>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="h3" variant="bodySm" tone="subdued">Carts Recovered</Text>
                  <Text as="p" variant="headingXl" fontWeight="bold" tone="success">{data.abandonedRecovered}</Text>
                </BlockStack>
              </InlineGrid>
            </BlockStack>
          </Card>
        </div>

        <div className="animate-fade-in-up stagger-5">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Quick Actions</Text>
              <Divider />
              <InlineGrid columns={4} gap="300">
                <Button url="/app/whatsapp" variant="primary" size="large">
                  WhatsApp
                </Button>
                <Button url="/app/templates" size="large">
                  Templates
                </Button>
                <Button url="/app/billing" size="large">
                  Billing
                </Button>
                <Button url="/app/analytics" size="large">
                  Analytics
                </Button>
              </InlineGrid>
            </BlockStack>
          </Card>
        </div>
      </BlockStack>
    </Page>
  );
}
