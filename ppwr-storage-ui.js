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
  table: { headerRows: 1, widths, body: [headers.map(value => ({ text: value, style: 'tableHeader' })), ...rows] },
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
const pdfNumber = value => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
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
  const height = Math.max(520, 220 + rows * 290);
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
  const { total, materials } = calculated();
  const active = s.components.filter(row => row.included !== false);
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
      pdfMakeTable([label('Lp.', 'No.'), label('Produkt / komponent', 'Product / component'), 'SKU / EAN', label('Partia / dowód', 'Batch / evidence')], [['1', data.product || '—', data.sku || '—', data.batch || '—']], ['8%', '42%', '25%', '25%']),
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
      pdfNumber(row.unit), pdfNumber(row.sku), pdfNumber(row.pallet), row.notes || '',
    ]);
    const excluded = [...s.components.filter(row => row.included === false), ...s.excluded];
    const excludedRows = excluded.map((row, index) => [index + 1, rowText(row.name), rowText(row.level), rowText(row.material), row.raw || '', pdfNumber(row.unit), pdfNumber(row.sku), pdfNumber(row.pallet)]);
    const materialRows = Object.entries(materials).map(([material, value]) => [material, value.sku.toFixed(3), total.sku ? (value.sku / total.sku * 100).toFixed(1) : '0.0', (value.pallet / 1000).toFixed(3), (value.order / 1000).toFixed(3)]);
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
        [label('Liczba SKU w zamówieniu', 'SKU units in order'), data.units || '0', label('SKU / paleta', 'SKU / pallet'), data.perPallet || '0'],
      ]),
      { columns: [
        pdfMetric(label('MASA NA 1 SKU', 'MASS PER 1 SKU'), `${total.sku.toFixed(3)} g`),
        pdfMetric(label('MASA NA PALETĘ', 'MASS PER PALLET'), `${(total.pallet / 1000).toFixed(3)} kg`),
        pdfMetric(label('MASA ZAMÓWIENIA', 'MASS FOR THE ORDER'), `${(total.order / 1000).toFixed(3)} kg`),
      ], columnGap: 6, margin: [0, 12, 0, 0] },
      pdfSection(label('1. Rejestr komponentów opakowania', '1. Packaging component register')),
      pdfMakeTable([label('Lp.', 'No.'), label('Komponent opakowania', 'Packaging component'), label('Poziom', 'Level'), label('Materiał', 'Material'), label('Surowiec', 'Raw material'), label('Masa jednostkowa (g)', 'Unit mass (g)'), label('Ilość / SKU', 'Qty / SKU'), label('Ilość / paletę', 'Qty / pallet'), label('Uwagi', 'Notes')], componentRows, [20, '*', 85, 52, 94, 52, 43, 47, 70]),
      pdfSection(label('2. Towary i elementy wysyłki wyłączone z obliczeń PPWR', '2. Goods and shipment items excluded from PPWR calculations')),
      pdfMakeTable([label('Lp.', 'No.'), label('Towar / element wysyłki', 'Goods / shipment item'), label('Poziom / funkcja', 'Level / function'), label('Materiał', 'Material'), label('Surowiec', 'Raw material'), label('Masa jednostkowa (g)', 'Unit mass (g)'), label('Ilość / SKU', 'Qty / SKU'), label('Ilość / paletę', 'Qty / pallet')], excludedRows.length ? excludedRows : [['—', label('Brak wyłączonych pozycji', 'No excluded items'), '', '', '', '', '', '']], [20, '*', 95, 57, 105, 55, 48, 52]),
      pdfSection(label('3. Podział masy według materiałów', '3. Material mass split')),
      pdfMakeTable([label('Materiał', 'Material'), label('Masa / SKU (g)', 'Mass / SKU (g)'), label('Udział / SKU (%)', 'Share / SKU (%)'), label('Masa / paletę (kg)', 'Mass / pallet (kg)'), label('Masa zamówienia (kg)', 'Mass / order (kg)')], materialRows, ['*', 110, 110, 120, 120]),
      pdfSection(label('4. Podstawa obliczeń i informacja o pliku technicznym', '4. Calculation basis and technical-file note')),
      { text: label('Masa na SKU, paletę i całe zamówienie jest obliczana z masy jednostkowej komponentu oraz jego ilości. Raport należy przechowywać wraz z dokumentacją dostawców.', 'Mass per SKU, pallet and order is calculated from component unit mass and quantities. Retain this report with supplier documentation.'), lineHeight: 1.3 },
      ...(diagramItems.length ? [{ text: label('5. DIAGRAM KOMPONENTÓW OPAKOWANIA', '5. PACKAGING COMPONENT DIAGRAM'), style: 'section', pageBreak: 'before', margin: [0, 8, 0, 5] }, { text: label('Ilustracja referencyjna numerowanych wierszy komponentów w tabeli.', 'Reference illustration for the numbered component rows in the table.'), color: '#51627A', fontSize: 8, margin: [0, 0, 0, 12] }, { image: legacyDiagram, fit: [770, 480], alignment: 'center' }] : []),
    ], language);
  }
  const filename = kind === 'doc'
    ? (pl ? `Deklaracja_Zgodnosci_UE_PPWR_${date}.pdf` : `EU_Declaration_of_Conformity_PPWR_${date}.pdf`)
    : (pl ? `Specyfikacja_Masy_PPWR_${date}.pdf` : `PPWR_Mass_Specification_${date}.pdf`);
  pdfMake.createPdf(definition).download(filename);
}

document.querySelector('#massPdf').onclick = () => downloadTextPdf('mass');
document.querySelector('#docPdf').onclick = () => downloadTextPdf('doc');
