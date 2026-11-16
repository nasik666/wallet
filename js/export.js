// Экспорт: CSV для Excel / Numbers и полная копия в JSON.
import * as C from './calc.js';

const SEP = ';'; // так CSV сразу открывается по столбцам в русском Excel и Numbers

function cell(v) {
  let s = v == null ? '' : String(v);
  // Текст, начинающийся с = + - @, табличные редакторы принимают за формулу.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`;
  return /["\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows) => `﻿${rows.map((r) => r.map(cell).join(SEP)).join('\r\n')}\r\n`;

const n = (x) => String(C.round2(x)).replace('.', ',');
const d = (s) => (s ? s.split('-').reverse().join('.') : '');
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.ts || 0) - (a.ts || 0));

export function txCsv(list, catName) {
  const rows = [['Дата', 'Тип', 'Категория', 'Сумма', 'Подпись']];
  for (const t of [...list].sort(byDateDesc)) {
    rows.push([d(t.date), t.type === 'inc' ? 'Доход' : 'Расход', catName(t.cat), n(t.amount), t.note || '']);
  }
  return toCsv(rows);
}

// Отчёт за период: итоги, категории, динамика, долги и вклады на текущий день.
export function reportCsv({ label, currency, totals, catsExp, catsInc, bandsHead, bands, debts, deposits, catName }) {
  const rows = [
    ['Отчёт', label],
    ['Валюта', currency],
    [],
    ['Доходы', n(totals.inc)],
    ['Расходы', n(totals.exp)],
    ['Остаток', n(totals.net)],
    ['Операций', totals.count],
  ];
  const catBlock = (title, list, total) => {
    if (!list.length) return;
    rows.push([], [title], ['Категория', 'Сумма', 'Доля, %', 'Операций']);
    for (const c of list) rows.push([catName(c.cat), n(c.sum), total ? n((c.sum / total) * 100) : '0', c.count]);
  };
  catBlock('Расходы по категориям', catsExp, totals.exp);
  catBlock('Доходы по категориям', catsInc, totals.inc);

  const filled = bands.filter((b) => b.inc || b.exp);
  if (filled.length) {
    rows.push([], [`Динамика (${bandsHead.toLowerCase()})`], [bandsHead, 'Доходы', 'Расходы', 'Остаток']);
    for (const b of filled) rows.push([b.title, n(b.inc), n(b.exp), n(b.inc - b.exp)]);
  }
  if (debts.length) {
    rows.push([], ['Долги (открытые)'], ['Кто', 'Направление', 'Сумма', 'Осталось', 'Дата', 'Вернуть до', 'Подпись']);
    for (const x of debts) {
      rows.push([x.person, x.dir === 'owe' ? 'Я должен' : 'Мне должны', n(x.amount), n(C.debtLeft(x)), d(x.date), d(x.due), x.note || '']);
    }
  }
  if (deposits.length) {
    rows.push([], ['Вклады'], ['Название', 'Ставка, %', 'Открыт', 'Срок, мес.', 'Вложено', 'Проценты', 'Сейчас']);
    for (const x of deposits) {
      const s = C.depositAt(x);
      rows.push([x.name, n(x.rate), d(x.start), x.months || '', n(s.invested), n(s.interest), n(s.value)]);
    }
  }
  return toCsv(rows);
}

// На телефоне открывает системное «Поделиться» (сохранить в Файлы, отправить),
// на компьютере скачивает файл.
export async function saveFile(name, mime, text) {
  const file = new File([text], name, { type: mime });
  const touch = globalThis.matchMedia?.('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
