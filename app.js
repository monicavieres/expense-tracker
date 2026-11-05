'use strict';
const $ = s => document.querySelector(s);
const enc = new TextEncoder(), dec = new TextDecoder();
const DEFAULT_CATS = ['🏠 Vivienda','🛒 Supermercado','🚗 Transporte','💊 Salud','🎓 Educación','🍽️ Restaurantes y ocio','📺 Suscripciones','💡 Servicios básicos','👕 Ropa y hogar','🐾 Mascotas','💼 Trabajo/Negocio','💰 Ahorro/Deudas','📦 Otros'];
const clp = n => '$' + Math.round(n).toLocaleString('es-CL');
const usd = n => 'US$ ' + n.toLocaleString('es-CL', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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

/* ---------- Cifrado (clave -> PBKDF2 -> AES-GCM) ---------- */
let key = null;
const deriveKey = async (pw, salt) => {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
};
const encrypt = async (bytes, k = key) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {iv, ct: await crypto.subtle.encrypt({name: 'AES-GCM', iv}, k, bytes)};
};
const decrypt = (rec, k = key) => crypto.subtle.decrypt({name: 'AES-GCM', iv: rec.iv}, k, rec.ct);
const encJSON = async o => encrypt(enc.encode(JSON.stringify(o)));
const decJSON = async r => JSON.parse(dec.decode(await decrypt(r)));

const getMeta = () => { try { return JSON.parse(localStorage.getItem('g_meta')); } catch { return null; } };
const setMeta = m => localStorage.setItem('g_meta', JSON.stringify(m));
const packRec = r => ({iv: b64(r.iv), ct: b64(r.ct)});
const unpackRec = r => ({iv: new Uint8Array(unb64(r.iv)), ct: unb64(r.ct)});

/* ---------- Estado ---------- */
let expenses = [];
let cats = DEFAULT_CATS.slice();
let editing = null;      // gasto en edición
let photoBytes = null;   // Uint8Array JPEG nuevo, o 'DEL'
const loadCats = () => { try { const c = JSON.parse(localStorage.getItem('g_cats')); if (Array.isArray(c) && c.length) cats = c; } catch {} };
const saveCats = () => localStorage.setItem('g_cats', JSON.stringify(cats));
const catIcon = c => (c || '').split(' ')[0] || '📦';

async function loadExpenses() {
  const rows = await dbAll('exp');
  expenses = [];
  for (const r of rows) { try { const e = await decJSON(r); e.id = r.id; expenses.push(e); } catch {} }
  expenses.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado - a.creado);
}

/* ---------- Bloqueo ---------- */
let idleTimer;
const lockUI = $('#lock');
function setupLockScreen() {
  const meta = getMeta();
  $('#pw').value = $('#pw2').value = ''; $('#lockErr').textContent = '';
  $('#pw2').hidden = !!meta;
  $('#restoreWrap').hidden = !!meta;
  $('#lockMsg').textContent = meta ? 'Ingresa tu clave' : 'Primera vez: crea una clave. No se puede recuperar si la olvidas.';
  $('#lockBtn').textContent = meta ? 'Entrar' : 'Crear clave';
  $('#pw').autocomplete = meta ? 'current-password' : 'new-password';
}
function lock() {
  key = null; expenses = []; editing = null;
  $('#dlg').close?.(); $('#app').hidden = true; lockUI.hidden = false; setupLockScreen();
}
$('#lockForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const pw = $('#pw').value, meta = getMeta(), err = $('#lockErr'); err.textContent = '';
  try {
    if (!meta) {
      if (pw !== $('#pw2').value) { err.textContent = 'Las claves no coinciden'; return; }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(pw, salt);
      const check = await encrypt(enc.encode('ok'));
      setMeta({salt: b64(salt), check: packRec(check)});
    } else {
      const k = await deriveKey(pw, new Uint8Array(unb64(meta.salt)));
      try { await decrypt(unpackRec(meta.check), k); } catch { err.textContent = 'Clave incorrecta'; return; }
      key = k;
    }
    await loadExpenses(); loadCats();
    lockUI.hidden = true; $('#app').hidden = false; showTab('list'); initFilters(); render();
    bumpIdle();
  } catch (e) { err.textContent = 'Error: ' + e.message; }
});
const bumpIdle = () => { clearTimeout(idleTimer); if (key) idleTimer = setTimeout(lock, 5 * 60 * 1000); };
['click', 'keydown', 'touchstart'].forEach(e => addEventListener(e, bumpIdle, {passive: true}));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (key && hiddenAt && Date.now() - hiddenAt > 60000) lock();
});
let hiddenAt = 0;
$('#lockNow').onclick = lock;

