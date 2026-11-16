// Экран «Долги»: две вкладки (я должен / мне должны), частичные платежи.
import { store, ui, render, money, cur, emptyHtml } from './ctx.js';
import { esc, toast, openSheet, closeSheet, sheetHead, confirmSheet, promptAmount, formValues, formError } from './ui.js';
import * as C from './calc.js';
import { I } from './icons.js';
import { live, uid } from './store.js';

const DIR = {
  owe: { tab: 'Я должен', who: 'Кому я должен', paid: 'Возвращено', pay: 'Вернуть часть' },
  lent: { tab: 'Мне должны', who: 'Кто мне должен', paid: 'Вернули', pay: 'Вернули часть' },
};

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ([...(parts[0] ?? '?')][0] + ([...(parts[1] ?? '')][0] ?? '')).toUpperCase();
}

const isOverdue = (d) => Boolean(d.due) && d.due < C.today() && C.debtLeft(d) > 0;
const sumLeft = (list) => C.round2(list.reduce((s, d) => s + C.debtLeft(d), 0));

function debtRow(d) {
  const left = C.debtLeft(d);
  const paid = C.debtPaid(d);
  const closed = left <= 0;
  const overdue = isOverdue(d);
  const when = closed ? 'Закрыт' : overdue ? `Просрочен с ${C.fmtDate(d.due)}` : d.due ? `До ${C.fmtDate(d.due)}` : `С ${C.fmtDate(d.date)}`;
  const partly = paid > 0 && !closed;
  return `<button type="button" class="row" data-act="debt-open" data-id="${esc(d.id)}">
    <span class="avatar">${esc(initials(d.person))}</span>
    <span class="row-main">
      <span class="row-title">${esc(d.person)}</span>
      <span class="row-sub${overdue ? ' bad' : ''}">${overdue ? I.warn : ''}<span>${esc([when, d.note].filter(Boolean).join(' · '))}</span></span>
      ${partly ? `<span class="meter"><i style="width:${((paid / d.amount) * 100).toFixed(1)}%"></i></span>` : ''}
    </span>
    <span class="row-end"><span class="row-amt">${money(closed ? d.amount : left)}</span>${partly ? `<span class="row-sub">из ${money(d.amount)}</span>` : ''}</span>
  </button>`;
}

export function viewDebts() {
  const all = live(store.state.debts);
  const dir = ui.debtDir;
  const mine = all.filter((d) => d.dir === dir);
  const open = mine
    .filter((d) => C.debtLeft(d) > 0)
    .sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : a.date < b.date ? 1 : -1);
  const closed = mine.filter((d) => C.debtLeft(d) <= 0).sort((a, b) => (a.date < b.date ? 1 : -1));
  const tab = (key) =>
    `<button type="button" class="seg-btn${dir === key ? ' on' : ''}" data-act="debt-dir" data-v="${key}"><span>${DIR[key].tab}</span><b>${money(sumLeft(all.filter((d) => d.dir === key)))}</b></button>`;

  return `<header class="head">
      <h1>Долги</h1>
      <div class="head-actions"><button type="button" class="icon-btn" data-act="debt-add" aria-label="Записать долг">${I.plus}</button></div>
    </header>
    <div class="seg block tall">${tab('owe')}${tab('lent')}</div>
    ${open.length
      ? `<div class="list">${open.map(debtRow).join('')}</div>`
      : emptyHtml('🤝', dir === 'owe' ? 'Вы никому не должны' : 'Вам никто не должен', 'Запишите долг — можно указать срок возврата и отмечать возврат частями.')}
    <button type="button" class="btn add-btn" data-act="debt-add">${I.plus}Записать долг</button>
    ${closed.length
      ? `<button type="button" class="disclosure${ui.closedDebts ? ' open' : ''}" data-act="debt-closed">Закрытые · ${closed.length}${I.down}</button>
         ${ui.closedDebts ? `<div class="list dim">${closed.map(debtRow).join('')}</div>` : ''}`
      : ''}`;
}

/* ───────── Форма долга ───────── */

function openDebtForm({ id = null, dir = ui.debtDir } = {}) {
  const orig = id ? store.state.debts.find((d) => d.id === id && !d.del) : null;
  let side = orig?.dir ?? dir;
  const sheet = openSheet(
    `${sheetHead(orig ? 'Изменить долг' : 'Новый долг')}
    <form novalidate>
      <div class="seg block">
        <button type="button" class="seg-btn" data-dir="owe">Я должен</button>
        <button type="button" class="seg-btn" data-dir="lent">Мне должны</button>
      </div>
      <label class="field"><span class="field-label" data-who></span>
        <input class="input" name="person" placeholder="Имя" maxlength="40" autocomplete="off" autocapitalize="words" value="${esc(orig?.person ?? '')}"></label>
      <div class="field-row">
        <label class="field"><span class="field-label">Сумма, ${esc(cur())}</span>
          <input class="input" name="amount" inputmode="decimal" placeholder="0" autocomplete="off" value="${orig ? String(orig.amount).replace('.', ',') : ''}"></label>
        <label class="field"><span class="field-label">Дата</span>
          <input class="input" type="date" name="date" value="${esc(orig?.date ?? C.today())}"></label>
      </div>
      <label class="field"><span class="field-label">Вернуть до <i>— необязательно</i></span>
        <input class="input" type="date" name="due" value="${esc(orig?.due ?? '')}"></label>
      <label class="field"><span class="field-label">Подпись <i>— необязательно</i></span>
        <input class="input" name="note" placeholder="За что" maxlength="120" autocomplete="off" value="${esc(orig?.note ?? '')}"></label>
      <p class="form-error" hidden></p>
      <button class="btn primary" type="submit">Сохранить</button>
    </form>`,
  );
  const form = sheet.inner.querySelector('form');
  const paint = () => {
    for (const b of form.querySelectorAll('[data-dir]')) b.classList.toggle('on', b.dataset.dir === side);
    form.querySelector('[data-who]').textContent = DIR[side].who;
  };
  paint();

  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]');
    if (!b) return;
    side = b.dataset.dir;
    paint();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form);
    const person = v.person.trim();
    const amount = C.parseAmount(v.amount);
    if (!person) return formError(form, 'Укажите, с кем долг');
    if (!(amount > 0)) return formError(form, 'Введите сумму больше нуля');
    if (!C.isYmd(v.date)) return formError(form, 'Укажите дату');
    if (orig && amount < C.debtPaid(orig)) return formError(form, `Уже возвращено ${money(C.debtPaid(orig))} — сумма не может быть меньше`);
    store.put('debts', {
      id: orig?.id ?? uid(),
      dir: side,
      person,
      amount,
      note: v.note.trim(),
      date: v.date,
      due: C.isYmd(v.due) ? v.due : '',
      pays: orig?.pays ?? [],
    });
    if (!orig) ui.debtDir = side;
    closeSheet(sheet);
    render();
    toast(orig ? 'Сохранено' : 'Долг записан');
  });
}

/* ───────── Карточка долга ───────── */

function openDebt(id) {
  const get = () => store.state.debts.find((d) => d.id === id && !d.del);
  if (!get()) return;

  const html = () => {
    const d = get();
    const left = C.debtLeft(d);
    const paid = C.debtPaid(d);
    const closed = left <= 0;
    const t = DIR[d.dir];
    return `${sheetHead(d.person)}
      <div class="detail">
        <div class="detail-label">${t.tab}${closed ? ' · долг закрыт' : ''}</div>
        <div class="detail-value">${money(closed ? d.amount : left)}</div>
        ${paid > 0 ? `<div class="meter big"><i style="width:${Math.min(100, (paid / d.amount) * 100).toFixed(1)}%"></i></div><div class="detail-sub">${t.paid} ${money(paid)} из ${money(d.amount)}</div>` : ''}
      </div>
      <dl class="facts">
        <div><dt>Дата</dt><dd>${esc(C.fmtDate(d.date, { year: true }))}</dd></div>
        ${d.due ? `<div><dt>Вернуть до</dt><dd class="${isOverdue(d) ? 'bad' : ''}">${isOverdue(d) ? I.warn : ''}${esc(C.fmtDate(d.due, { year: true }))}${isOverdue(d) ? ' — просрочен' : ''}</dd></div>` : ''}
        ${d.note ? `<div><dt>Подпись</dt><dd>${esc(d.note)}</dd></div>` : ''}
      </dl>
      ${closed ? '' : `<div class="btn-row"><button type="button" class="btn primary" data-k="pay">${t.pay}</button><button type="button" class="btn" data-k="payall">Закрыть долг</button></div>`}
      ${d.pays.length
        ? `<div class="group-title">Платежи</div>
           <div class="group">${d.pays.map((p) => `<div class="cell"><span class="cell-main"><span class="cell-title">${money(p.amount)}</span><span class="cell-sub">${esc(C.fmtDate(p.date, { year: true }))}</span></span><button type="button" class="icon-btn sm" data-k="unpay" data-id="${esc(p.id)}" aria-label="Удалить платёж">${I.x}</button></div>`).join('')}</div>`
        : ''}
      <div class="btn-row foot"><button type="button" class="btn" data-k="edit">Изменить</button><button type="button" class="btn danger" data-k="del">Удалить</button></div>`;
  };

  const sheet = openSheet(html(), { onClose: () => off() });
  const off = store.subscribe(() => {
    if (sheet.closed) return;
    if (get()) sheet.inner.innerHTML = html();
    else closeSheet(sheet);
  });

  const addPay = (d, amount, date) => store.put('debts', { ...d, pays: [...d.pays, { id: uid(), amount, date }] });

  sheet.inner.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-k]');
    const d = get();
    if (!el || !d) return;
    const k = el.dataset.k;
    const left = C.debtLeft(d);
    if (k === 'pay') {
      const r = await promptAmount({ title: DIR[d.dir].pay, hint: `Осталось ${money(left)}`, cur: cur(), date: C.today(), max: left, maxText: `Осталось всего ${money(left)}`, ok: 'Записать' });
      if (!r || !get()) return;
      addPay(get(), r.amount, C.isYmd(r.date) ? r.date : C.today());
      toast(C.debtLeft(get()) <= 0 ? 'Долг закрыт 🎉' : 'Платёж записан');
    } else if (k === 'payall') {
      addPay(d, left, C.today());
      toast('Долг закрыт 🎉');
    } else if (k === 'unpay') {
      store.put('debts', { ...d, pays: d.pays.filter((p) => p.id !== el.dataset.id) });
    } else if (k === 'edit') {
      openDebtForm({ id });
    } else if (k === 'del') {
      const ok = await confirmSheet({ title: 'Удалить долг?', text: `${d.person}, ${money(d.amount)}` });
      if (ok) {
        store.remove('debts', id);
        toast('Долг удалён');
      }
    }
  });
}

export const debtActions = {
  'debt-dir': (el) => {
    ui.debtDir = el.dataset.v;
    render();
  },
  'debt-add': () => openDebtForm(),
  'debt-open': (el) => openDebt(el.dataset.id),
  'debt-closed': () => {
    ui.closedDebts = !ui.closedDebts;
    render();
  },
};
