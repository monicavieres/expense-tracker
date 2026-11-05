'use strict';
const $ = s => document.querySelector(s);
const enc = new TextEncoder(), dec = new TextDecoder();
const lists = {cats: [], tags: [], icats: []};
const DEFAULTS = {
  cats: ['🏠 Vivienda','🛒 Supermercado','🚗 Transporte','💊 Salud','🎓 Educación','🍽️ Restaurantes y ocio','📺 Suscripciones','💡 Servicios básicos','👕 Ropa y hogar','🐾 Mascotas','💼 Trabajo/Negocio','💰 Ahorro/Deudas','📦 Otros'],
  tags: ['🔁 Fijo / recurrente','🧺 Común','🎉 Ocasión especial / única'],
  icats: ['🥦 Alimentos','🥤 Bebidas','🍪 Snacks y dulces','🧴 Aseo y cuidado personal','🏡 Hogar y decoración','🐾 Mascotas','💊 Farmacia','🏷️ Descuentos','📦 Otros']
};
const clp = n => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('es-CL');
const usd = n => 'US$ ' + n.toLocaleString('es-CL', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parseNum = s => { s = String(s ?? '').trim().replace(/\s/g, ''); if (!s) return 0;
  const neg = s.startsWith('-'); s = s.replace(/^-/, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return (parseFloat(s) || 0) * (neg ? -1 : 1); };
const EMOJI = /^\p{Extended_Pictographic}\S*\s*/u;
const catIcon = c => EMOJI.test(c || '') ? (c.match(EMOJI)[0].trim()) : '🏷️';
const catName = c => (c || '').replace(EMOJI, '') || c;
const hue = s => { // color estable: por posición en las listas (ángulo áureo) o por hash si es nuevo
  const all = [...lists.cats, ...lists.icats, ...lists.tags], i = all.indexOf(s);
  if (i >= 0) return Math.round((i * 137.508 + 20) % 360);
  let h = 7; for (const ch of s || '') h = (h * 33 + ch.charCodeAt(0)) % 360; return h; };
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const fechaLarga = f => cap1(new Date(f + 'T12:00:00').toLocaleDateString('es-CL', {weekday: 'long', day: 'numeric', month: 'long'}));
const monthLabel = m => cap1(new Date(m + '-01T12:00:00').toLocaleDateString('es-CL', {month: 'long', year: 'numeric'}).replace(' de ', ' '));
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number), d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

/* ---------- IndexedDB ---------- */
let db;
const openDB = () => new Promise((res, rej) => {
  const r = indexedDB.open('gastos', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('exp', {keyPath: 'id'}); r.result.createObjectStore('photo', {keyPath: 'id'}); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = (store, mode, fn) => new Promise((res, rej) => {
  const t = db.transaction(store, mode), s = t.objectStore(store), r = fn(s);
  t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
});
const dbAll = st => tx(st, 'readonly', s => s.getAll());
const dbPut = (st, v) => tx(st, 'readwrite', s => s.put(v));
const dbDel = (st, id) => tx(st, 'readwrite', s => s.delete(id));
const dbClear = st => tx(st, 'readwrite', s => s.clear());

/* ---------- Cifrado ---------- */
let key = null;
const deriveKey = async (pw, salt) => {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
};
const encrypt = async (bytes, k = key) => { const iv = crypto.getRandomValues(new Uint8Array(12)); return {iv, ct: await crypto.subtle.encrypt({name: 'AES-GCM', iv}, k, bytes)}; };
const decrypt = (rec, k = key) => crypto.subtle.decrypt({name: 'AES-GCM', iv: rec.iv}, k, rec.ct);
const encJSON = async o => encrypt(enc.encode(JSON.stringify(o)));
const decJSON = async r => JSON.parse(dec.decode(await decrypt(r)));
const getMeta = () => { try { return JSON.parse(localStorage.getItem('g_meta')); } catch { return null; } };
const setMeta = m => localStorage.setItem('g_meta', JSON.stringify(m));
const packRec = r => ({iv: b64(r.iv), ct: b64(r.ct)});
const unpackRec = r => ({iv: new Uint8Array(unb64(r.iv)), ct: unb64(r.ct)});

/* ---------- Estado ---------- */
let expenses = [], editing = null, photoBytes = null;
let month = today().slice(0, 7), fCat = '', fTag = '', fText = '', sumView = 'cat';
for (const k in lists) lists[k] = DEFAULTS[k].slice();
const LS = {cats: 'g_cats', tags: 'g_tags', icats: 'g_icats'};
const loadLists = () => { for (const k in LS) { lists[k] = DEFAULTS[k].slice(); try { const v = JSON.parse(localStorage.getItem(LS[k])); if (Array.isArray(v) && v.length) lists[k] = v; } catch {} } };
const saveList = k => localStorage.setItem(LS[k], JSON.stringify(lists[k]));
const rate = e => e.monto ? e.clp / e.monto : 1;
const itemClp = (e, it) => it.m * rate(e);

async function loadExpenses() {
  const rows = await dbAll('exp'); expenses = [];
  for (const r of rows) { try { const e = await decJSON(r); e.id = r.id; e.items ||= []; e.tags ||= []; expenses.push(e); } catch {} }
  expenses.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado - a.creado);
}

/* ---------- Bloqueo ---------- */
let idleTimer, hiddenAt = 0;
const lockUI = $('#lock');
function setupLockScreen() {
  const meta = getMeta();
  $('#pw').value = $('#pw2').value = ''; $('#lockErr').textContent = '';
  $('#pw2').hidden = !!meta; $('#restoreWrap').hidden = !!meta;
  $('#lockMsg').textContent = meta ? 'Ingresa tu clave' : 'Primera vez: crea una clave. No se puede recuperar si la olvidas.';
  $('#lockBtn').textContent = meta ? 'Entrar' : 'Crear clave';
  $('#pw').autocomplete = meta ? 'current-password' : 'new-password';
}
function lock() { key = null; expenses = []; editing = null; $('#dlg').close?.(); $('#app').hidden = true; lockUI.hidden = false; setupLockScreen(); }
$('#lockForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const pw = $('#pw').value, meta = getMeta(), err = $('#lockErr'); err.textContent = '';
  try {
    if (!meta) {
      if (pw !== $('#pw2').value) { err.textContent = 'Las claves no coinciden'; return; }
      const salt = crypto.getRandomValues(new Uint8Array(16)); key = await deriveKey(pw, salt);
      setMeta({salt: b64(salt), check: packRec(await encrypt(enc.encode('ok')))});
    } else {
      const k = await deriveKey(pw, new Uint8Array(unb64(meta.salt)));
      try { await decrypt(unpackRec(meta.check), k); } catch { err.textContent = 'Clave incorrecta'; return; }
      key = k;
    }
    await loadExpenses(); loadLists(); month = today().slice(0, 7); fCat = fTag = fText = ''; $('#fText').value = '';
    lockUI.hidden = true; $('#app').hidden = false; showTab('list'); bumpIdle();
  } catch (e) { err.textContent = 'Error: ' + e.message; }
});
const bumpIdle = () => { clearTimeout(idleTimer); if (key) idleTimer = setTimeout(lock, 5 * 60 * 1000); };
['click', 'keydown', 'touchstart'].forEach(e => addEventListener(e, bumpIdle, {passive: true}));
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (key && hiddenAt && Date.now() - hiddenAt > 60000) lock(); });
$('#lockNow').onclick = lock;

