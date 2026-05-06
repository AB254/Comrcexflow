import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  DataTable,
  Badge,
  Select,
  Box,
  Divider,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [
    thisMonthStats,
    lastMonthStats,
    dailyStats,
    recentMessages,
    messagesByType,
  ] = await Promise.all([
    prisma.messageLog.groupBy({
      by: ["status"],
      where: { shop, createdAt: { gte: startOfMonth } },
      _count: { id: true },
    }),
    prisma.messageLog.groupBy({
      by: ["status"],
      where: {
        shop,
        createdAt: { gte: startOfLastMonth, lt: startOfMonth },
      },
      _count: { id: true },
    }),
    prisma.analyticsDaily.findMany({
      where: {
        shop,
        date: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { date: "desc" },
      take: 30,
    }),
    prisma.messageLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        recipientPhone: true,
        recipientName: true,
        messageType: true,
        status: true,
        createdAt: true,
        orderId: true,
        errorMessage: true,
      },
    }),
    prisma.messageLog.groupBy({
      by: ["messageType"],
      where: { shop, createdAt: { gte: startOfMonth }, status: "sent" },
      _count: { id: true },
    }),
  ]);

  const getCount = (stats, status) =>
    stats.find((s) => s.status === status)?._count?.id || 0;

  const thisMonth = {
    sent: getCount(thisMonthStats, "sent"),
    failed: getCount(thisMonthStats, "failed"),
    queued: getCount(thisMonthStats, "queued"),
    limitReached: getCount(thisMonthStats, "limit_reached"),
  };

  const lastMonth = {
    sent: getCount(lastMonthStats, "sent"),
    failed: getCount(lastMonthStats, "failed"),
  };

  const byType = messagesByType.reduce((acc, item) => {
    acc[item.messageType] = item._count.id;
    return acc;
  }, {});

  const totalRecovered = await prisma.analyticsDaily.aggregate({
    where: { shop, date: { gte: startOfMonth } },
    _sum: { abandonedCartsRecovered: true },
  });

  return json({
    thisMonth,
    lastMonth,
    byType,
    dailyStats: dailyStats.map((d) => ({
      ...d,
      date: d.date.toISOString().split("T")[0],
    })),
    recentMessages: recentMessages.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
    totalRecovered: totalRecovered._sum.abandonedCartsRecovered || 0,
  });
};

export default function Analytics() {
  const {
    thisMonth,
    lastMonth,
    byType,
    dailyStats,
    recentMessages,
    totalRecovered,
  } = useLoaderData();

  const [view, setView] = useState("overview");

  const sentDelta = lastMonth.sent
    ? Math.round(((thisMonth.sent - lastMonth.sent) / lastMonth.sent) * 100)
    : 0;

  const formatType = (type) =>
    type
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  const statusBadge = (status) => {
    const tones = {
      sent: "success",
      failed: "critical",
      queued: "attention",
      limit_reached: "warning",
    };
    return <Badge tone={tones[status] || undefined}>{status}</Badge>;
  };

  const dailyRows = dailyStats.map((d) => [
    d.date,
    d.messagesSent,
    d.messagesFailed,
    d.abandonedCartsSent,
    d.abandonedCartsRecovered,
  ]);

  const messageRows = recentMessages.map((m) => [
    new Date(m.createdAt).toLocaleString(),
    formatType(m.messageType),
    m.recipientName || m.recipientPhone,
    m.recipientPhone,
    statusBadge(m.status),
    m.orderId || "—",
  ]);

  return (
    <Page
      title="Analytics"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Messages Sent</Text>
                <Text as="p" variant="headingXl">{thisMonth.sent}</Text>
                {sentDelta !== 0 && (
                  <Text
                    as="p"
                    variant="bodySm"
                    tone={sentDelta >= 0 ? "success" : "critical"}
                  >
                    {sentDelta >= 0 ? "+" : ""}{sentDelta}% vs last month
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Failed</Text>
                <Text as="p" variant="headingXl" tone="critical">
                  {thisMonth.failed}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">In Queue</Text>
                <Text as="p" variant="headingXl">{thisMonth.queued}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Carts Recovered</Text>
                <Text as="p" variant="headingXl" tone="success">
                  {totalRecovered}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Messages by Type (This Month)</Text>
            <InlineStack gap="400" wrap>
              {Object.entries(byType).map(([type, count]) => (
                <Box
                  key={type}
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="200"
                >
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {formatType(type)}
                    </Text>
                    <Text as="p" variant="headingMd">{count}</Text>
                  </BlockStack>
                </Box>
              ))}
              {Object.keys(byType).length === 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  No messages sent this month yet.
                </Text>
              )}
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                {view === "overview" ? "Daily Breakdown (Last 30 Days)" : "Recent Messages"}
              </Text>
              <Select
                label=""
                labelHidden
                options={[
                  { label: "Daily Overview", value: "overview" },
                  { label: "Recent Messages", value: "messages" },
                ]}
                value={view}
                onChange={setView}
              />
            </InlineStack>

            {view === "overview" ? (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                headings={["Date", "Sent", "Failed", "Cart Recovery Sent", "Carts Recovered"]}
                rows={dailyRows}
                footerContent={`${dailyStats.length} days shown`}
              />
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                headings={["Time", "Type", "Recipient", "Phone", "Status", "Order"]}
                rows={messageRows}
                footerContent={`${recentMessages.length} most recent messages`}
              />
            )}
          </BlockStack>
        </Card>

        {thisMonth.limitReached > 0 && (
          <Banner
            title={`${thisMonth.limitReached} messages blocked by plan limit`}
            tone="warning"
            action={{ content: "Upgrade Plan", url: "/app/billing" }}
          >
            <p>Some messages couldn't be sent because your monthly limit was reached.</p>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}
