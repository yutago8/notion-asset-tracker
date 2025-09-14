#!/usr/bin/env node
// Add minimal properties to Transactions DB under a given page
// Usage: node scripts/patch-transactions.cjs <pageUrlOrId>

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

async function getPage(pageId) { return api(`/pages/${pageId}`); }
async function listChildren(blockId) {
  let cursor = undefined; const out = [];
  do {
    const qs = new URLSearchParams(); if (cursor) qs.set('start_cursor', cursor); qs.set('page_size', '100');
    const data = await api(`/blocks/${blockId}/children?${qs.toString()}`);
    out.push(...(data.results || [])); cursor = data.next_cursor || undefined;
  } while (cursor);
  return out;
}
async function getDatabase(databaseId) { return api(`/databases/${databaseId}`); }
async function updateDatabase(databaseId, body) { return api(`/databases/${databaseId}`, { method: 'PATCH', body: JSON.stringify(body) }); }

function listProps(db) { const props = db.properties || {}; return Object.entries(props).map(([name, def]) => ({ name, type: def.type || 'unknown' })); }

function looksLikeTransactions(name) {
  const s = (name || '').toLowerCase();
  return /transaction|明細|収支|家計|expenses?/.test(s);
}

function buildDesiredProps() {
  return {
    'Due Date': { date: {} },
    '>=10k': { formula: { expression: 'abs(prop("Amount")) >= 10000' } },
    'Month': { formula: { expression: 'formatDate(prop("Date"), "YYYY-MM")' } },
    'Is Due Soon': { formula: { expression: 'if(empty(prop("Due Date")), false, and(dateBetween(now(), prop("Due Date"), "days") >= 0, dateBetween(now(), prop("Due Date"), "days") <= 60))' } },
    'Payment Method': { select: { options: [] } },
    'External ID': { rich_text: {} },
  };
}

async function findTransactionsDbUnder(pageId) {
  const children = await listChildren(pageId);
  const dbs = children.filter((b) => b.type === 'child_database');
  let picked = dbs.find((b) => looksLikeTransactions(b.child_database?.title || ''));
  if (!picked && dbs.length) picked = dbs[0];
  return picked ? { id: picked.id, title: picked.child_database?.title || '' } : null;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) { console.error('Usage: node scripts/patch-transactions.cjs <pageUrlOrId>'); process.exit(1); }
  const pageId = parsePageId(arg);
  const page = await getPage(pageId);
  const title = page.properties?.title?.title?.[0]?.plain_text || '(untitled)';
  console.log(`[Page] ${title} (${pageId})`);

  const tdb = await findTransactionsDbUnder(pageId);
  if (!tdb) { console.error('Transactions-like database not found under this page.'); process.exit(1); }
  console.log(`Target DB: ${tdb.title || '(untitled)'} (${tdb.id})`);

  const db = await getDatabase(tdb.id);
  const have = new Map(listProps(db).map((p) => [p.name.toLowerCase(), p.type]));
  const desired = buildDesiredProps();
  const missing = Object.entries(desired).filter(([name]) => !have.has(name.toLowerCase()));
  if (!missing.length) { console.log('No changes needed. All properties exist.'); return; }
  console.log('Creating properties one by one:');
  for (const [name, schema] of missing) {
    try {
      await updateDatabase(tdb.id, { properties: { [name]: schema } });
      console.log(' - OK:', name);
    } catch (e) {
      console.log(' - FAIL:', name, '\n   ', (e && e.message) ? e.message : String(e));
    }
  }
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
