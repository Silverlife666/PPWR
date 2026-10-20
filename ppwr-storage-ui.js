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