/* ---------- Pestañas ---------- */
const TITLES = {list: 'Gastos', sum: 'Resumen', set: 'Ajustes'};
let tab = 'list';
function showTab(t) {
  tab = t;
  document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== 'tab-' + t);
  document.querySelectorAll('.bar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#title').textContent = TITLES[t]; $('#hero').hidden = t === 'set'; render();
}
document.querySelectorAll('.bar [data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('#mPrev').onclick = () => { month = shiftMonth(month, -1); render(); };
$('#mNext').onclick = () => { month = shiftMonth(month, 1); render(); };
document.querySelectorAll('#seg button').forEach(b => b.onclick = () => { sumView = b.dataset.v; render(); });

/* ---------- Render ---------- */
const sum = (l, f = e => e.clp) => l.reduce((s, e) => s + f(e), 0);
const catColor = c => `hsl(${hue(c)} 60% 48%)`;
const inMonth = e => e.fecha.startsWith(month);

function renderHero() {
  const l = expenses.filter(inMonth), total = sum(l), prev = sum(expenses.filter(e => e.fecha.startsWith(shiftMonth(month, -1))));
  $('#mLabel').textContent = monthLabel(month); $('#heroTotal').textContent = clp(total);
  const u = l.filter(e => e.moneda === 'USD'), diff = prev ? Math.round((total - prev) / prev * 100) : null;
  $('#heroSub').textContent = `${l.length} gasto${l.length === 1 ? '' : 's'}` + (diff !== null ? ` · ${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}% vs mes anterior` : '') +
    (u.length ? ` · ${usd(sum(u, e => e.monto))} en dólares` : '');
  const by = {}; l.forEach(e => by[e.categoria] = (by[e.categoria] || 0) + e.clp);
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]);
  $('#heroStack').innerHTML = top.map(([c, v]) => `<i style="width:${v / total * 100}%;background:${catColor(c)}" title="${esc(c)}"></i>`).join('');
  $('#heroLegend').innerHTML = top.slice(0, 4).map(([c, v]) => `<span style="--c:${catColor(c)}">${esc(catName(c))} ${Math.round(v / total * 100)}%</span>`).join('');
}

