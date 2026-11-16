// Экран «Вклады»: ставка, срок, капитализация, пополнения и прогноз дохода.
import { store, ui, render, money, cur, emptyHtml } from './ctx.js';
import { esc, toast, openSheet, closeSheet, sheetHead, confirmSheet, promptAmount, formValues, formError } from './ui.js';
import * as C from './calc.js';
import { I } from './icons.js';
import { live, uid } from './store.js';

const rateText = (d) => `${String(d.rate).replace('.', ',')} % годовых`;

// Доля прошедшего срока, 0…1 (для бессрочных — null).
function termProgress(d, now) {
  const end = C.depositEnd(d);
  if (!end) return null;
  const total = C.daysBetween(d.start, end);
  return total > 0 ? Math.max(0, Math.min(1, C.daysBetween(d.start, d.closedOn || now) / total)) : 1;
}

function depRow(d, now) {
  const s = C.depositAt(d, now);
  const end = C.depositEnd(d);
  const done = end && end <= now;
  const when = d.closedOn ? `Закрыт ${C.fmtDate(d.closedOn)}` : done ? 'Срок истёк' : end ? `До ${C.fmtDate(end)}` : 'Бессрочный';
  const p = d.closedOn ? null : termProgress(d, now);
  return `<button type="button" class="row" data-act="dep-open" data-id="${esc(d.id)}">
    <span class="tile">🏦</span>
    <span class="row-main">
      <span class="row-title">${esc(d.name)}</span>
      <span class="row-sub"><span>${rateText(d)} · ${esc(when)}</span></span>
      ${p !== null ? `<span class="meter"><i style="width:${(p * 100).toFixed(1)}%"></i></span>` : ''}
    </span>
    <span class="row-end"><span class="row-amt">${money(s.value)}</span><span class="row-sub good">${money(s.interest, { sign: true })}</span></span>
  </button>`;
}

export function viewDeposits() {
  const now = C.today();
  const all = live(store.state.deposits).sort((a, b) => (a.start < b.start ? 1 : -1));
  const open = all.filter((d) => !d.closedOn);
  const closed = all.filter((d) => d.closedOn);
  const sum = (fn) => C.round2(open.reduce((acc, d) => acc + fn(d), 0));
  const total = sum((d) => C.depositAt(d, now).value);
  const interest = sum((d) => C.depositAt(d, now).interest);
  const nextMonth = sum((d) => C.depositAt(d, C.addMonths(now, 1)).value - C.depositAt(d, now).value);
  const totalText = money(total);

  return `<header class="head">
      <h1>Вклады</h1>
      <div class="head-actions"><button type="button" class="icon-btn" data-act="dep-add" aria-label="Добавить вклад">${I.plus}</button></div>
    </header>
    ${open.length
      ? `<section class="hero" aria-label="Итог по вкладам">
          <div class="hero-label">Сейчас на вкладах</div>
          <div class="hero-value" style="--n:${totalText.length}">${totalText}</div>
          <div class="hero-row">
            <div class="hero-stat"><div class="hero-stat-label"><span>Начислено процентов</span></div><div class="hero-stat-value">${money(interest, { sign: true })}</div></div>
            <div class="hero-stat"><div class="hero-stat-label"><span>За ближайший месяц</span></div><div class="hero-stat-value">≈ ${money(Math.round(nextMonth), { sign: true })}</div></div>
          </div>
        </section>
        <div class="list">${open.map((d) => depRow(d, now)).join('')}</div>`
      : emptyHtml('🏦', 'Вкладов пока нет', 'Добавьте вклад или накопительный счёт: укажите сумму и ставку — проценты приложение посчитает само.')}
    <button type="button" class="btn add-btn" data-act="dep-add">${I.plus}Добавить вклад</button>
    ${closed.length
      ? `<button type="button" class="disclosure${ui.closedDeps ? ' open' : ''}" data-act="dep-closed">Закрытые · ${closed.length}${I.down}</button>
         ${ui.closedDeps ? `<div class="list dim">${closed.map((d) => depRow(d, now)).join('')}</div>` : ''}`
      : ''}`;
}

/* ───────── Форма вклада ───────── */

