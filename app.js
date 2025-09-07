// app.js — Frontend logic for EVE Battleship Material Calculator

// Detect if running local dev (wrangler dev) or prod (workers.dev)
const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:8787'
  : 'https://eve-proxy-worker.everunner673.workers.dev';

const $ = (s)=>document.querySelector(s);
const out = $('#out');
const raw = $('#raw');
const sel = $('#shipSelect');
const manual = $('#manualId');
const cache = new Map();

// ====== API helpers ======
async function esi(path){
  const url = `${API}/esi${path}${path.includes('?') ? '&' : '?'}datasource=tranquility&language=en`;
  const r = await fetch(url);
  if(!r.ok) throw new Error(`ESI ${r.status}: ${url}`);
  return r.json();
}

async function everefCost(params){
  const q = new URLSearchParams(params);
  const url = `${API}/everef?${q.toString()}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error(`EVE Ref ${r.status}: ${url}`);
  return r.json();
}

// ====== Utilities ======
async function typeName(id){
  id = String(id);
  if(cache.has(id)) return cache.get(id);
  const data = await esi(`/universe/types/${id}/`);
  const name = data?.name || `type ${id}`;
  cache.set(id, name);
  return name;
}

function extractTypeId(raw){
  if(!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/(\d{3,})/);
  return m ? parseInt(m[1],10) : null;
}

function renderError(msg){
  out.innerHTML = `<div class="error">${msg.replace(/&/g,'&amp;')}</div>`;
}

function prettyISK(x){
  return new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(x);
}

// ====== Battleship discovery (FIX usando /search) ======
async function loadBattleships(){
  sel.innerHTML = `<option>Loading battleships…</option>`;

  // Buscar el grupo "Battleship" con /search
  const searchQS = new URLSearchParams({
    categories: 'group',
    search: 'battleship',
    strict: 'true',
    language: 'en-us',
    datasource: 'tranquility',
  }).toString();

  const r = await fetch(`${API}/esi/search/?${searchQS}`);
  if (!r.ok) throw new Error(`ESI search failed: ${r.status}`);
  const data = await r.json();

  const groupIds = data?.group || [];
  if (!groupIds.length) throw new Error('Battleship group not found via ESI search');
  const bsGroupId = groupIds[0];

  // Ahora traemos ese grupo
  const g = await esi(`/universe/groups/${bsGroupId}/`);
  const ids = (g?.types || []).slice();

  // Resolver nombres en batches
  const batch = (arr, n=20)=>{ const out=[]; for(let i=0;i<arr.length;i+=n){ out.push(arr.slice(i,i+n)); } return out; };
  const parts = batch(ids, 20);
  const items = [];
  for (const chunk of parts){
    const proms = chunk.map(async id=>{
      try {
        const t = await esi(`/universe/types/${id}/`);
        return t && t.published !== false ? {id, name:t.name} : null;
      } catch { return null; }
    });
    const got = await Promise.all(proms);
    for (const x of got) if (x) items.push(x);
  }

  items.sort((a,b)=> a.name.localeCompare(b.name));
  sel.innerHTML =
    `<option value="">— Select a battleship —</option>` +
    items.map(it=>`<option value="${it.id}">${it.name} (ID ${it.id})</option>`).join('');
}

// ====== Main calculator ======
async function calculate(){
  try{
    out.innerHTML = '⏳ Crunching…';
    raw.textContent = '';
    let typeId = sel.value || extractTypeId(manual.value);
    if(!typeId) throw new Error('Pick a ship or enter a valid Type ID / EVE Ref URL.');
    const runs = Math.max(1, parseInt($('#runs').value||'1',10));
    const me = Math.max(0, parseInt($('#me').value||'0',10));
    const te = Math.max(0, parseInt($('#te').value||'0',10));

    const resp = await everefCost({ product_id: typeId, runs, me, te });
    raw.textContent = JSON.stringify(resp,null,2);

    const mfg = resp?.manufacturing?.[typeId];
    if(!mfg) throw new Error('No manufacturing block returned (ship might not be manufacturable or wrong ID).');

    const mats = mfg.materials || {};
    const rows = [];
    for(const mid of Object.keys(mats)){
      const m = mats[mid];
      const name = await typeName(m.type_id || mid);
      rows.push({ name, id: m.type_id || parseInt(mid,10), qty: m.quantity, costPer: m.cost_per_unit, cost: m.cost });
    }
    rows.sort((a,b)=> a.name.localeCompare(b.name));

    const title = `${await typeName(typeId)} — runs: ${runs} <span class="pill">ME ${me}</span> <span class="pill">TE ${te}</span>`;
    let html = `<div><strong>${title}</strong></div>`;
    html += `<table><thead><tr><th>Material</th><th>Type ID</th><th>Qty</th><th>ISK / unit</th><th>Total ISK</th></tr></thead><tbody>`;
    for(const r of rows){
      html += `<tr><td>${r.name}</td><td>${r.id}</td><td>${r.qty.toLocaleString()}</td><td>${r.costPer!=null? prettyISK(r.costPer):'—'}</td><td>${r.cost!=null? prettyISK(r.cost):'—'}</td></tr>`;
    }
    html += `</tbody></table>`;
    html += `<p class="muted">Total material cost (from API): <strong>${prettyISK(mfg.total_material_cost || 0)} ISK</strong>. Total job cost: <strong>${prettyISK(mfg.total_job_cost || 0)} ISK</strong>. Total: <strong>${prettyISK(mfg.total_cost || 0)} ISK</strong>.</p>`;
    out.innerHTML = html;
  }catch(err){
    console.error(err);
    renderError(err.message || String(err));
  }
}

// ====== Init ======
$('#calcBtn').addEventListener('click', calculate);
loadBattleships().catch(e=>renderError(e.message||String(e)));
