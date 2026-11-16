// Экран «Статистика»: показатели за период, графики, раскрытие категории, экспорт.
import { store, ui, render, money, cur, cats, txRow, emptyHtml, plural } from './ctx.js';
import { esc, toast, openSheet, closeSheet, sheetHead } from './ui.js';
import * as C from './calc.js';
import { I } from './icons.js';
import { live, canonical } from './store.js';
import { columnsChart, bindChart, chartTable, legend } from './charts.js';
import { txCsv, reportCsv, saveFile } from './export.js';

const KINDS = [['week', 'Неделя'], ['month', 'Месяц'], ['year', 'Год'], ['all', 'Всё']];
// Цвет закреплён за показателем, а не за графиком: расходы всегда первого цвета, доходы — второго.
const SERIES = { exp: { name: 'Расходы', slot: 1 }, inc: { name: 'Доходы', slot: 2 } };

const specs = new Map(); // графики текущей отрисовки: id → описание
let last = null; // последняя посчитанная модель: нужна экспорту и раскрытию категории

// Подписи шкалы в одном стиле на всю ось: до 10 000 — полностью, дальше — сокращённо.
const axisTick = (v, top) => (top < 10000 ? C.fmtNum(Math.round(v)) : C.fmtCompact(v));

const chartWidth = () => Math.min(document.documentElement.clientWidth, 560) - 72; // поля экрана и карточки

function model() {
  const s = ui.stats;
  const now = C.today();
  const all = live(store.state.tx);

  let bounds = null;
  if (s.kind === 'all') {
    bounds = { from: now, to: now };
    for (const t of all) {
      if (t.date < bounds.from) bounds.from = t.date;
      if (t.date > bounds.to) bounds.to = t.date;
    }
  }
  const range = C.periodRange(s.kind, s.anchor, bounds);
  const list = C.inRange(all, range.from, range.to);
  const t = C.totals(list);

  // Незавершённый период сравниваем с такими же по счёту днями предыдущего.
  const partial = range.from <= now && now < range.to;
  const elapsedTo = partial ? now : range.to;
  const elapsedDays = C.daysBetween(range.from, elapsedTo) + 1;

  // Средние считаем с первой записи, а не с начала периода: иначе у новичка они занижены.
  let first = elapsedTo;
  for (const x of all) if (x.date < first) first = x.date;
  const activeFrom = first > range.from ? first : range.from;
  const days = C.daysBetween(activeFrom, elapsedTo) + 1;

  let cmp = null;
  if (s.kind !== 'all') {
    const prev = C.periodRange(s.kind, C.shiftAnchor(s.kind, range.from, -1));
    const prevTo = partial ? [prev.to, C.addDays(prev.from, elapsedDays - 1)].sort()[0] : prev.to;
    cmp = { prev, partial, ...C.totals(C.inRange(all, prev.from, prevTo)) };
  }

  let gran = 'day';
  let keys;
  let keyOf = (x) => x.date;
  if (s.kind === 'week' || s.kind === 'month') {
    keys = C.dayKeys(range.from, range.to);
  } else {
    keys = C.monthKeys(range.from, range.to);
    gran = 'month';
    keyOf = (x) => x.date.slice(0, 7);
    if (keys.length > 36) {
      gran = 'year';
      keys = [...new Set(keys.map((k) => k.slice(0, 4)))];
      keyOf = (x) => x.date.slice(0, 4);
    }
  }
  const bands = C.series(list, keys, keyOf).map((b) => ({ ...b, ...bandText(b.key, gran, s.kind, keys.length) }));
  const cut = (d) => (gran === 'day' ? d : d.slice(0, gran === 'month' ? 7 : 4));
  const elapsedBands = Math.max(1, bands.filter((b) => b.key >= cut(activeFrom) && b.key <= cut(elapsedTo)).length);

  return { s, now, range, list, t, partial, activeFrom, elapsedTo, days, cmp, gran, bands, elapsedBands, canNext: s.kind !== 'all' && range.to < now };
}

function bandText(key, gran, kind, count) {
  if (gran === 'year') return { label: key, title: key };
  if (gran === 'month') {
    const m = Number(key.slice(5)) - 1;
    const yy = key.slice(2, 4);
    return { label: count > 12 && m === 0 ? `’${yy}` : C.MONTHS_SHORT[m], title: C.fmtMonthKey(key) };
  }
  const d = C.parseYmd(key);
  const dom = d.getDate();
  return {
    label: kind === 'week' ? C.WEEKDAYS_SHORT[d.getDay()] : dom === 1 || dom % 5 === 0 ? String(dom) : '',
    title: C.fmtDate(key, { weekday: true }),
  };
}

