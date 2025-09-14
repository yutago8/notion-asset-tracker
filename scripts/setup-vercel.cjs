#!/usr/bin/env node
// Setup Vercel Project via API: create or reuse project, set env vars, print orgId/projectId
// Usage:
//   VERCEL_TOKEN=xxxxx node scripts/setup-vercel.cjs [--name <projName>] [--preview] [--dev]

const API = 'https://api.vercel.com';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { name: null, preview: true, dev: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--name') out.name = args[++i];
    else if (a === '--no-preview') out.preview = false;
    else if (a === '--no-dev') out.dev = false;
  }
  return out;
}

function parseDotEnv(path = '.env') {
  const fs = require('fs');
  const exists = fs.existsSync(path);
  const env = {};
  if (!exists) return env;
  const text = fs.readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
  return env;
}

async function api(path, init = {}) {
  const token = requireEnv('VERCEL_TOKEN');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init.method || 'GET'} ${path} failed: ${res.status} ${res.statusText} ${body}`);
  }
  return res.json();
}

async function getUser() {
  return api('/v2/user');
}

async function findProjectByName(name) {
  const data = await api(`/v9/projects?limit=100&search=${encodeURIComponent(name)}`);
  return (data.projects || []).find((p) => p.name === name) || null;
}

async function createProject(name) {
  return api('/v9/projects', { method: 'POST', body: JSON.stringify({ name, framework: null }) });
}

async function upsertEnv(projectId, key, value, targets) {
  if (value == null || value === '') return; // skip empty
  const body = { key, value, target: targets, type: 'encrypted' };
  try {
    await api(`/v9/projects/${projectId}/env`, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    // If already exists, ignore; otherwise rethrow
    if (!String(e.message).includes('already exists')) throw e;
  }
}

async function main() {
  const args = parseArgs();
  const localEnv = parseDotEnv('.env');
  const name = args.name || (require('path').basename(process.cwd()));

  const user = await getUser();
  console.log(`Vercel user: ${user.user?.username || user.user?.name || user.user?.id}`);

  let project = await findProjectByName(name);
  if (!project) {
    console.log(`Creating project: ${name}`);
    project = await createProject(name);
  } else {
    console.log(`Using existing project: ${name} (${project.id})`);
  }

  const targets = ['production'];
  if (args.preview) targets.push('preview');
  if (args.dev) targets.push('development');

  await upsertEnv(project.id, 'NOTION_TOKEN', localEnv.NOTION_TOKEN, targets);
  await upsertEnv(project.id, 'NOTION_SNAPSHOTS_DB_ID', localEnv.NOTION_SNAPSHOTS_DB_ID, targets);
  if (localEnv.NOTION_HOLDINGS_DB_ID) await upsertEnv(project.id, 'NOTION_HOLDINGS_DB_ID', localEnv.NOTION_HOLDINGS_DB_ID, targets);
  await upsertEnv(project.id, 'BASE_CURRENCY', localEnv.BASE_CURRENCY || 'JPY', targets);
  if (localEnv.CRON_SECRET) await upsertEnv(project.id, 'CRON_SECRET', localEnv.CRON_SECRET, targets);

  console.log('Project configured:');
  console.log(`- projectId: ${project.id}`);
  console.log(`- orgId: ${project.accountId}`);
  console.log('\nSet the following GitHub Secrets for Actions-based deploy:');
  console.log('VERCEL_TOKEN=<your token>');
  console.log(`VERCEL_PROJECT_ID=${project.id}`);
  console.log(`VERCEL_ORG_ID=${project.accountId}`);
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });

