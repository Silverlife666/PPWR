document.querySelector('.eyebrow')?.append(' · build szablony-20261112-4');
/* Widok obrazów dla prywatnego Supabase Storage. W JSON przechowywana jest wyłącznie ścieżka storage://. */
window.renderImageLists = function renderImageListsFromStorage() {
  const box = document.querySelector('#stageImages');
  if (!box) return;
  box.innerHTML = '';
  const outside = [...s.components.filter(row => row.included === false), ...s.excluded];
  const active = s.components.filter(row => row.included !== false);
  const items = [
    ...outside.map(row => ({ row, key: `stage-${imageId(row)}`, label: 'Poza PPWR: ' })),
    ...active.map((row, index) => ({ row, key: `stage-${imageId(row)}`, label: `Etap ${String(index + 1).padStart(2, '0')}: ` })),
  ];
  items.forEach(({ row, key, label }) => {
    const storedValue = s.stageImages?.[key] || '';
    const src = PPWRCloud.imageSource(storedValue);
    const article = document.createElement('article');
    article.className = 'image-upload';
    article.innerHTML = `<b>${label}${esc(row.name || 'Komponent bez nazwy')}</b><div><input type="file" accept="image/png,image/jpeg,image/gif,image/webp"><button class="remove-image" ${storedValue ? '' : 'hidden'}>Usuń zdjęcie</button></div>${src ? `<img src="${src}" alt="${esc(row.name)}">` : ''}`;
    article.querySelector('input').onchange = event => readImage(event.target.files[0], data => {
      s.stageImages ??= {};
      s.stageImages[key] = data;
      save();
      renderImageLists();
      renderDiagram();
    });
    article.querySelector('.remove-image').onclick = () => {
      delete s.stageImages[key];
      save();
      renderImageLists();
      renderDiagram();
    };
    box.append(article);
  });
};

window.renderDiagram = function renderDiagramFromStorage() {
  const box = document.querySelector('#packagingDiagram');
  if (!box) return;
  const outside = [...s.components.filter(row => row.included === false), ...s.excluded];
  const active = s.components.filter(row => row.included !== false);
  const items = [...outside.map(row => ({ row, number: null })), ...active.map((row, index) => ({ row, number: index + 1 }))];
  box.innerHTML = items.length ? items.map(({ row, number }) => {
    const src = PPWRCloud.imageSource(s.stageImages?.[`stage-${imageId(row)}`] || '');
    return `<div class="diagram-step">${number ? `<span>${number}</span>` : '<span class="outside-step">—</span>'}${src ? `<img src="${src}" alt="">` : '<i>brak zdjęcia</i>'}<b>${esc(row.name || 'Komponent')}</b></div>`;
  }).join('<em class="diagram-arrow">→</em>') : '<p>Dodaj komponenty do PPWR, aby utworzyć diagram.</p>';
};

const originalLoadPdfImage = window.loadPdfImage;
window.loadPdfImage = source => originalLoadPdfImage(PPWRCloud.imageSource(source));

const archiveCard = document.querySelector('#archive')?.closest('.card');
if (archiveCard) {
  archiveCard.querySelector('h2').textContent = 'Archiwum PPWR w chmurze';
  const description = archiveCard.querySelector('.heading p');
  if (description) description.textContent = 'Zapisywane rekordy są synchronizowane z Supabase i zachowane również w lokalnej kopii awaryjnej.';
}

const actions = document.querySelector('header .actions');
if (actions && !document.querySelector('#pdfLanguage')) {
  const language = document.createElement('label');
  language.className = 'pdf-language';
  language.innerHTML = 'Język PDF <select id="pdfLanguage"><option value="pl">Polski</option><option value="en">English</option></select>';
  const firstPdfButton = document.querySelector('#massPdf');
  actions.insertBefore(language, firstPdfButton);
}
if (actions && !document.querySelector('#syncNow')) {
  const button = document.createElement('button');
  button.id = 'syncNow';
  button.type = 'button';
  button.textContent = '☁️ Synchronizuj teraz';
  button.onclick = async () => {
    button.disabled = true;
    try {
      await PPWRCloud.syncNow(s);
    } finally {
      button.disabled = false;
    }
  };
  actions.prepend(button);
}

const notice = document.querySelector('.notice');
const authCard = document.createElement('section');
authCard.className = 'card';
authCard.id = 'ppwrAuth';
if (notice) notice.insertAdjacentElement('afterend', authCard);

function applyCloudState(value) {
  s = value && typeof value === 'object' ? value : {};
  s.archive ??= [];
  s.componentDatabase ??= [];
  s.translations ??= {};
  s.componentImages ??= {};
  s.stageImages ??= {};
  s.components ??= [];
  s.excluded ??= [];
  s.pallets ??= [{ displays: 0 }];
  s.details ??= {};
  s.checks ??= [];
  localStorage.setItem(K, JSON.stringify(s));
}

function renderAuthentication() {
  const current = PPWRCloud.currentUser();
  if (current?.email) {
    authCard.innerHTML = `<div class="heading"><div><h2>🔐 Dostęp do danych PPWR</h2><p>Zalogowano jako ${esc(current.email)}. Dokument jest dostępny również po zalogowaniu na innym urządzeniu.</p></div><button id="logoutPPWR" type="button">Wyloguj</button></div>`;
    authCard.querySelector('#logoutPPWR').onclick = async () => {
      await PPWRCloud.signOut();
      location.reload();
    };
    return;
  }
  authCard.innerHTML = `<div class="heading"><div><h2>🔐 Dostęp do danych PPWR</h2><p>Obecnie korzystasz z tymczasowej sesji tego urządzenia. Zaloguj się, aby używać tego samego dokumentu na wielu urządzeniach.</p></div></div><div class="grid fields"><label>E-mail<input id="ppwrEmail" type="email" autocomplete="email" placeholder="adres@firma.pl"></label><label>Hasło<input id="ppwrPassword" type="password" autocomplete="current-password" minlength="6" placeholder="co najmniej 6 znaków"></label></div><p><button id="loginPPWR" class="primary" type="button">Zaloguj</button> <button id="registerPPWR" type="button">Utwórz konto</button></p>`;
  const submit = async action => {
    const email = authCard.querySelector('#ppwrEmail').value.trim();
    const password = authCard.querySelector('#ppwrPassword').value;
    if (!email || password.length < 6) return alert('Podaj prawidłowy e-mail i hasło mające co najmniej 6 znaków.');
    const buttons = authCard.querySelectorAll('button');
    buttons.forEach(button => { button.disabled = true; });
    try {
      const next = action === 'login'
        ? await PPWRCloud.signIn(email, password, s)
        : await PPWRCloud.signUp(email, password, s);
      applyCloudState(next);
      render();
      renderAuthentication();
    } catch (error) {
      alert(error.message || 'Nie udało się zalogować.');
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  };
  authCard.querySelector('#loginPPWR').onclick = () => submit('login');
  authCard.querySelector('#registerPPWR').onclick = () => submit('register');
}
window.addEventListener('ppwr-auth-changed', renderAuthentication);
renderAuthentication();

/* PDFMake zapisuje tekst i tabele jako natywne obiekty PDF, a nie jako zrzuty canvasu. */
const pdfBlue = '#174578';
const pdfLine = '#CBD8E6';
const pdfPaleBlue = '#E9F0F8';
const pdfInk = '#17233A';
const pdfMakeDocumentHeader = language => (currentPage, pageCount) => ({
  columns: [
    { stack: [{ text: 'EMBURN', bold: true, color: '#FFFFFF', fontSize: 12 }, { text: language === 'pl' ? 'DOKUMENTACJA PPWR' : 'PPWR DOCUMENTATION', color: '#DCEAF8', fontSize: 6, characterSpacing: 0.7 }], fillColor: pdfBlue, margin: [12, 7, 12, 7], width: 132 },
    { text: language === 'pl' ? 'ROZPORZĄDZENIE W SPRAWIE OPAKOWAŃ I ODPADÓW OPAKOWANIOWYCH' : 'PACKAGING AND PACKAGING WASTE REGULATION', alignment: 'right', color: '#617694', bold: true, fontSize: 7, margin: [0, 13, 36, 0] },
  ], margin: [36, 16, 0, 0], columnGap: 10,
});
const pdfFooter = language => (currentPage, pageCount) => ({
  columns: [
    { text: language === 'pl' ? 'System Zarządzania Produkcją - Emburn' : 'Production Management System - Emburn', color: '#667996', fontSize: 7, bold: true },
    { text: language === 'pl' ? `DOKUMENT POUFNY  •  STRONA ${currentPage} / ${pageCount}` : `CONFIDENTIAL DOCUMENT  •  PAGE ${currentPage} / ${pageCount}`, alignment: 'right', color: '#667996', fontSize: 7, bold: true },
  ], margin: [36, 0, 36, 18],
});
const pdfTitle = (text, subtitle) => ([
  { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 770, y2: 0, lineWidth: 1.4, lineColor: pdfBlue }], margin: [0, 0, 0, 12] },
  { text, style: 'title' },
  { text: subtitle.toUpperCase(), style: 'subtitle' },
]);
const pdfMakeTable = (headers, rows, widths) => ({
  table: { headerRows: 1, dontBreakRows: true, widths, body: [headers.map(value => ({ text: value, style: 'tableHeader' })), ...rows] },
  layout: {
    hLineColor: () => pdfLine, vLineColor: () => pdfLine,
    fillColor: row => row === 0 ? pdfBlue : (row % 2 === 0 ? '#F6F9FC' : '#FFFFFF'),
    paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 4, paddingBottom: () => 4,
  },
});
const pdfMakeMetaTable = rows => ({
  table: {
    widths: ['17%', '33%', '17%', '33%'],
    body: rows.map(row => row.map((value, index) => index % 2 === 0
      ? { text: value, bold: true, fontSize: 7, color: '#203A5B', fillColor: '#E6EEF7' }
      : { text: value || '—', fontSize: 7, color: pdfInk }
    )),
  },
  layout: {
    hLineColor: () => pdfLine, vLineColor: () => pdfLine,
    paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 4, paddingBottom: () => 4,
  },
});
const pdfSection = text => ({ columns: [{ width: 5, canvas: [{ type: 'rect', x: 0, y: 0, w: 5, h: 15, color: pdfBlue }] }, { text, style: 'section' }], columnGap: 7, margin: [0, 16, 0, 7] });
const pdfMetric = (label, value) => ({
  table: { widths: ['*'], body: [[{
    stack: [{ text: label, fontSize: 7, bold: true, color: '#DCEAF8', alignment: 'center', margin: [0, 2, 0, 5] }, { text: value, fontSize: 14, bold: true, color: '#FFFFFF', alignment: 'center', margin: [0, 0, 0, 2] }],
    fillColor: pdfBlue,
  }]] },
  layout: 'noBorders',
});
const pdfLang = () => document.querySelector('#pdfLanguage')?.value || 'pl';
const pdfNumber = value => {
  const text = Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
  return pdfLang() === 'pl' ? text.replace(/,/g, '\u00A0') : text;
};
const pdfPalletRange = ids => {
  const pl = pdfLang() === 'pl';
  const n = ids.map(x => x + 1);
  const contiguous = n.every((v, k) => k === 0 || v === n[k - 1] + 1);
  const nums = n.length === 1 ? String(n[0]) : n.length > 2 && contiguous ? `${n[0]}–${n[n.length - 1]}` : pl ? n.slice(0, -1).join(', ') + ' i ' + n[n.length - 1] : n.slice(0, -1).join(', ') + ' & ' + n[n.length - 1];
  return (pl ? (n.length === 1 ? 'Paleta ' : 'Palety ') : (n.length === 1 ? 'Pallet ' : 'Pallets ')) + nums;
};
const pdfPalletQty = row => {
  const list = (s.pallets || []).map((p, i) => ({ p, i })).filter(x => palletDisplays(x.p) > 0);
  if (!(Number(row.perCarton) > 0) || !list.length) return pdfNumber(row.pallet);
  const values = list.map(x => palletQty(row, x.p));
  if (values.every(v => v === values[0])) return pdfNumber(values[0]);
  const pl = pdfLang() === 'pl', unit = pl ? 'szt.' : 'pcs';
  const groups = [];
  values.forEach((v, k) => { const g = groups.find(x => x.v === v); if (g) g.ids.push(list[k].i); else groups.push({ v, ids: [list[k].i] }); });
  return groups.map(g => `${pdfPalletRange(g.ids)}:\n${g.ids.length > 1 ? (pl ? 'po ' : 'each ') : ''}${pdfNumber(g.v)} ${unit}`).join('\n');
};
const dataUriForPdf = async value => {
  const source = PPWRCloud.imageSource(value);
  if (!source) return null;
  if (source.startsWith('data:image/')) return source;
  const response = await fetch(source);
  if (!response.ok) return null;
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};
const pdfMakeLoadCanvasImage = source => new Promise(resolve => {
  if (!source) return resolve(null);
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = source;
});
const pdfMakeLegacyDiagram = async items => {
  const columns = 10;
  const rows = Math.max(1, Math.ceil(items.length / columns));
  const width = 1684;
  const height = Math.max(360, 135 + (rows - 1) * 255 + 148 + 40);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#F6F8FC';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#E6EEF7';
  ctx.fillRect(0, 0, width, 12);
  const cardW = 130, cardH = 148, gap = 30, startX = 80, startY = 135, rowGap = 255;
  const position = index => {
    const row = Math.floor(index / columns);
    const slot = index % columns;
    const col = row % 2 === 0 ? slot : columns - 1 - slot;
    return { x: startX + col * (cardW + gap), y: startY + row * rowGap, row };
  };
  const arrow = (x1, y1, x2, y2) => {
    ctx.strokeStyle = '#2C6DB7'; ctx.fillStyle = '#2C6DB7'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const angle = Math.atan2(y2 - y1, x2 - x1), size = 12;
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - size * Math.cos(angle - .5), y2 - size * Math.sin(angle - .5)); ctx.lineTo(x2 - size * Math.cos(angle + .5), y2 - size * Math.sin(angle + .5)); ctx.closePath(); ctx.fill();
  };
  for (let index = 0; index < items.length - 1; index += 1) {
    const current = position(index), next = position(index + 1);
    if (current.row === next.row) arrow(current.x + cardW + 5, current.y + cardH / 2, next.x - 8, next.y + cardH / 2);
    else {
      const right = current.row % 2 === 0, edge = right ? width - 48 : 48;
      arrow(right ? current.x + cardW + 5 : current.x - 5, current.y + cardH / 2, edge, current.y + cardH / 2);
      arrow(edge, current.y + cardH / 2, edge, next.y + cardH / 2);
      arrow(edge, next.y + cardH / 2, right ? next.x + cardW + 5 : next.x - 8, next.y + cardH / 2);
    }
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index], pos = position(index);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(pos.x, pos.y, cardW, cardH);
    ctx.strokeStyle = item.number ? '#2C6DB7' : '#BFCDE0'; ctx.lineWidth = item.number ? 3 : 2; ctx.strokeRect(pos.x, pos.y, cardW, cardH);
    if (item.number) {
      ctx.fillStyle = '#174578'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'; ctx.fillText(String(item.number), pos.x + cardW / 2, pos.y - 48);
      arrow(pos.x + cardW / 2, pos.y - 38, pos.x + cardW / 2, pos.y - 8);
    }
    const image = await pdfMakeLoadCanvasImage(item.image);
    if (image) {
      const ratio = Math.min((cardW - 18) / image.width, 82 / image.height);
      const drawW = image.width * ratio, drawH = image.height * ratio;
      ctx.drawImage(image, pos.x + (cardW - drawW) / 2, pos.y + 10 + (82 - drawH) / 2, drawW, drawH);
    } else {
      ctx.fillStyle = '#EAF0F7'; ctx.fillRect(pos.x + 10, pos.y + 10, cardW - 20, 82);
      ctx.fillStyle = '#6A7E98'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.fillText('NO IMAGE', pos.x + cardW / 2, pos.y + 55);
    }
    const name = String(item.name || 'Component');
    ctx.fillStyle = '#183F70'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
    const words = name.split(/\s+/); let line = '', y = pos.y + 112;
    for (const word of words) { const proposed = `${line} ${word}`.trim(); if (ctx.measureText(proposed).width > cardW - 12 && line) { ctx.fillText(line, pos.x + cardW / 2, y); y += 14; line = word; } else line = proposed; }
    if (line) ctx.fillText(line, pos.x + cardW / 2, y);
  }
  return canvas.toDataURL('image/png');
};
const basePdfDefinition = (orientation, content, language) => ({
  pageSize: 'A4', pageOrientation: orientation, pageMargins: [36, 66, 36, 48],
  defaultStyle: { font: 'Roboto', fontSize: 8, color: pdfInk },
  styles: {
    title: { fontSize: 19, bold: true, color: '#183F70', margin: [0, 0, 0, 4] },
    subtitle: { fontSize: 7.5, bold: true, color: '#667996', characterSpacing: 0.45, margin: [0, 0, 0, 17] },
    section: { fontSize: 10.5, bold: true, color: '#183F70', margin: [0, 1, 0, 0] },
    tableHeader: { color: '#FFFFFF', bold: true, fontSize: 7, alignment: 'center' },
  },
  header: pdfMakeDocumentHeader(language),
  footer: pdfFooter(language),
  content,
});

