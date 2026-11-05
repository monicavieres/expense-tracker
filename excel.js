'use strict';
/* Exporta los gastos a un Excel con formato: resumen, hojas por mes, detalle de compras, etc. Requiere ExcelJS. */
async function buildExcel(expenses, lists, helpers) {
  const {catName, catIcon, hue} = helpers;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mis gastos'; wb.created = new Date();
  const CLP = '"$"#,##0;[Red]-"$"#,##0', USD = '"US$" #,##0.00', DATE = 'dd/mm/yyyy';
  const hex = (h, s, l) => { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l),
    f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
    return 'FF' + (f(0) + f(8) + f(4)).toUpperCase(); };
  const soft = c => hex(hue(c), 70, 90), strong = c => hex(hue(c), 55, 40);
  const solid = argb => ({type: 'pattern', pattern: 'solid', fgColor: {argb}});
  const TEAL = 'FF0F766E', GREY = 'FFF1F4F6', thin = {style: 'thin', color: {argb: 'FFD5DCE3'}};
  const box = {top: thin, bottom: thin, left: thin, right: thin};
  const MES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const mName = m => `${MES[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const dt = f => new Date(f + 'T12:00:00');
  const months = [...new Set(expenses.map(e => e.fecha.slice(0, 7)))].sort();
  const sorted = expenses.slice().sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creado - b.creado);

  const title = (ws, text, sub, cols) => {
    ws.mergeCells(1, 1, 1, cols); const c = ws.getCell(1, 1); c.value = text;
    c.font = {size: 16, bold: true, color: {argb: 'FFFFFFFF'}}; c.fill = solid(TEAL); c.alignment = {vertical: 'middle'}; ws.getRow(1).height = 30;
    ws.mergeCells(2, 1, 2, cols); const s = ws.getCell(2, 1); s.value = sub; s.font = {italic: true, color: {argb: 'FF6B7785'}};
  };
  const head = (row, color = TEAL) => row.eachCell(c => { c.font = {bold: true, color: {argb: 'FFFFFFFF'}}; c.fill = solid(color); c.border = box; c.alignment = {horizontal: 'center', vertical: 'middle', wrapText: true}; });
  const body = (ws, from, to, ncols) => { for (let r = from; r <= to; r++) for (let c = 1; c <= ncols; c++) { const cell = ws.getCell(r, c); cell.border = box; cell.alignment = {vertical: 'middle', wrapText: true}; if (r % 2 === 0 && !cell.fill?.fgColor) cell.fill = solid(GREY); } };
  const catCell = (cell, cat) => { cell.fill = solid(soft(cat)); cell.font = {bold: true, color: {argb: strong(cat)}}; };

  /* ---------- Todos los gastos (base de las fórmulas) ---------- */
  const T = wb.addWorksheet('Todos los gastos', {views: [{state: 'frozen', ySplit: 3}]});
  const TCOLS = [['Fecha', 12], ['Mes', 9], ['Motivo', 38], ['Comercio', 22], ['Categoría', 24], ['Etiquetas', 30], ['Medio de pago', 14], ['Moneda', 9], ['Monto', 14], ['Monto CLP', 14], ['Notas', 40], ['Boleta', 8]];
  title(T, 'Todos los gastos', `Generado el ${new Date().toLocaleDateString('es-CL')} · usa los filtros de cada columna`, TCOLS.length);
  T.getRow(3).values = TCOLS.map(c => c[0]); TCOLS.forEach((c, i) => T.getColumn(i + 1).width = c[1]); head(T.getRow(3));
  sorted.forEach((e, i) => {
    const r = T.getRow(4 + i);
    r.values = [dt(e.fecha), e.fecha.slice(0, 7), e.motivo, e.comercio || '', e.categoria, e.tags.join(' | '), e.pago, e.moneda, e.monto, e.clp, e.notas || '', e.foto ? 'sí' : 'no'];
    r.getCell(1).numFmt = DATE; r.getCell(9).numFmt = e.moneda === 'USD' ? USD : CLP; r.getCell(10).numFmt = CLP;
  });
  const tLast = 3 + sorted.length; body(T, 4, Math.max(tLast, 4), TCOLS.length);
  sorted.forEach((e, i) => catCell(T.getCell(4 + i, 5), e.categoria));
  T.autoFilter = {from: {row: 3, column: 1}, to: {row: Math.max(tLast, 3), column: TCOLS.length}};
  const tr = T.getRow(tLast + 1); tr.getCell(3).value = 'TOTAL'; tr.getCell(10).value = {formula: `SUBTOTAL(109,J4:J${tLast})`, result: sorted.reduce((s, e) => s + e.clp, 0)};
  tr.getCell(10).numFmt = CLP; tr.font = {bold: true}; tr.getCell(3).alignment = {horizontal: 'right'};
  const TR = n => `'Todos los gastos'!$${n}$4:$${n}$${Math.max(tLast, 4)}`; // rangos para fórmulas

  /* ---------- Detalle de compras (ítems) ---------- */
  const lines = []; sorted.forEach(e => e.items.forEach(i => lines.push({e, i})));
  const D = wb.addWorksheet('Detalle de compras', {views: [{state: 'frozen', ySplit: 3}]});
  const DCOLS = [['Fecha', 12], ['Mes', 9], ['Comercio', 22], ['Compra (motivo)', 36], ['Ítem', 34], ['Tipo de ítem', 26], ['Monto CLP', 14]];
  title(D, 'Detalle de compras por ítem', 'Qué compraste dentro de cada boleta, clasificado por tipo de ítem', DCOLS.length);
  D.getRow(3).values = DCOLS.map(c => c[0]); DCOLS.forEach((c, i) => D.getColumn(i + 1).width = c[1]); head(D.getRow(3));
  lines.forEach(({e, i}, k) => {
    const r = D.getRow(4 + k), v = Math.round(i.m * (e.monto ? e.clp / e.monto : 1));
    r.values = [dt(e.fecha), e.fecha.slice(0, 7), e.comercio || '', e.motivo, i.n, i.c, v]; r.getCell(1).numFmt = DATE; r.getCell(7).numFmt = CLP;
  });
  const dLast = 3 + lines.length; body(D, 4, Math.max(dLast, 4), DCOLS.length);
  lines.forEach(({i}, k) => catCell(D.getCell(4 + k, 6), i.c));
  if (lines.length) D.autoFilter = {from: {row: 3, column: 1}, to: {row: dLast, column: DCOLS.length}};
  const DR = n => `'Detalle de compras'!$${n}$4:$${n}$${Math.max(dLast, 4)}`;

  /* ---------- Resumen ---------- */
  const R = wb.addWorksheet('Resumen', {properties: {tabColor: {argb: TEAL}}});
  const NC = Math.max(months.length + 2, 5);
  title(R, 'Resumen de gastos', `Generado el ${new Date().toLocaleDateString('es-CL')} · los totales se recalculan si editas las hojas`, NC);
  R.getColumn(1).width = 30; for (let c = 2; c <= NC + 1; c++) R.getColumn(c).width = 15;
  let row = 4;
  const section = (t) => { const c = R.getCell(row, 1); c.value = t; c.font = {size: 13, bold: true, color: {argb: TEAL}}; row++; };
  const sumBy = (fn) => expenses.reduce((s, e) => s + fn(e), 0);

  // A) Por mes
  section('Total por mes');
  R.getRow(row).values = ['Mes', 'Gastos', 'Total CLP', 'Variación vs mes anterior']; head(R.getRow(row)); const aHead = row++;
  const aFirst = row;
  months.forEach((m, i) => {
    const l = expenses.filter(e => e.fecha.startsWith(m)), tot = sumBy(e => e.fecha.startsWith(m) ? e.clp : 0), prev = i ? sumBy(e => e.fecha.startsWith(months[i - 1]) ? e.clp : 0) : 0;
    const r = R.getRow(row); r.getCell(1).value = cap(mName(m));
    r.getCell(2).value = {formula: `COUNTIF(${TR('B')},"${m}")`, result: l.length};
    r.getCell(3).value = {formula: `SUMIFS(${TR('J')},${TR('B')},"${m}")`, result: tot}; r.getCell(3).numFmt = CLP;
    if (i) { r.getCell(4).value = {formula: `IF(C${row - 1}=0,"",C${row}/C${row - 1}-1)`, result: prev ? tot / prev - 1 : ''}; r.getCell(4).numFmt = '+0%;-0%;0%'; }
    row++;
  });
  body(R, aFirst, row - 1, 4);
  if (months.length) {
    R.addConditionalFormatting({ref: `C${aFirst}:C${row - 1}`, rules: [{type: 'dataBar', gradient: false, cfvo: [{type: 'min'}, {type: 'max'}], color: {argb: 'FF5EC4B6'}}]});
    R.addConditionalFormatting({ref: `D${aFirst}:D${row - 1}`, rules: [{type: 'cellIs', operator: 'greaterThan', formulae: [0], style: {font: {color: {argb: 'FFC0392B'}}}}, {type: 'cellIs', operator: 'lessThan', formulae: [0], style: {font: {color: {argb: 'FF0F766E'}}}}]});
  }
  const tot = R.getRow(row); tot.getCell(1).value = 'TOTAL'; tot.getCell(2).value = {formula: `SUM(B${aFirst}:B${row - 1})`, result: expenses.length};
  tot.getCell(3).value = {formula: `SUM(C${aFirst}:C${row - 1})`, result: sumBy(e => e.clp)}; tot.getCell(3).numFmt = CLP; tot.font = {bold: true}; row += 2;

  // matriz genérica: filas × meses con colorScale
  const matrix = (titleTxt, rowsKeys, rowHead, formulaFor, valueFor, colorFn) => {
    section(titleTxt);
    R.getRow(row).values = [rowHead, ...months.map(m => cap(mName(m)).replace(/ (\d{4})/, ' $1')), 'Total']; head(R.getRow(row)); row++;
    const first = row;
    rowsKeys.forEach(k => {
      const r = R.getRow(row), c0 = r.getCell(1); c0.value = k; if (colorFn) colorFn(c0, k);
      months.forEach((m, i) => { const cell = r.getCell(2 + i); cell.value = {formula: formulaFor(k, m), result: valueFor(k, m)}; cell.numFmt = CLP; });
      const lastCol = R.getColumn(months.length + 1).letter; r.getCell(months.length + 2).value = {formula: `SUM(B${row}:${lastCol}${row})`, result: months.reduce((s, m) => s + valueFor(k, m), 0)};
      r.getCell(months.length + 2).numFmt = CLP; r.getCell(months.length + 2).font = {bold: true}; row++;
    });
    if (rowsKeys.length && months.length) {
      const lc = R.getColumn(months.length + 1).letter;
      R.addConditionalFormatting({ref: `B${first}:${lc}${row - 1}`, rules: [{type: 'colorScale', cfvo: [{type: 'min'}, {type: 'max'}], color: [{argb: 'FFFFFFFF'}, {argb: 'FF5EC4B6'}]}]});
    }
    body(R, first, row - 1, months.length + 2); row += 1;
  };
  const cats = [...new Set(expenses.map(e => e.categoria))].sort((a, b) => sumBy(e => e.categoria === b ? e.clp : 0) - sumBy(e => e.categoria === a ? e.clp : 0));
  matrix('Por categoría y mes', cats, 'Categoría', (k, m) => `SUMIFS(${TR('J')},${TR('E')},"${k.replace(/"/g, '""')}",${TR('B')},"${m}")`,
    (k, m) => sumBy(e => e.categoria === k && e.fecha.startsWith(m) ? e.clp : 0), (c, k) => catCell(c, k));
  const tagKeys = [...new Set([...lists.tags, ...expenses.flatMap(e => e.tags)])];
  matrix('Por etiqueta y mes (un gasto con varias etiquetas cuenta en cada una)', tagKeys, 'Etiqueta', (k, m) => `SUMIFS(${TR('J')},${TR('F')},"*${k.replace(/"/g, '""')}*",${TR('B')},"${m}")`,
    (k, m) => sumBy(e => e.tags.includes(k) && e.fecha.startsWith(m) ? e.clp : 0), (c, k) => { c.font = {bold: true}; });
  if (lines.length) {
    const itKeys = [...new Set(lines.map(({i}) => i.c))].sort((a, b) => lines.filter(l => l.i.c === b).length - lines.filter(l => l.i.c === a).length);
    const vOf = ({e, i}) => Math.round(i.m * (e.monto ? e.clp / e.monto : 1));
    matrix('Detalle de compras por tipo de ítem y mes', itKeys, 'Tipo de ítem', (k, m) => `SUMIFS(${DR('G')},${DR('F')},"${k.replace(/"/g, '""')}",${DR('B')},"${m}")`,
      (k, m) => lines.reduce((s, l) => s + (l.i.c === k && l.e.fecha.startsWith(m) ? vOf(l) : 0), 0), (c, k) => catCell(c, k));
  }

  /* ---------- Compras en USD ---------- */
  const us = sorted.filter(e => e.moneda === 'USD');
  if (us.length) {
    const U = wb.addWorksheet('Compras en USD', {views: [{state: 'frozen', ySplit: 3}]});
    title(U, 'Compras en dólares', 'Tipo de cambio efectivo = lo que cobró tu tarjeta ÷ dólares', 7);
    U.getRow(3).values = ['Fecha', 'Motivo', 'Comercio', 'Monto USD', 'Cobrado CLP', 'Tipo de cambio', 'Medio de pago']; head(U.getRow(3));
    [12, 36, 22, 14, 14, 16, 14].forEach((w, i) => U.getColumn(i + 1).width = w);
    us.forEach((e, i) => { const r = U.getRow(4 + i); r.values = [dt(e.fecha), e.motivo, e.comercio || '', e.monto, e.clp, {formula: `E${4 + i}/D${4 + i}`, result: e.clp / e.monto}, e.pago];
      r.getCell(1).numFmt = DATE; r.getCell(4).numFmt = USD; r.getCell(5).numFmt = CLP; r.getCell(6).numFmt = '"$"#,##0.00'; });
    body(U, 4, 3 + us.length, 7);
    const t = U.getRow(4 + us.length); t.getCell(2).value = 'TOTAL'; t.getCell(4).value = {formula: `SUM(D4:D${3 + us.length})`, result: us.reduce((s, e) => s + e.monto, 0)}; t.getCell(5).value = {formula: `SUM(E4:E${3 + us.length})`, result: us.reduce((s, e) => s + e.clp, 0)};
    t.getCell(4).numFmt = USD; t.getCell(5).numFmt = CLP; t.font = {bold: true};
  }

  /* ---------- Una hoja por mes ---------- */
  const palette = ['FF0F766E', 'FF1D4ED8', 'FF7C3AED', 'FFB45309', 'FFBE185D', 'FF047857'];
  months.forEach((m, mi) => {
    const l = sorted.filter(e => e.fecha.startsWith(m)), ws = wb.addWorksheet(`${m} ${MES[+m.slice(5) - 1]}`, {properties: {tabColor: {argb: palette[mi % palette.length]}}, views: [{state: 'frozen', ySplit: 3}]});
    const cols = [['Fecha', 12], ['Motivo', 38], ['Comercio', 22], ['Categoría', 24], ['Etiquetas', 30], ['Pago', 13], ['Monto', 14], ['Monto CLP', 14], ['Detalle de la compra', 52]];
    title(ws, cap(mName(m)), `${l.length} gasto${l.length === 1 ? '' : 's'} · ordenados por fecha`, cols.length);
    ws.getRow(3).values = cols.map(c => c[0]); cols.forEach((c, i) => ws.getColumn(i + 1).width = c[1]); head(ws.getRow(3), palette[mi % palette.length]);
    l.forEach((e, i) => { const r = ws.getRow(4 + i);
      r.values = [dt(e.fecha), e.motivo, e.comercio || '', e.categoria, e.tags.join(' | '), e.pago, e.monto, e.clp, e.items.map(x => `${x.n}: ${Math.round(x.m).toLocaleString('es-CL')}`).join(' · ')];
      r.getCell(1).numFmt = DATE; r.getCell(7).numFmt = e.moneda === 'USD' ? USD : CLP; r.getCell(8).numFmt = CLP; r.getCell(9).alignment = {wrapText: true, vertical: 'top'}; });
    const last = 3 + l.length; body(ws, 4, last, cols.length); l.forEach((e, i) => catCell(ws.getCell(4 + i, 4), e.categoria));
    ws.autoFilter = {from: {row: 3, column: 1}, to: {row: last, column: cols.length}};
    const t = ws.getRow(last + 1); t.getCell(2).value = 'TOTAL DEL MES'; t.getCell(8).value = {formula: `SUBTOTAL(109,H4:H${last})`, result: l.reduce((s, e) => s + e.clp, 0)};
    t.getCell(8).numFmt = CLP; t.font = {bold: true, size: 12}; t.eachCell(c => c.fill = solid('FFD9F1EE'));
    // subtotal por categoría
    let r0 = last + 4; ws.getCell(r0 - 1, 2).value = 'Por categoría'; ws.getCell(r0 - 1, 2).font = {bold: true, size: 12, color: {argb: TEAL}};
    const mc = [...new Set(l.map(e => e.categoria))].sort((a, b) => l.filter(e => e.categoria === b).reduce((s, e) => s + e.clp, 0) - l.filter(e => e.categoria === a).reduce((s, e) => s + e.clp, 0));
    mc.forEach((c, i) => { const rr = r0 + i; const cc = ws.getCell(rr, 2); cc.value = c; catCell(cc, c); cc.border = box;
      const v = ws.getCell(rr, 3); v.value = {formula: `SUMIFS($H$4:$H$${last},$D$4:$D$${last},B${rr})`, result: l.filter(e => e.categoria === c).reduce((s, e) => s + e.clp, 0)}; v.numFmt = CLP; v.border = box;
      const p = ws.getCell(rr, 4); p.value = {formula: `C${rr}/$H$${last + 1}`, result: l.reduce((s, e) => s + e.clp, 0) ? l.filter(e => e.categoria === c).reduce((s, e) => s + e.clp, 0) / l.reduce((s, e) => s + e.clp, 0) : 0}; p.numFmt = '0%'; p.border = box; });
    if (mc.length) ws.addConditionalFormatting({ref: `C${r0}:C${r0 + mc.length - 1}`, rules: [{type: 'dataBar', gradient: false, cfvo: [{type: 'min'}, {type: 'max'}], color: {argb: 'FF5EC4B6'}}]});
    ws.pageSetup = {orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0};
  });

  // Orden de hojas: Resumen, meses (cronológico), Detalle, USD, Todos
  const order = ['Resumen', ...months.map(m => `${m} ${MES[+m.slice(5) - 1]}`), 'Detalle de compras', 'Compras en USD', 'Todos los gastos'];
  wb.worksheets.forEach(ws => ws.orderNo = order.indexOf(ws.name));
  return wb.xlsx.writeBuffer();
}
