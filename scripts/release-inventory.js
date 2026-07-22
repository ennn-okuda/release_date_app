import { randomUUID } from "node:crypto";
import { shopifyGraphQL } from "./lib/shopify-client.js";

const LOCATION_ID = process.env.SHOPIFY_LOCATION_ID;
// custom.release_stock が未設定の商品に適用するデフォルト在庫数
const DEFAULT_RELEASE_STOCK = Number(process.env.DEFAULT_RELEASE_STOCK ?? 10);

const FIND_TARGETS_QUERY = `
  query getScheduledProducts($q: String!, $cursor: String) {
    products(first: 50, after: $cursor, query: $q) {
      edges {
        node {
          id
          releaseDate: metafield(namespace: "custom", key: "release_date") { value }
          processed: metafield(namespace: "custom", key: "release_processed") { value }
          releaseStock: metafield(namespace: "custom", key: "release_stock") { value }
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
  mutation setInventory($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
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

// custom.release_stock の値を数量として使う。未設定・不正値の場合はデフォルトにフォールバックする
function resolveStockQuantity(product) {
  const raw = product.releaseStock?.value;
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RELEASE_STOCK;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(
      `[warn] ${product.id} の release_stock が不正な値 (${raw}) のため、デフォルト値 ${DEFAULT_RELEASE_STOCK} を使用します。`
    );
    return DEFAULT_RELEASE_STOCK;
  }
  return parsed;
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
      `[debug]   ${p.id} releaseDate=${p.releaseDate.value} processed=${p.processed ? p.processed.value : "(未設定)"} releaseStock=${p.releaseStock ? p.releaseStock.value : "(未設定)"}`
    );
  }

  return allProducts.filter((product) => {
    if (!product.releaseDate) return false;
    if (product.processed && product.processed.value === "true") return false;
    return new Date(product.releaseDate.value) <= now;
  });
}

async function releaseInventory(product) {
  const stockQuantity = resolveStockQuantity(product);

  const quantities = product.variants.edges.map((edge) => ({
    inventoryItemId: edge.node.inventoryItem.id,
    locationId: LOCATION_ID,
    quantity: stockQuantity,
    // 比較チェックを行わず、常に絶対値で在庫を設定する(2026-01以降の仕様)
    changeFromQuantity: null,
  }));

  const result = await shopifyGraphQL(SET_INVENTORY_MUTATION, {
    input: {
      reason: "correction",
      name: "available",
      quantities,
    },
    idempotencyKey: randomUUID(),
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
  const targets = await findReleaseTargets(now);

  console.log(`対象商品: ${targets.length}件`);

  let successCount = 0;

  for (const product of targets) {
    const quantity = resolveStockQuantity(product);
    console.log(`在庫解放を実行中: ${product.id} (数量: ${quantity})`);
    const success = await releaseInventory(product);

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
