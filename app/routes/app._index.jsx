import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  InlineGrid,
  Banner,
  Button,
  Box,
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

  return json({
    shop,
    plan: storeSettings.billingPlan,
    isBypassed: storeSettings.isBillingBypassed,
    isWhatsAppConnected: storeSettings.whatsappSession?.isConnected || false,
    phoneNumber: storeSettings.whatsappSession?.phoneNumber || null,
    monthlyUsage: storeSettings.monthlyMessageCount,
    monthlyLimit: storeSettings.isBillingBypassed
      ? "Unlimited"
      : PLAN_LIMITS[storeSettings.billingPlan] || 50,
    totalSent,
    totalFailed,
    totalQueued,
    abandonedRecovered,
  });
};

export default function Index() {
  const data = useLoaderData();

  return (
    <Page title="ComrcexFlow Dashboard">
      <BlockStack gap="500">
        {!data.isWhatsAppConnected && (
          <Banner
            title="WhatsApp Not Connected"
            tone="warning"
            action={{ content: "Connect WhatsApp", url: "/app/whatsapp" }}
          >
            <p>Connect your WhatsApp number to start sending automated messages.</p>
          </Banner>
        )}

        {data.isBypassed && (
          <Banner title="Lifetime Free Access Active" tone="success">
            <p>Developer key applied. Unlimited messages, no billing.</p>
          </Banner>
        )}

        <InlineGrid columns={3} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">Current Plan</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {data.isBypassed ? "Unlimited" : data.plan.charAt(0).toUpperCase() + data.plan.slice(1)}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">Monthly Usage</Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {data.monthlyUsage} / {data.monthlyLimit}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">WhatsApp Status</Text>
              <Text as="p" variant="headingLg" fontWeight="bold" tone={data.isWhatsAppConnected ? "success" : "critical"}>
                {data.isWhatsAppConnected ? "Connected" : "Disconnected"}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Text as="h2" variant="headingMd">This Month</Text>
        <InlineGrid columns={4} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Messages Sent</Text>
              <Text as="p" variant="headingLg">{data.totalSent}</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Failed</Text>
              <Text as="p" variant="headingLg" tone="critical">{data.totalFailed}</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">In Queue</Text>
              <Text as="p" variant="headingLg">{data.totalQueued}</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Carts Recovered</Text>
              <Text as="p" variant="headingLg" tone="success">{data.abandonedRecovered}</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Quick Actions</Text>
            <InlineGrid columns={4} gap="300">
              <Button url="/app/whatsapp" variant="primary">
                WhatsApp Settings
              </Button>
              <Button url="/app/templates">
                Message Templates
              </Button>
              <Button url="/app/billing">
                Manage Billing
              </Button>
              <Button url="/app/analytics">
                View Analytics
              </Button>
            </InlineGrid>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