function renderList() {
  $('#fCat').innerHTML = '<option value="">Todas las categorías</option>' + lists.cats.map(c => `<option ${c === fCat ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('#tagFilter').innerHTML = ['', ...lists.tags].map(t => `<button type="button" class="chip ${t === fTag ? 'on' : ''}" data-t="${esc(t)}">${t ? esc(t) : 'Todas'}</button>`).join('');
  document.querySelectorAll('#tagFilter .chip').forEach(b => b.onclick = () => { fTag = b.dataset.t; render(); });
  const q = fText.trim().toLowerCase();
  const l = expenses.filter(e => inMonth(e) && (!fCat || e.categoria === fCat) && (!fTag || e.tags.includes(fTag)) &&
    (!q || (e.motivo + ' ' + (e.comercio || '') + ' ' + (e.notas || '') + ' ' + e.items.map(i => i.n).join(' ')).toLowerCase().includes(q)));
  $('#empty').hidden = l.length > 0;
  let html = '', last = '';
  for (const e of l) {
    if (e.fecha !== last) { last = e.fecha; html += `<li class="day"><span>${fechaLarga(e.fecha)}</span><span>${clp(sum(l.filter(x => x.fecha === e.fecha)))}</span></li>`; }
    html += `<li class="item" data-id="${e.id}"><div class="ico" style="--h:${hue(e.categoria)}">${catIcon(e.categoria)}</div>
      <div class="mid"><div class="mot">${esc(e.motivo)}</div>
      <div class="sub">${esc(e.comercio || catName(e.categoria))} · ${esc(e.pago)}${e.items.length ? ` · 🧾 ${e.items.length} ítems` : ''}${e.foto ? ' · 📎' : ''}</div>
      ${e.tags.length ? `<div class="tags">${e.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}</div>
      <div class="amt">${clp(e.clp)}${e.moneda === 'USD' ? `<small>${usd(e.monto)}</small>` : ''}</div></li>`;
  }
  $('#list').innerHTML = html;
  document.querySelectorAll('.item').forEach(li => li.onclick = () => openForm(expenses.find(e => e.id === li.dataset.id)));
}

const barsHTML = (entries, total) => entries.length ? entries.map(([k, v]) =>
  `<div class="bar-row"><div class="h"><span>${esc(k)}</span><b>${clp(v)} · ${total ? Math.round(v / total * 100) : 0}%</b></div><div class="track"><div class="fill" style="--h:${hue(k)};width:${Math.max(0, Math.min(100, v / (total || 1) * 100))}%"></div></div></div>`).join('') : '<p class="muted">Sin datos este mes.</p>';

function renderSummary() {
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.v === sumView));
  const l = expenses.filter(inMonth), total = sum(l); let html = '';
  if (sumView === 'cat') {
    const by = {}; l.forEach(e => by[e.categoria] = (by[e.categoria] || 0) + e.clp);
    html = barsHTML(Object.entries(by).sort((a, b) => b[1] - a[1]), total);
  } else if (sumView === 'tag') {
    const by = {}; let none = 0;
    l.forEach(e => { if (!e.tags.length) none += e.clp; e.tags.forEach(t => by[t] = (by[t] || 0) + e.clp); });
    const ent = Object.entries(by).sort((a, b) => b[1] - a[1]); if (none) ent.push(['Sin etiqueta', none]);
    html = barsHTML(ent, total) + '<p class="note">Un gasto con varias etiquetas se cuenta en cada una, por eso los porcentajes pueden sumar más de 100%.</p>';
  } else {
    const det = l.filter(e => e.items.length), by = {}; let rest = 0;
    det.forEach(e => { let s = 0; e.items.forEach(i => { const v = itemClp(e, i); by[i.c] = (by[i.c] || 0) + v; s += v; }); rest += e.clp - s; });
    const dTotal = sum(det);
    const ent = Object.entries(by).sort((a, b) => b[1] - a[1]); if (Math.abs(rest) >= 1) ent.push(['Sin detallar', rest]);
    html = `<p class="note">${det.length} compra${det.length === 1 ? '' : 's'} con detalle · ${clp(dTotal)} de ${clp(total)} del mes.</p>` + barsHTML(ent, dTotal);
  }
  $('#sumBody').innerHTML = html;
  const ms = []; for (let i = 5; i >= 0; i--) ms.push(shiftMonth(month, -i));
  const vals = ms.map(k => sum(expenses.filter(e => e.fecha.startsWith(k)))), max = Math.max(...vals, 1);
  $('#byMonth').innerHTML = ms.map((k, i) => `<div class="mcol ${k === month ? 'cur' : ''}"><span>${vals[i] ? Math.round(vals[i] / 1000) + 'k' : ''}</span><div style="height:${vals[i] / max * 78}%"></div>${k.slice(5)}/${k.slice(2, 4)}</div>`).join('');
}

