import { useState, useCallback } from "react";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
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
  ProgressBar,
  Divider,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS } from "../utils/plans";
import {
  createSubscription,
  getActiveSubscription,
  cancelSubscription,
} from "../services/billing.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!storeSettings) {
    storeSettings = await prisma.storeSettings.create({ data: { shop } });
  }

  let activeSubscription = null;
  try {
    activeSubscription = await getActiveSubscription(admin);
  } catch {}

  return json({
    shop,
    currentPlan: storeSettings.billingPlan,
    monthlyUsage: storeSettings.monthlyMessageCount,
    isBypassed: storeSettings.isBillingBypassed,
    billingCycleStart: storeSettings.billingCycleStart,
    activeSubscription: activeSubscription
      ? {
          id: activeSubscription.id,
          name: activeSubscription.name,
          status: activeSubscription.status,
          currentPeriodEnd: activeSubscription.currentPeriodEnd,
        }
      : null,
    plans: PLANS,
  });
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "subscribe") {
    const planKey = formData.get("plan");
    if (planKey === "free") {
      const storeSettings = await prisma.storeSettings.findUnique({
        where: { shop },
      });
      if (storeSettings?.billingSubscriptionId) {
        try {
          await cancelSubscription(admin, storeSettings.billingSubscriptionId);
        } catch {}
      }
      await prisma.storeSettings.upsert({
        where: { shop },
        update: { billingPlan: "free", billingSubscriptionId: null },
        create: { shop, billingPlan: "free" },
      });
      return json({ success: true, message: "Downgraded to Free plan" });
    }

    const result = await createSubscription(admin, shop, planKey);
    if (result.confirmationUrl) {
      return redirect(result.confirmationUrl);
    }
    return json({ success: true });
  }

  if (intent === "cancel") {
    const storeSettings = await prisma.storeSettings.findUnique({
      where: { shop },
    });
    if (storeSettings?.billingSubscriptionId) {
      await cancelSubscription(admin, storeSettings.billingSubscriptionId);
      await prisma.storeSettings.update({
        where: { shop },
        data: { billingPlan: "free", billingSubscriptionId: null },
      });
    }
    return json({ success: true, message: "Subscription cancelled" });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function Billing() {
  const data = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const currentPlanConfig = data.plans[data.currentPlan] || data.plans.free;
  const usagePercent = data.isBypassed
    ? 0
    : Math.min(
        100,
        Math.round((data.monthlyUsage / currentPlanConfig.messageLimit) * 100)
      );

  const handleSelectPlan = useCallback(
    (planKey) => {
      const formData = new FormData();
      formData.append("intent", "subscribe");
      formData.append("plan", planKey);
      submit(formData, { method: "POST" });
    },
    [submit]
  );

  const handleCancel = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "cancel");
    submit(formData, { method: "POST" });
  }, [submit]);

  return (
    <Page
      title="Billing & Plans"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        {data.isBypassed && (
          <Banner title="Developer Bypass Active" tone="success">
            <p>
              Billing is bypassed with a developer key. You have unlimited
              messages and no charges.
            </p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Current Plan</Text>
                <InlineStack gap="200">
                  <Text as="p" variant="headingLg">
                    {data.isBypassed
                      ? "Unlimited (Bypassed)"
                      : currentPlanConfig.name}
                  </Text>
                  <Badge tone="success">Active</Badge>
                </InlineStack>
              </BlockStack>
              {data.currentPlan !== "free" && !data.isBypassed && (
                <Button
                  tone="critical"
                  onClick={handleCancel}
                  loading={isSubmitting}
                >
                  Cancel Subscription
                </Button>
              )}
            </InlineStack>

            {!data.isBypassed && (
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodySm">Monthly Usage</Text>
                  <Text as="p" variant="bodySm">
                    {data.monthlyUsage} / {currentPlanConfig.messageLimit} messages
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={usagePercent}
                  tone={usagePercent >= 90 ? "critical" : "primary"}
                  size="small"
                />
                {usagePercent >= 90 && (
                  <Text as="p" variant="bodySm" tone="critical">
                    You&apos;re approaching your message limit. Consider upgrading.
                  </Text>
                )}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Text as="h2" variant="headingMd">Available Plans</Text>

        <Layout>
          {Object.entries(data.plans).map(([key, plan]) => {
            const isCurrent = key === data.currentPlan && !data.isBypassed;
            const isUpgrade =
              plan.price > (currentPlanConfig?.price || 0);
            const isDowngrade =
              plan.price < (currentPlanConfig?.price || 0) &&
              key !== data.currentPlan;

            return (
              <Layout.Section variant="oneQuarter" key={key}>
                <Card background={isCurrent ? "bg-surface-success" : undefined}>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text as="h3" variant="headingMd">{plan.name}</Text>
                        {isCurrent && <Badge tone="success">Current</Badge>}
                      </InlineStack>
                      <Text as="p" variant="headingXl">
                        {plan.price === 0 ? "Free" : `$${plan.price}`}
                        {plan.price > 0 && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            /month
                          </Text>
                        )}
                      </Text>
                    </BlockStack>

                    <Divider />

                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd">
                        {plan.messageLimit.toLocaleString()} messages/month
                      </Text>
                      {plan.trialDays > 0 && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {plan.trialDays}-day free trial
                        </Text>
                      )}
                      <Text as="p" variant="bodySm" tone="subdued">
                        All automation features
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Order tagging
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Analytics dashboard
                      </Text>
                    </BlockStack>

                    {!isCurrent && !data.isBypassed && (
                      <Button
                        variant={isUpgrade ? "primary" : undefined}
                        onClick={() => handleSelectPlan(key)}
                        loading={isSubmitting}
                        fullWidth
                      >
                        {isUpgrade
                          ? "Upgrade"
                          : isDowngrade
                          ? "Downgrade"
                          : "Select"}
                      </Button>
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>
      </BlockStack>
    </Page>
  );
}
