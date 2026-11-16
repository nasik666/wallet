// Запуск из корня проекта: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/calc.js';
import { createStore, mergeStates, restoreStates, normalize, canonical, live, uid } from '../js/store.js';
import { createSync, parseGistId, GIST_FILE } from '../js/sync.js';
import { txCsv } from '../js/export.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};

// Упрощённая копия GitHub Gist API в памяти.
function fakeGitHub() {
  const gists = new Map();
  const log = [];
  let seq = 0;
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  async function fetch(url, opts = {}) {
    const { pathname } = new URL(url);
    const method = opts.method ?? 'GET';
    log.push(`${method} ${pathname}`);
    if (opts.headers?.Authorization !== 'Bearer good') return reply(401, { message: 'Bad credentials' });
    if (pathname === '/gists' && method === 'GET') return reply(200, [...gists.values()]);
    if (pathname === '/gists' && method === 'POST') {
      const body = JSON.parse(opts.body);
      const id = `${++seq}`.padStart(32, 'a');
      const files = Object.fromEntries(Object.entries(body.files).map(([name, f]) => [name, { content: f.content, truncated: false }]));
      gists.set(id, { id, created_at: new Date(seq * 1000).toISOString(), public: body.public, files });
      return reply(201, gists.get(id));
    }
    const g = gists.get(pathname.replace('/gists/', ''));
    if (!g) return reply(404, {});
    if (method === 'PATCH') {
      for (const [name, f] of Object.entries(JSON.parse(opts.body).files)) g.files[name] = { content: f.content, truncated: false };
    }
    return reply(200, g);
  }
  return { fetch, gists, log };
}

const device = (gh) => {
  const store = createStore(memory());
  return { store, sync: createSync(store, { fetch: gh.fetch, online: () => true }) };
};
const tx = (over = {}) => ({ id: uid(), type: 'exp', amount: 250, cat: 'coffee', note: '', date: '2026-11-16', ts: 1, ...over });

/* ───────── Даты и деньги ───────── */