function renderSettings() {
  for (const [k, el] of [['cats', '#catList'], ['tags', '#tagList'], ['icats', '#icatList']])
    $(el).innerHTML = lists[k].map(c => `<span class="chip static">${esc(c)}</span>`).join('');
}
function render() { if (!key) return; renderHero(); if (tab === 'list') renderList(); if (tab === 'sum') renderSummary(); if (tab === 'set') renderSettings(); }
$('#fText').addEventListener('input', e => { fText = e.target.value; renderList(); });
$('#fCat').addEventListener('change', e => { fCat = e.target.value; renderList(); });

/* ---------- Formulario ---------- */
const dlg = $('#dlg');
let tagsSel = new Set(), itemsSt = [];
function syncCurrency() {
  const isUsd = $('#fMoneda').value === 'USD';
  $('#lblMonto').firstChild.textContent = isUsd ? 'Monto USD *' : 'Monto CLP *';
  $('#lblClp').hidden = !isUsd; $('#fClp').required = isUsd;
  const m = parseNum($('#fMonto').value), c = parseNum($('#fClp').value);
  $('#rate').hidden = !(isUsd && m > 0 && c > 0);
  if (isUsd && m > 0 && c > 0) $('#rate').textContent = `Tipo de cambio efectivo: ${clp(c / m)} por dólar`;
  itemsSummary();
}
['#fMoneda', '#fMonto', '#fClp'].forEach(s => $(s).addEventListener('input', syncCurrency));

