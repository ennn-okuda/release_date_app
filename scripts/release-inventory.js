import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { shopifyGraphQL } from "./lib/shopify-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCATION_ID = process.env.SHOPIFY_LOCATION_ID;

const FIND_TARGETS_QUERY = `
  query getScheduledProducts($q: String!, $cursor: String) {
    products(first: 50, after: $cursor, query: $q) {
      edges {
        node {
          id
          releaseDate: metafield(namespace: "custom", key: "release_date") { value }
          processed: metafield(namespace: "custom", key: "release_processed") { value }
          variants(first: 50) {
            edges { node { id inventoryItem { id } } }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const SET_INVENTORY_MUTATION = `
  mutation setInventory($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { field message }
    }
  }
`;

const MARK_PROCESSED_MUTATION = `
  mutation markProcessed($id: ID!) {
    productUpdate(
      input: {
        id: $id
        metafields: [
          { namespace: "custom", key: "release_processed", type: "boolean", value: "true" }
        ]
      }
    ) {
      userErrors { field message }
    }
  }
`;

async function loadStockConfig() {
  const configPath = path.join(__dirname, "..", "config", "release-stock.json");
  const raw = await readFile(configPath, "utf-8");
  return JSON.parse(raw);
}

function resolveStockQuantity(productId, stockConfig) {
  if (stockConfig.overrides && productId in stockConfig.overrides) {
    return stockConfig.overrides[productId];
  }
  return stockConfig.default ?? 0;
}

async function findReleaseTargets(now) {
  const allProducts = [];
  let cursor = null;
  let hasNextPage = true;
  let pageCount = 0;

  // status:active の商品を全ページ取得する(店舗の商品数が多くても漏れなく検索するため)
  while (hasNextPage) {
    const data = await shopifyGraphQL(FIND_TARGETS_QUERY, {
      q: "status:active",
      cursor,
    });

    pageCount += 1;
    allProducts.push(...data.products.edges.map((edge) => edge.node));
    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  console.log(`[debug] status:active の商品を ${pageCount} ページ、計 ${allProducts.length} 件取得しました。`);

  const withReleaseDate = allProducts.filter((p) => p.releaseDate);
  console.log(`[debug] release_date が設定されている商品: ${withReleaseDate.length} 件`);
  for (const p of withReleaseDate) {
    console.log(
      `[debug]   ${p.id} releaseDate=${p.releaseDate.value} processed=${p.processed ? p.processed.value : "(未設定)"}`
    );
  }

  return allProducts.filter((product) => {
    if (!product.releaseDate) return false;
    if (product.processed && product.processed.value === "true") return false;
    return new Date(product.releaseDate.value) <= now;
  });
}

async function releaseInventory(product, stockConfig) {
  const quantities = product.variants.edges.map((edge) => ({
    inventoryItemId: edge.node.inventoryItem.id,
    locationId: LOCATION_ID,
    quantity: resolveStockQuantity(product.id, stockConfig),
  }));

  const result = await shopifyGraphQL(SET_INVENTORY_MUTATION, {
    input: {
      reason: "correction",
      name: "available",
      ignoreCompareQuantity: true,
      quantities,
    },
  });

  const errors = result.inventorySetQuantities.userErrors;
  if (errors.length > 0) {
    console.error(`在庫更新エラー (${product.id}):`, errors);
    return false;
  }

  return true;
}

async function markAsProcessed(productId) {
  const result = await shopifyGraphQL(MARK_PROCESSED_MUTATION, { id: productId });
  const errors = result.productUpdate.userErrors;
  if (errors.length > 0) {
    console.error(`処理済みフラグ更新エラー (${productId}):`, errors);
  }
}

async function main() {
  if (!LOCATION_ID) {
    throw new Error("環境変数 SHOPIFY_LOCATION_ID が設定されていません。");
  }

  const now = new Date();
  const stockConfig = await loadStockConfig();
  const targets = await findReleaseTargets(now);

  console.log(`対象商品: ${targets.length}件`);

  let successCount = 0;

  for (const product of targets) {
    console.log(`在庫解放を実行中: ${product.id}`);
    const success = await releaseInventory(product, stockConfig);

    if (success) {
      await markAsProcessed(product.id);
      successCount += 1;
    }
  }

  console.log(`完了: ${successCount}/${targets.length}件の商品の在庫を解放しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
