// Общие кирпичики интерфейса: шторки, подтверждения, всплывающие сообщения.
import { I } from './icons.js';
import { parseAmount } from './calc.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

let toastTimer;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ───────── Шторки ───────── */

const stack = [];
export const topSheet = () => stack[stack.length - 1] ?? null;

export const closeBtn = `<button type="button" class="icon-btn" data-close aria-label="Закрыть">${I.x}</button>`;
export const sheetHead = (title) => `<div class="sheet-head"><h2 class="sheet-title">${esc(title)}</h2>${closeBtn}</div>`;

export function openSheet(html, { tall = false, cls = '', onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop"></div><section class="sheet${tall ? ' sheet--tall' : ''}${cls ? ` ${cls}` : ''}" role="dialog" aria-modal="true" tabindex="-1"><div class="sheet-grab"></div><div class="sheet-inner"></div></section>`;
  const sheet = { wrap, el: wrap.querySelector('.sheet'), inner: wrap.querySelector('.sheet-inner'), onClose, closed: false };
  sheet.inner.innerHTML = html;
  wrap.querySelector('.sheet-backdrop').addEventListener('click', () => closeSheet(sheet));
  sheet.inner.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet(sheet);
  });
  $('#sheets').appendChild(wrap);
  stack.push(sheet);
  void wrap.offsetHeight; // фиксируем начальное положение, чтобы сработала анимация
  wrap.classList.add('open');
  enableDrag(sheet);
  return sheet;
}

export function closeSheet(sheet = topSheet(), result) {
  if (!sheet || sheet.closed) return;
  sheet.closed = true;
  const i = stack.indexOf(sheet);
  if (i >= 0) stack.splice(i, 1);
  if (sheet.wrap.contains(document.activeElement)) document.activeElement.blur();
  sheet.wrap.classList.remove('open');
  sheet.wrap.style.pointerEvents = 'none';
  setTimeout(() => sheet.wrap.remove(), 400);
  sheet.onClose?.(result);
}

// Шторку можно смахнуть вниз за «ручку» или заголовок.
function enableDrag(sheet) {
  const el = sheet.el;
  let startY = 0;
  let dy = 0;
  let t0 = 0;
  let id = null;
  el.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.sheet-grab, .sheet-head') || e.target.closest('button, input, a, label')) return;
    id = e.pointerId;
    startY = e.clientY;
    dy = 0;
    t0 = e.timeStamp;
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    dy = Math.max(0, e.clientY - startY);
    if (dy > 4) {
      el.setPointerCapture?.(id);
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
    }
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    el.style.transition = '';
    el.style.transform = '';
    const speed = dy / Math.max(1, e.timeStamp - t0);
    if (dy > 110 || (dy > 30 && speed > 0.6)) closeSheet(sheet);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/* ───────── Формы ───────── */

export const formValues = (form) => Object.fromEntries(new FormData(form).entries());

export function formError(form, text) {
  const el = form.querySelector('.form-error');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

export function confirmSheet({ title, text = '', ok = 'Удалить', cancel = 'Отмена', danger = true }) {
  return new Promise((resolve) => {
    const sheet = openSheet(
      `<div class="confirm">
        <h2 class="confirm-title">${esc(title)}</h2>
        ${text ? `<p class="confirm-text">${esc(text)}</p>` : ''}
        <button type="button" class="btn ${danger ? 'danger-fill' : 'primary'}" data-ok>${esc(ok)}</button>
        <button type="button" class="btn" data-close>${esc(cancel)}</button>
      </div>`,
      { onClose: (r) => resolve(r === true) },
    );
    sheet.inner.querySelector('[data-ok]').addEventListener('click', () => closeSheet(sheet, true));
  });
}

// Короткий запрос суммы (платёж по долгу, пополнение вклада). Возвращает { amount, date } или null.
export function promptAmount({ title, hint = '', value = '', cur = '₽', ok = 'Готово', date = '', max = null, maxText = '' }) {
  return new Promise((resolve) => {
    const sheet = openSheet(
      `${sheetHead(title)}
      <form novalidate>
        ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
        <div class="field-row${date ? '' : ' one'}">
          <label class="field"><span class="field-label">Сумма, ${esc(cur)}</span>
            <input class="input" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(value)}"></label>
          ${date ? `<label class="field"><span class="field-label">Дата</span><input class="input" type="date" name="date" value="${esc(date)}"></label>` : ''}
        </div>
        <p class="form-error" hidden></p>
        <button class="btn primary" type="submit">${esc(ok)}</button>
      </form>`,
      { onClose: (r) => resolve(r ?? null) },
    );
    const form = sheet.inner.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(form);
      const amount = parseAmount(v.amount);
      if (!(amount > 0)) return formError(form, 'Введите сумму больше нуля');
      if (max !== null && amount > max) return formError(form, maxText || 'Сумма слишком большая');
      closeSheet(sheet, { amount, date: v.date || date });
    });
    const input = form.elements.amount;
    input.focus({ preventScroll: true });
    input.select();
  });
}
