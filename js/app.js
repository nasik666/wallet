// Точка входа: вкладки, главный экран, обработка нажатий, запуск синхронизации.
import { store, sync, ui, hooks, money, cats, txRow, emptyHtml } from './ctx.js';
import { $, $$, esc, toast, closeSheet, topSheet } from './ui.js';
import * as C from './calc.js';
import { I } from './icons.js';
import { live } from './store.js';
import { openTxSheet } from './txsheet.js';
import { viewStats, mountStats, statsActions } from './stats.js';
import { viewDebts, debtActions } from './debts.js';
import { viewDeposits, depositActions } from './deposits.js';
import { openSettings } from './settings.js';

const view = $('#view');
const VIEWS = { home: viewHome, stats: viewStats, debts: viewDebts, deposits: viewDeposits };
const scrollPos = {};

/* ───────── Главный экран ───────── */

function homeActions() {
  const st = sync.status.state;
  const label = { idle: 'Синхронизировано', syncing: 'Идёт синхронизация', error: 'Ошибка синхронизации', offline: 'Нет сети' }[st];
  const cloud = st === 'off' ? '' : `<button type="button" class="icon-btn sync-btn is-${st}" data-act="sync" aria-label="${label}">${I.cloud}<i></i></button>`;
  return `${cloud}<button type="button" class="icon-btn" data-act="settings" aria-label="Настройки">${I.gear}</button>`;
}

function installHint() {
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (standalone || !ios || store.local.hintOff) return '';
  return `<div class="hint-card">
    <span class="tile">${I.share}</span>
    <div class="hint-card-text"><b>Добавьте на экран «Домой»</b>В Safari нажмите «Поделиться» → «На экран „Домой“»: приложение откроется на весь экран и будет работать без сети.</div>
    <button type="button" class="icon-btn sm" data-act="hint-off" aria-label="Скрыть подсказку">${I.x}</button>
  </div>`;
}

// Категории расходов для быстрого добавления: сначала те, что чаще использовались за 60 дней.
function quickCats() {
  const since = C.addDays(C.today(), -60);
  const used = new Map();
  for (const t of live(store.state.tx)) {
    if (t.type === 'exp' && t.date >= since) used.set(t.cat, (used.get(t.cat) ?? 0) + 1);
  }
  return cats.of('exp').sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || a.order - b.order);
}

function homeTop() {
  const list = live(store.state.tx);
  const all = C.totals(list);
  const month = C.periodRange('month', C.today());
  const m = C.totals(C.inRange(list, month.from, month.to));
  const name = C.MONTHS[new Date().getMonth()];
  const balance = money(all.net);
  return `<section class="hero" aria-label="Баланс">
      <div class="hero-label">Баланс</div>
      <div class="hero-value" style="--n:${balance.length}">${balance}</div>
      <div class="hero-row">
        <div class="hero-stat"><div class="hero-stat-label">${I.in}<span>Доходы за ${name}</span></div><div class="hero-stat-value">${money(m.inc)}</div></div>
        <div class="hero-stat"><div class="hero-stat-label">${I.out}<span>Расходы за ${name}</span></div><div class="hero-stat-value">${money(m.exp)}</div></div>
      </div>
    </section>
    ${installHint()}
    <div class="quick" aria-label="Быстрое добавление расхода">
      ${quickCats().map((c) => `<button type="button" class="quick-item" data-act="add" data-cat="${esc(c.id)}"><span class="quick-ico">${esc(c.emoji)}</span><span class="quick-name">${esc(c.name)}</span></button>`).join('')}
    </div>`;
}

function txListHtml() {
  const q = ui.search.trim().toLowerCase();
  let list = live(store.state.tx);
  if (q) {
    const qNum = q.replace(/\s/g, '').replace(',', '.');
    list = list.filter((t) => {
      const c = cats.get(t.cat);
      return (t.note || '').toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || String(t.amount).includes(qNum) || C.fmtDate(t.date).replace(/ /g, ' ').includes(q);
    });
  }
  if (!list.length) {
    return q
      ? emptyHtml('🔍', 'Ничего не нашлось', 'Попробуйте другое слово, категорию или сумму.')
      : emptyHtml('👋', 'Пока пусто', 'Нажмите + внизу или выберите категорию выше — запись займёт пару секунд.');
  }
  list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.ts || 0) - (a.ts || 0)));
  const net = new Map();
  for (const t of list) net.set(t.date, (net.get(t.date) ?? 0) + (t.type === 'inc' ? t.amount : -t.amount));

  let html = '';
  let day = null;
  for (const t of list.slice(0, ui.limit)) {
    if (t.date !== day) {
      if (day) html += '</div>';
      day = t.date;
      html += `<div class="day"><div class="day-head"><span>${esc(C.fmtDateRel(day))}</span><span>${money(net.get(day), { sign: true })}</span></div>`;
    }
    html += txRow(t);
  }
  if (day) html += '</div>';
  if (list.length > ui.limit) html += `<button type="button" class="btn sm more" data-act="more-tx">Показать ещё · ${list.length - ui.limit}</button>`;
  return html;
}