/* ───────── Разметка ───────── */

function insight(m) {
  const { cmp } = m;
  if (!cmp || !(cmp.exp > 0) || !(m.t.exp > 0)) return '';
  const diff = ((m.t.exp - cmp.exp) / cmp.exp) * 100;
  const p = C.parseYmd(cmp.prev.from);
  const versus = {
    week: cmp.partial ? 'за те же дни прошлой недели' : 'на прошлой неделе',
    month: cmp.partial ? `за те же дни ${C.MONTHS_GEN[p.getMonth()]}` : `в ${C.MONTHS_PREP[p.getMonth()]}`,
    year: cmp.partial ? `за тот же период ${p.getFullYear()} года` : `в ${p.getFullYear()} году`,
  }[m.s.kind];
  if (Math.abs(diff) < 1) return `<p class="insight"><span>Расходы почти такие же, как ${versus}.</span></p>`;
  const up = diff > 0;
  const pct = Math.abs(diff) >= 1000 ? 'намного' : `на ${C.fmtPct(Math.abs(diff))}`;
  return `<p class="insight ${up ? 'bad' : 'good'}">${up ? I.triUp : I.triDown}<span>Расходы ${pct} ${up ? 'выше' : 'ниже'}, чем ${versus}.</span></p>`;
}

function kpis(m) {
  const per = m.t.exp / m.days;
  return `<div class="kpis">
    <div class="kpi"><div class="kpi-label">Расходы</div><div class="kpi-value">${money(m.t.exp)}</div></div>
    <div class="kpi"><div class="kpi-label">Доходы</div><div class="kpi-value">${money(m.t.inc)}</div></div>
    <div class="kpi"><div class="kpi-label">Остаток за период</div><div class="kpi-value">${money(m.t.net, { sign: true })}</div></div>
    <div class="kpi"><div class="kpi-label">Расход в день</div><div class="kpi-value">${money(Math.round(per))}</div></div>
  </div>`;
}

const tableBtn = () =>
  `<button type="button" class="icon-btn sm${ui.stats.table ? ' on' : ''}" data-act="stats-table" aria-label="${ui.stats.table ? 'Показать графики' : 'Показать таблицы'}" aria-pressed="${ui.stats.table}">${I.table}</button>`;

function timeCard(m) {
  const type = m.s.type;
  const word = { day: ['по дням', 'в день', 'День'], month: ['по месяцам', 'в месяц', 'Месяц'], year: ['по годам', 'в год', 'Год'] }[m.gran];
  const spec = {
    id: 'ch-time',
    width: chartWidth(),
    series: [SERIES[type]],
    bands: m.bands.map((b) => ({ label: b.label, title: b.title, values: [b[type]] })),
    fmt: (v) => money(v),
    tick: axisTick,
    direct: true,
    keepLabels: m.s.kind === 'month',
    aria: `${SERIES[type].name} ${word[0]}, ${m.range.label}. Стрелки влево и вправо показывают значения.`,
  };
  specs.set(spec.id, spec);
  const avg = m.t[type] / m.elapsedBands;
  return `<section class="card">
    <div class="card-head">
      <div><h3 class="card-title">${SERIES[type].name} ${word[0]}</h3><div class="card-sub">В среднем ${money(Math.round(avg))} ${word[1]}</div></div>
      ${tableBtn()}
    </div>
    ${ui.stats.table ? chartTable(spec, word[2]) : columnsChart(spec)}
  </section>`;
}

function catCard(m) {
  const type = m.s.type;
  const rows = C.byCategory(m.list, type);
  const total = m.t[type];
  if (!rows.length) return '';
  const max = rows[0].sum;
  return `<section class="card">
    <div class="card-head"><div><h3 class="card-title">По категориям</h3><div class="card-sub">${rows.length} ${plural(rows.length, 'категория', 'категории', 'категорий')} · нажмите, чтобы увидеть записи</div></div></div>
    <div class="ranks">${rows.map((r) => {
      const c = cats.get(r.cat);
      const share = (r.sum / total) * 100;
      return `<button type="button" class="rank" data-act="cat-drill" data-cat="${esc(r.cat)}">
        <span class="rank-top"><span class="rank-emoji">${esc(c.emoji)}</span><span class="rank-name">${esc(c.name)}</span><span class="rank-val">${money(r.sum)}</span></span>
        <span class="rank-line"><span class="rank-track"><i class="s${SERIES[type].slot}" style="width:${Math.max(1, (r.sum / max) * 100).toFixed(2)}%"></i></span><span class="rank-share">${C.fmtPct(share, share < 9.95 && Math.abs(share - Math.round(share)) >= 0.05 ? 1 : 0)}</span></span>
      </button>`;
    }).join('')}</div>
  </section>`;
}

