# shopify-scheduled-release

Shopifyの商品を **公開状態のまま在庫0** で登録しておき、`custom.release_date` メタフィールドで指定した日時になったら
GitHub Actionsが自動的に在庫数を解放して販売を開始する仕組みです。

## 事前準備(Shopify側)

### 1. カスタムアプリの作成

1. Shopify管理画面 → **設定 → アプリと販売チャネル → アプリを開発する**(Dev Dashboard)
2. アプリを作成し、以下のAccess scopesを設定
   - `read_products`, `write_products`
   - `read_inventory`, `write_inventory`
   - `read_locations`
3. アプリの **URLs** 設定で、以下を追加
   - App URL: 任意のプレースホルダー(例 `https://example.com`)で構いません
   - Allowed redirection URL(s): `http://localhost:3000/callback`
4. アプリをインストール
5. **Settings** ページで **Client ID** と **Client Secret** を控える

> **本番ストアでの重要な注意点**: Dev Dashboardで作成したアプリは、Client ID/Secretを使った「Client Credentials Grant」でも直接アクセストークンを取得できますが、この方式は**開発ストア(Dev store)専用**です。実際に販売している本番ストアに対して使うと `shop_not_permitted` エラーになります。本番ストアでは、次の手順で「Authorization Code Grant」を使い、**有効期限のないオフラインアクセストークン**を取得する必要があります。

### 2. オフラインアクセストークンの取得(初回のみ)

ローカル環境で、Client ID/Secretを使って1度だけ認可フローを実行し、`SHOPIFY_ADMIN_TOKEN` に設定する値を取得します。

```bash
export SHOPIFY_SHOP=your-shop.myshopify.com
export SHOPIFY_CLIENT_ID=xxxx
export SHOPIFY_CLIENT_SECRET=shpss_xxxx

npm install
npm run setup:token
```

1. ターミナルに表示されたURLをブラウザで開く
2. 対象ストアにログインした状態で、アプリの許可を承認する
3. 自動的にローカルサーバーがコールバックを受け取り、ターミナルにアクセストークンが表示される
4. 表示された値(`shpat_...`)をコピーしておく(この後GitHub Secretsに登録します)

このトークンには有効期限がなく、以前の管理画面から直接発行していた`shpat_`トークンと同じように使えます。

### 3. メタフィールド定義の作成

商品向けに以下の定義を追加します(**設定 → カスタムデータ → 商品**)。

| Namespace and key | Type | 用途 |
|---|---|---|
| `custom.release_date` | Date and time | 販売を開始する日時 |
| `custom.release_processed` | True or false | 処理済みかどうかのフラグ(初期値 `false`) |
| `custom.release_stock` | Integer(整数) | 公開時に投入する在庫数(未設定の場合は`DEFAULT_RELEASE_STOCK`を使用) |

### 4. 商品の初期設定

- 商品ステータス: **有効(Active)**
- 各バリアントの在庫数量: **0**
- 各バリアントの「在庫切れの場合でも販売を続ける」: **オフ**(`inventoryPolicy: DENY`)
- `custom.release_date` に販売開始日時(UTC推奨)をセット

### 5. ロケーションIDの取得

Admin GraphQL APIで以下を1度実行し、在庫を持たせたいロケーションのIDを控えます。

```graphql
query {
  locations(first: 10) {
    edges { node { id name } }
  }
}
```

## GitHubリポジトリの設定

**Settings → Secrets and variables → Actions** に以下を登録してください。

| Secret名 | 内容 |
|---|---|
| `SHOPIFY_SHOP` | `your-shop.myshopify.com` |
| `SHOPIFY_ADMIN_TOKEN` | 手順2で取得したオフラインアクセストークン |
| `SHOPIFY_LOCATION_ID` | `gid://shopify/Location/xxxx` |

> `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` はGitHub Actions側では使いません(ローカルでの初回トークン取得のみに使用)。ただし、トークンを失効・再発行したくなった場合に備えて、安全な場所に控えておくことをおすすめします。

## 在庫数量の管理

商品ごとの在庫数は、**Shopify管理画面の商品編集画面から直接設定**します。

1. 対象商品の編集画面を開く
2. メタフィールドのセクションで `release_stock` に、公開時に投入したい数量(整数)を入力
3. 保存

`release_stock` を設定していない商品は、GitHub ActionsのSecrets(または環境変数)`DEFAULT_RELEASE_STOCK` の値が使われます(未設定の場合はスクリプト内のデフォルト値 `10`)。

デフォルト値を変更したい場合は、`.github/workflows/release-scheduled.yml` の `DEFAULT_RELEASE_STOCK` を書き換えてください。

```yaml
env:
  DEFAULT_RELEASE_STOCK: "10"   # ここを変更
```

## ローカルでの動作確認

```bash
export SHOPIFY_SHOP=your-shop.myshopify.com
export SHOPIFY_ADMIN_TOKEN=shpat_xxxx
export SHOPIFY_LOCATION_ID=gid://shopify/Location/xxxx

npm run release
```

## 動作の流れ

1. GitHub Actionsが15分おきに起動(`workflow_dispatch` で手動実行も可能)
2. `SHOPIFY_ADMIN_TOKEN`(オフラインアクセストークン)を使ってShopify Admin GraphQL APIを呼び出す
3. `status:active` かつ `release_processed != true` の商品を検索
4. `release_date` <= 現在時刻の商品を抽出
5. 各商品の `release_stock` メタフィールド(未設定なら `DEFAULT_RELEASE_STOCK`)の数量で在庫を設定(`inventorySetQuantities`)
6. 成功した商品には `release_processed = true` を設定し、二重処理を防止

## 注意点

- GitHub Actionsの`schedule`は負荷状況により数分の遅延が発生することがあります。秒単位の厳密な予約公開が必要な場合は、AWS EventBridgeなど精度の高いスケジューラの利用を検討してください。
- `release_date`はUTCで統一して運用することを推奨します。
- ストアフロントやCDNのキャッシュにより、在庫反映まで数分のタイムラグが出る場合があります。
- 対象商品数が多い場合はGraphQLのレート制限に注意し、必要に応じてページネーションやリトライ処理を追加してください。
- `SHOPIFY_ADMIN_TOKEN`(オフラインアクセストークン)には有効期限がありませんが、アプリを削除・再インストールしたりスコープを変更したりすると無効になります。その場合は`npm run setup:token`を再実行してください。
- Client Secretおよびアクセストークンは非常に機密性の高い情報です。リポジトリに直接コミットせず、必ずGitHub Secrets経由で渡してください。
