import dotenv from 'dotenv';
dotenv.config();

export const config = {
  notionToken: process.env.NOTION_TOKEN || '',
  holdingsDbId: process.env.NOTION_HOLDINGS_DB_ID || '',
  snapshotsDbId: process.env.NOTION_SNAPSHOTS_DB_ID || '',
  transactionsDbId: process.env.NOTION_TRANSACTIONS_DB_ID || '',
  baseCurrency: (process.env.BASE_CURRENCY || 'USD').toUpperCase(),
  props: {
    name: process.env.PROP_NAME || 'Name',
    category: process.env.PROP_CATEGORY || 'Category',
    symbol: process.env.PROP_SYMBOL || 'Symbol',
    quantity: process.env.PROP_QUANTITY || 'Quantity',
    priceSource: process.env.PROP_PRICE_SOURCE || 'Price Source',
    manualPrice: process.env.PROP_MANUAL_PRICE || 'Manual Price',
    currency: process.env.PROP_CURRENCY || 'Currency',
    priceId: process.env.PROP_PRICE_ID || 'Price ID',
  },
  snapshotProps: {
    date: process.env.SNAPSHOT_PROP_DATE || 'Date',
    totalUSD: process.env.SNAPSHOT_PROP_TOTAL_USD || 'Total USD',
    changeUSD: process.env.SNAPSHOT_PROP_CHANGE_USD || 'Change USD',
    changePct: process.env.SNAPSHOT_PROP_CHANGE_PCT || 'Change %',
  },
  transactionProps: {
    title: process.env.TR_PROP_TITLE || 'Title',
    date: process.env.TR_PROP_DATE || 'Date',
    amount: process.env.TR_PROP_AMOUNT || 'Amount',
    amountConfirmed: process.env.TR_PROP_AMOUNT_CONFIRMED || 'Amount Confirmed',
    verified: process.env.TR_PROP_VERIFIED || 'Verified',
    dueDate: process.env.TR_PROP_DUE_DATE || 'Due Date',
    transactionType: process.env.TR_PROP_TRANSACTION_TYPE || 'Transaction Type',
    paymentMethod: process.env.TR_PROP_PAYMENT_METHOD || 'Payment Method',
    externalId: process.env.TR_PROP_EXTERNAL_ID || 'External ID',
  },
};

export function assertConfig() {
  const missing: string[] = [];
  if (!config.notionToken) missing.push('NOTION_TOKEN');
  if (!config.holdingsDbId) missing.push('NOTION_HOLDINGS_DB_ID');
  if (!config.snapshotsDbId) missing.push('NOTION_SNAPSHOTS_DB_ID');
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