function flowCard(m) {
  if (m.gran === 'day') return '';
  const series = [SERIES.exp, SERIES.inc];
  const spec = {
    id: 'ch-flow',
    width: chartWidth(),
    series,
    bands: m.bands.map((b) => ({ label: b.label, title: b.title, values: [b.exp, b.inc], net: b.inc - b.exp })),
    fmt: (v) => money(v),
    tick: axisTick,
    extra: (b) => [['Остаток', money(b.net, { sign: true })]],
    aria: `Расходы и доходы ${m.gran === 'month' ? 'по месяцам' : 'по годам'}, ${m.range.label}. Стрелки влево и вправо показывают значения.`,
  };
  specs.set(spec.id, spec);
  return `<section class="card">
    <div class="card-head"><div><h3 class="card-title">Расходы и доходы</h3><div class="card-sub">${m.gran === 'month' ? 'По месяцам' : 'По годам'}</div></div>${tableBtn()}</div>
    ${ui.stats.table ? chartTable(spec, m.gran === 'month' ? 'Месяц' : 'Год') : legend(series) + columnsChart(spec)}
  </section>`;
}

function factsCard(m) {
  const rows = [['Записей', String(m.t.count), '']];
  const exps = m.list.filter((t) => t.type === 'exp');
  if (exps.length) {
    const big = exps.reduce((a, b) => (b.amount > a.amount ? b : a));
    rows.push(['Самая крупная трата', money(big.amount), [cats.get(big.cat).name, C.fmtDate(big.date), big.note].filter(Boolean).join(' · ')]);
    const perDay = new Map();
    for (const t of exps) perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.amount);
    const top = [...perDay].reduce((a, b) => (b[1] > a[1] ? b : a));
    rows.push(['Самый затратный день', money(top[1]), C.fmtDate(top[0], { weekday: true })]);
    const spent = [...perDay.keys()].filter((d) => d >= m.activeFrom && d <= m.elapsedTo).length;
    rows.push(['Дней без трат', `${m.days - spent} из ${m.days}`, '']);
  }
  return `<section class="card">
    <div class="card-head"><h3 class="card-title">Итоги периода</h3></div>
    <dl class="facts">${rows.map(([k, v, sub]) => `<div><dt>${esc(k)}${sub ? `<small>${esc(sub)}</small>` : ''}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  </section>`;
}

export function viewStats() {
  specs.clear();
  const m = (last = model());
  const s = m.s;
  return `<header class="head">
      <h1>Статистика</h1>
      <div class="head-actions"><button type="button" class="icon-btn" data-act="export" aria-label="Экспорт">${I.share}</button></div>
    </header>
    <div class="seg block">${KINDS.map(([k, name]) => `<button type="button" class="seg-btn${k === s.kind ? ' on' : ''}" data-act="stats-kind" data-v="${k}">${name}</button>`).join('')}</div>
    <div class="period">
      <button type="button" class="icon-btn sm" data-act="stats-shift" data-v="-1" aria-label="Предыдущий период"${s.kind === 'all' ? ' disabled' : ''}>${I.left}</button>
      <div class="period-label">${esc(m.range.label)}</div>
      <button type="button" class="icon-btn sm" data-act="stats-shift" data-v="1" aria-label="Следующий период"${m.canNext ? '' : ' disabled'}>${I.right}</button>
    </div>
    ${kpis(m)}
    ${insight(m)}
    ${m.list.length
      ? `<div class="seg block type-seg">
          <button type="button" class="seg-btn${s.type === 'exp' ? ' on' : ''}" data-act="stats-type" data-v="exp">Расходы</button>
          <button type="button" class="seg-btn${s.type === 'inc' ? ' on' : ''}" data-act="stats-type" data-v="inc">Доходы</button>
        </div>
        ${m.t[s.type] > 0 ? timeCard(m) + catCard(m) : `<section class="card">${emptyHtml('🗓️', s.type === 'exp' ? 'Расходов за период нет' : 'Доходов за период нет', 'Переключите вид или выберите другой период.')}</section>`}
        ${flowCard(m)}
        ${factsCard(m)}`
      : emptyHtml('📊', 'За этот период записей нет', 'Выберите другой период или добавьте операцию кнопкой +.')}`;
}

export function mountStats(root) {
  for (const [id, spec] of specs) {
    const el = root.querySelector(`#${id}`);
    if (el) bindChart(el, spec);
  }
}

/* ───────── Раскрытие категории ───────── */