function viewHome() {
  const has = live(store.state.tx).length > 0;
  return `<header class="head">
      <h1>Кошелёк</h1>
      <div class="head-actions" id="home-actions">${homeActions()}</div>
    </header>
    <div id="home-top">${homeTop()}</div>
    <div class="sec-head">
      <h2>Операции</h2>
      ${has ? `<button type="button" class="icon-btn sm${ui.searchOpen ? ' on' : ''}" data-act="search-toggle" aria-label="Поиск">${I.search}</button>` : ''}
    </div>
    ${ui.searchOpen ? `<input class="input search" type="search" data-search placeholder="Подпись, категория или сумма" value="${esc(ui.search)}" autocomplete="off" enterkeyhint="search">` : ''}
    <div id="tx-list">${txListHtml()}</div>`;
}

/* ───────── Отрисовка и навигация ───────── */

function render() {
  // Пока в поиске печатают, само поле не трогаем — иначе закроется клавиатура.
  if (ui.tab === 'home' && document.activeElement?.matches?.('[data-search]') && $('#home-top')) {
    $('#home-top').innerHTML = homeTop();
    $('#tx-list').innerHTML = txListHtml();
    return;
  }
  view.innerHTML = VIEWS[ui.tab]();
  if (ui.tab === 'stats') mountStats(view);
  for (const t of $$('.tab')) {
    const on = t.dataset.tab === ui.tab;
    t.classList.toggle('on', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
}

function go(tab) {
  if (tab === ui.tab) {
    view.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  scrollPos[ui.tab] = view.scrollTop;
  ui.tab = tab;
  render();
  view.scrollTop = scrollPos[tab] ?? 0;
}

const actions = {
  tab: (el) => go(el.dataset.tab),
  add: (el) => openTxSheet({ type: el.dataset.type || 'exp', cat: el.dataset.cat || null }),
  'edit-tx': (el) => openTxSheet({ id: el.dataset.id }),
  settings: () => openSettings(),
  'hint-off': () => {
    store.saveLocal({ hintOff: true });
    render();
  },
  'search-toggle': () => {
    ui.searchOpen = !ui.searchOpen;
    ui.search = '';
    ui.limit = 60;
    render();
    if (ui.searchOpen) $('[data-search]')?.focus();
  },
  'more-tx': () => {
    ui.limit += 120;
    $('#tx-list').innerHTML = txListHtml();
  },
  sync: async () => {
    if (sync.status.state === 'syncing') return;
    const ok = await sync.syncNow();
    toast(ok ? 'Синхронизировано' : sync.status.error || 'Нет сети — синхронизируем позже');
  },
  ...statsActions,
  ...debtActions,
  ...depositActions,
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) actions[el.dataset.act]?.(el, e);
});

view.addEventListener('input', (e) => {
  if (!e.target.matches('[data-search]')) return;
  ui.search = e.target.value;
  ui.limit = 60;
  $('#tx-list').innerHTML = txListHtml();
});
view.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-search]')) e.target.blur();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && topSheet()) closeSheet();
});
document.addEventListener('touchstart', () => {}, { passive: true }); // включает :active в iOS Safari

/* ───────── Клавиатура iOS: держим интерфейс в видимой части экрана ───────── */

const vv = window.visualViewport;
if (vv) {
  const fit = () => {
    // При увеличении страницы жестом видимая область тоже уменьшается — это не клавиатура.
    const open = vv.scale < 1.05 && window.innerHeight - vv.height > 120;
    document.documentElement.classList.toggle('kb', open);
    document.body.style.height = open ? `${vv.height}px` : '';
    document.body.style.top = open ? `${vv.offsetTop}px` : '';
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

/* ───────── Запуск ───────── */

for (const el of $$('#tabbar [data-icon]')) el.insertAdjacentHTML('afterbegin', I[el.dataset.icon]);

hooks.render = render;
store.subscribe((reason, saved) => {
  render();
  if (reason !== 'sync') sync.schedule();
  if (!saved) toast('Не удалось сохранить: на устройстве закончилось место');
});
sync.onStatus(() => {
  const box = $('#home-actions');
  if (box) box.innerHTML = homeActions();
});

render();
sync.syncNow();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render(); // мог смениться день
    sync.syncNow();
  } else {
    sync.flush();
  }
});
window.addEventListener('online', () => sync.syncNow());

let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => ui.tab === 'stats' && render(), 150); // графики считаются в пикселях
});

navigator.storage?.persist?.().catch(() => {});

// Офлайн-режим. На localhost сервис-воркер выключен, чтобы не мешал разработке (включается ?sw).
const dev = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!dev || location.search.includes('sw'))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
