/* Globalna warstwa zapisu PPWR. Nie przechowuje klucza o podwyższonych uprawnieniach. */
(() => {
  const URL = "https://hjadatjvyrjexgmicggi.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_mZw_I5bNx_xuJb3jnX71eQ_iQdB8qCo";
  const TABLE = "ppwr_documents";
  const BUCKET = "ppwr-images";
  const LOCAL_DOCUMENT_ID = "ppwr-supabase-document-id";
  const client = window.supabase.createClient(URL, PUBLISHABLE_KEY);
  let user = null;
  let documentId = localStorage.getItem(LOCAL_DOCUMENT_ID);
  let ready = false;
  let timer = null;
  const signedUrls = new Map();

  const status = text => {
    const node = document.querySelector("#syncStatus");
    if (node) node.textContent = text;
  };
  const announceAuth = () => window.dispatchEvent(new Event('ppwr-auth-changed'));
  const copy = value => JSON.parse(JSON.stringify(value));
  const isStorageRef = value => typeof value === "string" && value.startsWith("storage://");
  const pathOf = value => value.slice("storage://".length);

  async function ensureUser() {
    const { data: current, error: currentError } = await client.auth.getSession();
    if (currentError) throw currentError;
    if (current.session) {
      user = current.session.user;
      announceAuth();
      return user;
    }
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw new Error("Włącz Anonymous Sign-Ins w Supabase Authentication, a następnie odśwież stronę. " + error.message);
    user = data.user;
    announceAuth();
    return user;
  }

  function eachImage(state, action) {
    const visit = value => {
      if (!value || typeof value !== "object") return;
      if (value.stageImages && typeof value.stageImages === "object") {
        Object.entries(value.stageImages).forEach(([key, image]) => action(value.stageImages, key, image));
      }
      if (Array.isArray(value.archive)) value.archive.forEach(item => visit(item && item.data));
    };
    visit(state);
  }

  async function signPaths(paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    if (!unique.length) return;
    const { data, error } = await client.storage.from(BUCKET).createSignedUrls(unique, 60 * 60 * 24);
    if (error) throw error;
    (data || []).forEach(item => signedUrls.set(`storage://${item.path}`, item.signedUrl));
  }

  async function uploadDataUrl(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    if (blob.size > 1024 * 1024) throw new Error("Zdjęcie po kompresji przekracza limit 1 MB.");
    const path = `${user.id}/${documentId}/${crypto.randomUUID()}.jpg`;
    const { error } = await client.storage.from(BUCKET).upload(path, blob, {
      contentType: "image/jpeg", cacheControl: "31536000", upsert: false,
    });
    if (error) throw error;
    const ref = `storage://${path}`;
    await signPaths([path]);
    return ref;
  }

  async function migrateImages(state) {
    const tasks = [];
    eachImage(state, (container, key, image) => {
      if (typeof image === "string" && image.startsWith("data:image/")) {
        tasks.push(uploadDataUrl(image).then(ref => { container[key] = ref; }));
      }
    });
    await Promise.all(tasks);
    const paths = [];
    eachImage(state, (_container, _key, image) => { if (isStorageRef(image)) paths.push(pathOf(image)); });
    await signPaths(paths);
    return state;
  }

  function blobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function makeTransferCopy(state) {
    const copyOfState = copy(state);
    const refs = [];
    eachImage(copyOfState, (_container, _key, image) => { if (isStorageRef(image)) refs.push(pathOf(image)); });
    await signPaths(refs);
    const tasks = [];
    eachImage(copyOfState, (container, key, image) => {
      if (!isStorageRef(image)) return;
      const signedUrl = signedUrls.get(image);
      if (!signedUrl) throw new Error('Nie można odczytać jednego ze zdjęć do przeniesienia.');
      tasks.push(fetch(signedUrl).then(response => {
        if (!response.ok) throw new Error('Nie można pobrać zdjęcia do przeniesienia.');
        return response.blob();
      }).then(blobAsDataUrl).then(dataUrl => { container[key] = dataUrl; }));
    });
    await Promise.all(tasks);
    return copyOfState;
  }

  async function loadLatestDocument() {
    const { data, error } = await client.from(TABLE).select('id, data').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    documentId = data.id;
    localStorage.setItem(LOCAL_DOCUMENT_ID, documentId);
    const state = copy(data.data);
    await migrateImages(state);
    return state;
  }

  async function useEmailSession(result, localState) {
    if (result.error) throw result.error;
    if (!result.data.session) {
      throw new Error('Konto zostało utworzone. Potwierdź adres e-mail, a potem zaloguj się hasłem.');
    }
    user = result.data.session.user;
    announceAuth();
    documentId = null;
    localStorage.removeItem(LOCAL_DOCUMENT_ID);
    const existing = await loadLatestDocument();
    if (existing) {
      ready = true;
      status(`Zalogowano: ${user.email}. Wczytano dokument z chmury.`);
      return existing;
    }
    const transfer = await makeTransferCopy(localState);
    const created = await createDocument(transfer);
    ready = true;
    status(`Zalogowano: ${user.email}. Utworzono bezpieczną kopię Twojego dokumentu.`);
    return created;
  }

  async function createDocument(localState) {
    documentId = crypto.randomUUID();
    const data = await migrateImages(copy(localState));
    const name = data.details && data.details.product ? data.details.product : "Bieżący dokument PPWR";
    const { data: created, error } = await client.from(TABLE).insert({ id: documentId, owner_id: user.id, name, data }).select("id").single();
    if (error) throw error;
    documentId = created.id;
    localStorage.setItem(LOCAL_DOCUMENT_ID, documentId);
    return data;
  }

  async function start(localState) {
    status("Łączenie z Supabase…");
    await ensureUser();
    let row = null;
    if (documentId) {
      const result = await client.from(TABLE).select("id, data").eq("id", documentId).maybeSingle();
      if (result.error) throw result.error;
      row = result.data;
    }
    if (!row) {
      const result = await client.from(TABLE).select("id, data").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw result.error;
      row = result.data;
    }
    let state;
    if (row) {
      documentId = row.id;
      localStorage.setItem(LOCAL_DOCUMENT_ID, documentId);
      state = copy(row.data);
      await migrateImages(state);
      status("Wczytano bezpieczną kopię z chmury.");
    } else {
      status("Przenoszenie lokalnej kopii do Supabase…");
      state = await createDocument(localState);
      status("Lokalna kopia została bezpiecznie przeniesiona do chmury.");
    }
    ready = true;
    return state;
  }

  async function persist(state) {
    if (!ready) return;
    try {
      status("Zapisywanie bezpiecznej kopii…");
      const data = await migrateImages(copy(state));
      const name = data.details && data.details.product ? data.details.product : "Bieżący dokument PPWR";
      const { error } = await client.from(TABLE).update({ name, data, updated_at: new Date().toISOString() }).eq("id", documentId);
      if (error) throw error;
      status("Zapisano w Supabase.");
    } catch (error) {
      console.error(error);
      status("Nie zapisano w chmurze — zachowano lokalną kopię.");
    }
  }

  window.PPWRCloud = {
    start,
    queueSave(state) {
      if (!ready) return;
      clearTimeout(timer);
      timer = setTimeout(() => persist(state), 900);
    },
    async syncNow(state) {
      if (!ready) return;
      clearTimeout(timer);
      await persist(state);
    },
    async signIn(email, password, localState) {
      const result = await client.auth.signInWithPassword({ email, password });
      return useEmailSession(result, localState);
    },
    async signUp(email, password, localState) {
      const transfer = await makeTransferCopy(localState);
      const result = await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } });
      return useEmailSession(result, transfer);
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      documentId = null;
      localStorage.removeItem(LOCAL_DOCUMENT_ID);
      user = null;
      announceAuth();
      ready = false;
      status('Wylogowano. Odśwież stronę, aby rozpocząć nową sesję.');
    },
    currentUser() { return user; },
    async uploadImage(dataUrl) {
      if (!ready) return dataUrl;
      return uploadDataUrl(dataUrl);
    },
    imageSource(value) {
      return isStorageRef(value) ? (signedUrls.get(value) || "") : (value || "");
    },
  };
})();
