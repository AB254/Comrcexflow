import { useState } from "react";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  AppProvider,
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";

import { login } from "../../shopify.server";

export const loader = async ({ request }) => {
  const errors = login(request);
  return json({ errors, polarisTranslations });
};

export const action = async ({ request }) => {
  const errors = await login(request);
  return json({ errors });
};

export default function Auth() {
  const { polarisTranslations } = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const hasError = actionData?.errors?.shop;

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page narrowWidth>
        <Card>
          <Form method="post">
            <FormLayout>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="e.g: my-shop.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={hasError}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
        {hasError && (
          <Banner tone="critical">
            <p>{actionData.errors.shop}</p>
          </Banner>
        )}
      </Page>
    </AppProvider>
  );
}
