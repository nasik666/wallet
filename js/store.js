// Данные приложения: структура, проверка, слияние версий и хранение в localStorage.
import { round2, isYmd } from './calc.js';

export const KEY = 'wallet:data:v1'; // синхронизируемые данные
export const LOCAL_KEY = 'wallet:local:v1'; // только это устройство: токен, id gist

const seed = (type, rows) => rows.map(([id, name, emoji], order) => ({ id, type, name, emoji, order, u: 0 }));

export const DEFAULT_CATS = [
  ...seed('exp', [
    ['snacks', 'Снеки', '🍿'],
    ['tech', 'Техника', '💻'],
    ['coffee', 'Кофе', '☕'],
    ['lunch', 'Обед', '🍱'],
    ['dinner', 'Ужин', '🍝'],
    ['groceries', 'Продукты', '🛒'],
    ['transport', 'Транспорт', '🚕'],
    ['home', 'Жильё', '🏠'],
    ['fun', 'Досуг', '🎮'],
    ['clothes', 'Одежда', '👕'],
    ['health', 'Здоровье', '💊'],
    ['subs', 'Подписки', '📱'],
    ['gifts', 'Подарки', '🎁'],
    ['other', 'Другое', '✨'],
  ]),
  ...seed('inc', [
    ['salary', 'Зарплата', '💼'],
    ['gift', 'Подарок', '🎁'],
    ['side', 'Подработка', '🛠️'],
    ['interest', 'Проценты', '📈'],
    ['refund', 'Возврат', '↩️'],
    ['other_inc', 'Другое', '✨'],
  ]),
];
const DEFAULT_IDS = new Set(DEFAULT_CATS.map((c) => c.id));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const live = (list) => list.filter((r) => !r.del);

/* ───────── Проверка входящих данных (файл, gist, localStorage) ───────── */

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x, max = 200) => (typeof x === 'string' ? x.slice(0, max) : '');
const arr = (x) => (Array.isArray(x) ? x : []);
const base = (r) => (r && typeof r === 'object' && typeof r.id === 'string' && r.id ? { id: r.id.slice(0, 64), u: num(r.u) ?? 0 } : null);

function normTx(r) {
  const b = base(r);
  if (!b) return null;
  if (r.del) return { ...b, del: 1 };
  const amount = num(r.amount);
  if (amount === null || amount <= 0 || !isYmd(r.date) || (r.type !== 'exp' && r.type !== 'inc')) return null;
  return {
    ...b,
    type: r.type,
    amount: round2(amount),
    cat: str(r.cat, 64) || (r.type === 'exp' ? 'other' : 'other_inc'),
    note: str(r.note),
    date: r.date,
    ts: num(r.ts) ?? 0,
  };
}

function normDebt(r) {
  const b = base(r);
  if (!b) return null;
  if (r.del) return { ...b, del: 1 };
  const amount = num(r.amount);
  if (amount === null || amount <= 0 || !isYmd(r.date) || (r.dir !== 'owe' && r.dir !== 'lent')) return null;
  const pays = arr(r.pays)
    .map((p) => {
      const a = num(p?.amount);
      return a !== null && a > 0 && isYmd(p.date) && typeof p.id === 'string' ? { id: p.id, amount: round2(a), date: p.date } : null;
    })
    .filter(Boolean);
  return {
    ...b,
    dir: r.dir,
    person: str(r.person, 60) || 'Без имени',
    amount: round2(amount),
    note: str(r.note),
    date: r.date,
    due: isYmd(r.due) ? r.due : '',
    pays,
  };
}

function normDeposit(r) {
  const b = base(r);
  if (!b) return null;
  if (r.del) return { ...b, del: 1 };
  const rate = num(r.rate);
  if (rate === null || rate < 0 || !isYmd(r.start)) return null;
  const ops = arr(r.ops)
    .map((o) => {
      const a = num(o?.amount);
      if (a === null || a === 0 || !isYmd(o.date) || typeof o.id !== 'string') return null;
      return { id: o.id, amount: round2(a), date: o.date, ...(o.open ? { open: 1 } : {}) };
    })
    .filter(Boolean);
  const months = num(r.months);
  return {
    ...b,
    name: str(r.name, 60) || 'Вклад',
    rate,
    start: r.start,
    months: months && months > 0 ? Math.round(months) : 0,
    cap: r.cap === 'none' ? 'none' : 'month',
    ops,
    closedOn: isYmd(r.closedOn) ? r.closedOn : '',
  };
}

function normCat(r) {
  const b = base(r);
  if (!b || (r.type !== 'exp' && r.type !== 'inc')) return null;
  return {
    ...b,
    type: r.type,
    name: str(r.name, 40) || 'Категория',
    emoji: str(r.emoji, 32) || '🏷️',
    order: num(r.order) ?? 999,
    ...(r.del ? { del: 1 } : {}),
  };
}

function dedupe(list) {
  const m = new Map();
  for (const r of list) {
    const x = m.get(r.id);
    if (!x || r.u > x.u) m.set(r.id, r);
  }
  return [...m.values()];
}

const clean = (raw, fn) => dedupe(arr(raw).map(fn).filter(Boolean));