function openDepForm({ id = null } = {}) {
  const orig = id ? store.state.deposits.find((d) => d.id === id && !d.del) : null;
  const first = orig?.ops.find((o) => o.open) ?? orig?.ops[0];
  let cap = orig?.cap ?? 'month';
  const sheet = openSheet(
    `${sheetHead(orig ? 'Изменить вклад' : 'Новый вклад')}
    <form novalidate>
      <label class="field"><span class="field-label">Название</span>
        <input class="input" name="name" placeholder="Например, накопительный счёт" maxlength="40" autocomplete="off" autocapitalize="sentences" value="${esc(orig?.name ?? '')}"></label>
      <div class="field-row">
        <label class="field"><span class="field-label">${orig ? 'Первый взнос' : 'Сумма'}, ${esc(cur())}</span>
          <input class="input" name="amount" inputmode="decimal" placeholder="0" autocomplete="off" value="${first ? String(first.amount).replace('.', ',') : ''}"></label>
        <label class="field"><span class="field-label">Ставка, % годовых</span>
          <input class="input" name="rate" inputmode="decimal" placeholder="0" autocomplete="off" value="${orig ? String(orig.rate).replace('.', ',') : ''}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span class="field-label">Дата открытия</span>
          <input class="input" type="date" name="start" value="${esc(orig?.start ?? C.today())}"></label>
        <label class="field"><span class="field-label">Срок, мес. <i>— если есть</i></span>
          <input class="input" name="months" inputmode="numeric" placeholder="Бессрочный" autocomplete="off" value="${orig?.months || ''}"></label>
      </div>
      <div class="field"><span class="field-label">Проценты</span>
        <div class="seg block">
          <button type="button" class="seg-btn" data-cap="month">Прибавляются ко вкладу</button>
          <button type="button" class="seg-btn" data-cap="none">Копятся отдельно</button>
        </div>
        <p class="hint small" data-cap-hint></p>
      </div>
      <p class="form-error" hidden></p>
      <button class="btn primary" type="submit">Сохранить</button>
    </form>`,
  );
  const form = sheet.inner.querySelector('form');
  const paint = () => {
    for (const b of form.querySelectorAll('[data-cap]')) b.classList.toggle('on', b.dataset.cap === cap);
    form.querySelector('[data-cap-hint]').textContent =
      cap === 'month' ? 'Капитализация: раз в месяц проценты прибавляются к сумме и дальше тоже приносят доход.' : 'Без капитализации: проценты считаются только на внесённую сумму.';
  };
  paint();

  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cap]');
    if (!b) return;
    cap = b.dataset.cap;
    paint();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form);
    const amount = C.parseAmount(v.amount);
    const rate = C.parseAmount(v.rate);
    const months = v.months.trim() ? Number(v.months.trim()) : 0;
    if (!(amount > 0)) return formError(form, 'Введите сумму больше нуля');
    if (rate === null || rate > 1000) return formError(form, 'Укажите ставку, например 16 или 14,5');
    if (!C.isYmd(v.start)) return formError(form, 'Укажите дату открытия');
    if (!Number.isInteger(months) || months < 0 || months > 600) return formError(form, 'Срок — целое число месяцев, либо оставьте поле пустым');

    const opening = { id: first?.id ?? uid(), date: v.start, amount, open: 1 };
    const rest = (orig?.ops ?? []).filter((o) => o.id !== first?.id);
    if (rest.some((o) => o.date < v.start)) return formError(form, 'Есть пополнения раньше этой даты открытия');
    store.put('deposits', {
      id: orig?.id ?? uid(),
      name: v.name.trim() || 'Вклад',
      rate,
      start: v.start,
      months,
      cap,
      ops: [opening, ...rest],
      closedOn: orig?.closedOn ?? '',
    });
    closeSheet(sheet);
    toast(orig ? 'Сохранено' : 'Вклад добавлен');
  });
}

/* ───────── Карточка вклада ───────── */

function openDep(id) {
  const get = () => store.state.deposits.find((d) => d.id === id && !d.del);
  if (!get()) return;

  const html = () => {
    const d = get();
    const now = C.today();
    const s = C.depositAt(d, now);
    const end = C.depositEnd(d);
    const active = !d.closedOn && !(end && end <= now);
    const p = d.closedOn ? null : termProgress(d, now);

    const points = [];
    if (active) {
      const m1 = C.addMonths(now, 1);
      const y1 = C.addMonths(now, 12);
      if (!end || m1 < end) points.push(['Через месяц', m1]);
      if (!end || y1 < end) points.push(['Через год', y1]);
      if (end) points.push([`К концу срока, ${C.fmtDate(end, { short: true, year: true })}`, end]);
    }
    const ops = [...d.ops].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return `${sheetHead(d.name)}
      <div class="detail">
        <div class="detail-label">${rateText(d)} · ${d.cap === 'month' ? 'с капитализацией' : 'без капитализации'}${d.closedOn ? ' · закрыт' : ''}</div>
        <div class="detail-value">${money(s.value)}</div>
        <div class="detail-sub">Вложено ${money(s.invested)} · проценты <b class="good">${money(s.interest, { sign: true })}</b></div>
        ${p !== null ? `<div class="meter big"><i style="width:${(p * 100).toFixed(1)}%"></i></div><div class="detail-sub">${end <= now ? 'Срок истёк' : 'Срок до'} ${esc(C.fmtDate(end, { year: true }))}</div>` : ''}
      </div>
      ${points.length
        ? `<div class="group-title">Прогноз</div>
           <dl class="facts">${points.map(([label, date]) => {
             const f = C.depositAt(d, date);
             return `<div><dt>${esc(label)}<small>${money(f.value - s.value, { sign: true })}</small></dt><dd>${money(f.value)}</dd></div>`;
           }).join('')}</dl>`
        : ''}
      ${d.closedOn ? '' : `<div class="btn-row"><button type="button" class="btn primary" data-k="add">Пополнить</button><button type="button" class="btn" data-k="take">Снять</button></div>`}
      <div class="group-title">Операции</div>
      <div class="group">${ops.map((o) => `<div class="cell"><span class="cell-main"><span class="cell-title">${money(o.amount, { sign: true })}</span><span class="cell-sub">${o.open ? 'Открытие' : o.amount > 0 ? 'Пополнение' : 'Снятие'} · ${esc(C.fmtDate(o.date, { year: true }))}</span></span>${o.open ? '' : `<button type="button" class="icon-btn sm" data-k="unop" data-id="${esc(o.id)}" aria-label="Удалить операцию">${I.x}</button>`}</div>`).join('')}</div>
      <div class="btn-row foot">
        <button type="button" class="btn" data-k="edit">Изменить</button>
        <button type="button" class="btn" data-k="${d.closedOn ? 'reopen' : 'close'}">${d.closedOn ? 'Открыть снова' : 'Закрыть вклад'}</button>
      </div>
      <button type="button" class="btn danger" data-k="del">Удалить вклад</button>`;
  };

  const sheet = openSheet(html(), { onClose: () => off() });
  const off = store.subscribe(() => {
    if (sheet.closed) return;
    if (get()) sheet.inner.innerHTML = html();
    else closeSheet(sheet);
  });

  sheet.inner.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-k]');
    const d = get();
    if (!el || !d) return;
    const k = el.dataset.k;
    if (k === 'add' || k === 'take') {
      const take = k === 'take';
      const value = C.depositAt(d).value;
      const r = await promptAmount({
        title: take ? 'Снять со вклада' : 'Пополнить вклад',
        hint: take ? `Сейчас на вкладе ${money(value)}` : '',
        cur: cur(),
        date: C.today(),
        max: take ? value : null,
        maxText: `На вкладе только ${money(value)}`,
        ok: take ? 'Снять' : 'Пополнить',
      });
      const fresh = get();
      if (!r || !fresh) return;
      const date = C.isYmd(r.date) && r.date >= fresh.start ? r.date : C.today();
      store.put('deposits', { ...fresh, ops: [...fresh.ops, { id: uid(), date, amount: take ? -r.amount : r.amount }] });
      toast(take ? 'Снятие записано' : 'Вклад пополнен');
    } else if (k === 'unop') {
      store.put('deposits', { ...d, ops: d.ops.filter((o) => o.id !== el.dataset.id) });
    } else if (k === 'edit') {
      openDepForm({ id });
    } else if (k === 'close') {
      const ok = await confirmSheet({ title: 'Закрыть вклад?', text: 'Проценты перестанут начисляться с сегодняшнего дня. Вклад останется в списке закрытых.', ok: 'Закрыть вклад', danger: false });
      if (ok) store.put('deposits', { ...get(), closedOn: C.today() });
    } else if (k === 'reopen') {
      store.put('deposits', { ...d, closedOn: '' });
    } else if (k === 'del') {
      const ok = await confirmSheet({ title: 'Удалить вклад?', text: `${d.name} — вместе со всеми операциями.` });
      if (ok) {
        store.remove('deposits', id);
        toast('Вклад удалён');
      }
    }
  });
}

export const depositActions = {
  'dep-add': () => openDepForm(),
  'dep-open': (el) => openDep(el.dataset.id),
  'dep-closed': () => {
    ui.closedDeps = !ui.closedDeps;
    render();
  },
};