test('addMonths не выходит за конец месяца', () => {
  assert.equal(C.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(C.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(C.addMonths('2026-11-16', 2), '2027-01-16');
  assert.equal(C.addMonths('2026-03-31', -1), '2026-02-28');
});

test('isYmd отвергает несуществующие даты', () => {
  assert.equal(C.isYmd('2026-02-30'), false);
  assert.equal(C.isYmd('2026-2-3'), false);
  assert.equal(C.isYmd('2026-11-16'), true);
});

test('неделя начинается с понедельника', () => {
  const r = C.periodRange('week', '2026-11-16'); // понедельник
  assert.deepEqual([r.from, r.to], ['2026-11-16', '2026-11-22']);
  const s = C.periodRange('week', '2026-11-22'); // воскресенье той же недели
  assert.deepEqual([s.from, s.to], ['2026-11-16', '2026-11-22']);
});

test('границы месяца и года, сдвиг периода', () => {
  const m = C.periodRange('month', '2026-02-10');
  assert.deepEqual([m.from, m.to, m.label], ['2026-02-01', '2026-02-28', 'Февраль 2026']);
  assert.equal(C.shiftAnchor('month', '2026-01-31', 1), '2026-02-01');
  assert.equal(C.shiftAnchor('year', '2026-06-01', -1), '2025-01-01');
  assert.equal(C.shiftAnchor('week', '2026-11-16', -1), '2026-11-09');
});

test('формат и разбор сумм', () => {
  assert.equal(C.fmtMoney(1234567, '₽'), '1 234 567 ₽');
  assert.equal(C.fmtMoney(-250.5, '₽'), '−250,50 ₽');
  assert.equal(C.fmtMoney(99, '$', { sign: true }), '+99 $');
  assert.equal(C.parseAmount('1 250,50'), 1250.5);
  assert.equal(C.parseAmount('0,1'), 0.1);
  assert.equal(C.parseAmount(''), null);
  assert.equal(C.parseAmount('12a'), null);
  assert.equal(C.parseAmount('1,2,3'), null);
});

test('итоги, категории и ряды по дням', () => {
  const list = [
    tx({ amount: 100, cat: 'coffee', date: '2026-11-01' }),
    tx({ amount: 300, cat: 'lunch', date: '2026-11-01' }),
    tx({ amount: 50, cat: 'coffee', date: '2026-11-03' }),
    tx({ type: 'inc', amount: 1000, cat: 'salary', date: '2026-11-02' }),
  ];
  assert.deepEqual(C.totals(list), { inc: 1000, exp: 450, net: 550, count: 4 });
  assert.deepEqual(C.byCategory(list, 'exp').map((c) => [c.cat, c.sum, c.count]), [['lunch', 300, 1], ['coffee', 150, 2]]);
  const s = C.series(list, C.dayKeys('2026-11-01', '2026-11-03'), (t) => t.date);
  assert.deepEqual(s, [
    { key: '2026-11-01', inc: 0, exp: 400 },
    { key: '2026-11-02', inc: 1000, exp: 0 },
    { key: '2026-11-03', inc: 0, exp: 50 },
  ]);
  assert.deepEqual(C.monthKeys('2025-11-20', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

/* ───────── Долги и вклады ───────── */

test('остаток долга с частичными платежами', () => {
  const d = { amount: 10000, pays: [{ amount: 2500 }, { amount: 2500.5 }] };
  assert.equal(C.debtPaid(d), 5000.5);
  assert.equal(C.debtLeft(d), 4999.5);
  assert.equal(C.debtLeft({ amount: 100, pays: [{ amount: 150 }] }), 0);
});

const dep = (over = {}) => ({ rate: 12, start: '2025-01-01', months: 0, cap: 'none', ops: [{ id: 'o', date: '2025-01-01', amount: 100000, open: 1 }], closedOn: '', ...over });

test('вклад без капитализации: простой процент', () => {
  const s = C.depositAt(dep(), '2026-01-01'); // ровно 365 дней, год не високосный
  assert.equal(s.invested, 100000);
  assert.equal(s.interest, 12000);
  assert.equal(s.value, 112000);
});

test('вклад с ежемесячной капитализацией даёт больше простого процента', () => {
  const s = C.depositAt(dep({ cap: 'month' }), '2026-01-01');
  assert.ok(s.interest > 12600 && s.interest < 12750, `проценты ${s.interest}`); // ≈ 100000·((1+0,01)^12 − 1)
  assert.equal(s.value, C.round2(100000 + s.interest));
});

test('вклад перестаёт расти после окончания срока и после закрытия', () => {
  const termed = dep({ months: 6 });
  assert.equal(C.depositEnd(termed), '2025-07-01');
  assert.equal(C.depositAt(termed, '2025-07-01').value, C.depositAt(termed, '2030-01-01').value);
  const closed = dep({ closedOn: '2025-03-01' });
  assert.equal(C.depositAt(closed, '2025-03-01').value, C.depositAt(closed, '2026-01-01').value);
});

test('пополнение начинает приносить проценты со следующего дня', () => {
  const d = dep({ ops: [{ id: 'a', date: '2025-01-01', amount: 100000, open: 1 }, { id: 'b', date: '2025-07-01', amount: 100000 }] });
  const s = C.depositAt(d, '2026-01-01');
  assert.equal(s.invested, 200000);
  const days2 = C.daysBetween('2025-07-01', '2026-01-01');
  assert.equal(s.interest, C.round2(12000 + (100000 * 0.12 * days2) / 365));
  assert.equal(C.depositAt(d, '2024-12-01').value, 100000); // до открытия — только первый взнос
});

/* ───────── Данные и слияние ───────── */

test('normalize отбрасывает мусор и добавляет стандартные категории', () => {
  const s = normalize({
    tx: [tx({ id: 'ok' }), { id: 'bad', type: 'exp', amount: -5, date: '2026-11-16' }, { id: 'bad2', type: 'exp', amount: 5, date: 'вчера' }, null, 'x'],
    debts: 'нет',
    settings: { currency: '€' },
  });
  assert.deepEqual(s.tx.map((t) => t.id), ['ok']);
  assert.deepEqual(s.debts, []);
  assert.equal(s.settings.currency, '€');
  assert.ok(s.cats.some((c) => c.id === 'coffee') && s.cats.some((c) => c.id === 'salary'));
});

test('слияние: побеждает поздняя правка, удаление не воскресает', () => {
  const a = normalize({ tx: [{ ...tx({ id: 'x', amount: 100 }), u: 10 }, { ...tx({ id: 'y' }), u: 5 }] });
  const b = normalize({ tx: [{ ...tx({ id: 'x', amount: 999 }), u: 20 }, { id: 'y', u: 7, del: 1 }, { ...tx({ id: 'z' }), u: 1 }] });
  const m1 = mergeStates(a, b);
  const m2 = mergeStates(b, a);
  assert.equal(canonical(m1), canonical(m2)); // порядок слияния не важен
  assert.equal(m1.tx.find((t) => t.id === 'x').amount, 999);
  assert.deepEqual(live(m1.tx).map((t) => t.id).sort(), ['x', 'z']);
});

test('canonical не зависит от порядка ключей и записей', () => {
  const a = normalize({ tx: [{ id: 'a', type: 'exp', amount: 1, date: '2026-01-01', u: 1 }, { id: 'b', type: 'inc', amount: 2, date: '2026-01-02', u: 1 }] });
  const b = normalize({ tx: [{ u: 1, date: '2026-01-02', amount: 2, type: 'inc', id: 'b' }, { date: '2026-01-01', u: 1, amount: 1, id: 'a', type: 'exp' }] });
  assert.equal(canonical(a), canonical(b));
});

test('хранилище переживает перезапуск и повреждённые данные', () => {
  const mem = memory();
  const s1 = createStore(mem);
  s1.put('tx', tx({ id: 'keep' }));
  s1.setSettings({ currency: '$' });
  const s2 = createStore(mem);
  assert.deepEqual(live(s2.state.tx).map((t) => t.id), ['keep']);
  assert.equal(s2.state.settings.currency, '$');

  const broken = memory();
  broken.setItem('wallet:data:v1', '{не json');
  const s3 = createStore(broken);
  assert.deepEqual(s3.state.tx, []);
  assert.equal(broken.getItem('wallet:data:v1:broken'), '{не json');
});

test('wipe оставляет надгробия, чтобы удаление дошло до других устройств', () => {
  const s = createStore(memory());
  s.put('tx', tx({ id: 'a' }));
  s.put('cats', { id: 'mine', type: 'exp', name: 'Своя', emoji: '🎯', order: 50 });
  s.wipe();
  assert.deepEqual(live(s.state.tx), []);
  assert.equal(s.state.tx.length, 1);
  assert.equal(s.state.cats.find((c) => c.id === 'mine').del, 1);
  assert.ok(live(s.state.cats).some((c) => c.id === 'coffee'));
});

test('восстановление из копии возвращает удалённое, но не затирает свежие правки', () => {
  const s = createStore(memory());
  s.put('tx', tx({ id: 'a', amount: 100 }));
  s.put('tx', tx({ id: 'b', amount: 200 }));
  const backup = normalize(JSON.parse(canonical(s.state))); // копия до удаления

  s.wipe();
  assert.deepEqual(live(s.state.tx), []);
  assert.equal(canonical(mergeStates(s.state, backup)), canonical(s.state), 'обычное слияние удалённое не возвращает');

  const restored = restoreStates(s.state, backup);
  assert.deepEqual(live(restored.tx).map((t) => t.id).sort(), ['a', 'b']);
  const tomb = s.state.tx.find((t) => t.id === 'a');
  assert.ok(restored.tx.find((t) => t.id === 'a').u > tomb.u, 'возвращённая запись новее надгробия и дойдёт до других устройств');

  // Запись, изменённая после копии, остаётся в новом виде; удаления из копии ничего не стирают.
  const cur = normalize({ tx: [{ ...tx({ id: 'a', amount: 999 }), u: 50 }, { ...tx({ id: 'c' }), u: 5 }] });
  const old = normalize({ tx: [{ ...tx({ id: 'a', amount: 100 }), u: 10 }, { id: 'c', u: 99, del: 1 }] });
  const r = restoreStates(cur, old);
  assert.equal(r.tx.find((t) => t.id === 'a').amount, 999);
  assert.deepEqual(live(r.tx).map((t) => t.id).sort(), ['a', 'c']);
});

/* ───────── Синхронизация ───────── */

test('два устройства сходятся к одним данным, удаление распространяется', async () => {
  const gh = fakeGitHub();
  const A = device(gh);
  const B = device(gh);

  A.store.put('tx', tx({ id: 't1', note: 'с телефона' }));
  assert.deepEqual(await A.sync.connect('good'), { ok: true });
  assert.equal(gh.gists.size, 1);
  assert.equal([...gh.gists.values()][0].public, false);

  assert.deepEqual(await B.sync.connect('good'), { ok: true });
  assert.equal(gh.gists.size, 1, 'второе устройство должно найти существующий gist');
  assert.equal(B.store.local.gistId, A.store.local.gistId);
  assert.deepEqual(live(B.store.state.tx).map((t) => t.note), ['с телефона']);

  await sleep(3);
  B.store.put('tx', tx({ id: 't2', note: 'с ноутбука' }));
  await B.sync.syncNow();
  await A.sync.syncNow();
  assert.deepEqual(live(A.store.state.tx).map((t) => t.id).sort(), ['t1', 't2']);

  await sleep(3);
  A.store.remove('tx', 't1');
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.deepEqual(live(B.store.state.tx).map((t) => t.id), ['t2']);
  assert.equal(canonical(A.store.state), canonical(B.store.state));
});

test('одновременные правки одной записи: остаётся более поздняя', async () => {
  const gh = fakeGitHub();
  const A = device(gh);
  const B = device(gh);
  A.store.put('tx', tx({ id: 't', amount: 100 }));
  await A.sync.connect('good');
  await B.sync.connect('good');

  await sleep(3);
  A.store.put('tx', tx({ id: 't', amount: 111 }));
  await sleep(3);
  B.store.put('tx', tx({ id: 't', amount: 222 }));
  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.sync.syncNow();
  assert.equal(A.store.state.tx[0].amount, 222);
  assert.equal(B.store.state.tx[0].amount, 222);
});

test('без изменений в gist ничего не пишется', async () => {
  const gh = fakeGitHub();
  const A = device(gh);
  A.store.put('tx', tx());
  await A.sync.connect('good');
  gh.log.length = 0;
  await A.sync.syncNow();
  await A.sync.syncNow();
  assert.ok(gh.log.every((l) => l.startsWith('GET')), gh.log.join(', '));
});

test('неверный токен: понятная ошибка и отключение', async () => {
  const gh = fakeGitHub();
  const A = device(gh);
  const r = await A.sync.connect('bad');
  assert.equal(r.ok, false);
  assert.match(r.error, /Токен не подходит/);
  assert.equal(A.store.local.token, '');
  assert.equal(A.sync.status.state, 'off');
});

test('удалённый gist создаётся заново, данные не теряются', async () => {
  const gh = fakeGitHub();
  const A = device(gh);
  A.store.put('tx', tx({ id: 'keep' }));
  await A.sync.connect('good');
  gh.gists.clear();
  assert.equal(await A.sync.syncNow(), true);
  assert.equal(gh.gists.size, 1);
  const saved = JSON.parse([...gh.gists.values()][0].files[GIST_FILE].content);
  assert.deepEqual(live(saved.tx).map((t) => t.id), ['keep']);
});

test('правка во время сетевого запроса не теряется', async () => {
  const gh = fakeGitHub();
  const A = device(gh);
  A.store.put('tx', tx({ id: 'first' }));
  await A.sync.connect('good');
  const p = A.sync.syncNow();
  A.store.put('tx', tx({ id: 'during' })); // пока идёт запрос
  await p;
  assert.deepEqual(live(A.store.state.tx).map((t) => t.id).sort(), ['during', 'first']);
});

test('отключение во время синхронизации не оставляет ошибку и не возвращает токен', async () => {
  const gh = fakeGitHub();
  const A = device(gh);
  A.store.put('tx', tx());
  await A.sync.connect('good');
  const p = A.sync.syncNow();
  A.sync.disconnect(); // пока идёт запрос
  assert.equal(await p, false);
  assert.equal(A.sync.status.state, 'off');
  assert.equal(A.store.local.token, '');
  assert.equal(A.store.local.gistId, '');
});

test('офлайн: синхронизация откладывается без ошибок', async () => {
  const gh = fakeGitHub();
  const store = createStore(memory());
  store.saveLocal({ token: 'good' });
  const sync = createSync(store, { fetch: gh.fetch, online: () => false });
  assert.equal(await sync.syncNow(), false);
  assert.equal(sync.status.state, 'offline');
  assert.equal(gh.log.length, 0);
});

test('parseGistId понимает id и ссылку', () => {
  const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  assert.equal(parseGistId(id), id);
  assert.equal(parseGistId(`https://gist.github.com/someone/${id}`), id);
  assert.equal(parseGistId('что-то не то'), '');
});

/* ───────── Экспорт ───────── */

test('CSV: разделитель, кавычки и защита от формул', () => {
  const csv = txCsv(
    [tx({ amount: 1250.5, note: 'кафе "У моря"; обед', date: '2026-11-05' }), tx({ type: 'inc', amount: 100, cat: 'salary', note: '=СУММ(A1)', date: '2026-11-06' })],
    (id) => ({ coffee: 'Кофе', salary: 'Зарплата' })[id],
  );
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  assert.equal(lines[0], 'Дата;Тип;Категория;Сумма;Подпись');
  assert.equal(lines[1], "06.11.2026;Доход;Зарплата;100;'=СУММ(A1)");
  assert.equal(lines[2], '05.11.2026;Расход;Кофе;1250,5;"кафе ""У моря""; обед"');
  assert.ok(csv.startsWith('﻿'));
});
