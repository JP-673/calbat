// app.js — Production build for GH Pages + Cloudflare Worker proxy

// Tu Worker en producción:
const API = 'https://eve-proxy-worker.everunner673.workers.dev';

const $ = (s)=>document.querySelector(s);
const out = $('#out');
const raw = $('#raw');
const sel = $('#shipSelect');
const manual = $('#manualId');
const btn = $('#calcBtn');
const cache = new Map();

// ============ HELPERS: ESI & EVEREF ============
async function esi(path){
  // Añadimos datasource y language a todas las llamadas ESI
  const url = `${API}/esi${path}${path.includes('?') ? '&' : '?'}datasource=tranquility&language=en`;
  const r = await fetch(url, { cache: 'no-store' });
  if(!r.ok) throw new Error(`ESI ${r.status}: ${url}`);
  return r.json();
}

async function everefCost(params){
  const q = new URLSearchParams(params);
  const url = `${API}/everef?${q.toString()}`;
  const r = await fetch(url, { cache: 'no-store' });
  if(!r.ok) throw new Error(`EVE Ref ${r.status}: ${url}`);
  return r.json();
}

// ============ UTILS ============
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
  out.innerHTML = `<div class="error">${String(msg).replace(/&/g,'&amp;')}</div>`;
}

function prettyISK(x){
  return new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(x);
}

// ============ LOAD BATTLESHIPS (robusto) ============
async function loadBattleships(){
  btn.disabled = true;
  sel.innerHTML = `<option>Loading battleships…</option>`;

  // 1) Busca el groupId "Battleship" en categoría 6 (Ships)
  let bsGroupId = localStorage.getItem('bsGroupId');
  if (!bsGroupId) {
    const cat = await esi('/universe/categories/6/'); // Ships
    const groups = cat.groups || [];
    if (!groups.length) throw new Error('ESI: category 6 has no groups');

    let found = null;
    let i = 0;
    const CONC = 6; // concurrencia para evitar rate-limit

    async function worker(){
      while (!found && i < groups.length) {
        const gid = groups[i++];
        try {
          const g = await esi(`/universe/groups/${gid}/`);
          if ((g?.name || '').toLowerCase() === 'battleship') {
            found = gid;
            break;
          }
        } catch { /* ignore individual failures */ }
      }
    }
    await Promise.all(Array.from({length: CONC}, worker));

    if (!found) throw new Error('Battleship group not found under category 6');
    bsGroupId = String(found);
    localStorage.setItem('bsGroupId', bsGroupId);
  }

  // 2) Trae tipos del grupo
  const group = await esi(`/universe/groups/${bsGroupId}/`);
  const ids = (group?.types || []).slice();
  if (!ids.length) throw new Error('Battleship group has no types');

  // 3) Resuelve nombres con concurrencia limitada
  const items = [];
  let j = 0;
  const CONC_TYPES = 8;

  async function typeWorker(){
    while (j < ids.length) {
      const id = ids[j++];
      try {
        const t = await esi(`/universe/types/${id}/`);
        if (t && t.published !== false) items.push({ id, name: t.name });
      } catch { /* ignore */ }
    }
  }
  await Promise.all(Array.from({length: CONC_TYPES}, typeWorker));

  items.sort((a,b)=> a.name.localeCompare(b.name));
  sel.innerHTML =
    `<option value="">— Select a battleship —</option>` +
    items.map(it=>`<option value="${it.id}">${it.name} (ID ${it.id})</option>`).join('');

  btn.disabled = false;
}

// ============ CALCULATOR ============
async function calculate(){
  try{
    btn.disabled = true;
    out.innerHTML = '⏳ Crunching…';
    raw.textContent = '';

    let typeId = sel.value || extractTypeId(manual.value);
    if(!typeId) throw new Error('Pick a ship or enter a valid Type ID / EVE Ref URL.');

    const runs = Math.max(1, parseInt($('#runs').value||'1',10));
    const me = Math.max(0, parseInt($('#me').value||'0',10));
    const te = Math.max(0, parseInt($('#te').value||'0',10));

    const resp = await everefCost({ product_id: typeId, runs, me, te });
    raw.textContent = JSON.stringify(resp, null, 2);

    const mfg = resp?.manufacturing?.[typeId];
    if(!mfg) throw new Error('No manufacturing block returned (ship might not be manufacturable or wrong ID).');

    const mats = mfg.materials || {};
    const rows = [];
    for (const mid of Object.keys(mats)) {
      const m = mats[mid];
      const name = await typeName(m.type_id || mid);
      rows.push({
        name,
        id: m.type_id || parseInt(mid,10),
        qty: m.quantity,
        costPer: m.cost_per_unit,
        cost: m.cost
      });
    }
    rows.sort((a,b)=> a.name.localeCompare(b.name));

    const title = `${await typeName(typeId)} — runs: ${runs} <span class="pill">ME ${me}</span> <span class="pill">TE ${te}</span>`;
    let html = `<div><strong>${title}</strong></div>`;
    html += `<table><thead><tr><th>Material</th><th>Type ID</th><th>Qty</th><th>ISK / unit</th><th>Total ISK</th></tr></thead><tbody>`;
    for (const r of rows) {
      html += `<tr><td>${r.name}</td><td>${r.id}</td><td>${r.qty.toLocaleString()}</td><td>${r.costPer!=null? prettyISK(r.costPer):'—'}</td><td>${r.cost!=null? prettyISK(r.cost):'—'}</td></tr>`;
    }
    html += `</tbody></table>`;
    html += `<p class="muted">Total material cost (from API): <strong>${prettyISK(mfg.total_material_cost || 0)} ISK</strong>. Total job cost: <strong>${prettyISK(mfg.total_job_cost || 0)} ISK</strong>. Total: <strong>${prettyISK(mfg.total_cost || 0)} ISK</strong>.</p>`;
    out.innerHTML = html;

  } catch (err) {
    console.error(err);
    renderError(err.message || String(err));
  } finally {
    btn.disabled = false;
  }
}

// ============ INIT ============
$('#calcBtn').addEventListener('click', calculate);
loadBattleships().catch(e=>renderError(e.message||String(e)));
