# Transactions_caluc (Next.js 14 Webhook for Notion → Asset Log)

Vercel/Next.js 14 の API Route で、Notion Automations の "Send webhook" を受け取り、Transactions DB を再集計して Asset Log DB に upsert します。

## セットアップ（5分）

1) Vercel に新規プロジェクトとしてこの `Transactions_caluc` ディレクトリをインポート

2) 環境変数（Project → Settings → Environment Variables）

- `NOTION_TOKEN`（必須）
- `TRANSACTIONS_DB_ID`（必須）
- `ASSET_LOG_DB_ID`（必須）
- `WEBHOOK_SECRET`（必須）: Automations から `x-webhook-secret` ヘッダーで送る共通シークレット

任意（プロパティ名が既定と違う場合に上書き）
- `TR_PROP_DATE`（default: `Date`）
- `TR_PROP_AMOUNT`（default: `Amount`）
- `TR_PROP_AMOUNT_CONFIRMED`（default: `Amount Confirmed`）
- `TR_PROP_VERIFIED`（default: `Verified`）
- `TR_PROP_PAYMENT_METHOD`（default: `Payment Method`）
- `ALOG_PROP_DATE`（default: `Date`）
- `ALOG_PROP_ASSET_TYPE`（default: `Asset Type`）
- `ALOG_PROP_NUMBER`（default: `Number`）
- `ALOG_PROP_BALANCE`（default: `Balance`）
- `AGGREGATE_BY`（`asset_type`|`payment_method`|`total`。既定は `asset_type`）

3) Notion Automations（Transactions DB）

- Trigger: When item is created or edited
- Action: Send webhook
  - URL: `https://<your-vercel-app>/api/notion-webhook`
  - Headers: `x-webhook-secret: <WEBHOOK_SECRET>`
  - Body(JSON 例): `{ "page_id": "{{Page.ID}}", "event": "updated" }`

## 仕組み

- Webhook受信 → page_id の日付周辺（既定±30日）または直近 180 日を対象に、Transactions を取得
- 条件: `Amount Confirmed = true` または `Verified = true`
- 既定は `AGGREGATE_BY=asset_type`（TransactionsのAsset Type別）。日次変動を `Number`、累積を `Balance` に書き込み
- `AGGREGATE_BY=payment_method` の場合は `Payment Method` 別、`AGGREGATE_BY=total` は全体一本化
- `date + assetType` をキーに Asset Log を upsert（存在すれば update、なければ create）。`Balance`列が無ければ自動追加

## 開発

```
npm install
npm run dev
# POST http://localhost:3000/api/notion-webhook with header x-webhook-secret
```
