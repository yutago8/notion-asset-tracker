#!/usr/bin/env node
// Minimal Notion page inspector without external deps (Node 18+)
// Usage: node scripts/inspect-page.cjs <pageUrlOrId>

const API = 'https://api.notion.com/v1';
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_VERSION = '2022-06-28';

if (!NOTION_TOKEN) {
  console.error('NOTION_TOKEN is required in environment (.env).');
  process.exit(1);
}

function hyphenate(id) {
  const s = String(id).replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(s)) return id;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function parsePageId(input) {
  try {
    const u = new URL(input);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    const idPart = last.split('-').pop() || last;
    return hyphenate(idPart);
  } catch (_) {
    return hyphenate(input);
  }
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Notion API ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

async function getPage(pageId) {
  return api(`/pages/${pageId}`);
}

async function listChildren(blockId) {
  let cursor = undefined;
  const out = [];
  do {
    const qs = new URLSearchParams();
    if (cursor) qs.set('start_cursor', cursor);
    qs.set('page_size', '100');
    const data = await api(`/blocks/${blockId}/children?${qs.toString()}`);
    out.push(...(data.results || []));
    cursor = data.next_cursor || undefined;
  } while (cursor);
  return out;
}

async function walkChildDatabases(rootId) {
  const queue = [rootId];
  const seen = new Set();
  const found = [];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const children = await listChildren(id).catch(() => []);
    for (const b of children) {
      if (b.type === 'child_database') {
        found.push({ id: b.id, title: b.child_database?.title || '' });
      }
      if (b.has_children) queue.push(b.id);
    }
  }
  return found;
}

async function getDatabase(databaseId) {
  return api(`/databases/${databaseId}`);
}

function listProps(db) {
  const props = db.properties || {};
  return Object.entries(props).map(([name, def]) => ({ name, type: def.type || 'unknown' }));
}

function checkTransactionsProps(props) {
  const need = [
    { name: 'Date', type: 'date' },
    { name: 'Amount', type: 'number' },
    { name: 'Due Date', type: 'date' },
    { name: 'Amount Confirmed', type: 'checkbox' },
    { name: 'Verified', type: 'checkbox' },
    { name: '>=10k', type: 'formula', hint: 'and(prop("Transaction Type")="Expense", abs(prop("Amount"))>=10000)' },
    { name: 'Month', type: 'formula', hint: 'formatDate(prop("Date"), "YYYY-MM")' },
    { name: 'Is Due Soon', type: 'formula', hint: 'dateBetween(prop("Due Date"), now(), dateAdd(now(), 60, "days"))' },
    { name: 'Payment Method', type: 'select' },
    { name: 'External ID', type: 'rich_text', hint: 'CSV取り込みの重複排除キー' },
  ];
  const have = new Map(props.map((p) => [p.name.toLowerCase(), p.type]));
  const missing = need.filter((n) => have.get(n.name.toLowerCase()) !== n.type);
  return { missing, have: props };
}

function checkAccountsSnapshotProps(props) {
  const need = [
    { name: 'Date', type: 'date' },
    { name: 'Account', type: 'title' },
    { name: 'Class', type: 'select', hint: 'Asset / Liability' },
    { name: 'Balance', type: 'number' },
  ];
  const have = new Map(props.map((p) => [p.name.toLowerCase(), p.type]));
  const missing = need.filter((n) => have.get(n.name.toLowerCase()) !== n.type);
  return { missing, have: props };
}

function looksLikeTransactions(name) {
  const s = (name || '').toLowerCase();
  return /transaction|明細|出金|入金|収支|家計|expenses?/.test(s);
}

function looksLikeAccounts(name) {
  const s = (name || '').toLowerCase();
  return /account|資産|負債|snapshot|口座|balance/.test(s);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/inspect-page.cjs <pageUrlOrId>');
    process.exit(1);
  }
  const pageId = parsePageId(arg);
  const page = await getPage(pageId);
  const title = page.properties?.title?.title?.[0]?.plain_text || '(untitled)';
  console.log(`[Page] ${title} (${pageId})`);

  const dbs = await walkChildDatabases(pageId);
  if (!dbs.length) {
    console.log('No child databases found. Ensure the integration has access to the page.');
    return;
  }
  console.log(`Found ${dbs.length} databases.`);

  for (const d of dbs) {
    const db = await getDatabase(d.id);
    const props = listProps(db);
    console.log(`\n- ${d.title} (${d.id})`);
    for (const p of props) console.log(`  * ${p.name} (${p.type})`);

    if (looksLikeTransactions(d.title)) {
      const check = checkTransactionsProps(props);
      if (check.missing.length) {
        console.log('  Suggested additions for Transactions:');
        for (const m of check.missing) console.log(`    - ${m.name} : ${m.type}${m.hint ? `  // ${m.hint}` : ''}`);
      } else {
        console.log('  Transactions: looks complete.');
      }
    }
    if (looksLikeAccounts(d.title)) {
      const check = checkAccountsSnapshotProps(props);
      if (check.missing.length) {
        console.log('  Suggested additions for Accounts Snapshot:');
        for (const m of check.missing) console.log(`    - ${m.name} : ${m.type}${m.hint ? `  // ${m.hint}` : ''}`);
      } else {
        console.log('  Accounts Snapshot: looks complete.');
      }
    }
  }
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});

