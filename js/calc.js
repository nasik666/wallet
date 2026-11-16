// Чистые функции: даты, деньги, агрегаты, долги, вклады. Без DOM и без состояния.

export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const NBSP = ' ';
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ───────── Даты (строки YYYY-MM-DD в местном времени) ───────── */

export const pad2 = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const today = () => ymd(new Date());

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseYmd(s)) === s;
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// Сдвиг на n месяцев; 31 января + 1 месяц = 28/29 февраля.
export function addMonths(s, n) {
  const d = parseYmd(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return ymd(d);
}

// Номер дня от эпохи: считаем в UTC, чтобы переводы часов не ломали арифметику.
export function dayNum(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}

export function fromDayNum(n) {
  const d = new Date(n * 864e5);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export const daysBetween = (a, b) => dayNum(b) - dayNum(a);

export function dayKeys(from, to) {
  const out = [];
  for (let n = dayNum(from), e = dayNum(to); n <= e; n++) out.push(fromDayNum(n));
  return out;
}

export function monthKeys(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad2(m)}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export function fmtDate(s, { weekday = false, short = false, year = 'auto' } = {}) {
  const d = parseYmd(s);
  let out = `${d.getDate()}${NBSP}${(short ? MONTHS_SHORT : MONTHS_GEN)[d.getMonth()]}`;
  if (year === true || (year === 'auto' && d.getFullYear() !== new Date().getFullYear())) out += `${NBSP}${d.getFullYear()}`;
  if (weekday) out += `, ${WEEKDAYS_SHORT[d.getDay()]}`;
  return out;
}

export function fmtDateRel(s, now = today()) {
  if (s === now) return 'Сегодня';
  if (s === addDays(now, -1)) return 'Вчера';
  if (s === addDays(now, 1)) return 'Завтра';
  return fmtDate(s, { weekday: true });
}

export function fmtMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return `${cap(MONTHS[m - 1])} ${y}`;
}

export function fmtAgo(ts, now = Date.now()) {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 45) return 'только что';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}${NBSP}мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}${NBSP}ч назад`;
  return fmtDate(ymd(new Date(ts)), { short: true });
}

/* ───────── Периоды статистики ───────── */

function spanLabel(from, to) {
  const a = parseYmd(from);
  const b = parseYmd(to);
  const y = b.getFullYear() !== new Date().getFullYear() ? ` ${b.getFullYear()}` : '';
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[b.getMonth()]}${y}`;
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}${y}`;
}

// kind: week | month | year | all. Для all границы передаются в bounds.
export function periodRange(kind, anchor, bounds = null) {
  const d = parseYmd(anchor);
  if (kind === 'week') {
    const from = addDays(anchor, -((d.getDay() + 6) % 7)); // неделя с понедельника
    const to = addDays(from, 6);
    return { kind, from, to, label: spanLabel(from, to) };
  }
  if (kind === 'month') {
    const from = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
    const to = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return { kind, from, to, label: `${cap(MONTHS[d.getMonth()])} ${d.getFullYear()}` };
  }
  if (kind === 'year') {
    const y = d.getFullYear();
    return { kind, from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
  }
  return { kind: 'all', from: bounds?.from ?? anchor, to: bounds?.to ?? anchor, label: 'За всё время' };
}

export function shiftAnchor(kind, anchor, dir) {
  if (kind === 'week') return addDays(anchor, 7 * dir);
  if (kind === 'month') return addMonths(`${anchor.slice(0, 7)}-01`, dir);
  if (kind === 'year') return `${Number(anchor.slice(0, 4)) + dir}-01-01`;
  return anchor;
}

/* ───────── Деньги ───────── */

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfc = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const fixSpaces = (s) => s.replace(/[   ]/g, NBSP);

// Число без знака: целые без копеек, дробные всегда с двумя знаками.
export function fmtNum(n) {
  const a = Math.abs(round2(n));
  return fixSpaces((Number.isInteger(a) ? nf0 : nf2).format(a));
}

export function fmtMoney(n, cur = 'сум', { sign = false } = {}) {
  const v = round2(n);
  const s = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return `${s}${fmtNum(v)}${NBSP}${cur}`;
}

export const fmtCompact = (n) => fixSpaces(nfc.format(n));

export function fmtPct(x, digits = 0) {
  return `${x.toFixed(digits).replace('.', ',')}${NBSP}%`;
}

// «1 250,50» → 1250.5; пустая или некорректная строка → null.
export function parseAmount(input) {
  const s = String(input ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
  const n = round2(parseFloat(s));
  return Number.isFinite(n) ? n : null;
}

/* ───────── Агрегаты по операциям ───────── */

export function inRange(list, from, to) {
  return list.filter((t) => t.date >= from && t.date <= to);
}

export function totals(list) {
  let inc = 0;
  let exp = 0;
  for (const t of list) {
    if (t.type === 'inc') inc += t.amount;
    else exp += t.amount;
  }
  return { inc: round2(inc), exp: round2(exp), net: round2(inc - exp), count: list.length };
}

export function byCategory(list, type) {
  const m = new Map();
  for (const t of list) {
    if (t.type !== type) continue;
    const x = m.get(t.cat) ?? { cat: t.cat, sum: 0, count: 0 };
    x.sum += t.amount;
    x.count++;
    m.set(t.cat, x);
  }
  return [...m.values()].map((x) => ({ ...x, sum: round2(x.sum) })).sort((a, b) => b.sum - a.sum);
}

// Раскладывает операции по корзинам keys (дни, месяцы или годы).
export function series(list, keys, keyOf) {
  const m = new Map(keys.map((key) => [key, { key, inc: 0, exp: 0 }]));
  for (const t of list) {
    const x = m.get(keyOf(t));
    if (x) x[t.type] += t.amount;
  }
  return [...m.values()].map((x) => ({ key: x.key, inc: round2(x.inc), exp: round2(x.exp) }));
}

/* ───────── Долги ───────── */

export const debtPaid = (d) => round2((d.pays ?? []).reduce((s, p) => s + p.amount, 0));
export const debtLeft = (d) => Math.max(0, round2(d.amount - debtPaid(d)));

/* ───────── Вклады ───────── */

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function depositEnd(dep) {
  return dep.months > 0 ? addMonths(dep.start, dep.months) : null;
}

// Состояние вклада на дату: проценты начисляются ежедневно на остаток,
// при cap === 'month' причисляются к вкладу каждый месяц в день открытия.
// Операция (пополнение, снятие) начинает работать со следующего дня.
export function depositAt(dep, on = today()) {
  const startN = dayNum(dep.start);
  const stops = [dayNum(on)];
  const end = depositEnd(dep);
  if (end) stops.push(dayNum(end));
  if (dep.closedOn) stops.push(dayNum(dep.closedOn));
  const endN = Math.min(...stops);

  const ops = [...(dep.ops ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let balance = 0; // тело вклада вместе с причисленными процентами
  let invested = 0; // внесено минус снято
  let pending = 0; // начислено, но ещё не причислено
  let capitalized = 0;
  let i = 0;
  const apply = (n) => {
    while (i < ops.length && dayNum(ops[i].date) <= n) {
      balance += ops[i].amount;
      invested += ops[i].amount;
      i++;
    }
  };

  apply(startN);
  const startDom = Number(dep.start.slice(8));
  const rate = (dep.rate || 0) / 100;
  for (let n = startN + 1; n <= endN; n++) {
    const d = new Date(n * 864e5);
    const y = d.getUTCFullYear();
    if (balance > 0) pending += (balance * rate) / (isLeap(y) ? 366 : 365);
    if (dep.cap === 'month') {
      const dim = new Date(Date.UTC(y, d.getUTCMonth() + 1, 0)).getUTCDate();
      if (d.getUTCDate() === Math.min(startDom, dim)) {
        balance += pending;
        capitalized += pending;
        pending = 0;
      }
    }
    apply(n);
  }

  return {
    invested: round2(invested),
    interest: round2(capitalized + pending),
    value: round2(balance + pending),
  };
}
