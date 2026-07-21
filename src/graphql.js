import { getAccessToken } from "./auth.js";

const STORE = process.env.SHOPIFY_STORE;

export async function graphql(query, variables = {}) {
  const token = await getAccessToken();

  const response = await fetch(`https://${STORE}/admin/api/2026-07/graphql.json`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },

    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const json = await response.json();

  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }

  return json.data;
}
