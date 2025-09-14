# Notion Asset Tracker

Notionのデータベース（保有資産）と連動し、日々の資産評価額スナップショットを記録・可視化する最小構成のアプリです。

> Deployment note: Triggered Vercel deploy via GitHub push on 2025-09-14.

- バックエンド: Node.js + Express + TypeScript
- 連携: Notion API（公式 SDK）
- 価格取得: CoinGecko（暗号資産）/ Yahoo Finance Quote API（株式・ETF）
- 為替: exchangerate.host（任意の基軸通貨に換算）
- UI: シンプルな静的ページ（Chart.js CDN）

## できること（MVP）
- Notionの「Holdings（保有資産）」DBを読み込む
- 当日のポートフォリオ評価額（基軸通貨、例: USD/JPY）を計算
- 前回スナップショットとの差分（USD/％）を計算
- Notionの「Snapshots（日次スナップショット）」DBに記録
- Web画面で過去スナップショットの推移を折れ線グラフ表示

## 前提
- Node.js 18+ 推奨
- Notion ワークスペースで下記2つのDBを用意し、内部インテグレーションを作成してDBを共有

### Holdings DB（保有資産）
デフォルトのプロパティ名（変更したい場合は `.env` で上書き可能）
- Name: タイトル（資産名 or ティッカー）
- Category: セレクト（Stock / Crypto / Cash / Fund / Bond / Other）
- Symbol: リッチテキスト（例: AAPL, MSFT, BTC）
- Quantity: 数値（保有数量）
- Price Source: セレクト（Yahoo / CoinGecko / Manual）
- Manual Price: 数値（必要時のみ, 単位あたりの価格。通貨は `Currency` で指定）
- Currency: セレクト（USD / JPY など。MVPではUSD想定、他通貨は為替換算）
- Price ID: リッチテキスト（CoinGecko用ID。例: bitcoin, ethereum）

### Snapshots DB（日次スナップショット）
- Date: 日付
- Total USD: 数値
- Change USD: 数値
- Change %: 数値

## セットアップ
1) 依存関係のインストール
```
npm install
```

2) 環境変数の設定
- `.env.example` を `.env` にコピーし、NotionのトークンとDB IDを設定

3) 開発サーバ
```
npm run dev
```
- ブラウザで `http://localhost:3000` を開く

4) 日次スナップショットの作成
```
npm run snapshot
```

## Notion DBの最小構成を自動作成（任意）
- 指定ページ配下に Snapshots（資産推移）/ Accounts Snapshot を作成:
```
set -a; source .env; set +a
node scripts/create-snapshots-db.cjs "<NotionページURL>"
node scripts/create-accounts-db.cjs "<NotionページURL>"
```
- 既存の Transactions へ最小プロパティを追加:
```
node scripts/patch-transactions.cjs "<NotionページURL>"
```

## Vercel でのデプロイ
1) Vercelプロジェクトを作成し、このリポジトリをリンク
2) プロジェクトの環境変数を設定
   - `NOTION_TOKEN`, `NOTION_SNAPSHOTS_DB_ID`, `NOTION_HOLDINGS_DB_ID`(任意), `BASE_CURRENCY`, `CRON_SECRET`(任意)
3) デプロイすると下記エンドポイントが利用可能
   - `GET /api/snapshots` — Snapshots DBから履歴取得
   - `GET /api/config` — 基軸通貨の取得
   - `GET /api/compute` — 評価額の試算（Holdings DBがある場合）
   - `GET /api/cron-snapshot` — 評価→スナップ保存（Vercel Cron用, `x-vercel-cron` or `Authorization: Bearer <CRON_SECRET>`)
4) ルート`/`は `public/index.html` にリライトされ、グラフが表示されます


## 環境変数
- `NOTION_TOKEN`: Notion内部インテグレーションのシークレット
- `NOTION_HOLDINGS_DB_ID`: Holdings DBのID
- `NOTION_SNAPSHOTS_DB_ID`: Snapshots DBのID
- `BASE_CURRENCY`: 基軸通貨（デフォルト: USD。例: JPY）
- プロパティ名上書き（任意）
  - `PROP_NAME`, `PROP_CATEGORY`, `PROP_SYMBOL`, `PROP_QUANTITY`, `PROP_PRICE_SOURCE`, `PROP_MANUAL_PRICE`, `PROP_CURRENCY`, `PROP_PRICE_ID`
  - `SNAPSHOT_PROP_DATE`, `SNAPSHOT_PROP_TOTAL_USD`, `SNAPSHOT_PROP_CHANGE_USD`, `SNAPSHOT_PROP_CHANGE_PCT`

## 注意
- Yahoo Financeの非公式エンドポイントを利用しています。商用利用・レート制限には注意してください。
- CoinGeckoは無料プランにレート制限があります。大量銘柄の場合はケアが必要です。
- 為替は `exchangerate.host` を利用します。基軸通貨は `BASE_CURRENCY` で指定できます。

## JPY（日本円）で使うには
1) `.env` に以下を設定
```
BASE_CURRENCY=JPY
```
2) NotionのHoldingsで、通貨がUSD以外の銘柄は `Currency` を適切に設定（例: 東証銘柄は JPY）。
   - CoinGecko由来の価格は自動で基軸通貨（JPY）で取得されます。
   - Yahoo/手動価格は `Currency` からJPYへ換算されます。
3) Snapshots DBのプロパティ名を円表記にしたい場合は `.env` で上書き（例）
```
SNAPSHOT_PROP_TOTAL_USD=Total JPY
SNAPSHOT_PROP_CHANGE_USD=Change JPY
```
4) フロントエンドは `/api/config` の `baseCurrency` を参照して通貨記号を自動表示します。

## 今後の拡張例
- 認証＆複数ユーザー対応
- 資産クラス別の寄与度分解、銘柄別チャート
- ベンチマーク（S&P500等）との比較
- 多通貨・多口座の厳密対応、手数料・配当の反映