async function downloadTextPdf(kind) {
  if (!window.pdfMake) return alert('Nie udało się załadować biblioteki PDF. Sprawdź połączenie z internetem i spróbuj ponownie.');
  const language = document.querySelector('#pdfLanguage')?.value || 'pl';
  const pl = language === 'pl';
  const label = (polish, english) => pl ? polish : english;
  const rowText = value => pl ? (value || '—') : translateEN(value || '');
  const data = s.details || {};
  const date = data.issue || new Date().toISOString().slice(0, 10);
  const calc = calculated();
  const { total, materials } = calc;
  const multi = (calc.items || []).length > 1;
  const active = s.components.filter(row => row.included !== false);
  const anyScope = s.components.some(r => scopeIds(r));
  const scopeText = row => scopeLabel(row) || label('wszystkie', 'all');
  let definition;
  if (kind === 'doc') {
    definition = basePdfDefinition('portrait', [
      ...pdfTitle(label('DEKLARACJA ZGODNOŚCI UE (PPWR)', 'EU DECLARATION OF CONFORMITY (PPWR)'), `${label('Data wystawienia', 'Issue date')}: ${date}`),
      pdfSection(label('1. DANE PRODUCENTA / WYSTAWCY DEKLARACJI', '1. MANUFACTURER / DECLARATION ISSUER DETAILS')),
      pdfMakeMetaTable([
        [label('Nazwa firmy', 'Company name'), data.company, label('NIP', 'VAT ID'), data.vat],
        [label('Adres rejestrowy', 'Registered address'), data.address, label('Data wystawienia', 'Issue date'), date],
        [label('Osoba kontaktowa', 'Contact person'), data.contact, label('Miejsce wystawienia', 'Place of issue'), data.place],
      ]),
      pdfSection(label('2. DANE KLIENTA / ODBIORCY', '2. CUSTOMER / CONSIGNEE DETAILS')),
      pdfMakeMetaTable([
        [label('Nazwa firmy', 'Company name'), data.customer, label('NIP', 'VAT ID'), data.customerVat],
        [label('Adres rejestrowy', 'Registered address'), data.customerAddress, label('Marka', 'Brand'), data.brand],
      ]),
      pdfSection(label('3. PRZEDMIOT DEKLARACJI', '3. SUBJECT OF DECLARATION')),
      pdfMakeTable([label('Lp.', 'No.'), label('Produkt / komponent', 'Product / component'), 'SKU / EAN', label('Partia / dowód', 'Batch / evidence')], (s.skuSplit || []).length > 1 ? s.skuSplit.map((it, i) => { const m = String(it.name || '').match(/^(.*?)\s*\/\s*(\d{13})\s*$/); return [String(i + 1), (m ? m[1] : it.name) || '—', m ? m[2] : '—', data.batch || '—']; }) : [['1', data.product || '—', data.sku || '—', data.batch || '—']], ['8%', '42%', '25%', '25%']),
      pdfSection(label('4. OŚWIADCZENIE O ZGODNOŚCI Z PPWR', '4. EU COMPLIANCE STATEMENT')),
      { text: label('Wystawca oświadcza na własną odpowiedzialność, że wymienione opakowanie zostało ocenione pod kątem właściwych wymagań rozporządzenia (UE) 2025/40 w sprawie opakowań i odpadów opakowaniowych (PPWR).', 'The issuer declares, under its sole responsibility, that the listed packaging is assessed against the applicable requirements of Regulation (EU) 2025/40 on packaging and packaging waste (PPWR).'), lineHeight: 1.35, margin: [0, 0, 0, 7] },
      { ul: (pl ? statements : statementsEN).map((statement, index) => ({ text: [{ text: `${statement}: `, bold: true }, { text: s.checks[index] === false ? label('NIE POTWIERDZONO', 'NOT CONFIRMED') : label('POTWIERDZONO PRZEZ PRZYGOTOWUJĄCEGO', 'CONFIRMED BY PREPARER'), color: s.checks[index] === false ? '#9D2020' : '#21633A', bold: true }] })), margin: [0, 5, 0, 0] },
      pdfSection(label('5. DOKUMENTACJA UZUPEŁNIAJĄCA / PLIK TECHNICZNY', '5. SUPPORTING DOCUMENTATION / TECHNICAL FILE')),
      { text: s.supporting || '—', lineHeight: 1.3 },
      pdfSection(label('6. OSOBA UPOWAŻNIONA I PODPIS', '6. AUTHORISED ISSUE AND SIGNATURE')),
      { text: label(`Osoba upoważniona: ${s.authorised || '—'}\n\nPodpis i pieczęć firmowa: _________________________________________________`, `Authorised person: ${s.authorised || '—'}\n\nSignature and company stamp: _________________________________________________`) },
    ], language);
  } else {
    const componentRows = active.map((row, index) => [
      index + 1, rowText(row.name), rowText(row.level), rowText(row.material), row.raw || '',
      pdfNumber(row.unit), pdfNumber(row.sku), pdfPalletQty(row), ...(anyScope ? [scopeText(row)] : []), row.notes || '',
    ]);
    const excluded = [...s.components.filter(row => row.included === false), ...s.excluded];
    const excludedRows = excluded.map((row, index) => [index + 1, rowText(row.name), rowText(row.level), rowText(row.material), row.raw || '', pdfNumber(row.unit), pdfNumber(row.sku), pdfPalletQty(row), ...(anyScope ? [scopeLabel(row) || '—'] : [])]);
    const materialRows = Object.entries(materials).map(([material, value]) => [material, value.sku.toFixed(3), total.sku ? (value.sku / total.sku * 100).toFixed(1) : '0.0', (value.pallet / 1000).toFixed(3), (value.order / 1000).toFixed(3)]);
    const f3 = v => Number(v).toFixed(3);
    const itemSections = multi ? [
      pdfSection(label('3a. Masa na 1 SKU według pozycji', '3a. Mass per 1 SKU by item')),
      pdfMakeTable([label('Lp.', 'No.'), label('Pozycja (SKU / EAN / TYPE)', 'Item (SKU / EAN / TYPE)'), label('Liczba SKU', 'SKU units'), label('Masa / SKU (g)', 'Mass / SKU (g)'), label('Masa pozycji w zamówieniu (kg)', 'Item mass in order (kg)')], calc.items.map((it, i) => [i + 1, it.name, pdfNumber(it.sku), f3(it.perSku), f3(it.order / 1000)]), [20, '*', 80, 90, 150]),
      pdfSection(label('3b. Podział masy według materiałów i pozycji', '3b. Material mass split by item')),
      pdfMakeTable([label('Pozycja', 'Item'), label('Materiał', 'Material'), label('Masa / SKU (g)', 'Mass / SKU (g)'), label('Udział (%)', 'Share (%)'), label('Masa w zamówieniu (kg)', 'Mass in order (kg)')], calc.items.flatMap(it => it.mats.map(m => [it.name, rowText(m.m), f3(m.perSku), m.share.toFixed(1), f3(m.order / 1000)])), ['*', 110, 90, 70, 120]),
      { text: label('Komponenty przypisane do pozycji są liczone wyłącznie dla niej. Elementy paletowe (paleta, folie, taśmy, etykiety) rozdzielono proporcjonalnie do liczby SKU danej pozycji na palecie.', 'Components assigned to an item are counted for that item only. Pallet-level elements (pallet, films, straps, labels) are allocated in proportion to the item\u2019s SKU count on the pallet.'), lineHeight: 1.3, fontSize: 8, margin: [0, 4, 0, 0] },
      ...(calc.unassignedOrder > 0.0005 ? [{ text: label(`Uwaga: ${f3(calc.unassignedOrder / 1000)} kg masy zamówienia pochodzi z palet bez rozpisu na pozycje i nie jest przypisane do żadnej pozycji.`, `Note: ${f3(calc.unassignedOrder / 1000)} kg of the order mass comes from pallets without an item breakdown and is not assigned to any item.`), color: '#9D2020', fontSize: 8, margin: [0, 3, 0, 0] }] : []),
    ] : [];
    const diagramItems = [...excluded.map(row => ({ row, number: null })), ...active.map((row, index) => ({ row, number: index + 1 }))];
    const legacyDiagram = await pdfMakeLegacyDiagram(await Promise.all(diagramItems.map(async item => ({
      number: item.number,
      name: rowText(item.row.name || label('Komponent', 'Component')),
      image: await dataUriForPdf(s.stageImages?.[`stage-${imageId(item.row)}`]),
    }))));
    definition = basePdfDefinition('landscape', [
      ...pdfTitle(label('SPECYFIKACJA MASY I MATERIAŁÓW OPAKOWANIA', 'PACKAGING MASS AND MATERIAL SPECIFICATION'), `${label('Oświadczenie techniczne PPWR B2B', 'PPWR B2B technical statement')} • ${label('Data wystawienia', 'Issue date')}: ${date}`),
      pdfMakeMetaTable([
        [label('Produkt / pozycja', 'Product / item'), data.product, 'SKU / EAN', data.sku],
        [label('Klient / marka', 'Client / brand'), data.brand, label('Data wystawienia', 'Issue date'), date],
        [label('NIP wystawcy', 'Issuer VAT ID / NIP'), data.issuer, label('Wersja dokumentu', 'Document version'), data.version],
        [label('Liczba SKU w zamówieniu', 'SKU units in order'), data.units || '0', label('SKU / dostawa', 'SKU / delivery'), data.perPallet || '0'],
      ]),
      { columns: [
        pdfMetric(multi ? label('ŚR. MASA NA 1 SKU (wszystkie pozycje)', 'AVG MASS PER 1 SKU (all items)') : label('MASA NA 1 SKU', 'MASS PER 1 SKU'), `${total.sku.toFixed(3)} g`),
        pdfMetric(label('MASA NA PALETĘ', 'MASS PER PALLET'), `${(total.pallet / 1000).toFixed(3)} kg`),
        pdfMetric(label('MASA ZAMÓWIENIA', 'MASS FOR THE ORDER'), `${(total.order / 1000).toFixed(3)} kg`),
      ], columnGap: 6, margin: [0, 12, 0, 0] },
      pdfSection(label('1. Rejestr komponentów opakowania', '1. Packaging component register')),
      pdfMakeTable([label('Lp.', 'No.'), label('Komponent opakowania', 'Packaging component'), label('Poziom', 'Level'), label('Materiał', 'Material'), label('Surowiec', 'Raw material'), label('Masa jednostkowa (g)', 'Unit mass (g)'), label('Ilość / SKU', 'Qty / SKU'), label('Ilość / paletę', 'Qty / pallet'), ...(anyScope ? [label('Dotyczy', 'Applies to')] : []), label('Uwagi', 'Notes')], componentRows, anyScope ? [20, '*', 80, 50, 70, 50, 40, 62, 80, 55] : [20, '*', 85, 52, 80, 52, 43, 72, 62]),
      pdfSection(label('2. Towary i elementy wysyłki wyłączone z obliczeń PPWR', '2. Goods and shipment items excluded from PPWR calculations')),
      pdfMakeTable([label('Lp.', 'No.'), label('Towar / element wysyłki', 'Goods / shipment item'), label('Poziom / funkcja', 'Level / function'), label('Materiał', 'Material'), label('Surowiec', 'Raw material'), label('Masa jednostkowa (g)', 'Unit mass (g)'), label('Ilość / SKU', 'Qty / SKU'), label('Ilość / paletę', 'Qty / pallet'), ...(anyScope ? [label('Dotyczy', 'Applies to')] : [])], excludedRows.length ? excludedRows : [['—', label('Brak wyłączonych pozycji', 'No excluded items'), '', '', '', '', '', '', ...(anyScope ? [''] : [])]], anyScope ? [20, '*', 85, 52, 90, 52, 44, 52, 80] : [20, '*', 95, 57, 105, 55, 48, 52]),
      pdfSection(label('3. Podział masy według materiałów', '3. Material mass split')),
      pdfMakeTable([label('Materiał', 'Material'), label('Masa / SKU (g)', 'Mass / SKU (g)'), label('Udział / SKU (%)', 'Share / SKU (%)'), label('Masa / paletę (kg)', 'Mass / pallet (kg)'), label('Masa zamówienia (kg)', 'Mass / order (kg)')], materialRows, ['*', 110, 110, 120, 120]),
      ...itemSections,
      pdfSection(label('4. Podstawa obliczeń i informacja o pliku technicznym', '4. Calculation basis and technical-file note')),
      { text: label('Masa na SKU, paletę i całe zamówienie jest obliczana z masy jednostkowej komponentu oraz jego ilości. Raport należy przechowywać wraz z dokumentacją dostawców.', 'Mass per SKU, pallet and order is calculated from component unit mass and quantities. Retain this report with supplier documentation.'), lineHeight: 1.3 },
      ...(diagramItems.length ? [{ text: label('5. DIAGRAM KOMPONENTÓW OPAKOWANIA', '5. PACKAGING COMPONENT DIAGRAM'), style: 'section', pageBreak: 'before', margin: [0, 8, 0, 5] }, { text: label('Ilustracja referencyjna numerowanych wierszy komponentów w tabeli.', 'Reference illustration for the numbered component rows in the table.'), color: '#51627A', fontSize: 8, margin: [0, 0, 0, 12] }, { image: legacyDiagram, fit: [770, 410], alignment: 'center' }] : []),
    ], language);
  }
  const filename = kind === 'doc'
    ? (pl ? `Deklaracja_Zgodnosci_UE_PPWR_${date}.pdf` : `EU_Declaration_of_Conformity_PPWR_${date}.pdf`)
    : (pl ? `Specyfikacja_Masy_PPWR_${date}.pdf` : `PPWR_Mass_Specification_${date}.pdf`);
  pdfMake.createPdf(definition).download(filename);
}