function renderFormTags() {
  const all = [...lists.tags, ...[...tagsSel].filter(t => !lists.tags.includes(t))];
  $('#fTags').innerHTML = all.map(t => `<button type="button" class="chip ${tagsSel.has(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('');
  document.querySelectorAll('#fTags .chip').forEach(b => b.onclick = () => { tagsSel.has(b.dataset.t) ? tagsSel.delete(b.dataset.t) : tagsSel.add(b.dataset.t); renderFormTags(); });
}
function renderItems() {
  $('#itemsBox').innerHTML = itemsSt.map((it, i) => `<div class="irow" data-i="${i}">
    <input data-f="n" placeholder="Ítem (ej: Pepsi 2.5L)" value="${esc(it.n)}" maxlength="80">
    <input data-f="m" inputmode="decimal" placeholder="Monto" value="${esc(it.m)}">
    <button type="button" class="rm" aria-label="Quitar">✕</button>
    <select data-f="c">${lists.icats.concat(lists.icats.includes(it.c) ? [] : [it.c]).map(c => `<option ${c === it.c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`).join('');
  itemsSummary();
}
function itemsSummary() {
  const el = $('#itemsSum'), used = itemsSt.filter(i => i.n.trim() || i.m);
  if (!used.length) { el.textContent = ''; el.className = 'muted'; return; }
  const s = used.reduce((a, i) => a + parseNum(i.m), 0), tot = parseNum($('#fMonto').value), diff = tot - s;
  el.className = Math.abs(diff) < 1 ? 'ok' : (diff < 0 ? 'warn' : 'muted');
  el.textContent = `Detallado: ${Math.abs(diff) < 1 ? 'todo ✓ ' : ''}${s.toLocaleString('es-CL')}` + (tot ? ` de ${tot.toLocaleString('es-CL')}` : '') +
    (Math.abs(diff) >= 1 && tot ? (diff > 0 ? ` · sin detallar ${diff.toLocaleString('es-CL')}` : ` · te pasaste por ${(-diff).toLocaleString('es-CL')}`) : '');
}
$('#itemsBox').addEventListener('input', e => { const r = e.target.closest('.irow'); if (!r) return; itemsSt[+r.dataset.i][e.target.dataset.f] = e.target.value; itemsSummary(); });
$('#itemsBox').addEventListener('click', e => { if (e.target.classList.contains('rm')) { itemsSt.splice(+e.target.closest('.irow').dataset.i, 1); renderItems(); } });
$('#addItem').onclick = () => { itemsSt.push({n: '', m: '', c: lists.icats[0]}); renderItems(); $('#itemsBox').querySelector('.irow:last-child input')?.focus(); };

async function openForm(e) {
  editing = e || null; photoBytes = null;
  $('#dlgTitle').textContent = e ? 'Editar gasto' : 'Nuevo gasto';
  $('#fCategoria').innerHTML = lists.cats.map(c => `<option>${esc(c)}</option>`).join('');
  if (e && !lists.cats.includes(e.categoria)) $('#fCategoria').insertAdjacentHTML('beforeend', `<option>${esc(e.categoria)}</option>`);
  $('#fMotivo').value = e?.motivo || ''; $('#fComercio').value = e?.comercio || '';
  $('#fFecha').value = e?.fecha || (month === today().slice(0, 7) ? today() : month + '-01'); $('#fMoneda').value = e?.moneda || 'CLP';
  $('#fMonto').value = e ? String(e.monto).replace('.', ',') : ''; $('#fClp').value = e && e.moneda === 'USD' ? e.clp : '';
  $('#fCategoria').value = e?.categoria || lists.cats[0]; $('#fPago').value = e?.pago || 'Débito'; $('#fNotas').value = e?.notas || '';
  tagsSel = new Set(e?.tags || []); itemsSt = (e?.items || []).map(i => ({n: i.n, m: String(i.m).replace('.', ','), c: i.c}));
  $('#delBtn').hidden = !e; renderFormTags(); renderItems(); syncCurrency(); setPhoto(null);
  if (e?.foto) { const rec = await tx('photo', 'readonly', s => s.get(e.id)); if (rec) setPhoto(new Uint8Array(await decrypt(rec))); }
  dlg.showModal();
}
let photoURL;
function setPhoto(bytes) {
  if (photoURL) URL.revokeObjectURL(photoURL);
  const img = $('#photoImg');
  if (bytes) { photoURL = URL.createObjectURL(new Blob([bytes], {type: 'image/jpeg'})); img.src = photoURL; img.hidden = false; $('#photoDel').hidden = false; }
  else { img.hidden = true; img.removeAttribute('src'); $('#photoDel').hidden = true; }
}
$('#fab').onclick = () => openForm(null);
$('#cancel').onclick = () => dlg.close();
$('#photoIn').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  const bmp = await createImageBitmap(f), sc = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
  photoBytes = new Uint8Array(await blob.arrayBuffer()); setPhoto(photoBytes);
});
$('#photoDel').onclick = () => { photoBytes = 'DEL'; setPhoto(null); };
$('#photoImg').onclick = () => { $('#viewerImg').src = $('#photoImg').src; $('#viewer').showModal(); };
$('#viewerClose').onclick = () => $('#viewer').close();

