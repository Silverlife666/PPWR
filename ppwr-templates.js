/* Szablony produktów i wysyłki + reguły dopasowania + masa per pozycja.
   Wymaga ppwr.js i ppwr-storage-ui.js (ładowany po nich). Dane: s.templates, s.rules (zapisywane razem z dokumentem). */
(() => {
  'use strict';
  const N = x => Number(x) || 0;
  const uid = p => p + '-' + Math.random().toString(36).slice(2, 9);
  const openSet = new Set();

  /* ---------- dane ---------- */
  function tpl() {
    s.templates ??= {};
    s.templates.products ??= [];
    s.templates.shipping ??= { name: 'Wysyłka standardowa', components: [] };
    s.templates.shipping.components ??= [];
    s.rules ??= [];
    return s.templates;
  }
  const get = id => tpl().products.find(p => p.id === id);
  const list = () => tpl().products.map(p => ({ id: p.id, name: p.name, spd: p.spd, dpc: p.dpc }));
  const hasAny = () => tpl().products.length > 0 || tpl().shipping.components.length > 0;
  const strip = r => { const o = JSON.parse(JSON.stringify(r)); delete o.scope; delete o.from; delete o._imageId; return o; };
  function cloneRow(c, scope, from) {
    const o = strip(c);
    if (scope) o.scope = scope.slice();
    o.from = from;
    if (o.included === undefined) o.included = true;
    return o;
  }

  /* ---------- dopasowanie pozycji faktury do szablonu ---------- */
  const eanOf = it => (it.ean && String(it.ean).trim()) || ((String(it.name || '').match(/\b\d{13}\b/) || [])[0] || '');
  const nameOf = it => String(it.name || '').replace(/\s*\/\s*\d{13}\s*$/, '').trim();
  const esc2 = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function match(item) {
    tpl();
    const ean = eanOf(item), full = String(item.name || ''), nm = nameOf(item).toLowerCase();
    const rules = s.rules.filter(r => r && r.value && get(r.templateId));
    const code = r => {
      const v = String(r.value).trim();
      if (ean && v === ean) return true;
      return new RegExp('(^|[\\s/;,()])' + esc2(v) + '($|[\\s/;,()])', 'i').test(full);
    };
    const byCode = rules.find(r => (r.by === 'code' || r.by === 'ean') && code(r));
    if (byCode) return byCode.templateId;
    const c = rules.filter(r => r.by === 'contains' && nm.includes(String(r.value).trim().toLowerCase()))
      .sort((a, b) => String(b.value).length - String(a.value).length)[0];
    return c ? c.templateId : '';
  }
  function remember(item, templateId) {
    tpl();
    const ean = eanOf(item), by = ean ? 'code' : 'contains', value = ean || nameOf(item);
    if (!value || !get(templateId)) return;
    const old = s.rules.find(r => r.by === by && String(r.value).toLowerCase() === value.toLowerCase());
    if (old) old.templateId = templateId; else s.rules.push({ id: uid('rule'), by, value, templateId });
  }
  function fillDefaults(it) {
    const t = get(it.tplId);
    if (!t) return;
    if (N(t.spd) > 0) it.spd = N(t.spd);
    if (N(t.dpc) > 0) it.dpc = N(t.dpc);
  }

  /* ---------- wstawianie komponentów ---------- */
  function applyImport(items, opts) {
    tpl();
    const comps = [], missing = [];
    items.forEach(i => {
      const t = get(i.tplId);
      if (!t) { if (i.tplId !== '__none') missing.push(i.name); return; }
      (t.components || []).forEach(c => comps.push(cloneRow(c, [i._id], 'prod:' + t.id)));
    });
    if (opts && opts.ship) s.templates.shipping.components.forEach(c => comps.push(cloneRow(c, null, 'ship')));
    s.components = comps;
    return { missing };
  }
  function applyProductToItem(item, tid) {
    const t = get(tid);
    if (!t) return;
    const old = s.components.filter(r => String(r.from || '').startsWith('prod:') && Array.isArray(r.scope) && r.scope.length === 1 && r.scope[0] === item.id);
    if (old.length && !confirm('Pozycja „' + nameOf(item) + '” ma już ' + old.length + ' komponentów z szablonu. Zastąpić je?')) return;
    s.components = s.components.filter(r => !old.includes(r));
    (t.components || []).forEach(c => s.components.push(cloneRow(c, [item.id], 'prod:' + t.id)));
    if (N(t.spd) > 0) item.spd = N(t.spd);
    if (N(t.dpc) > 0) item.dpc = N(t.dpc);
    if (match(item) !== tid) remember(item, tid);
    save(); render();
  }
  function applyShipping() {
    const sh = tpl().shipping;
    if (!sh.components.length) return alert('Szablon wysyłki jest pusty.');
    const old = s.components.filter(r => r.from === 'ship');
    if (old.length && !confirm('Zastąpić ' + old.length + ' komponentów wysyłki z poprzedniego szablonu?')) return;
    s.components = s.components.filter(r => !old.includes(r));
    sh.components.forEach(c => s.components.push(cloneRow(c, null, 'ship')));
    save(); render();
  }

  /* ---------- UI: edytor szablonów ---------- */
  const h = html => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  const libRows = () => [...Object.values(componentLibrary).flat(), ...(s.componentDatabase || [])];
  const NUM = ['unit', 'sku', 'pallet', 'perCarton'];

  function compTable(rows, redraw) {
    const wrap = h('<div class="table-wrap"><table><thead><tr><th>Komponent</th><th>Poziom</th><th>Materiał</th><th>Surowiec</th><th>Masa jedn. (g)</th><th>Ilość / SKU</th><th>Ilość / paletę</th><th>Ilość / 1 karton zb.</th><th>Uwagi</th><th>PPWR</th><th></th></tr></thead><tbody></tbody></table></div>');
    const body = wrap.querySelector('tbody');
    if (!rows.length) body.innerHTML = '<tr><td colspan="11" style="color:#75839a">Brak komponentów — dodaj z bazy lub pusty wiersz.</td></tr>';
    rows.forEach((row, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = ['name', 'level', 'material', 'raw', 'unit', 'sku', 'pallet', 'perCarton', 'notes']
        .map(k => '<td><input data-k="' + k + '"' + (NUM.includes(k) ? ' type="number" min="0" step="0.001"' : '') + '></td>').join('')
        + '<td><input data-k="included" type="checkbox"></td><td class="row-actions"><button type="button" class="move-up" title="Wyżej">↑</button><button type="button" class="move-down" title="Niżej">↓</button><button type="button" class="delete" title="Usuń">×</button></td>';
      tr.querySelectorAll('[data-k]').forEach(x => {
        const k = x.dataset.k;
        if (x.type === 'checkbox') x.checked = row[k] !== false; else x.value = row[k] ?? '';
        x.oninput = () => { row[k] = x.type === 'checkbox' ? x.checked : x.value; save(); };
      });
      const mv = d => { const j = i + d; if (j < 0 || j >= rows.length) return; [rows[i], rows[j]] = [rows[j], rows[i]]; save(); redraw(); };
      tr.querySelector('.move-up').onclick = () => mv(-1);
      tr.querySelector('.move-down').onclick = () => mv(1);
      tr.querySelector('.delete').onclick = () => { rows.splice(i, 1); save(); redraw(); };
      body.append(tr);
    });
    return wrap;
  }

  function addTools(rows, redraw) {
    const box = h('<div class="tpl-tools"><label>Dodaj z bazy komponentów<select></select></label><button type="button" class="primary add-lib">＋ Dodaj</button><button type="button" class="add-empty">＋ Pusty wiersz</button></div>');
    const sel = box.querySelector('select'), lib = libRows();
    sel.innerHTML = lib.map((x, i) => '<option value="' + i + '">' + esc(x.name) + ' · ' + esc(x.material) + ' · ' + N(x.unit).toFixed(2) + ' g</option>').join('');
    box.querySelector('.add-lib').onclick = () => { const b = lib[N(sel.value)]; if (!b) return; rows.push({ ...strip(b), included: !standardNonPackaging.has(b.name) }); save(); redraw(); };
    box.querySelector('.add-empty').onclick = () => { rows.push({ included: true }); save(); redraw(); };
    return box;
  }

  function productBox(t) {
    const d = h('<details class="tpl-box"><summary></summary><div class="tpl-body"></div></details>');
    d.open = openSet.has(t.id);
    d.ontoggle = () => { d.open ? openSet.add(t.id) : openSet.delete(t.id); };
    d.querySelector('summary').textContent = (t.name || '(bez nazwy)') + ' · ' + (t.components || []).length + ' komponentów';
    const body = d.querySelector('.tpl-body');
    const head = h('<div class="tpl-head"><label class="grow">Nazwa szablonu (towar / TYPE)<input data-f="name"></label><label>SKU / display<input data-f="spd" type="number" min="1" step="1"></label><label>Displayów / karton<input data-f="dpc" type="number" min="1" step="1"></label><button type="button" class="dup">Duplikuj</button><button type="button" class="danger del">Usuń szablon</button></div>');
    head.querySelectorAll('[data-f]').forEach(x => {
      const k = x.dataset.f; x.value = t[k] ?? '';
      x.oninput = () => { t[k] = k === 'name' ? x.value : (N(x.value) > 0 ? N(x.value) : ''); save(); };
      if (k === 'name') x.onchange = renderTemplates;
    });
    head.querySelector('.dup').onclick = () => { openSet.add(t.id); const c = { ...JSON.parse(JSON.stringify(t)), id: uid('tpl'), name: (t.name || 'Szablon') + ' (kopia)' }; tpl().products.push(c); openSet.add(c.id); save(); renderTemplates(); };
    head.querySelector('.del').onclick = () => {
      if (!confirm('Usunąć szablon „' + (t.name || '') + '” oraz reguły do niego prowadzące? Komponenty już wstawione do dokumentu zostaną.')) return;
      tpl().products = tpl().products.filter(x => x.id !== t.id); s.rules = s.rules.filter(r => r.templateId !== t.id); save(); renderTemplates();
    };
    t.components ??= [];
    const redraw = () => { renderTemplates(); };
    body.append(head, compTable(t.components, () => { openSet.add(t.id); redraw(); }), addTools(t.components, () => { openSet.add(t.id); redraw(); }));
    return d;
  }

  function shippingBox() {
    const sh = tpl().shipping;
    const d = h('<details class="tpl-box"><summary></summary><div class="tpl-body"></div></details>');
    d.open = openSet.has('__ship');
    d.ontoggle = () => { d.open ? openSet.add('__ship') : openSet.delete('__ship'); };
    d.querySelector('summary').textContent = (sh.name || 'Wysyłka') + ' · ' + sh.components.length + ' komponentów';
    const redraw = () => { openSet.add('__ship'); renderTemplates(); };
    d.querySelector('.tpl-body').append(compTable(sh.components, redraw), addTools(sh.components, redraw));
    return d;
  }

  function rulesBlock() {
    const box = document.createElement('div');
    const T = tpl();
    if (!s.rules.length) box.append(h('<p class="hint">Brak reguł. Powstaną automatycznie, gdy przy imporcie faktury wybierzesz szablon dla nierozpoznanej pozycji, albo dodaj ręcznie.</p>'));
    s.rules.forEach((r, i) => {
      const row = h('<div class="tpl-rule"><label>Typ<select data-f="by"><option value="code">Kod / SKU / EAN (dokładnie)</option><option value="contains">Nazwa zawiera</option></select></label><label class="grow">Wartość<input data-f="value"></label><label class="grow">Szablon produktu<select data-f="templateId"></select></label><button type="button" class="delete" title="Usuń regułę">×</button></div>');
      const ts = row.querySelector('[data-f=templateId]');
      ts.innerHTML = '<option value="">— wybierz —</option>' + T.products.map(p => '<option value="' + p.id + '">' + esc(p.name || '(bez nazwy)') + '</option>').join('');
      row.querySelector('[data-f=by]').value = r.by === 'contains' ? 'contains' : 'code';
      row.querySelector('[data-f=value]').value = r.value || '';
      ts.value = r.templateId || '';
      row.querySelectorAll('[data-f]').forEach(x => { x.onchange = x.oninput = () => { r[x.dataset.f] = x.value; save(); }; });
      row.querySelector('.delete').onclick = () => { s.rules.splice(i, 1); save(); renderTemplates(); };
      box.append(row);
    });
    const add = h('<button type="button" class="add-line">+ Dodaj regułę</button>');
    add.onclick = () => { s.rules.push({ id: uid('rule'), by: 'code', value: '', templateId: '' }); save(); renderTemplates(); };
    box.append(add);
    return box;
  }

  function applyBlock() {
    const box = document.createElement('div');
    ensureItemIds();
    const items = s.skuSplit || [], T = tpl();
    if (!items.length) box.append(h('<p class="hint">Brak pozycji w sekcji „Podział na SKU/EAN/TYPE”. Zaimportuj fakturę albo dodaj pozycje ręcznie.</p>'));
    items.forEach(it => {
      const row = h('<div class="tpl-apply"><b></b><select></select><button type="button" class="primary">Wstaw komponenty</button></div>');
      row.querySelector('b').textContent = it.name || '(pozycja bez nazwy)';
      const sel = row.querySelector('select');
      sel.innerHTML = '<option value="">— wybierz szablon —</option>' + T.products.map(p => '<option value="' + p.id + '">' + esc(p.name || '(bez nazwy)') + '</option>').join('');
      sel.value = match(it) || '';
      row.querySelector('button').onclick = () => { if (!sel.value) return alert('Wybierz szablon produktu.'); applyProductToItem(it, sel.value); };
      box.append(row);
    });
    const ship = h('<div class="tpl-apply"><b>Elementy wysyłki (paleta, folie, taśmy)</b><button type="button" class="primary">Wstaw / zamień szablon wysyłki</button></div>');
    ship.querySelector('button').onclick = applyShipping;
    box.append(ship);
    return box;
  }

  function fromRegisterBlock() {
    ensureItemIds();
    const box = h('<div class="tpl-tools"><label>Zapisz bieżący rejestr jako szablon produktu — źródło<select></select></label><button type="button" class="mk-prod">Zapisz jako szablon produktu</button><button type="button" class="mk-ship">Zapisz elementy transportowe jako szablon wysyłki</button></div>');
    const sel = box.querySelector('select');
    sel.innerHTML = '<option value="">Cały rejestr (bez elementów transportowych)</option>' + (s.skuSplit || []).map(it => '<option value="' + it.id + '">Komponenty pozycji: ' + esc(it.name || '(bez nazwy)') + '</option>').join('');
    box.querySelector('.mk-prod').onclick = () => {
      const id = sel.value, it = id ? findItem(id) : null;
      const rows = s.components.filter(r => { const sc = scopeIds(r); return id ? sc && sc.includes(id) : !/transport/i.test(r.level || ''); });
      if (!rows.length) return alert('Brak komponentów do zapisania w wybranym źródle.');
      const name = prompt('Nazwa szablonu produktu:', it ? nameOf(it) : (s.details.product || ''));
      if (!name) return;
      const t = { id: uid('tpl'), name, spd: it ? itemSpd(it) : N(s.skuPerDisplay) || '', dpc: it ? itemDpc(it) : dpc(), components: rows.map(strip) };
      tpl().products.push(t); openSet.add(t.id); save(); renderTemplates();
    };
    box.querySelector('.mk-ship').onclick = () => {
      const rows = s.components.filter(r => !scopeIds(r) && /transport/i.test(r.level || ''));
      if (!rows.length) return alert('W rejestrze nie ma elementów transportowych bez przypisanej pozycji.');
      const sh = tpl().shipping;
      if (sh.components.length && !confirm('Zastąpić obecny szablon wysyłki (' + sh.components.length + ' komponentów)?')) return;
      sh.components = rows.map(strip); openSet.add('__ship'); save(); renderTemplates();
    };
    return box;
  }

  function renderTemplates() {
    const anchor = document.querySelector('.component-library');
    if (!anchor) return;
    let card = document.querySelector('#templatesCard');
    if (!card) { card = document.createElement('section'); card.id = 'templatesCard'; card.className = 'card tpl-card'; anchor.before(card); }
    tpl();
    card.innerHTML = '<div class="heading"><div><h2>Szablony produktów i wysyłki</h2><p>Szablon produktu to komponenty jednego towaru (np. okładka, kartonik, display, karton zbiorczy) wraz z jego „SKU / display” i „Displayów / karton”. Szablon wysyłki to elementy wspólne dla palety. Po imporcie faktury każda pozycja dostaje komponenty własnego szablonu — liczone tylko dla niej.</p></div></div>';
    card.append(h('<h3>Szablony produktów</h3>'));
    tpl().products.forEach(t => card.append(productBox(t)));
    const add = h('<button type="button" class="primary">+ Nowy szablon produktu</button>');
    add.onclick = () => { const t = { id: uid('tpl'), name: 'Nowy towar', spd: '', dpc: '', components: [] }; tpl().products.push(t); openSet.add(t.id); save(); renderTemplates(); };
    card.append(add, h('<h3>Szablon wysyłki</h3>'), shippingBox(), fromRegisterBlock(), h('<h3>Reguły dopasowania pozycji faktury</h3>'), rulesBlock(), h('<h3>Zastosuj do pozycji bieżącego dokumentu</h3>'), applyBlock());
    card.append(h('<p class="hint">Szablon ustawia też „SKU / display” i „Displayów / karton” danej pozycji. W wierszu rejestru kolumna „Dotyczy pozycji” pokazuje, do której pozycji należy komponent; puste = wszystkie pozycje / cała paleta.</p>'));
  }

  /* ---------- masa per pozycja ---------- */
  function renderItemMass() {
    const stats = document.querySelector('#stats');
    if (!stats) return;
    let box = document.querySelector('#itemMass');
    if (!box) { box = document.createElement('section'); box.id = 'itemMass'; box.className = 'card item-mass'; stats.after(box); }
    const c = calculated(), items = c.items || [];
    if (items.length < 2) { box.style.display = 'none'; return; }
    box.style.display = '';
    const f3 = v => N(v).toFixed(3), f0 = v => Math.round(N(v)).toLocaleString('pl-PL');
    const st = stats.querySelector('.stat');
    if (st && st.firstChild && st.firstChild.nodeType === 3) st.firstChild.nodeValue = 'ŚR. MASA NA 1 SKU (wszystkie pozycje)';
    box.innerHTML = '<h2>Masa według pozycji (SKU / EAN / TYPE)</h2><p>Komponenty przypisane do pozycji są liczone tylko dla niej; elementy paletowe rozdzielane są proporcjonalnie do liczby SKU pozycji na palecie.</p>'
      + '<div class="table-wrap"><table><thead><tr><th>Pozycja</th><th>Liczba SKU</th><th>Masa / SKU (g)</th><th>Masa pozycji w zamówieniu (kg)</th></tr></thead><tbody>'
      + items.map(it => '<tr><td>' + esc(it.name) + '</td><td>' + f0(it.sku) + '</td><td>' + f3(it.perSku) + '</td><td>' + f3(it.order / 1000) + '</td></tr>').join('')
      + '</tbody></table></div><h3>Podział materiałowy per pozycja</h3><div class="table-wrap"><table><thead><tr><th>Pozycja</th><th>Materiał</th><th>Masa / SKU (g)</th><th>Udział (%)</th><th>Masa w zamówieniu (kg)</th></tr></thead><tbody>'
      + items.flatMap(it => it.mats.map(m => '<tr><td>' + esc(it.name) + '</td><td>' + esc(m.m) + '</td><td>' + f3(m.perSku) + '</td><td>' + m.share.toFixed(1) + '</td><td>' + f3(m.order / 1000) + '</td></tr>')).join('')
      + '</tbody></table></div>'
      + (c.unassignedOrder > 0.0005 ? '<div class="split-msg er">✗ ' + f3(c.unassignedOrder / 1000) + ' kg masy zamówienia pochodzi z palet bez rozpisu na pozycje (paleta „prosta”) i nie jest przypisane do żadnej pozycji. Użyj „Paleta mix: rozpisz na pozycje”.</div>' : '');
  }

  /* ---------- podpięcie w istniejący render ---------- */
  const baseCalc = window.renderCalc;
  window.renderCalc = function () { baseCalc.apply(this, arguments); renderItemMass(); };
  const baseRender = window.render;
  window.render = function () { baseRender.apply(this, arguments); renderTemplates(); };

  window.PPWRTemplates = { list, get, hasAny, match, remember, fillDefaults, applyImport, applyProductToItem, applyShipping };
  renderTemplates();
  renderItemMass();
})();
