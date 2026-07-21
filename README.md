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
3. アプリをインストール
4. **Settings** ページで **Client ID** と **Client Secret** を控える

> 2026年1月以降、Dev Dashboardで新規作成したカスタムアプリは画面上に固定のAdmin API access token(`shpat_`)が表示されません。代わりにClient ID / Client Secretが表示され、これらを使ってプログラム側でトークンを取得する **Client Credentials Grant** という方式に変わっています。本リポジトリのスクリプトはこの方式に対応済みです。

### 2. メタフィールド定義の作成

商品向けに以下の定義を追加します(**設定 → カスタムデータ → 商品**)。

| Namespace and key | Type | 用途 |
|---|---|---|
| `custom.release_date` | Date and time | 販売を開始する日時 |
| `custom.release_processed` | True or false | 処理済みかどうかのフラグ(初期値 `false`) |

### 3. 商品の初期設定

- 商品ステータス: **有効(Active)**
- 各バリアントの在庫数量: **0**
- 各バリアントの「在庫切れの場合でも販売を続ける」: **オフ**(`inventoryPolicy: DENY`)
- `custom.release_date` に販売開始日時(UTC推奨)をセット

### 4. ロケーションIDの取得

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
| `SHOPIFY_CLIENT_ID` | Dev DashboardのSettingsページに表示されるClient ID |
| `SHOPIFY_CLIENT_SECRET` | 同ページに表示されるClient Secret |
| `SHOPIFY_LOCATION_ID` | `gid://shopify/Location/xxxx` |

## 在庫数量の管理

`config/release-stock.json` で、商品ごとに公開時に投入する在庫数を管理します。

```json
{
  "default": 10,
  "overrides": {
    "gid://shopify/Product/xxxx": 25
  }
}
```

- `default`: 個別指定のない商品に適用される在庫数
- `overrides`: 商品ID(gid)をキーにした個別の在庫数

## ローカルでの動作確認

```bash
export SHOPIFY_SHOP=your-shop.myshopify.com
export SHOPIFY_CLIENT_ID=xxxx
export SHOPIFY_CLIENT_SECRET=shpss_xxxx
export SHOPIFY_LOCATION_ID=gid://shopify/Location/xxxx

npm run release
```

## 動作の流れ

1. GitHub Actionsが15分おきに起動(`workflow_dispatch` で手動実行も可能)
2. Client Credentials Grantでアクセストークンを取得(`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` を使用、有効期限24時間)
3. `status:active` かつ `release_processed != true` の商品を検索
4. `release_date` <= 現在時刻の商品を抽出
5. `config/release-stock.json` の数量で在庫を設定(`inventorySetQuantities`)
6. 成功した商品には `release_processed = true` を設定し、二重処理を防止

## 注意点

- GitHub Actionsの`schedule`は負荷状況により数分の遅延が発生することがあります。秒単位の厳密な予約公開が必要な場合は、AWS EventBridgeなど精度の高いスケジューラの利用を検討してください。
- `release_date`はUTCで統一して運用することを推奨します。
- ストアフロントやCDNのキャッシュにより、在庫反映まで数分のタイムラグが出る場合があります。
- 対象商品数が多い場合はGraphQLのレート制限に注意し、必要に応じてページネーションやリトライ処理を追加してください。
- Client Credentials Grantは**自社が所有するストアにインストールした自社アプリ**でのみ利用可能です。`shop_not_permitted` エラーが出る場合は、アプリとストアが同じ組織に属しているか確認してください。
- Client Secretは非常に機密性の高い情報です。リポジトリに直接コミットせず、必ずGitHub Secrets経由で渡してください。
