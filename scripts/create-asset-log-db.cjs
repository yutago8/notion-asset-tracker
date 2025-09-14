#!/usr/bin/env node
const API = 'https://api.notion.com/v1';
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_VERSION = '2022-06-28';
if (!NOTION_TOKEN) { console.error('NOTION_TOKEN is required'); process.exit(1); }

function hyphenate(id){ const s=String(id).replace(/-/g,''); if(!/^[0-9a-fA-F]{32}$/.test(s)) return id; return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; }
function parsePageId(input){ try{ const u=new URL(input); const last=u.pathname.split('/').filter(Boolean).pop()||''; const idPart=last.split('-').pop()||last; return hyphenate(idPart); }catch(_){ return hyphenate(input);} }
async function api(path, init={}){
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization:`Bearer ${NOTION_TOKEN}`, 'Notion-Version':NOTION_VERSION, 'Content-Type':'application/json', ...(init.headers||{}) } });
  if(!r.ok){ const t=await r.text().catch(()=> ''); throw new Error(`${init.method||'GET'} ${path} ${r.status} ${t}`); }
  return r.json();
}
async function createDb(pageId){
  const title = [{ type:'text', text:{ content:'Asset Log' } }];
  const properties = {
    Name: { title: {} },
    Date: { date: {} },
    Change: { number: {} },
    Mode: { select: { options: [ { name:'Cash', color:'blue' }, { name:'Forecast', color:'green' } ] } },
  };
  return api('/databases', { method:'POST', body: JSON.stringify({ parent:{ type:'page_id', page_id: pageId }, title, properties, is_inline: true }) });
}
(async()=>{
  const arg=process.argv[2]; if(!arg){ console.error('Usage: node scripts/create-asset-log-db.cjs <pageUrlOrId>'); process.exit(1);} const pid=parsePageId(arg);
  const db = await createDb(pid);
  console.log('Created Asset Log DB id:', db.id);
})();

