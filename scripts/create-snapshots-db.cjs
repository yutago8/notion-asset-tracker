#!/usr/bin/env node
// Create a minimal Snapshots DB under a page and print its ID
const API = 'https://api.notion.com/v1';
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_VERSION = '2022-06-28';

if (!NOTION_TOKEN) {
  console.error('NOTION_TOKEN is required in environment (.env)');
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
    const t = await res.text().catch(() => '');
    throw new Error(`API ${path} failed: ${res.status} ${res.statusText} ${t}`);
  }
  return res.json();
}

async function createSnapshotsDb(parentPageId) {
  const title = [{ type: 'text', text: { content: 'Snapshots' } }];
  const properties = {
    Name: { title: {} },
    Date: { date: {} },
    'Total USD': { number: {} },
    'Change USD': { number: {} },
    'Change %': { number: {} },
  };
  const body = { parent: { type: 'page_id', page_id: parentPageId }, title, properties, is_inline: true };
  return api('/databases', { method: 'POST', body: JSON.stringify(body) });
}

async function main() {
  const arg = process.argv[2];
  if (!arg) { console.error('Usage: node scripts/create-snapshots-db.cjs <pageUrlOrId>'); process.exit(1); }
  const pageId = parsePageId(arg);
  const db = await createSnapshotsDb(pageId);
  console.log('Created Snapshots DB:');
  console.log('- title:', db.title?.[0]?.plain_text || '');
  console.log('- id:', db.id);
  console.log('\nSet NOTION_SNAPSHOTS_DB_ID in .env to this id.');
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });

