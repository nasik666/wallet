// Шторка добавления и правки операции: сумма с клавиатуры, категория, дата, подпись.
import { store, cats, cur, money } from './ctx.js';
import { esc, toast, openSheet, closeSheet, closeBtn, confirmSheet, topSheet } from './ui.js';
import * as C from './calc.js';
import { I } from './icons.js';
import { uid } from './store.js';
import { openCatForm } from './catform.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'];

export function openTxSheet({ id = null, type = 'exp', cat = null } = {}) {
  const orig = id ? store.state.tx.find((t) => t.id === id && !t.del) : null;
  if (id && !orig) return;

  const s = {
    type: orig?.type ?? (cat ? cats.get(cat).type || type : type),
    cat: orig?.cat ?? cat,
    amt: orig ? String(orig.amount).replace('.', ',') : '',
    date: orig?.date ?? C.today(),
  };

  const sheet = openSheet(
    `<div class="sheet-head">
      ${orig ? `<button type="button" class="icon-btn" data-k="del" aria-label="Удалить запись">${I.trash}</button>` : '<span class="icon-btn ghost"></span>'}
      <div class="seg" role="tablist">
        <button type="button" class="seg-btn" data-k="type" data-v="exp">Расход</button>
        <button type="button" class="seg-btn" data-k="type" data-v="inc">Доход</button>
      </div>
      ${closeBtn}
    </div>
    <div class="amount" aria-live="polite"></div>
    <div class="cat-wrap"><div class="cat-grid"></div></div>
    <div class="tx-meta">
      <div class="chips">
        <button type="button" class="chip" data-k="date" data-v="0">Сегодня</button>
        <button type="button" class="chip" data-k="date" data-v="-1">Вчера</button>
        <label class="chip chip-date">${I.calendar}<span class="chip-date-label"></span><input type="date" aria-label="Другая дата"></label>
      </div>
      <input class="input note" placeholder="Подпись: что, где, с кем" maxlength="120" enterkeyhint="done" autocomplete="off" value="${esc(orig?.note ?? '')}">
    </div>
    <div class="keypad">${KEYS.map((k) => `<button type="button" class="key" data-key="${k}"${k === 'back' ? ' aria-label="Стереть"' : ''}>${k === 'back' ? I.back : k}</button>`).join('')}</div>
    <button type="button" class="btn primary" data-k="save"></button>`,
    { tall: true, cls: 'tx-sheet', onClose: () => document.removeEventListener('keydown', onKey) },
  );

  const q = (sel) => sheet.inner.querySelector(sel);
  const amountEl = q('.amount');
  const noteEl = q('.note');
  const dateEl = q('.chip-date input');
  const value = () => C.parseAmount(s.amt) ?? 0;

  function paintAmount() {
    const [int, frac] = s.amt.split(',');
    const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const text = `${s.type === 'inc' ? '+' : '−'}${grouped}${frac !== undefined ? `,${frac}` : ''}`;
    amountEl.innerHTML = `<span>${s.amt ? text : '0'}</span><span class="amount-cur">${esc(cur())}</span>`;
    amountEl.classList.toggle('empty', !s.amt);
    amountEl.classList.toggle('inc', s.type === 'inc' && Boolean(s.amt));
    amountEl.style.setProperty('--n', String(text.length + 2));
    const btn = q('[data-k="save"]');
    btn.textContent = orig ? 'Сохранить' : s.type === 'inc' ? 'Добавить доход' : 'Добавить расход';
    btn.disabled = !(value() > 0);
  }

  function paintType() {
    for (const b of sheet.inner.querySelectorAll('[data-k="type"]')) b.classList.toggle('on', b.dataset.v === s.type);
  }

  function paintCats() {
    q('.cat-grid').innerHTML =
      cats.of(s.type).map((c) =>
        `<button type="button" class="cat${c.id === s.cat ? ' on' : ''}" data-k="cat" data-v="${esc(c.id)}"><span class="cat-ico">${esc(c.emoji)}</span><span class="cat-name">${esc(c.name)}</span></button>`).join('') +
      `<button type="button" class="cat cat-new" data-k="newcat"><span class="cat-ico">${I.plus}</span><span class="cat-name">Своя</span></button>`;
  }

  function paintDate() {
    const now = C.today();
    const off = s.date === now ? '0' : s.date === C.addDays(now, -1) ? '-1' : null;
    for (const b of sheet.inner.querySelectorAll('[data-k="date"]')) b.classList.toggle('on', b.dataset.v === off);
    q('.chip-date').classList.toggle('on', off === null);
    q('.chip-date-label').textContent = off === null ? C.fmtDate(s.date, { short: true }) : 'Другой день';
    dateEl.value = s.date;
  }

  function bump() {
    amountEl.classList.remove('shake');
    void amountEl.offsetWidth;
    amountEl.classList.add('shake');
  }

  function press(k) {
    let v = s.amt;
    if (k === 'back') {
      v = v.slice(0, -1);
    } else if (k === ',') {
      if (!v.includes(',')) v = `${v || '0'},`;
    } else {
      const [int, frac] = v.split(',');
      if (frac !== undefined) {
        if (frac.length >= 2) return bump();
        v += k;
      } else if (int === '0') {
        v = k;
      } else if (int.length >= 9) {
        return bump();
      } else {
        v += k;
      }
    }
    s.amt = v;
    paintAmount();
  }

  function save() {
    const amount = value();
    if (!(amount > 0)) return bump();
    const cat = s.cat || (s.type === 'exp' ? 'other' : 'other_inc');
    store.put('tx', {
      id: orig?.id ?? uid(),
      type: s.type,
      amount,
      cat,
      note: noteEl.value.trim(),
      date: s.date,
      ts: orig?.ts ?? Date.now(),
    });
    closeSheet(sheet);
    toast(orig ? 'Сохранено' : `${cats.get(cat).name}: ${money(s.type === 'inc' ? amount : -amount, { sign: true })}`);
  }

  // Клавиатура шторки: pointerdown, чтобы цифры откликались мгновенно.
  let hold = null;
  sheet.inner.addEventListener('pointerdown', (e) => {
    const key = e.target.closest('[data-key]');
    if (!key) return;
    e.preventDefault();
    press(key.dataset.key);
    if (key.dataset.key === 'back') {
      clearTimeout(hold);
      hold = setTimeout(() => { s.amt = ''; paintAmount(); }, 550); // долгое нажатие стирает всё
    }
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) sheet.inner.addEventListener(ev, () => clearTimeout(hold));

  sheet.inner.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    const { k, v } = el.dataset;
    if (k === 'type' && v !== s.type) {
      s.type = v;
      s.cat = null;
      paintType();
      paintCats();
      paintAmount();
    } else if (k === 'cat') {
      s.cat = v;
      for (const b of sheet.inner.querySelectorAll('.cat')) b.classList.toggle('on', b.dataset.v === v);
    } else if (k === 'newcat') {
      const created = await openCatForm({ type: s.type });
      if (created) s.cat = created.id;
      paintCats();
    } else if (k === 'date') {
      s.date = C.addDays(C.today(), Number(v));
      paintDate();
    } else if (k === 'save') {
      save();
    } else if (k === 'del') {
      const c = cats.get(orig.cat);
      const ok = await confirmSheet({ title: 'Удалить запись?', text: `${c.name}, ${money(orig.amount)}, ${C.fmtDate(orig.date)}` });
      if (!ok) return;
      store.remove('tx', orig.id);
      closeSheet(sheet);
      toast('Запись удалена');
    }
  });

  dateEl.addEventListener('click', () => {
    try { dateEl.showPicker?.(); } catch { /* сработает обычное поведение поля */ }
  });
  dateEl.addEventListener('change', () => {
    if (C.isYmd(dateEl.value)) s.date = dateEl.value;
    paintDate();
  });
  noteEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') noteEl.blur();
  });

  // С обычной клавиатуры (на компьютере) сумму можно просто набрать.
  function onKey(e) {
    if (topSheet() !== sheet || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches?.('input, textarea')) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === ',' || e.key === '.') press(',');
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') save();
    else return;
    e.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  paintType();
  paintCats();
  paintDate();
  paintAmount();
}
