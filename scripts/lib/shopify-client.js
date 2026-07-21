const API_VERSION = "2026-07";

/**
 * Shopify Admin GraphQL API に対してクエリ/ミューテーションを実行する
 * @param {string} query - GraphQLクエリまたはミューテーション文字列
 * @param {object} variables - GraphQL変数
 * @returns {Promise<object>} data フィールドの中身
 */
export async function shopifyGraphQL(query, variables = {}) {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!shop || !token) {
    throw new Error(
      "環境変数 SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN が設定されていません。"
    );
  }

  const res = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API request failed: ${res.status} ${text}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}
