const shop = process.env.SHOPIFY_STORE;
const token = process.env.SHOPIFY_TOKEN;

async function main() {
  const response = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: `
          {
            shop {
              name
              email
            }
          }
        `,
    }),
  });

  const data = await response.json();

  console.log(data);
}

main();
