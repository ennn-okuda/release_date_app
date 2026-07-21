/**
 * 初回セットアップ専用スクリプト。
 * Authorization Code Grant を使って、有効期限のないオフラインアクセストークンを取得する。
 * ローカルで1回だけ実行し、表示されたトークンを GitHub Secrets の SHOPIFY_ADMIN_TOKEN に登録する。
 *
 * 事前準備:
 *  - Dev Dashboardのアプリ設定で、Allowed redirection URL(s) に
 *    http://localhost:3000/callback を追加しておくこと
 *  - 環境変数 SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET を設定してから実行すること
 *
 * 実行方法:
 *  node scripts/setup/get-offline-token.js
 */
import http from "node:http";
import crypto from "node:crypto";

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/callback";
const SCOPES = "read_products,write_products,read_inventory,write_inventory,read_locations";
const PORT = 3000;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "環境変数 SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET を設定してから実行してください。"
  );
  process.exit(1);
}

const state = crypto.randomBytes(16).toString("hex");

const authUrl =
  `https://${SHOP}/admin/oauth/authorize?` +
  new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state,
  }).toString();

console.log("\n以下のURLをブラウザで開いて、アプリの許可を承認してください:\n");
console.log(authUrl);
console.log("\n承認すると、自動的にこのターミナルにアクセストークンが表示されます。\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const shop = url.searchParams.get("shop") || SHOP;

  if (!code || returnedState !== state) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("state が一致しないか、code がありません。もう一度スクリプトを実行してください。");
    server.close();
    return;
  }

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
      }),
    });

    const data = await tokenRes.json();

    if (!tokenRes.ok || !data.access_token) {
      console.error("トークン取得に失敗しました:", data);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("トークン取得に失敗しました。ターミナルのログを確認してください。");
      return;
    }

    console.log("\n取得成功。以下の値を GitHub Secrets の SHOPIFY_ADMIN_TOKEN に登録してください:\n");
    console.log(data.access_token);
    console.log("\nこのトークンには有効期限がありません(オフラインアクセストークン)。安全に保管してください。\n");

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("認証が完了しました。ターミナルに表示されたトークンをコピーしてください。このタブは閉じて構いません。");
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end("エラーが発生しました。ターミナルを確認してください。");
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log(`ローカルサーバーを起動しました (http://localhost:${PORT})`);
});
