/* Zwijanie sekcji (kart) PPWR. Klik w tytuł sekcji zwija ją do samego nagłówka; stan jest pamiętany na tym urządzeniu. */
(() => {
  'use strict';
  const KEY = 'ppwr-collapsed-sections';
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch (e) { return new Set(); } };
  const store = set => { try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch (e) { /* brak miejsca lub zablokowany zapis – stan tylko na czas sesji */ } };
  let collapsed = load();

  const cards = () => [...document.querySelectorAll('main .card')].filter(c => c.querySelector('h2'));
  const titleOf = c => (c.querySelector('h2').textContent || '').trim();

  function paint() {
    cards().forEach(c => {
      const on = collapsed.has(titleOf(c));
      c.classList.toggle('collapsed', on);
      const h = c.querySelector('h2');
      h.setAttribute('role', 'button');
      h.setAttribute('tabindex', '0');
      h.setAttribute('aria-expanded', String(!on));
      h.title = on ? 'Kliknij, aby rozwinąć sekcję' : 'Kliknij, aby zwinąć sekcję';
    });
  }

  function toggle(card) {
    const t = titleOf(card);
    collapsed.has(t) ? collapsed.delete(t) : collapsed.add(t);
    store(collapsed);
    paint();
  }

  document.addEventListener('click', e => {
    const h = e.target.closest && e.target.closest('main .card h2');
    if (!h) return;
    const card = h.closest('.card');
    if (card && cards().includes(card)) toggle(card);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const h = e.target.closest && e.target.closest('main .card h2');
    if (!h || e.target !== h) return;
    e.preventDefault();
    toggle(h.closest('.card'));
  });

  const bar = document.createElement('div');
  bar.className = 'collapse-bar';
  bar.innerHTML = '<button type="button" data-all="close">Zwiń wszystkie sekcje</button><button type="button" data-all="open">Rozwiń wszystkie sekcje</button>';
  bar.onclick = e => {
    const mode = e.target.dataset && e.target.dataset.all;
    if (!mode) return;
    collapsed = mode === 'close' ? new Set(cards().map(titleOf)) : new Set();
    store(collapsed);
    paint();
  };
  const notice = document.querySelector('main .notice');
  if (notice) notice.after(bar); else document.querySelector('main').prepend(bar);

  const baseRender = window.render;
  if (typeof baseRender === 'function') window.render = function () { const r = baseRender.apply(this, arguments); paint(); return r; };
  paint();
})();
