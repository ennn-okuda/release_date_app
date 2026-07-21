# shopify-scheduled-release

Shopifyの商品を **公開状態のまま在庫0** で登録しておき、`custom.release_date` メタフィールドで指定した日時になったら
GitHub Actionsが自動的に在庫数を解放して販売を開始する仕組みです。

## 事前準備(Shopify側)

### 1. カスタムアプリの作成

1. Shopify管理画面 → **設定 → アプリと販売チャネル → アプリを開発する**
2. アプリを作成し、以下のAccess scopesを設定
   - `read_products`, `write_products`
   - `read_inventory`, `write_inventory`
   - `read_locations`
3. アプリをインストールし、Admin API access tokenを発行

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
| `SHOPIFY_ADMIN_TOKEN` | Admin API access token |
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
export SHOPIFY_ADMIN_TOKEN=shpat_xxxx
export SHOPIFY_LOCATION_ID=gid://shopify/Location/xxxx

npm run release
```

## 動作の流れ

1. GitHub Actionsが15分おきに起動(`workflow_dispatch` で手動実行も可能)
2. `status:active` かつ `release_processed != true` の商品を検索
3. `release_date` <= 現在時刻の商品を抽出
4. `config/release-stock.json` の数量で在庫を設定(`inventorySetQuantities`)
5. 成功した商品には `release_processed = true` を設定し、二重処理を防止

## 注意点

- GitHub Actionsの`schedule`は負荷状況により数分の遅延が発生することがあります。秒単位の厳密な予約公開が必要な場合は、AWS EventBridgeなど精度の高いスケジューラの利用を検討してください。
- `release_date`はUTCで統一して運用することを推奨します。
- ストアフロントやCDNのキャッシュにより、在庫反映まで数分のタイムラグが出る場合があります。
- 対象商品数が多い場合はGraphQLのレート制限に注意し、必要に応じてページネーションやリトライ処理を追加してください。
