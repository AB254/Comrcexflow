import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { handleBillingCallback } from "../services/billing.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const planKey = url.searchParams.get("plan") || "free";
  const chargeId = url.searchParams.get("charge_id");

  await handleBillingCallback(shop, planKey, chargeId);

  return redirect("/app/billing");
};
