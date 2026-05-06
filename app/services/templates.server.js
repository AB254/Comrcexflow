const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

export function renderTemplate(template, variables) {
  return template.replace(VARIABLE_PATTERN, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}

export function extractOrderVariables(payload) {
  const customer = payload.customer || {};
  const shippingAddress = payload.shipping_address || customer.default_address || {};

  return {
    customer_name: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "Customer",
    customer_first_name: customer.first_name || "Customer",
    customer_last_name: customer.last_name || "",
    customer_email: customer.email || payload.email || "",
    customer_phone: customer.phone || shippingAddress.phone || payload.phone || "",
    order_number: payload.order_number || payload.name || "",
    order_name: payload.name || "",
    order_id: String(payload.id || ""),
    total_price: payload.total_price || "0.00",
    subtotal_price: payload.subtotal_price || "0.00",
    total_tax: payload.total_tax || "0.00",
    currency: payload.currency || "USD",
    financial_status: payload.financial_status || "",
    fulfillment_status: payload.fulfillment_status || "unfulfilled",
    shipping_address: formatAddress(shippingAddress),
    item_count: String(payload.line_items?.length || 0),
    items_summary: formatLineItems(payload.line_items || []),
    shop_name: payload.shop_name || "",
    tracking_url: extractTrackingUrl(payload),
    tracking_number: extractTrackingNumber(payload),
  };
}

export function extractCheckoutVariables(payload) {
  const customer = payload.customer || {};

  return {
    customer_name: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "Customer",
    customer_first_name: customer.first_name || "Customer",
    customer_email: customer.email || payload.email || "",
    customer_phone: customer.phone || payload.phone || "",
    checkout_link: payload.abandoned_checkout_url || payload.recovery_url || "",
    total_price: payload.total_price || "0.00",
    currency: payload.currency || "USD",
    item_count: String(payload.line_items?.length || 0),
    items_summary: formatLineItems(payload.line_items || []),
  };
}

function formatAddress(addr) {
  if (!addr) return "";
  return [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country]
    .filter(Boolean)
    .join(", ");
}

function formatLineItems(items) {
  if (!items.length) return "No items";
  return items
    .slice(0, 5)
    .map((item) => `${item.title || item.name} x${item.quantity}`)
    .join(", ") + (items.length > 5 ? ` +${items.length - 5} more` : "");
}

function extractTrackingUrl(payload) {
  const fulfillment = payload.fulfillments?.[0];
  return fulfillment?.tracking_url || fulfillment?.tracking_urls?.[0] || "";
}

function extractTrackingNumber(payload) {
  const fulfillment = payload.fulfillments?.[0];
  return fulfillment?.tracking_number || fulfillment?.tracking_numbers?.[0] || "";
}
