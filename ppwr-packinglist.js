/* Wczytywanie dokumentu z archiwum Packing List (tabela packing_list_archive w Supabase albo plik archiwum JSON).
   Pozycje, kartony i palety trafiają do PPWR; „SKU / display” i „Displayów / karton” pochodzą z szablonów produktów.
   Wymaga ppwr.js, ppwr-storage-ui.js, ppwr-templates.js i supabase-store.js. */
(() => {
  'use strict';
  const N = x => Number(String(x ?? '').replace(',', '.')) || 0;
  const TABLE = 'packing_list_archive';
  const TT = () => window.PPWRTemplates;
  const S = v => String(v ?? '').trim();

  /* ---------- dostęp do chmury (klient bez sesji = rola anon, jak w Packing List) ---------- */
  let client = null;
  function getClient() {
    if (client) return client;
    const cfg = window.PPWRCloud && window.PPWRCloud.publicConfig;
    if (!cfg || !window.supabase) throw new Error('Brak połączenia z Supabase (nie załadowano biblioteki lub konfiguracji).');
    client = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return client;
  }
  async function listCloud() {
    const { data, error } = await getClient().from(TABLE)
      .select('number,saved_at,recipient:data->>recipient,created_at:data->>created_at,status:data->>status')
      .order('saved_at', { ascending: false }).limit(300);
    if (error) throw error;
    return data || [];
  }
  async function getCloud(number) {
    const { data, error } = await getClient().from(TABLE).select('number,data,saved_at').eq('number', number).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Nie znaleziono dokumentu ' + number + ' w chmurze.');
    return { ...(data.data || {}), number: data.number };
  }

  /* ---------- logika: pozycje, dopasowanie szablonów, kontrola ---------- */
  const nameOf = it => S(it.Produkt).replace(/\s*\/\s*\d{8,14}\s*$/, '').trim();
  const codes = it => [it.EAN_MC, it.EAN_D, it.EAN_P, it.SKU].map(S).filter(Boolean);
  const mainCode = it => [it.EAN_P, it.SKU, it.EAN_MC, it.EAN_D].map(S).find(Boolean) || '';

  function matchTemplate(it) {
    const T = TT(); if (!T) return '';
    for (const c of codes(it)) { const id = T.match({ name: nameOf(it), ean: c }); if (id) return id; }
    return T.match({ name: nameOf(it) }) || '';
  }

  function buildRows(doc) {
    const T = TT();
    return (doc.items || []).filter(x => x && N(x.Kartony) > 0).map(it => {
      const row = { src: it, on: true, name: nameOf(it), code: mainCode(it), cartons: N(it.Kartony), pcs: N(it.Sztuki), tplId: matchTemplate(it), spd: 0, dpc: 0 };
      row.matched = !!row.tplId;
      if (T && row.tplId) T.fillDefaults(row);
      return row;
    });
  }

  function check(row, g) {
    const spd = row.spd || g.spd, dpc = row.dpc || g.dpc, units = row.cartons * spd * dpc;
    const T = TT(), t = T && row.tplId && T.get(row.tplId), per = N(t && t.pcs);
    const f = v => Math.round(v * 100) / 100;
    if (!(row.pcs > 0)) return { ok: null, text: 'brak ilości w PL', units };
    if (Math.abs(row.pcs - units) < 0.5) return { ok: true, text: 'zgodne', units };
    if (per > 0 && Math.abs(row.pcs - units * per) < 0.5) return { ok: true, text: 'zgodne (PL w sztukach)', units };
    return { ok: false, text: 'PL: ' + f(row.pcs) + ', ze struktury: ' + f(units) + (per > 0 ? ' jedn. (' + f(units * per) + ' szt.)' : ''), units };
  }

  /* Zapis do bieżącego dokumentu PPWR. Zwraca komunikat o pozycjach bez szablonu (albo ''). */
  function applyDoc(doc, rows, head, o) {
    const T = TT(), on = rows.filter(r => r.on);
    on.forEach(r => {
      if (r.tplId === '__new' && T) {
        const nm = r.name || r.code || 'Nowy towar';
        const t = T.byName(nm) || T.upsertStructure(nm, r.spd || o.spd, r.dpc || o.dpc);
        r.tplId = t.id; r.created = true;
      }
    });
    s.skuPerDisplay = o.spd; s.displaysPerCarton = o.dpc;
    s.details ??= {};
    const idMap = {};
    s.skuSplit = on.map(r => {
      const id = 'it-' + Math.random().toString(36).slice(2, 9);
      idMap[r.src.id] = id; r._id = id;
      return { id, name: r.code ? r.name + ' / ' + r.code : r.name, cartons: Math.round(r.cartons * 100) / 100, spd: r.spd || o.spd, dpc: r.dpc || o.dpc };
    });
    let palletMsg = '';
    if (o.pallets && Array.isArray(doc.pallets) && doc.pallets.length) {
      const pal = doc.pallets.map(p => {
        const lines = (p.lines || []).filter(l => idMap[l.id] && N(l.cartons) > 0).map(l => ({ item: idMap[l.id], cartons: N(l.cartons) }));
        return lines.length ? { lines, cartons: lines.reduce((a, l) => a + l.cartons, 0), displays: lines.reduce((a, l) => a + lineDisplays(l), 0) } : null;
      }).filter(Boolean);
      if (pal.length) s.pallets = pal; else palletMsg = 'W Packing Liście nie ma palet z wybranymi pozycjami — podział na palety uzupełnij ręcznie.';
    } else if (o.pallets) palletMsg = 'Dokument z Packing Listu nie ma rozpisanych palet — podział na palety uzupełnij ręcznie.';
    const units = on.reduce((a, r) => a + r.cartons * (r.spd || o.spd) * (r.dpc || o.dpc), 0);
    const addr = [head.customerAddress].filter(Boolean).join(', ');
    Object.assign(s.details, {
      customer: head.customer || s.details.customer, customerAddress: addr || s.details.customerAddress,
      customerVat: head.customerVat || s.details.customerVat, batch: head.number || s.details.batch,
      issue: head.issue || s.details.issue, units: String(Math.round(units * 100) / 100),
    });
    s.packingListRef = { number: doc.number, loadedAt: new Date().toISOString() };
    if (T && o.remember) on.forEach(r => {
      if (r.tplId && r.tplId !== '__none' && !(r.matched && matchTemplate(r.src) === r.tplId)) T.remember({ name: r.name, ean: r.code || '' }, r.tplId);
    });
    let tplMsg = '';
    if (o.tpl && T && T.hasAny()) {
      if (!s.components.length || confirm('Rejestr komponentów nie jest pusty. Zastąpić go komponentami z szablonów?')) {
        const res = T.applyImport(on, { ship: o.ship });
        if (res.missing.length) tplMsg = 'Pozycje bez szablonu (komponenty dodaj ręcznie lub użyj sekcji „Szablony produktów i wysyłki”):\n• ' + res.missing.join('\n• ');
      }
    }
    save(); render();
    return [palletMsg, tplMsg].filter(Boolean).join('\n\n');
  }

  /* ---------- UI ---------- */
  function modal(inner) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:#0008;z-index:99;display:grid;place-items:center;padding:16px';
    wrap.innerHTML = '<div class="card" style="max-width:1000px;width:100%;max-height:90vh;overflow:auto;margin:0">' + inner + '</div>';
    document.body.append(wrap);
    return wrap;
  }

  function openPreview(doc) {
    const T = TT(), rows = buildRows(doc);
    if (!rows.length) return alert('Dokument ' + doc.number + ' nie ma pozycji z liczbą kartonów większą od zera.');
    const head = {
      customer: doc.recipient || '',
      customerAddress: [doc.recipient_address, [doc.recipient_zip, doc.recipient_city].filter(Boolean).join(' '), doc.recipient_country].filter(Boolean).join(', '),
      customerVat: '', number: doc.number || '', issue: doc.sent_at || doc.created_at || '',
    };
    const palCount = Array.isArray(doc.pallets) ? doc.pallets.length : 0;
    const wrap = modal(`<div class="heading"><div><h2>📦 Wczytanie z Packing List — podgląd</h2><p>Dokument ${esc(doc.number)}${doc.recipient ? ' · ' + esc(doc.recipient) : ''}. Popraw dane, zanim trafią do PPWR.</p></div></div>
      <div class="grid fields" id="plHead"></div>
      <div class="grid" style="margin:12px 0">
        <label>SKU / display (domyślnie, dla pozycji bez szablonu)<input id="plSpd" type="number" min="1" value="${N(s.skuPerDisplay) || 16}"></label>
        <label>Displayów / karton (domyślnie)<input id="plDpc" type="number" min="1" value="${N(s.displaysPerCarton) || 24}"></label>
      </div>
      <p class="hint">Kartony i palety pochodzą z Packing Listu. Struktura (SKU / display, displayów / karton) pochodzi z szablonu produktu; dla pozycji bez szablonu wpisz ją ręcznie i wybierz „➕ Nowy szablon”, a przy następnej wysyłce zostanie rozpoznana sama.</p>
      <div class="table-wrap"><table><thead><tr><th></th><th>Pozycja (SKU / EAN)</th><th>Ilość w PL</th><th>Kartony</th><th>Szablon produktu</th><th>SKU / display</th><th>Displayów / karton</th><th>Kontrola</th></tr></thead><tbody id="plRows"></tbody></table></div>
      <div class="inv-tpl-warn" id="plWarn" style="display:none"></div>
      <div class="checks">
        <label><input type="checkbox" id="plPallets" ${palCount ? 'checked' : ''}> Przenieś palety z Packing Listu (${palCount}) razem z podziałem kartonów na pozycje</label>
        <label><input type="checkbox" id="plTpl" checked> Uzupełnij rejestr komponentów szablonami wybranymi w tabeli</label>
        <label><input type="checkbox" id="plShip" checked> Dodaj szablon wysyłki (paleta, folie, taśmy, etykieta)</label>
        <label><input type="checkbox" id="plRemember" checked> Zapamiętaj wybrane szablony jako reguły (kod lub fragment nazwy)</label></div>
      <div class="split-msg" id="plSum"></div>
      <div style="display:flex;gap:8px;justify-content:end;margin-top:12px"><button id="plCancel" type="button">Anuluj</button><button id="plApply" type="button" class="primary">Zastosuj</button></div>`);

    const hd = wrap.querySelector('#plHead');
    [['customer', 'Klient / odbiorca'], ['customerAddress', 'Adres klienta'], ['customerVat', 'VAT ID klienta'], ['number', 'Nr dokumentu (partia / dowód)'], ['issue', 'Data wystawienia']].forEach(([k, l]) => {
      const lab = document.createElement('label'); lab.textContent = l;
      const i = document.createElement('input'); i.value = head[k] || ''; i.oninput = () => { head[k] = i.value; };
      lab.append(i); hd.append(lab);
    });
    const g = () => ({ spd: N(wrap.querySelector('#plSpd').value) || 1, dpc: N(wrap.querySelector('#plDpc').value) || 1 });
    const f = v => (Math.round(v * 100) / 100).toLocaleString('pl-PL');
    const paintSum = () => {
      const on = rows.filter(r => r.on), gg = g(), cart = on.reduce((a, r) => a + r.cartons, 0), bad = on.filter(r => check(r, gg).ok === false).length;
      const el = wrap.querySelector('#plSum');
      el.textContent = 'Razem: ' + f(cart) + ' kartonów w ' + on.length + ' pozycjach' + (bad ? ' · ' + bad + ' z niezgodną ilością' : '');
      el.className = 'split-msg ' + (bad ? 'er' : 'ok');
    };
    const paintWarn = () => {
      const miss = rows.filter(r => r.on && !r.tplId), box = wrap.querySelector('#plWarn');
      box.style.display = miss.length ? '' : 'none';
      box.textContent = miss.length ? 'Brak szablonu dla ' + miss.length + ' pozycji (' + miss.map(r => r.name).slice(0, 3).join(', ') + (miss.length > 3 ? '…' : '') + '). Wybierz istniejący szablon, „➕ Nowy szablon” albo „bez szablonu”.' : '';
    };
    const body = wrap.querySelector('#plRows');
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><input type="checkbox"></td><td data-n></td><td data-p></td><td data-c></td><td><select class="inv-tpl"></select></td><td><input type="number" min="1"></td><td><input type="number" min="1"></td><td data-k></td>';
      const [cb, sp, dp] = tr.querySelectorAll('input'), sel = tr.querySelector('select'), kc = tr.querySelector('[data-k]');
      cb.checked = true; tr.querySelector('[data-n]').textContent = r.code ? r.name + ' / ' + r.code : r.name;
      tr.querySelector('[data-p]').textContent = f(r.pcs); tr.querySelector('[data-c]').textContent = f(r.cartons);
      sel.innerHTML = '<option value="">— wybierz szablon —</option>' + (T ? T.list() : []).map(x => '<option value="' + x.id + '">' + esc(x.name || '(bez nazwy)') + '</option>').join('') + '<option value="__new">➕ Nowy szablon (z wartości obok)</option><option value="__none">(bez szablonu — ręcznie)</option>';
      sel.value = r.tplId || ''; if (sel.value !== (r.tplId || '')) sel.value = '';
      sel.classList.toggle('missing', !r.tplId);
      sp.value = r.spd || ''; sp.placeholder = String(g().spd); dp.value = r.dpc || ''; dp.placeholder = String(g().dpc);
      const paintK = () => {
        const c = check(r, g()); kc.textContent = (c.ok === true ? '✓ ' : c.ok === false ? '⚠ ' : '') + c.text;
        kc.style.color = c.ok === false ? '#b3261e' : c.ok === true ? '#1b7f3b' : '';
      };
      cb.onchange = () => { r.on = cb.checked; paintSum(); paintWarn(); };
      sel.onchange = () => {
        r.tplId = sel.value; sel.classList.toggle('missing', !r.tplId);
        if (T && r.tplId && r.tplId !== '__none' && r.tplId !== '__new') { r.spd = 0; r.dpc = 0; T.fillDefaults(r); sp.value = r.spd || ''; dp.value = r.dpc || ''; }
        paintK(); paintSum(); paintWarn();
      };
      sp.oninput = () => { r.spd = N(sp.value); paintK(); paintSum(); };
      dp.oninput = () => { r.dpc = N(dp.value); paintK(); paintSum(); };
      r._paint = paintK; paintK(); body.append(tr);
    });
    ['#plSpd', '#plDpc'].forEach(id => wrap.querySelector(id).oninput = () => { rows.forEach(r => r._paint && r._paint()); paintSum(); });
    paintSum(); paintWarn();

    wrap.querySelector('#plCancel').onclick = () => wrap.remove();
    wrap.querySelector('#plApply').onclick = () => {
      const on = rows.filter(r => r.on);
      if (!on.length) return alert('Zaznacz co najmniej jedną pozycję.');
      if ((s.skuSplit || []).length && !confirm('Zastąpić bieżące pozycje w „Podziale na SKU/EAN/TYPE” oraz palety danymi z Packing Listu?')) return;
      const gg = g();
      const msg = applyDoc(doc, rows, head, {
        spd: gg.spd, dpc: gg.dpc, pallets: wrap.querySelector('#plPallets').checked, tpl: wrap.querySelector('#plTpl').checked,
        ship: wrap.querySelector('#plShip').checked, remember: wrap.querySelector('#plRemember').checked,
      });
      wrap.remove(); if (msg) alert(msg);
    };
  }

  function openPicker() {
    const wrap = modal(`<div class="heading"><div><h2>📦 Wczytaj z Packing List</h2><p>Wybierz dokument z archiwum Packing List (chmura) albo wczytaj plik archiwum JSON.</p></div></div>
      <div class="tpl-tools"><label>Szukaj (numer, odbiorca)<input id="plQ"></label><button type="button" id="plReload">↻ Odśwież z chmury</button><button type="button" id="plFile">📂 Z pliku archiwum…</button><button type="button" id="plClose">Zamknij</button><input id="plFileIn" type="file" accept="application/json,.json" hidden></div>
      <p class="hint" id="plMsg">Pobieram listę dokumentów…</p>
      <div class="table-wrap"><table><thead><tr><th>Numer</th><th>Odbiorca</th><th>Data</th><th>Status</th><th></th></tr></thead><tbody id="plList"></tbody></table></div>`);
    let docs = [], local = null;
    const msg = (t, bad) => { const e = wrap.querySelector('#plMsg'); e.textContent = t; e.style.color = bad ? '#b3261e' : ''; };
    const paint = () => {
      const q = wrap.querySelector('#plQ').value.trim().toLowerCase(), body = wrap.querySelector('#plList'); body.innerHTML = '';
      docs.filter(d => !q || (d.number + ' ' + (d.recipient || '')).toLowerCase().includes(q)).slice(0, 150).forEach(d => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td></td><td></td><td></td><td></td><td><button type="button" class="primary">Wczytaj</button></td>';
        const c = tr.children; c[0].textContent = d.number; c[1].textContent = d.recipient || ''; c[2].textContent = d.created_at || ''; c[3].textContent = d.status || '';
        tr.querySelector('button').onclick = async () => {
          try {
            const full = local ? local.get(d.number) : await getCloud(d.number);
            wrap.remove(); openPreview(full);
          } catch (e) { console.error(e); msg('Nie udało się pobrać dokumentu: ' + (e.message || e), true); }
        };
        body.append(tr);
      });
    };
    const loadCloud = async () => {
      local = null; msg('Pobieram listę dokumentów…');
      try {
        docs = await listCloud(); paint();
        msg(docs.length ? 'Dokumentów w chmurze: ' + docs.length + '.' : 'Archiwum w chmurze jest puste albo brak polityki SELECT dla roli anon (w Packing List: „Kopiuj SQL tabeli”). Możesz wczytać plik archiwum JSON.', !docs.length);
      } catch (e) { console.error(e); docs = []; paint(); msg('Nie udało się pobrać archiwum z chmury: ' + (e.message || e) + '. Możesz wczytać plik archiwum JSON.', true); }
    };
    wrap.querySelector('#plQ').oninput = paint;
    wrap.querySelector('#plReload').onclick = loadCloud;
    wrap.querySelector('#plClose').onclick = () => wrap.remove();
    wrap.querySelector('#plFile').onclick = () => wrap.querySelector('#plFileIn').click();
    wrap.querySelector('#plFileIn').onchange = async ev => {
      const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
      try {
        const j = JSON.parse(await file.text()), arr = Array.isArray(j) ? j : (Array.isArray(j.docs) ? j.docs : []);
        if (!arr.length) throw new Error('plik nie zawiera dokumentów');
        local = new Map(arr.filter(x => x && x.number).map(x => [x.number, x]));
        docs = [...local.values()].map(x => ({ number: x.number, recipient: x.recipient, created_at: x.created_at, status: x.status }));
        paint(); msg('Wczytano z pliku: ' + docs.length + ' dokumentów.');
      } catch (e) { msg('Nie udało się odczytać pliku archiwum: ' + (e.message || e), true); }
    };
    loadCloud();
  }

  window.PPWRPackingList = { open: openPicker, openPreview, buildRows, check, matchTemplate, applyDoc };

  const bar = document.querySelector('header .actions');
  if (bar && !document.querySelector('#plImport')) {
    const btn = Object.assign(document.createElement('button'), { id: 'plImport', type: 'button', textContent: '📦 Wczytaj z Packing List' });
    btn.onclick = openPicker;
    const anchor = document.querySelector('#invoiceImport') || document.querySelector('#syncNow');
    anchor ? anchor.after(btn) : bar.prepend(btn);
  }
})();
