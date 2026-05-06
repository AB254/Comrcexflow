import { login } from "../shopify.server";

export const loader = async ({ request }) => {
  const errors = login(request);
  return errors;
};

export const action = async ({ request }) => {
  const errors = login(request);
  return errors;
};