// Приводит любые входные данные к корректному состоянию; мусор отбрасывается.
export function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const cats = clean(r.cats, normCat);
  const have = new Set(cats.map((c) => c.id));
  for (const c of DEFAULT_CATS) if (!have.has(c.id)) cats.push({ ...c });
  return {
    v: 1,
    tx: clean(r.tx, normTx),
    debts: clean(r.debts, normDebt),
    deposits: clean(r.deposits, normDeposit),
    cats,
    settings: { currency: str(r.settings?.currency, 4).trim() === '$' ? '$' : 'сум', u: num(r.settings?.u) ?? 0 },
  };
}

/* ───────── Слияние двух версий (устройство ↔ gist) ───────── */

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = stable(v[k]);
    return o;
  }
  return v;
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Одинаковые данные дают одинаковую строку независимо от порядка записей и ключей.
export function canonical(s) {
  return JSON.stringify(
    stable({
      v: 1,
      tx: [...s.tx].sort(byId),
      debts: [...s.debts].sort(byId),
      deposits: [...s.deposits].sort(byId),
      cats: [...s.cats].sort(byId),
      settings: s.settings,
    }),
  );
}

// Побеждает запись с более поздним временем правки; при равенстве выбор
// детерминированный, чтобы оба устройства пришли к одному результату.
function newer(a, b) {
  const ua = a.u ?? 0;
  const ub = b.u ?? 0;
  if (ua !== ub) return ua > ub ? a : b;
  return JSON.stringify(stable(a)) >= JSON.stringify(stable(b)) ? a : b;
}

function mergeLists(a, b) {
  const m = new Map(a.map((r) => [r.id, r]));
  for (const r of b) m.set(r.id, m.has(r.id) ? newer(m.get(r.id), r) : r);
  return [...m.values()];
}

// Удаления хранятся как «надгробия» { id, u, del }, поэтому не воскресают при слиянии.
export function mergeStates(a, b) {
  return {
    v: 1,
    tx: mergeLists(a.tx, b.tx),
    debts: mergeLists(a.debts, b.debts),
    deposits: mergeLists(a.deposits, b.deposits),
    cats: mergeLists(a.cats, b.cats),
    settings: newer(a.settings, b.settings),
  };
}

// Восстановление из резервной копии. В отличие от обычного слияния, запись из копии
// возвращается, даже если на устройстве она удалена; удаления из копии игнорируются,
// а более свежие правки на устройстве остаются.
export function restoreStates(current, backup, now = Date.now()) {
  const revive = (mine, theirs) => {
    const m = new Map(mine.map((r) => [r.id, r]));
    for (const r of theirs) {
      if (r.del) continue;
      const x = m.get(r.id);
      if (!x) m.set(r.id, r);
      else if (x.del) m.set(r.id, { ...r, u: Math.max(now, (x.u ?? 0) + 1) });
      else m.set(r.id, newer(x, r));
    }
    return [...m.values()];
  };
  return {
    v: 1,
    tx: revive(current.tx, backup.tx),
    debts: revive(current.debts, backup.debts),
    deposits: revive(current.deposits, backup.deposits),
    cats: revive(current.cats, backup.cats),
    settings: newer(current.settings, backup.settings),
  };
}

/* ───────── Хранилище ───────── */

export function createStore(storage = globalThis.localStorage) {
  const read = (k) => {
    try { return storage?.getItem(k) ?? null; } catch { return null; }
  };
  const write = (k, v) => {
    try { storage?.setItem(k, v); return true; } catch { return false; }
  };

  let state = null;
  const raw = read(KEY);
  if (raw) {
    try { state = normalize(JSON.parse(raw)); } catch { write(`${KEY}:broken`, raw); }
  }
  state ??= normalize({});

  let local = { token: '', gistId: '', lastSync: 0, hintOff: false };
  try { Object.assign(local, JSON.parse(read(LOCAL_KEY) || '{}')); } catch { /* оставляем значения по умолчанию */ }

  const subs = new Set();
  const commit = (reason) => {
    const saved = write(KEY, JSON.stringify(state));
    for (const fn of [...subs]) fn(reason, saved);
  };
  const stamp = (prev) => Math.max(Date.now(), (prev?.u ?? 0) + 1);

  return {
    get state() { return state; },
    get local() { return local; },

    saveLocal(patch) {
      local = { ...local, ...patch };
      write(LOCAL_KEY, JSON.stringify(local));
    },

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    // Создаёт или заменяет запись целиком, обновляя время правки.
    put(coll, rec) {
      const list = state[coll];
      const i = list.findIndex((r) => r.id === rec.id);
      const next = { ...rec, u: stamp(list[i]) };
      if (i >= 0) list[i] = next;
      else list.push(next);
      commit('local');
      return next;
    },

    remove(coll, id) {
      return this.put(coll, { id, del: 1 });
    },

    setSettings(patch) {
      state.settings = { ...state.settings, ...patch, u: stamp(state.settings) };
      commit('local');
    },

    replace(next, reason = 'replace') {
      state = next;
      commit(reason);
    },

    // Удаляет всё; с синхронизацией удаление дойдёт и до других устройств.
    wipe() {
      const tomb = (r) => ({ id: r.id, u: stamp(r), del: 1 });
      state = {
        ...state,
        tx: state.tx.map(tomb),
        debts: state.debts.map(tomb),
        deposits: state.deposits.map(tomb),
        cats: state.cats.map((c) => (DEFAULT_IDS.has(c.id) || c.del ? c : { ...c, del: 1, u: stamp(c) })),
      };
      commit('local');
    },
  };
}
