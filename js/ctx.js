// Общее состояние приложения: данные, синхронизация, состояние экранов.
import { createStore, live } from './store.js';
import { createSync } from './sync.js';
import * as C from './calc.js';
import { esc } from './ui.js';

export const VERSION = '1.0';

export const store = createStore();
export const sync = createSync(store);

export const ui = {
  tab: 'home',
  search: '',
  searchOpen: false,
  limit: 60,
  stats: { kind: 'month', anchor: C.today(), type: 'exp', table: false },
  debtDir: 'owe',
  closedDebts: false,
  closedDeps: false,
};

// app.js подставляет сюда настоящую перерисовку; так модули экранов не зависят от него.
export const hooks = { render() {} };
export const render = () => hooks.render();

export const cur = () => store.state.settings.currency;
export const money = (n, opts) => C.fmtMoney(n, cur(), opts);

export const cats = {
  // Удалённые категории тоже находятся: старые записи сохраняют подпись и значок.
  get: (id) => store.state.cats.find((c) => c.id === id) ?? { id, type: '', name: 'Без категории', emoji: '🏷️', order: 999 },
  of: (type) =>
    live(store.state.cats)
      .filter((c) => c.type === type)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)),
};

export function txRow(t) {
  const c = cats.get(t.cat);
  const inc = t.type === 'inc';
  return `<button type="button" class="tx" data-act="edit-tx" data-id="${esc(t.id)}">
    <span class="tile">${esc(c.emoji)}</span>
    <span class="tx-main"><span class="tx-title">${esc(c.name)}</span>${t.note ? `<span class="tx-note">${esc(t.note)}</span>` : ''}</span>
    <span class="tx-amt${inc ? ' inc' : ''}">${money(inc ? t.amount : -t.amount, { sign: true })}</span>
  </button>`;
}

export const emptyHtml = (ico, title, text) =>
  `<div class="empty"><div class="empty-ico">${ico}</div><div class="empty-title">${esc(title)}</div><p class="empty-text">${esc(text)}</p></div>`;

// Склонение: plural(3, 'запись', 'записи', 'записей').
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
