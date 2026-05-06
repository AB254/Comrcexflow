import { useState, useCallback } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Banner,
  Badge,
  Divider,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { validateBypassKey, removeBypass } from "../services/billing.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!storeSettings) {
    storeSettings = await prisma.storeSettings.create({ data: { shop } });
  }

  return json({
    shop,
    isBypassed: storeSettings.isBillingBypassed,
    bypassKeyHash: storeSettings.bypassKeyHash,
    billingPlan: storeSettings.billingPlan,
    isWhatsAppConnected: false,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "validate_key") {
    const key = formData.get("bypass_key");
    if (!key || key.trim().length === 0) {
      return json({ error: "Please enter a key" });
    }

    const isValid = await validateBypassKey(shop, key.trim());
    if (isValid) {
      return json({
        success: true,
        message: "Developer key validated! Billing has been bypassed. You now have unlimited messages.",
      });
    }
    return json({ error: "Invalid developer key. Please check and try again." });
  }

  if (intent === "remove_bypass") {
    await removeBypass(shop);
    return json({
      success: true,
      message: "Developer bypass removed. Normal billing has been restored.",
    });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function Settings() {
  const data = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [bypassKey, setBypassKey] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [isBypassed, setIsBypassed] = useState(data.isBypassed);

  const handleValidateKey = useCallback(() => {
    setFeedback(null);
    const formData = new FormData();
    formData.append("intent", "validate_key");
    formData.append("bypass_key", bypassKey);
    submit(formData, { method: "POST" });
  }, [bypassKey, submit]);

  const handleRemoveBypass = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "remove_bypass");
    submit(formData, { method: "POST" });
  }, [submit]);

  return (
    <Page
      title="Settings"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Agency / Developer Key
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  If you have an agency or developer key, enter it below to
                  unlock unlimited messages and bypass billing. This is intended
                  for authorized agencies and development partners.
                </Text>

                <Divider />

                {isBypassed || data.isBypassed ? (
                  <BlockStack gap="300">
                    <Banner title="Developer Bypass Active" tone="success">
                      <p>
                        Your developer key is active. You have unlimited messages
                        with no billing charges.
                      </p>
                    </Banner>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Key: {data.bypassKeyHash || "***"}
                      </Text>
                      <Badge tone="success">Verified</Badge>
                    </InlineStack>
                    <Button
                      tone="critical"
                      onClick={handleRemoveBypass}
                      loading={isSubmitting}
                    >
                      Remove Developer Key
                    </Button>
                  </BlockStack>
                ) : (
                  <BlockStack gap="300">
                    <TextField
                      label="Developer Key"
                      type="password"
                      value={bypassKey}
                      onChange={setBypassKey}
                      autoComplete="off"
                      placeholder="Enter your agency/developer key"
                      connectedRight={
                        <Button
                          variant="primary"
                          onClick={handleValidateKey}
                          loading={isSubmitting}
                          disabled={!bypassKey.trim()}
                        >
                          Validate Key
                        </Button>
                      }
                    />
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Store Info</Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">Shop</Text>
                      <Text as="span">{data.shop}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">Plan</Text>
                      <Badge>
                        {data.isBypassed
                          ? "Unlimited"
                          : data.billingPlan.charAt(0).toUpperCase() +
                            data.billingPlan.slice(1)}
                      </Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">Billing</Text>
                      <Badge tone={data.isBypassed ? "success" : "info"}>
                        {data.isBypassed ? "Bypassed" : "Active"}
                      </Badge>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Quick Links</Text>
                  <BlockStack gap="200">
                    <Button url="/app/whatsapp" fullWidth>
                      WhatsApp Connection
                    </Button>
                    <Button url="/app/templates" fullWidth>
                      Message Templates
                    </Button>
                    <Button url="/app/billing" fullWidth>
                      Manage Billing
                    </Button>
                    <Button url="/app/analytics" fullWidth>
                      View Analytics
                    </Button>
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