function openCatDrill(catId) {
  const m = last ?? model();
  const type = m.s.type;
  const html = () => {
    const c = cats.get(catId);
    const list = C.inRange(live(store.state.tx), m.range.from, m.range.to)
      .filter((t) => t.cat === catId && t.type === type)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.ts || 0) - (a.ts || 0)));
    const sum = list.reduce((acc, t) => acc + t.amount, 0);
    return `${sheetHead(`${c.emoji} ${c.name}`)}
      <p class="hint">${esc(m.range.label)} · ${list.length} ${plural(list.length, 'запись', 'записи', 'записей')} на ${money(sum)}</p>
      <div class="drill">${list.length
        ? list.map((t) => txRow({ ...t, note: [C.fmtDate(t.date, { short: true }), t.note].filter(Boolean).join(' · ') })).join('')
        : emptyHtml('🗓️', 'Записей не осталось', 'В этой категории за период больше ничего нет.')}</div>`;
  };
  const sheet = openSheet(html(), { onClose: () => off() });
  const off = store.subscribe(() => {
    if (!sheet.closed) sheet.inner.innerHTML = html();
  });
}

/* ───────── Экспорт ───────── */

const catName = (id) => cats.get(id).name;

export function openExport() {
  const m = ui.tab === 'stats' && last ? last : model();
  const sheet = openSheet(
    `${sheetHead('Экспорт')}
    <p class="hint">Период: ${esc(m.range.label)}. CSV открывается в Excel, Numbers и Google Таблицах.</p>
    <div class="group">
      <button type="button" class="cell" data-k="report"><span class="tile sm">📊</span><span class="cell-main"><span class="cell-title">Отчёт за период</span><span class="cell-sub">Итоги, категории, динамика, долги и вклады · CSV</span></span></button>
      <button type="button" class="cell" data-k="tx"><span class="tile sm">🧾</span><span class="cell-main"><span class="cell-title">Операции за период</span><span class="cell-sub">${m.list.length} ${plural(m.list.length, 'запись', 'записи', 'записей')} · CSV</span></span></button>
      <button type="button" class="cell" data-k="all"><span class="tile sm">🗂️</span><span class="cell-main"><span class="cell-title">Все операции</span><span class="cell-sub">За всё время · CSV</span></span></button>
      <button type="button" class="cell" data-k="json"><span class="tile sm">💾</span><span class="cell-main"><span class="cell-title">Полная копия данных</span><span class="cell-sub">Для переноса и восстановления · JSON</span></span></button>
    </div>`,
  );

  sheet.inner.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    const span = m.s.kind === 'all' ? 'vse-vremya' : `${m.range.from}_${m.range.to}`;
    let res;
    if (k === 'report') {
      const text = reportCsv({
        label: m.range.label,
        currency: cur(),
        totals: m.t,
        catsExp: C.byCategory(m.list, 'exp'),
        catsInc: C.byCategory(m.list, 'inc'),
        bandsHead: { day: 'По дням', month: 'По месяцам', year: 'По годам' }[m.gran],
        bands: m.bands,
        debts: live(store.state.debts).filter((d) => C.debtLeft(d) > 0),
        deposits: live(store.state.deposits).filter((d) => !d.closedOn),
        catName,
      });
      res = await saveFile(`koshelek-otchet-${span}.csv`, 'text/csv', text);
    } else if (k === 'tx') {
      res = await saveFile(`koshelek-operacii-${span}.csv`, 'text/csv', txCsv(m.list, catName));
    } else if (k === 'all') {
      res = await saveFile('koshelek-operacii-vse.csv', 'text/csv', txCsv(live(store.state.tx), catName));
    } else {
      res = await saveFile(`koshelek-kopiya-${C.today()}.json`, 'application/json', canonical(store.state));
    }
    if (res === 'cancelled') return;
    closeSheet(sheet);
    toast(res === 'shared' ? 'Готово' : 'Файл сохранён в загрузки');
  });
}

export const statsActions = {
  'stats-kind': (el) => {
    ui.stats.kind = el.dataset.v;
    ui.stats.anchor = C.today();
    render();
  },
  'stats-shift': (el) => {
    ui.stats.anchor = C.shiftAnchor(ui.stats.kind, C.periodRange(ui.stats.kind, ui.stats.anchor).from, Number(el.dataset.v));
    render();
  },
  'stats-type': (el) => {
    ui.stats.type = el.dataset.v;
    render();
  },
  'stats-table': () => {
    ui.stats.table = !ui.stats.table;
    render();
  },
  'cat-drill': (el) => openCatDrill(el.dataset.cat),
  export: () => openExport(),
};