$('#form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const moneda = $('#fMoneda').value, monto = parseNum($('#fMonto').value);
  const clpVal = moneda === 'USD' ? Math.round(parseNum($('#fClp').value)) : Math.round(monto);
  if (!$('#fMotivo').value.trim() || monto <= 0 || clpVal <= 0) { alert('Completa motivo y montos.'); return; }
  const items = itemsSt.filter(i => i.n.trim() || i.m).map(i => ({n: i.n.trim() || 'Ítem', m: parseNum(i.m), c: i.c}));
  const id = editing?.id || crypto.randomUUID();
  const foto = photoBytes === 'DEL' ? false : (photoBytes ? true : !!editing?.foto);
  const e = {motivo: $('#fMotivo').value.trim(), comercio: $('#fComercio').value.trim(), fecha: $('#fFecha').value, moneda, monto, clp: clpVal,
    categoria: $('#fCategoria').value, pago: $('#fPago').value, notas: $('#fNotas').value.trim(), foto, items, tags: [...tagsSel], creado: editing?.creado || Date.now()};
  if (editing?.ref) e.ref = editing.ref;
  await dbPut('exp', {id, ...(await encJSON(e))});
  if (photoBytes === 'DEL') await dbDel('photo', id); else if (photoBytes) await dbPut('photo', {id, ...(await encrypt(photoBytes))});
  month = e.fecha.slice(0, 7); dlg.close(); await loadExpenses(); render();
});
$('#delBtn').onclick = async () => {
  if (!editing || !confirm('¿Eliminar este gasto y su boleta?')) return;
  await dbDel('exp', editing.id); await dbDel('photo', editing.id); dlg.close(); await loadExpenses(); render();
};

/* ---------- Ajustes ---------- */
const ADD_MSG = {cats: 'Nombre de la categoría (puedes empezar con un emoji, ej: 🎁 Regalos)', tags: 'Nombre de la etiqueta (ej: 🎂 Cumpleaños)', icats: 'Tipo de ítem (ej: 🧀 Lácteos)'};
document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
  const k = b.dataset.add, n = prompt(ADD_MSG[k]); if (!n?.trim()) return;
  lists[k].push(n.trim()); saveList(k); render();
});
const download = (name, data, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], {type})); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
$('#expBackup').onclick = async () => {
  const meta = getMeta();
  const out = {v: 1, salt: meta.salt, check: meta.check, lists, exp: (await dbAll('exp')).map(r => ({id: r.id, ...packRec(r)})), photo: (await dbAll('photo')).map(r => ({id: r.id, ...packRec(r)}))};
  download(`respaldo-gastos-${today()}.json`, JSON.stringify(out), 'application/json');
};
function applyLists(d) {
  const L = d.lists || (d.cats ? {cats: d.cats} : null); if (!L) return;
  for (const k in LS) if (Array.isArray(L[k]) && L[k].length) localStorage.setItem(LS[k], JSON.stringify(L[k]));
}
async function restoreFrom(file) {
  const d = JSON.parse(await file.text());
  if (d.v !== 1 || !d.salt || !d.check) throw new Error('Archivo no válido');
  await dbClear('exp'); await dbClear('photo');
  for (const r of d.exp) await dbPut('exp', {id: r.id, ...unpackRec(r)});
  for (const r of d.photo) await dbPut('photo', {id: r.id, ...unpackRec(r)});
  setMeta({salt: d.salt, check: d.check}); applyLists(d);
}
$('#restore').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  if (!confirm('Esto REEMPLAZA los datos de este dispositivo por los del respaldo, y se usará la clave del respaldo. ¿Continuar?')) return;
  try { await restoreFrom(f); alert('Respaldo restaurado. Entra con la clave del respaldo.'); lock(); } catch (e) { alert('No se pudo restaurar: ' + e.message); }
});
$('#restoreFirst').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  try { await restoreFrom(f); setupLockScreen(); $('#lockErr').textContent = 'Respaldo cargado. Ingresa su clave.'; } catch (e) { $('#lockErr').textContent = 'No se pudo restaurar: ' + e.message; }
});

