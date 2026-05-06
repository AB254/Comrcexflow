import prisma from "../db.server.js";
import { PLANS } from "../utils/plans.js";

export async function createSubscription(admin, shop, planKey) {
  const plan = PLANS[planKey];
  if (!plan || planKey === "free") {
    await prisma.storeSettings.upsert({
      where: { shop },
      update: {
        billingPlan: "free",
        billingSubscriptionId: null,
      },
      create: { shop, billingPlan: "free" },
    });
    return { confirmationUrl: null, plan: "free" };
  }

  const response = await admin.graphql(
    `#graphql
    mutation appSubscriptionCreate(
      $name: String!
      $lineItems: [AppSubscriptionLineItemInput!]!
      $returnUrl: URL!
      $trialDays: Int
      $test: Boolean
    ) {
      appSubscriptionCreate(
        name: $name
        lineItems: $lineItems
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: $test
      ) {
        appSubscription {
          id
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        name: `ComrcexFlow ${plan.name} Plan`,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: {
                  amount: plan.price,
                  currencyCode: "USD",
                },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
        returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing/callback?plan=${planKey}`,
        trialDays: plan.trialDays,
        test: process.env.NODE_ENV !== "production",
      },
    }
  );

  const result = await response.json();
  const data = result.data.appSubscriptionCreate;

  if (data.userErrors?.length) {
    console.error("[Billing] Subscription creation errors:", data.userErrors);
    throw new Error(data.userErrors.map((e) => e.message).join(", "));
  }

  return {
    confirmationUrl: data.confirmationUrl,
    subscriptionId: data.appSubscription.id,
  };
}

export async function getActiveSubscription(admin) {
  const response = await admin.graphql(
    `#graphql
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          currentPeriodEnd
          trialDays
          lineItems {
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  price {
                    amount
                    currencyCode
                  }
                  interval
                }
              }
            }
          }
        }
      }
    }`
  );

  const result = await response.json();
  const subscriptions =
    result.data.currentAppInstallation.activeSubscriptions || [];

  return subscriptions.length > 0 ? subscriptions[0] : null;
}

export async function cancelSubscription(admin, subscriptionId) {
  const response = await admin.graphql(
    `#graphql
    mutation appSubscriptionCancel($id: ID!) {
      appSubscriptionCancel(id: $id) {
        appSubscription {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: { id: subscriptionId },
    }
  );

  const result = await response.json();
  const data = result.data.appSubscriptionCancel;

  if (data.userErrors?.length) {
    throw new Error(data.userErrors.map((e) => e.message).join(", "));
  }

  return data.appSubscription;
}

export async function handleBillingCallback(shop, planKey, chargeId) {
  await prisma.storeSettings.upsert({
    where: { shop },
    update: {
      billingPlan: planKey,
      billingSubscriptionId: chargeId || null,
      monthlyMessageCount: 0,
      billingCycleStart: new Date(),
    },
    create: {
      shop,
      billingPlan: planKey,
      billingSubscriptionId: chargeId || null,
      monthlyMessageCount: 0,
      billingCycleStart: new Date(),
    },
  });
}

export async function resetMonthlyCounts() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const storesNeedingReset = await prisma.storeSettings.findMany({
    where: {
      billingCycleStart: { lte: thirtyDaysAgo },
    },
  });

  for (const store of storesNeedingReset) {
    await prisma.storeSettings.update({
      where: { shop: store.shop },
      data: {
        monthlyMessageCount: 0,
        billingCycleStart: new Date(),
      },
    });
  }

  return storesNeedingReset.length;
}

export async function validateBypassKey(shop, inputKey) {
  const masterKey = process.env.MASTER_BYPASS_KEY;
  if (!masterKey) return false;

  const isValid = inputKey === masterKey;

  if (isValid) {
    await prisma.storeSettings.upsert({
      where: { shop },
      update: {
        isBillingBypassed: true,
        bypassKeyHash: inputKey.substring(0, 8) + "***",
      },
      create: {
        shop,
        isBillingBypassed: true,
        bypassKeyHash: inputKey.substring(0, 8) + "***",
      },
    });
  }

  return isValid;
}

export async function removeBypass(shop) {
  await prisma.storeSettings.update({
    where: { shop },
    data: {
      isBillingBypassed: false,
      bypassKeyHash: null,
    },
  });
}
