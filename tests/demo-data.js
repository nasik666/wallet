// Пример данных для ручной проверки интерфейса. Приложение этот файл не использует.
// В консоли браузера на странице приложения:
//   const { demoState } = await import('./tests/demo-data.js');
//   localStorage.setItem('wallet:data:v1', JSON.stringify(demoState())); location.reload();
// Внимание: это заменит текущие данные на устройстве.

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const NOTES = {
  coffee: ['Surf Coffee', 'капучино с Сашей', 'флэт уайт у офиса', '', ''],
  lunch: ['бизнес-ланч', 'столовая', 'поке', '', 'с командой'],
  dinner: ['паста дома', 'суши на двоих', 'бургерная', ''],
  snacks: ['чипсы и кола', 'орешки', 'шоколадка', ''],
  groceries: ['ВкусВилл', 'Перекрёсток на неделю', 'рынок', 'Самокат'],
  transport: ['такси домой', 'метро', 'каршеринг', 'пополнил Тройку'],
  fun: ['кино', 'Steam', 'боулинг', 'концерт'],
};

export function demoState(today = new Date()) {
  let seed = 42;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const ago = (days) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
    return ymd(d);
  };

  const tx = [];
  const add = (type, cat, amount, date, note = '') => tx.push({ id: `demo-${tx.length + 1}`, type, cat, amount, date, note, ts: tx.length + 1, u: 1 });

  for (let back = 88; back >= 0; back--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const date = ymd(d);
    const dow = d.getDay();
    const dom = d.getDate();
    if (rnd() < 0.72) add('exp', 'coffee', pick([220, 250, 280, 320, 350]), date, pick(NOTES.coffee));
    if (dow >= 1 && dow <= 5 && rnd() < 0.85) add('exp', 'lunch', 380 + Math.round(rnd() * 34) * 10, date, pick(NOTES.lunch));
    if (rnd() < 0.3) add('exp', 'dinner', 600 + Math.round(rnd() * 180) * 10, date, pick(NOTES.dinner));
    if (rnd() < 0.35) add('exp', 'snacks', 90 + Math.round(rnd() * 30) * 10, date, pick(NOTES.snacks));
    if (rnd() < 0.28) add('exp', 'groceries', 900 + Math.round(rnd() * 260) * 10, date, pick(NOTES.groceries));
    if (rnd() < 0.4) add('exp', 'transport', pick([64, 64, 280, 350, 420, 510, 1000]), date, pick(NOTES.transport));
    if ((dow === 6 || dow === 0) && rnd() < 0.45) add('exp', 'fun', 500 + Math.round(rnd() * 250) * 10, date, pick(NOTES.fun));
    if (dom === 3) add('exp', 'subs', 399, date, 'Яндекс Плюс');
    if (dom === 12) add('exp', 'subs', 149, date, 'iCloud 200 ГБ');
    if (dom === 1) add('exp', 'home', 42000, date, 'аренда квартиры');
    if (dom === 10) add('inc', 'salary', 95000, date, 'зарплата');
    if (dom === 25) add('inc', 'salary', 62000, date, 'аванс');
  }
  add('exp', 'tech', 12990, ago(11), 'наушники');
  add('exp', 'tech', 54990, ago(63), 'монитор 27"');
  add('exp', 'clothes', 8990, ago(29), 'кроссовки');
  add('exp', 'health', 3200, ago(40), 'стоматолог, чистка');
  add('exp', 'gifts', 4500, ago(8), 'маме на день рождения');
  add('inc', 'gift', 5000, ago(14), 'от бабушки');
  add('inc', 'side', 18000, ago(26), 'лендинг для знакомого');
  add('inc', 'refund', 1290, ago(5), 'возврат за доставку');

  return {
    v: 1,
    tx,
    debts: [
      { id: 'demo-b1', u: 1, dir: 'owe', person: 'Саша Петров', amount: 15000, note: 'на билеты в Сочи', date: ago(19), due: ago(-15), pays: [{ id: 'p1', amount: 5000, date: ago(6) }] },
      { id: 'demo-b2', u: 1, dir: 'owe', person: 'Мама', amount: 30000, note: 'на ноутбук', date: ago(75), due: ago(6), pays: [] },
      { id: 'demo-b3', u: 1, dir: 'lent', person: 'Дима', amount: 3500, note: 'за ужин и такси', date: ago(7), due: '', pays: [] },
      { id: 'demo-b4', u: 1, dir: 'lent', person: 'Аня Ким', amount: 12000, note: 'до зарплаты', date: ago(17), due: ago(-9), pays: [{ id: 'p2', amount: 4000, date: ago(4) }] },
      { id: 'demo-b5', u: 1, dir: 'lent', person: 'Коля', amount: 2000, note: 'пицца', date: ago(57), due: '', pays: [{ id: 'p3', amount: 2000, date: ago(50) }] },
    ],
    deposits: [
      { id: 'demo-v1', u: 1, name: 'Т-Банк, вклад', rate: 16, start: ago(157), months: 12, cap: 'month', ops: [{ id: 'o1', date: ago(157), amount: 300000, open: 1 }], closedOn: '' },
      { id: 'demo-v2', u: 1, name: 'Накопительный счёт', rate: 14.5, start: ago(260), months: 0, cap: 'month', ops: [{ id: 'o2', date: ago(260), amount: 80000, open: 1 }, { id: 'o3', date: ago(98), amount: 40000 }, { id: 'o4', date: ago(32), amount: -15000 }], closedOn: '' },
    ],
    cats: [],
    settings: { currency: '₽', u: 1 },
  };
}