/* ---------- Pestañas ---------- */
const TITLES = {list: 'Gastos', sum: 'Resumen', set: 'Ajustes'};
function showTab(t) {
  document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== 'tab-' + t);
  document.querySelectorAll('.bar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#title').textContent = TITLES[t]; render();
}
document.querySelectorAll('.bar [data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));

/* ---------- Render ---------- */
const sumClp = list => list.reduce((s, e) => s + e.clp, 0);
const usdPart = list => list.filter(e => e.moneda === 'USD');
function statsHTML(list) {
  const u = usdPart(list), uTot = u.reduce((s, e) => s + e.monto, 0);
  return `<div class="stat"><small>Total (CLP)</small><b>${clp(sumClp(list))}</b></div>
    <div class="stat"><small>Gastos</small><b>${list.length}</b></div>` +
    (u.length ? `<div class="stat"><small>En dólares</small><b>${usd(uTot)}</b><small>= ${clp(sumClp(u))} cobrado</small></div>` : '');
}
function initFilters() {
  $('#fMonth').value = $('#sMonth').value = today().slice(0, 7);
  const opts = '<option value="">Todas las categorías</option>' + cats.map(c => `<option>${esc(c)}</option>`).join('');
  $('#fCat').innerHTML = opts;
}
function render() {
  if (!key) return;
  // lista
  const m = $('#fMonth').value, c = $('#fCat').value, q = $('#fText').value.trim().toLowerCase();
  const list = expenses.filter(e => (!m || e.fecha.startsWith(m)) && (!c || e.categoria === c) &&
    (!q || (e.motivo + ' ' + (e.comercio || '') + ' ' + (e.notas || '')).toLowerCase().includes(q)));
  $('#totals').innerHTML = statsHTML(list);
  $('#empty').hidden = list.length > 0;
  $('#list').innerHTML = list.map(e => `<li class="item" data-id="${e.id}">
    <div class="ico">${catIcon(e.categoria)}</div>
    <div class="mid"><div class="mot">${esc(e.motivo)}</div>
      <div class="sub">${e.fecha.split('-').reverse().join('/')} · ${esc(e.comercio || e.categoria.replace(/^\S+\s/, ''))} · ${esc(e.pago)}${e.foto ? ' · 📎' : ''}</div></div>
    <div class="amt">${clp(e.clp)}${e.moneda === 'USD' ? `<small>${usd(e.monto)}</small>` : ''}</div></li>`).join('');
  document.querySelectorAll('.item').forEach(li => li.onclick = () => openForm(expenses.find(e => e.id === li.dataset.id)));
  // resumen
  const sm = $('#sMonth').value, sl = expenses.filter(e => !sm || e.fecha.startsWith(sm));
  $('#sTotals').innerHTML = statsHTML(sl);
  const by = {}; sl.forEach(e => by[e.categoria] = (by[e.categoria] || 0) + e.clp);
  const tot = sumClp(sl) || 1;
  $('#byCat').innerHTML = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="bar-row"><div class="h"><span>${esc(k)}</span><span>${clp(v)} · ${Math.round(v / tot * 100)}%</span></div><div class="track"><div class="fill" style="width:${v / tot * 100}%"></div></div></div>`).join('') || '<p class="muted">Sin datos.</p>';
  const base = sm ? new Date(sm + '-01T12:00:00') : new Date(), ms = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(base.getFullYear(), base.getMonth() - i, 1, 12); ms.push(d.toISOString().slice(0, 7)); }
  const vals = ms.map(k => sumClp(expenses.filter(e => e.fecha.startsWith(k)))), max = Math.max(...vals, 1);
  $('#byMonth').innerHTML = ms.map((k, i) => `<div class="mcol"><span>${vals[i] ? clp(vals[i] / 1000) + 'k' : ''}</span><div style="height:${vals[i] / max * 100}%"></div>${k.slice(5)}/${k.slice(2, 4)}</div>`).join('');
  // categorías
  $('#catList').innerHTML = cats.map(c => `<span class="chip">${esc(c)}</span>`).join('');
}
['#fMonth', '#fCat', '#fText', '#sMonth'].forEach(s => $(s).addEventListener('input', render));

/* ---------- Formulario ---------- */
const dlg = $('#dlg');
function syncCurrency() {
  const isUsd = $('#fMoneda').value === 'USD';
  $('#lblMonto').firstChild.textContent = isUsd ? 'Monto USD *' : 'Monto CLP *';
  $('#lblClp').hidden = !isUsd; $('#fClp').required = isUsd;
  const m = parseNum($('#fMonto').value), c = parseNum($('#fClp').value);
  $('#rate').hidden = !(isUsd && m > 0 && c > 0);
  if (isUsd && m > 0 && c > 0) $('#rate').textContent = `Tipo de cambio efectivo: ${clp(c / m)} por dólar`;
}
const parseNum = s => { s = String(s).trim().replace(/\s/g, ''); if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return parseFloat(s) || 0; };
['#fMoneda', '#fMonto', '#fClp'].forEach(s => $(s).addEventListener('input', syncCurrency));

async function openForm(e) {
  editing = e || null; photoBytes = null;
  $('#dlgTitle').textContent = e ? 'Editar gasto' : 'Nuevo gasto';
  $('#fCategoria').innerHTML = cats.map(c => `<option>${esc(c)}</option>`).join('');
  $('#fMotivo').value = e?.motivo || ''; $('#fComercio').value = e?.comercio || '';
  $('#fFecha').value = e?.fecha || today(); $('#fMoneda').value = e?.moneda || 'CLP';
  $('#fMonto').value = e ? String(e.monto).replace('.', ',') : ''; $('#fClp').value = e && e.moneda === 'USD' ? e.clp : '';
  if (e && !cats.includes(e.categoria)) $('#fCategoria').insertAdjacentHTML('beforeend', `<option>${esc(e.categoria)}</option>`);
  $('#fCategoria').value = e?.categoria || cats[0]; $('#fPago').value = e?.pago || 'Débito'; $('#fNotas').value = e?.notas || '';
  $('#delBtn').hidden = !e; syncCurrency(); setPhoto(null);
  if (e?.foto) { const rec = (await tx('photo', 'readonly', s => s.get(e.id))); if (rec) setPhoto(new Uint8Array(await decrypt(rec))); }
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
  const id = editing?.id || crypto.randomUUID();
  const hadPhoto = !!editing?.foto;
  const foto = photoBytes === 'DEL' ? false : (photoBytes ? true : hadPhoto);
  const e = {motivo: $('#fMotivo').value.trim(), comercio: $('#fComercio').value.trim(), fecha: $('#fFecha').value, moneda, monto, clp: clpVal,
    categoria: $('#fCategoria').value, pago: $('#fPago').value, notas: $('#fNotas').value.trim(), foto, creado: editing?.creado || Date.now()};
  await dbPut('exp', {id, ...(await encJSON(e))});
  if (photoBytes === 'DEL') await dbDel('photo', id);
  else if (photoBytes) await dbPut('photo', {id, ...(await encrypt(photoBytes))});
  dlg.close(); await loadExpenses(); render();
});
$('#delBtn').onclick = async () => {
  if (!editing || !confirm('¿Eliminar este gasto y su boleta?')) return;
  await dbDel('exp', editing.id); await dbDel('photo', editing.id);
  dlg.close(); await loadExpenses(); render();
};

/* ---------- Ajustes ---------- */
$('#addCat').onclick = () => {
  const n = prompt('Nombre de la categoría (puedes empezar con un emoji, ej: 🎁 Regalos)'); if (!n?.trim()) return;
  cats.push(n.trim()); saveCats(); initFilters(); render();
};
const download = (name, data, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], {type})); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
$('#expBackup').onclick = async () => {
  const meta = getMeta();
  const out = {v: 1, salt: meta.salt, check: meta.check, cats, exp: (await dbAll('exp')).map(r => ({id: r.id, ...packRec(r)})), photo: (await dbAll('photo')).map(r => ({id: r.id, ...packRec(r)}))};
  download(`respaldo-gastos-${today()}.json`, JSON.stringify(out), 'application/json');
};
async function restoreFrom(file) {
  const d = JSON.parse(await file.text());
  if (d.v !== 1 || !d.salt || !d.check) throw new Error('Archivo no válido');
  await dbClear('exp'); await dbClear('photo');
  for (const r of d.exp) await dbPut('exp', {id: r.id, ...unpackRec(r)});
  for (const r of d.photo) await dbPut('photo', {id: r.id, ...unpackRec(r)});
  setMeta({salt: d.salt, check: d.check}); if (d.cats) localStorage.setItem('g_cats', JSON.stringify(d.cats));
}
$('#restore').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  if (!confirm('Esto REEMPLAZA los datos de este dispositivo por los del respaldo, y se usará la clave del respaldo. ¿Continuar?')) return;
  try { await restoreFrom(f); alert('Respaldo restaurado. Entra con la clave del respaldo.'); lock(); } catch (e) { alert('No se pudo restaurar: ' + e.message); }
});
$('#restoreFirst').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  try { await restoreFrom(f); loadCats(); setupLockScreen(); $('#lockErr').textContent = 'Respaldo cargado. Ingresa su clave.'; } catch (e) { $('#lockErr').textContent = 'No se pudo restaurar: ' + e.message; }
});
$('#expCsv').onclick = () => {
  if (!confirm('El CSV NO está cifrado. Guárdalo en un lugar seguro. ¿Exportar?')) return;
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['Fecha', 'Motivo', 'Comercio', 'Categoría', 'Medio de pago', 'Moneda', 'Monto', 'CLP', 'Notas', 'Boleta']].concat(
    expenses.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).map(e => [e.fecha, e.motivo, e.comercio, e.categoria, e.pago, e.moneda, e.monto, e.clp, e.notas, e.foto ? 'sí' : 'no']));
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
  await dbClear('exp'); await dbClear('photo'); localStorage.removeItem('g_meta'); localStorage.removeItem('g_cats'); cats = DEFAULT_CATS.slice(); lock();
};

/* ---------- Inicio ---------- */
(async () => {
  db = await openDB(); setupLockScreen();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
