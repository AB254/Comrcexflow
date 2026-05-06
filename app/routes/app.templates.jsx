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
  Checkbox,
  Divider,
  Collapsible,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const TEMPLATE_CONFIGS = [
  {
    key: "orderConfirmation",
    label: "Order Confirmation",
    description: "Sent when a new order is placed",
    templateField: "orderConfirmationTemplate",
    enabledField: "orderConfirmationEnabled",
    variables: [
      "customer_name",
      "customer_first_name",
      "order_number",
      "total_price",
      "currency",
      "items_summary",
      "shipping_address",
      "shop_name",
    ],
  },
  {
    key: "abandonedCheckout",
    label: "Abandoned Checkout Recovery",
    description: "Sent 15 minutes after a checkout is abandoned",
    templateField: "abandonedCheckoutTemplate",
    enabledField: "abandonedCheckoutEnabled",
    variables: [
      "customer_name",
      "customer_first_name",
      "checkout_link",
      "total_price",
      "currency",
      "items_summary",
      "item_count",
    ],
  },
  {
    key: "orderFulfillment",
    label: "Order Fulfillment",
    description: "Sent when an order is shipped/fulfilled",
    templateField: "orderFulfillmentTemplate",
    enabledField: "orderFulfillmentEnabled",
    variables: [
      "customer_name",
      "customer_first_name",
      "order_number",
      "tracking_url",
      "tracking_number",
      "items_summary",
      "shop_name",
    ],
  },
  {
    key: "orderCancellation",
    label: "Order Cancellation",
    description: "Sent when an order is cancelled",
    templateField: "orderCancellationTemplate",
    enabledField: "orderCancellationEnabled",
    variables: [
      "customer_name",
      "customer_first_name",
      "order_number",
      "total_price",
      "currency",
      "shop_name",
    ],
  },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!storeSettings) {
    storeSettings = await prisma.storeSettings.create({ data: { shop } });
  }

  return json({ storeSettings });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const updateData = {};

  for (const config of TEMPLATE_CONFIGS) {
    const templateValue = formData.get(config.templateField);
    const enabledValue = formData.get(config.enabledField);

    if (templateValue !== null) {
      updateData[config.templateField] = templateValue;
    }
    updateData[config.enabledField] = enabledValue === "true";
  }

  await prisma.storeSettings.upsert({
    where: { shop },
    update: updateData,
    create: { shop, ...updateData },
  });

  return json({ success: true, message: "Templates saved successfully!" });
};

export default function Templates() {
  const { storeSettings } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [templates, setTemplates] = useState(
    TEMPLATE_CONFIGS.reduce((acc, config) => {
      acc[config.templateField] = storeSettings[config.templateField] || "";
      acc[config.enabledField] = storeSettings[config.enabledField] ?? true;
      return acc;
    }, {})
  );

  const [expandedSections, setExpandedSections] = useState(
    TEMPLATE_CONFIGS.reduce((acc, config) => {
      acc[config.key] = true;
      return acc;
    }, {})
  );

  const [saved, setSaved] = useState(false);

  const handleTemplateChange = useCallback((field, value) => {
    setTemplates((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }, []);

  const toggleSection = useCallback((key) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(templates)) {
      formData.append(key, String(value));
    }
    submit(formData, { method: "POST" });
    setSaved(true);
  }, [templates, submit]);

  return (
    <Page
      title="Message Templates"
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{
        content: "Save All Templates",
        onAction: handleSave,
        loading: isSaving,
      }}
    >
      <BlockStack gap="500">
        {saved && navigation.state === "idle" && (
          <Banner title="Templates saved!" tone="success" onDismiss={() => setSaved(false)} />
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Available Variables</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Use these variables in your templates. They will be replaced with actual values when the message is sent.
            </Text>
            <InlineStack gap="200" wrap>
              {[
                "customer_name", "customer_first_name", "order_number",
                "total_price", "currency", "items_summary", "checkout_link",
                "tracking_url", "tracking_number", "shipping_address", "shop_name", "item_count",
              ].map((v) => (
                <Badge key={v} tone="info">{`{{${v}}}`}</Badge>
              ))}
            </InlineStack>
          </BlockStack>
        </Card>

        {TEMPLATE_CONFIGS.map((config) => (
          <Card key={config.key}>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Button
                    variant="plain"
                    onClick={() => toggleSection(config.key)}
                  >
                    {expandedSections[config.key] ? "▼" : "▶"} {config.label}
                  </Button>
                  <Badge tone={templates[config.enabledField] ? "success" : undefined}>
                    {templates[config.enabledField] ? "Active" : "Disabled"}
                  </Badge>
                </InlineStack>
                <Checkbox
                  label="Enabled"
                  labelHidden
                  checked={templates[config.enabledField]}
                  onChange={(checked) =>
                    handleTemplateChange(config.enabledField, checked)
                  }
                />
              </InlineStack>

              <Collapsible open={expandedSections[config.key]}>
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {config.description}
                  </Text>

                  <TextField
                    label="Message Template"
                    value={templates[config.templateField]}
                    onChange={(value) =>
                      handleTemplateChange(config.templateField, value)
                    }
                    multiline={4}
                    autoComplete="off"
                    helpText={`Available: ${config.variables.map((v) => `{{${v}}}`).join(", ")}`}
                  />

                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">Preview:</Text>
                      <Text as="p" variant="bodySm">
                        {templates[config.templateField]
                          .replace(/\{\{customer_name\}\}/g, "John Doe")
                          .replace(/\{\{customer_first_name\}\}/g, "John")
                          .replace(/\{\{order_number\}\}/g, "1042")
                          .replace(/\{\{total_price\}\}/g, "59.99")
                          .replace(/\{\{currency\}\}/g, "USD")
                          .replace(/\{\{items_summary\}\}/g, "Blue T-Shirt x1, Jeans x2")
                          .replace(/\{\{checkout_link\}\}/g, "https://your-store.com/recover/abc123")
                          .replace(/\{\{tracking_url\}\}/g, "https://track.carrier.com/ABC123")
                          .replace(/\{\{tracking_number\}\}/g, "ABC123456")
                          .replace(/\{\{shipping_address\}\}/g, "123 Main St, City")
                          .replace(/\{\{shop_name\}\}/g, "My Store")
                          .replace(/\{\{item_count\}\}/g, "3")}
                      </Text>
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
        ))}
      </BlockStack>
    </Page>
  );
}
