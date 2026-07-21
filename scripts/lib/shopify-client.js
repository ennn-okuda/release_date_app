const API_VERSION = "2026-07";

// プロセス内でアクセストークンを使い回すためのキャッシュ
// (GitHub Actions は1回の実行で終わるジョブなので、実行のたびに取得し直す想定)
let cachedToken = null;

/**
 * Client Credentials Grant でShopifyのアクセストークンを取得する
 * トークンは約24時間で失効するため、実行ごとに取得し直す
 * @returns {Promise<string>} access_token
 */
async function fetchAccessToken() {
  const shop = process.env.SHOPIFY_SHOP;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!shop || !clientId || !clientSecret) {
    throw new Error(
      "環境変数 SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET が設定されていません。"
    );
  }

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`アクセストークンの取得に失敗しました: ${res.status} ${text}`);
  }

  const json = await res.json();
  return json.access_token;
}

async function getAccessToken() {
  if (!cachedToken) {
    cachedToken = await fetchAccessToken();
  }
  return cachedToken;
}

/**
 * Shopify Admin GraphQL API に対してクエリ/ミューテーションを実行する
 * @param {string} query - GraphQLクエリまたはミューテーション文字列
 * @param {object} variables - GraphQL変数
 * @returns {Promise<object>} data フィールドの中身
 */
export async function shopifyGraphQL(query, variables = {}) {
  const shop = process.env.SHOPIFY_SHOP;
  const token = await getAccessToken();

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
