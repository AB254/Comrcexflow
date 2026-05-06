export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    messageLimit: 50,
    trialDays: 0,
  },
  starter: {
    name: "Starter",
    price: 4.99,
    messageLimit: 1250,
    trialDays: 3,
  },
  growth: {
    name: "Growth",
    price: 9.99,
    messageLimit: 2500,
    trialDays: 3,
  },
  professional: {
    name: "Professional",
    price: 14.99,
    messageLimit: 4250,
    trialDays: 3,
  },
};

export function getPlanLimit(planName) {
  return PLANS[planName]?.messageLimit || 50;
}

export function canSendMessage(storeSettings) {
  if (storeSettings.isBillingBypassed) return true;
  const limit = getPlanLimit(storeSettings.billingPlan);
  return storeSettings.monthlyMessageCount < limit;
}

export const ORDER_TAGS = {
  order_confirmation: "WA_Confirmed",
  abandoned_checkout: "WA_CartRecovery",
  order_fulfillment: "WA_Fulfilled",
  order_cancellation: "WA_Cancelled",
};