/* Importar gastos: {gastos:[{fecha,motivo,comercio,categoria,pago,moneda,monto,clp,notas,ref,tags:[],items:[{n,m,c}],foto(base64 jpeg)}]} */
$('#importJson').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text()), arr = Array.isArray(d) ? d : d.gastos;
    if (!Array.isArray(arr)) throw new Error('Formato no válido');
    const known = new Map(expenses.filter(e => e.ref).map(e => [e.ref, e]));
    let n = 0, upd = 0;
    for (const it of arr) {
      const monto = Number(it.monto), moneda = it.moneda === 'USD' ? 'USD' : 'CLP', clpVal = Math.round(Number(it.clp ?? it.monto));
      if (!/^\d{4}-\d\d-\d\d$/.test(it.fecha) || !it.motivo || !(monto > 0) || !(clpVal > 0)) throw new Error('Gasto inválido: ' + (it.motivo || '(sin motivo)'));
      const items = (it.items || []).map(i => ({n: String(i.n), m: Number(i.m), c: i.c || lists.icats[lists.icats.length - 1]}));
      const tags = (it.tags || []).map(String);
      for (const t of tags) if (!lists.tags.includes(t)) { lists.tags.push(t); saveList('tags'); }
      for (const i of items) if (!lists.icats.includes(i.c)) { lists.icats.push(i.c); saveList('icats'); }
      const prev = it.ref && known.get(it.ref), id = prev?.id || crypto.randomUUID();
      const e = {motivo: String(it.motivo), comercio: it.comercio || '', fecha: it.fecha, moneda, monto, clp: clpVal,
        categoria: it.categoria || lists.cats[lists.cats.length - 1], pago: it.pago || 'Débito', notas: it.notas || '', items, tags,
        foto: !!it.foto || !!prev?.foto, creado: prev?.creado || Date.now() + n};
      if (it.ref) e.ref = String(it.ref);
      await dbPut('exp', {id, ...(await encJSON(e))});
      if (it.foto) await dbPut('photo', {id, ...(await encrypt(new Uint8Array(unb64(it.foto))))});
      prev ? upd++ : n++;
    }
    await loadExpenses(); render();
    alert(`Importados: ${n}` + (upd ? ` · actualizados: ${upd}` : ''));
  } catch (e) { alert('No se pudo importar: ' + e.message); }
});

const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); });
$('#expXlsx').onclick = async () => {
  if (!expenses.length) { alert('Aún no hay gastos para exportar.'); return; }
  if (!confirm('El Excel NO está cifrado. Guárdalo en un lugar seguro. ¿Exportar?')) return;
  const btn = $('#expXlsx'), txt = btn.textContent; btn.textContent = 'Generando…'; btn.disabled = true;
  try {
    if (!window.ExcelJS) await loadScript('vendor/exceljs.min.js');
    if (!window.buildExcel) await loadScript('excel.js');
    const buf = await buildExcel(expenses, lists, {catName, catIcon, hue});
    download(`gastos-${today()}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } catch (e) { alert('No se pudo generar el Excel: ' + e.message); }
  btn.textContent = txt; btn.disabled = false;
};
$('#expCsv').onclick = () => {
  if (!confirm('El CSV NO está cifrado. Guárdalo en un lugar seguro. ¿Exportar?')) return;
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['Fecha', 'Motivo', 'Comercio', 'Categoría', 'Etiquetas', 'Medio de pago', 'Moneda', 'Monto', 'CLP', 'Detalle', 'Notas', 'Boleta']].concat(
    expenses.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).map(e => [e.fecha, e.motivo, e.comercio, e.categoria, e.tags.join(' | '), e.pago, e.moneda, e.monto, e.clp,
      e.items.map(i => `${i.n} (${i.c}): ${i.m}`).join(' | '), e.notas, e.foto ? 'sí' : 'no']));
  download(`gastos-${today()}.csv`, '﻿' + rows.map(r => r.map(q).join(';')).join('\n'), 'text/csv');
};
$('#chgPw').onclick = async () => {
  const a = prompt('Nueva clave (mín. 4 caracteres):'); if (!a || a.length < 4) return;
  if (a !== prompt('Repite la nueva clave:')) { alert('No coinciden'); return; }
  const rows = await dbAll('exp'), prow = await dbAll('photo');
  const plain = []; for (const r of rows) plain.push([r.id, await decrypt(r)]);
  const pplain = []; for (const r of prow) pplain.push([r.id, await decrypt(r)]);
  const salt = crypto.getRandomValues(new Uint8Array(16)); key = await deriveKey(a, salt);
  for (const [id, b] of plain) await dbPut('exp', {id, ...(await encrypt(b))});
  for (const [id, b] of pplain) await dbPut('photo', {id, ...(await encrypt(b))});
  setMeta({salt: b64(salt), check: packRec(await encrypt(enc.encode('ok')))}); alert('Clave cambiada.');
};
$('#wipe').onclick = async () => {
  if (prompt('Se borrarán TODOS los gastos y boletas de este dispositivo. Escribe BORRAR para confirmar:') !== 'BORRAR') return;
  await dbClear('exp'); await dbClear('photo'); localStorage.removeItem('g_meta'); Object.values(LS).forEach(k => localStorage.removeItem(k)); loadLists(); lock();
};

(async () => {
  db = await openDB(); setupLockScreen();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