document.querySelector('#massPdf').onclick = () => downloadTextPdf('mass');
document.querySelector('#docPdf').onclick = () => downloadTextPdf('doc');

/* ===== Import faktury z Subiekta (PDF) -> Dane dokumentu + podział SKU/EAN/TYPE + szablon komponentów ===== */
(() => {
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const loadPdfJs = () => new Promise((res, rej) => {
    if (window.pdfjsLib) return res();
    const el = document.createElement('script');
    el.src = PDFJS;
    el.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; res(); };
    el.onerror = () => rej(new Error('Nie udało się załadować pdf.js'));
    document.head.append(el);
  });

  // Pozycje tekstu {s,x,y} -> wiersze (klasteryzacja po Y z tolerancją), w każdym wierszu posortowane po X
  function groupRows(items) {
    const sorted = items.filter(i => i.s.trim()).sort((p, q) => q.y - p.y);
    const rows = [];
    sorted.forEach(it => {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.y - it.y) <= 3) last.items.push(it); else rows.push({ y: it.y, items: [it] });
    });
    return rows.map(r => r.items.sort((p, q) => p.x - q.x));
  }

  async function pdfRows(file) {
    await loadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const rows = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const { items } = await (await pdf.getPage(p)).getTextContent();
      rows.push(...groupRows(items.map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5] }))));
    }
    return rows;
  }

  const rowText = r => r.map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
  const toNum = x => Number(String(x).replace(/\s/g, '').replace(',', '.')) || 0;
  const nipOf = t => { const m = t.match(/NIP:?\s*([A-Z]{2})?\s*([\d-]{9,13})/i); return m ? { digits: m[2].replace(/-/g, ''), prefix: (m[1] || 'PL').toUpperCase() } : null; };

  // Blok "Sprzedawca | Klient" czytany kolumnami; kontrahent = strona z NIP innym niż pierwszy NIP w dokumencie (nasz)
  function parseParties(rows, ownDigits) {
    const hi = rows.findIndex(r => r.some(i => /Sprzedawca/i.test(i.s)) && r.some(i => /Klient|Nabywca/i.test(i.s)));
    if (hi < 0) return {};
    const xs = rows[hi].find(i => /Sprzedawca/i.test(i.s)).x, xk = rows[hi].find(i => /Klient|Nabywca/i.test(i.s)).x, mid = (xs + xk) / 2;
    const L = [], R = [];
    for (let k = hi + 1; k < rows.length; k++) {
      const t = rowText(rows[k]);
      if (/Zamówienie|Faktura|Paragon|^Lp\b|Nazwa/i.test(t)) break;
      const l = rowText(rows[k].filter(i => i.x < mid)), r = rowText(rows[k].filter(i => i.x >= mid));
      if (l) L.push(l); if (r) R.push(r);
    }
    const info = lines => {
      const n = lines.map(nipOf).find(Boolean);
      const body = lines.filter(x => !/NIP/i.test(x));
      const p = body.map(x => /\b\d{2}-\d{3}\b/.test(x)).lastIndexOf(true);
      const name = p >= 0 ? body.slice(0, Math.max(1, p - 1)).join(' ') : (body[0] || '');
      const address = p >= 0 ? body.slice(Math.max(1, p - 1)).join(', ') : body.slice(1).join(', ');
      return { digits: n && n.digits, vat: n ? n.prefix + ' ' + n.digits : '', customer: name, customerAddress: address };
    };
    const a = info(L), b = info(R);
    const pick = (a.digits && a.digits === ownDigits) ? b : (b.digits && b.digits === ownDigits) ? a : b;
    return { customer: pick.customer, customerAddress: pick.customerAddress, customerVat: pick.vat };
  }

  function parseInvoice(rows) {
    const lines = rows.map(rowText), text = lines.join('\n');
    const head = {};
    const nm = text.match(/(Faktura(?:\s+VAT)?|Zamówienie(?:\s+do\s+dostawcy)?|Paragon)\s+(?:nr\s+)?([A-Z]{0,4}\s?\d+\/[\w/]+)/i);
    head.number = nm ? nm[0].trim() : '';
    const dre = /(\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})/;
    const di = lines.findIndex(l => /Data wystawienia/i.test(l));
    let d = '';
    for (let k = Math.max(di, 0); di >= 0 && k <= di + 2 && !d; k++) d = (lines[k].replace(/.*Data wystawienia:?/i, '').match(dre) || [])[1] || '';
    d = d || (text.match(dre) || [])[1] || '';
    if (d) head.issue = /^\d{4}/.test(d) ? d : d.split(/[.-]/).reverse().join('-');
    const own = nipOf(text);
    Object.assign(head, parseParties(rows, own && own.digits));

    const items = [];
    const scan = strict => lines.forEach(l => {
      const ean = (l.match(/\b\d{13}\b/) || [])[0] || '';
      const rest = ean ? l.replace(ean, ' ').replace(/\s+/g, ' ') : l;
      const tail = strict ? '(?=\\s+\\d[\\d ]*,\\d{2}\\s+\\d{1,2}(?:\\s|$))' : '(?=\\s|$)';
      const m = rest.match(new RegExp('^(\\d{1,3})\\s+(.+?)\\s+(\\d{1,3}(?:[ \\u00a0]\\d{3})+(?:[,.]\\d+)?|\\d+(?:[,.]\\d+)?)\\s+(szt\\.?|kpl\\.?|op\\.?|opak\\.?)' + tail, 'i'));
      if (m) items.push({ on: true, name: m[2].trim() || ean, ean, qty: toNum(m[3]) });
    });
    scan(true); if (!items.length) scan(false);
    return { head, items };
  }

  function dialog(parsed) {
    const spd = num(s.skuPerDisplay) || 16, dpcv = num(s.displaysPerCarton) || 24;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:#0008;z-index:99;display:grid;place-items:center;padding:16px';
    wrap.innerHTML = `<div class="card" style="max-width:1000px;width:100%;max-height:90vh;overflow:auto;margin:0">
      <div class="heading"><div><h2>📄 Import faktury — podgląd</h2><p>Popraw dane, zanim trafią do dokumentu.</p></div></div>
      <div class="grid fields" id="invHead"></div>
      <div class="grid" style="margin:12px 0">
        <label>SKU / display (domyślnie)<input id="invSpd" type="number" min="1" value="${spd}"></label>
        <label>Displayów / karton (domyślnie)<input id="invDpc" type="number" min="1" value="${dpcv}"></label>
        <label>Kartonów na paletę (0 = nie dziel)<input id="invPerPallet" type="number" min="0" value="0"></label>
      </div>
      <p class="hint">Wartości w tabeli poniżej możesz ustawić osobno dla każdej pozycji (puste = domyślne). Kartony układane są na paletach po kolei, pozycja po pozycji (paleta mix), i można je potem poprawić.</p>
      <div class="table-wrap"><table><thead><tr><th></th><th>SKU / EAN / TYPE</th><th>Ilość z FV (szt.)</th><th>Szablon produktu</th><th>SKU / display</th><th>Displayów / karton</th><th>Kartony</th></tr></thead><tbody id="invRows"></tbody></table></div>
      <div class="inv-tpl-warn" id="invTplWarn" style="display:none"></div>
      <div class="checks"><label><input type="checkbox" id="invTemplate" checked> Uzupełnij rejestr komponentów szablonami wybranymi w tabeli (każda pozycja dostaje własne komponenty; bez zdefiniowanych szablonów — szablon standardowy)</label>
      <label><input type="checkbox" id="invShip" checked> Dodaj szablon wysyłki (paleta, folie, taśmy, etykieta)</label>
      <label><input type="checkbox" id="invRemember" checked> Zapamiętaj wybrane szablony jako reguły (EAN lub fragment nazwy)</label></div>
      <div class="split-msg" id="invSum"></div>
      <div style="display:flex;gap:8px;justify-content:end;margin-top:12px">
        <button id="invCancel" type="button">Anuluj</button><button id="invApply" type="button" class="primary">Zastosuj</button></div></div>`;
    document.body.append(wrap);

    const head = wrap.querySelector('#invHead');
    [['customer', 'Klient / odbiorca'], ['customerAddress', 'Adres klienta'], ['customerVat', 'VAT ID klienta'], ['number', 'Nr dokumentu (partia / dowód)'], ['issue', 'Data wystawienia']].forEach(([k, l]) => {
      const lab = document.createElement('label'); lab.textContent = l;
      const i = document.createElement('input'); i.value = parsed.head[k] || ''; i.oninput = () => parsed.head[k] = i.value;
      lab.append(i); head.append(lab);
    });

    const gSpd = () => num(wrap.querySelector('#invSpd').value) || 1, gDpc = () => num(wrap.querySelector('#invDpc').value) || 1;
    const cartonsOf = it => it.qty / ((it.spd || gSpd()) * (it.dpc || gDpc()));
    const f = v => (Math.round(v * 100) / 100).toLocaleString('pl-PL');
    const paintSum = () => {
      const on = parsed.items.filter(i => i.on), tot = on.reduce((a, i) => a + i.qty, 0), car = on.reduce((a, i) => a + cartonsOf(i), 0);
      wrap.querySelector('#invSum').textContent = `Razem: ${tot.toLocaleString('pl-PL')} szt. = ${f(car)} kartonów`;
      wrap.querySelector('#invSum').className = 'split-msg ok';
    };
    const paintCartons = (it, td) => { const c = cartonsOf(it); td.textContent = f(c) + (Number.isInteger(c) ? '' : ' ⚠ niecałkowite'); td.style.color = Number.isInteger(c) ? '' : '#b3261e'; };
    const T = () => window.PPWRTemplates;
    const paintWarn = () => {
      const box = wrap.querySelector('#invTplWarn'); if (!box) return;
      const t = T(), miss = t && t.list().length ? parsed.items.filter(i => i.on && !i.tplId) : [];
      box.style.display = miss.length ? '' : 'none';
      box.textContent = miss.length ? `Nie rozpoznano szablonu dla ${miss.length} pozycji (${miss.map(i => i.name).slice(0, 3).join(', ')}${miss.length > 3 ? '…' : ''}). Wybierz szablon z listy — wybór zostanie zapamiętany jako reguła — albo „bez szablonu”, by uzupełnić komponenty ręcznie.` : '';
    };
    const initTplSelect = (it, sel, sp, dp, td) => {
      const t = T(), list = t ? t.list() : [];
      if (t && !it._tplInit) { it._tplInit = true; it.tplId = t.match(it) || ''; it._tplMatched = !!it.tplId; if (it.tplId) t.fillDefaults(it); }
      sel.innerHTML = '<option value="">— wybierz szablon —</option>' + list.map(x => `<option value="${x.id}">${String(x.name || '(bez nazwy)').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`).join('') + '<option value="__none">(bez szablonu — ręcznie)</option>';
      sel.value = it.tplId || ''; if (sel.value !== (it.tplId || '')) sel.value = '';
      sel.classList.toggle('missing', !!list.length && !it.tplId);
      sel.title = list.length ? '' : 'Brak zdefiniowanych szablonów — zdefiniuj je w sekcji „Szablony produktów i wysyłki”.';
      sel.onchange = () => {
        it.tplId = sel.value; sel.classList.toggle('missing', !it.tplId);
        if (t && it.tplId && it.tplId !== '__none') { t.fillDefaults(it); sp.value = it.spd || ''; dp.value = it.dpc || ''; }
        paintCartons(it, td); paintSum(); paintWarn();
      };
    };
    const paint = () => {
      const body = wrap.querySelector('#invRows'); body.innerHTML = '';
      parsed.items.forEach(it => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td><input type="checkbox"></td><td><input></td><td><input type="number" min="0"></td><td><select class="inv-tpl"></select></td><td><input type="number" min="1"></td><td><input type="number" min="1"></td><td data-c></td>';
        const [cb, nm, q, sp, dp] = tr.querySelectorAll('input'), td = tr.querySelector('[data-c]');
        cb.checked = it.on; nm.value = it.ean ? `${it.name} / ${it.ean}` : it.name; q.value = it.qty;
        sp.value = it.spd || ''; sp.placeholder = gSpd(); dp.value = it.dpc || ''; dp.placeholder = gDpc();
        initTplSelect(it, tr.querySelector('select'), sp, dp, td);
        cb.onchange = () => { it.on = cb.checked; paintSum(); paintWarn(); };
        nm.oninput = () => { it.name = nm.value; it.ean = ''; };
        q.oninput = () => { it.qty = num(q.value); paintCartons(it, td); paintSum(); };
        sp.oninput = () => { it.spd = num(sp.value) || 0; paintCartons(it, td); paintSum(); };
        dp.oninput = () => { it.dpc = num(dp.value) || 0; paintCartons(it, td); paintSum(); };
        paintCartons(it, td); body.append(tr);
      });
      paintSum(); paintWarn();
    };
    ['#invSpd', '#invDpc'].forEach(id => wrap.querySelector(id).oninput = paint);
    paint();

    wrap.querySelector('#invCancel').onclick = () => wrap.remove();
    wrap.querySelector('#invApply').onclick = () => {
      const on = parsed.items.filter(i => i.on);
      s.skuPerDisplay = gSpd(); s.displaysPerCarton = gDpc();
      s.details ??= {};
      Object.assign(s.details, {
        customer: parsed.head.customer || s.details.customer, customerAddress: parsed.head.customerAddress || s.details.customerAddress,
        customerVat: parsed.head.customerVat || s.details.customerVat, batch: parsed.head.number || s.details.batch,
        issue: parsed.head.issue || s.details.issue, units: String(on.reduce((a, i) => a + i.qty, 0)),
      });
      s.skuSplit = on.map(i => {
        const r = { id: 'it-' + Math.random().toString(36).slice(2, 9), name: i.ean ? `${i.name} / ${i.ean}` : i.name, cartons: Math.round(cartonsOf(i) * 100) / 100 };
        if (i.spd) r.spd = i.spd; if (i.dpc) r.dpc = i.dpc; i._id = r.id; return r;
      });

      const per = num(wrap.querySelector('#invPerPallet').value);
      if (per > 0) {
        if (s.skuSplit.some(r => !Number.isInteger(r.cartons))) alert('Niektóre pozycje mają niecałkowitą liczbę kartonów, więc palet nie rozpisano automatycznie. Uzupełnij je ręcznie.');
        else {
          const pal = []; let cur = null;
          s.skuSplit.forEach(r => { let left = r.cartons; while (left > 0) { if (!cur || cur.cap === 0) { cur = { lines: [], cap: per }; pal.push(cur); } const c = Math.min(cur.cap, left); cur.lines.push({ item: r.id, cartons: c }); cur.cap -= c; left -= c; } });
          if (pal.length) s.pallets = pal.map(p => ({ lines: p.lines, cartons: p.lines.reduce((a, l) => a + l.cartons, 0), displays: p.lines.reduce((a, l) => a + lineDisplays(l), 0) }));
        }
      }
      let tplMsg = '';
      const TT = window.PPWRTemplates;
      if (TT && wrap.querySelector('#invRemember').checked) on.forEach(i => { if (i.tplId && i.tplId !== '__none' && !(i._tplMatched && TT.match(i) === i.tplId)) TT.remember(i, i.tplId); });
      if (wrap.querySelector('#invTemplate').checked) {
        if (TT && TT.hasAny()) {
          if (!s.components.length || confirm('Rejestr komponentów nie jest pusty. Zastąpić go komponentami z szablonów?')) {
            const res = TT.applyImport(on, { ship: wrap.querySelector('#invShip').checked });
            if (res.missing.length) tplMsg = 'Pozycje bez szablonu (komponenty dodaj ręcznie lub użyj sekcji „Szablony produktów i wysyłki”):\n• ' + res.missing.join('\n• ');
          }
        } else if (!s.components.length || confirm('Rejestr komponentów nie jest pusty. Zastąpić go szablonem standardowym?')) {
          s.components = Object.values(componentLibrary).flat().map(x => ({ ...x, included: !standardNonPackaging.has(x.name) }));
        }
      }
      save(); render(); wrap.remove(); if (tplMsg) alert(tplMsg);
    };
  }

  window.PPWRInvoiceImport = { parseInvoice, groupRows, dialog };

  const bar = document.querySelector('header .actions');
  if (bar && !document.querySelector('#invoiceImport')) {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.pdf,application/pdf', hidden: true });
    const btn = Object.assign(document.createElement('button'), { id: 'invoiceImport', type: 'button', textContent: '📄 Importuj fakturę' });
    btn.onclick = () => input.click();
    input.onchange = async () => {
      const file = input.files[0]; input.value = '';
      if (!file) return;
      try {
        const parsed = parseInvoice(await pdfRows(file));
        if (!parsed.items.length) return alert('Nie rozpoznano pozycji faktury. Wyślij przykładowy PDF, aby dostroić parser.');
        dialog(parsed);
      } catch (e) { console.error(e); alert('Błąd odczytu faktury: ' + e.message); }
    };
    const sync = document.querySelector('#syncNow');
    sync ? sync.after(btn) : bar.prepend(btn);
    bar.append(input);
  }
})();