// Столбчатые графики на SVG: одна или две серии, подсказка по нажатию, табличный вид.
import { esc } from './ui.js';

const f = (x) => Math.round(x * 100) / 100;

// «Круглая» шкала: 0, шаг, 2·шаг… до значения не меньше максимума.
export function niceScale(max, target = 3) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const k = raw / mag;
  const step = (k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let i = 0; i * step <= top + step / 2; i++) ticks.push(f(i * step));
  return { max: top, ticks };
}

function layout(spec) {
  const W = spec.width;
  const H = spec.height ?? 190;
  const top = 20; // место для подписи над самым высоким столбцом
  const bottom = 22; // полоса подписей оси X
  const gutter = 46; // подписи шкалы справа
  const plotW = W - gutter;
  const plotH = H - top - bottom;
  const y0 = top + plotH;
  const k = spec.series.length;
  const n = spec.bands.length;
  const max = Math.max(0, ...spec.bands.flatMap((b) => b.values));
  const scale = niceScale(max);
  const band = plotW / n;
  const inner = 2; // зазор между соседними столбцами
  // Столбец не шире 24px и не заполняет ячейку целиком: остаток ячейки — воздух.
  const bw = k === 1
    ? Math.max(1.5, Math.min(24, Math.max(band * 0.62, Math.min(band - inner, 9))))
    : Math.max(1.5, Math.min(14, (band - Math.max(4, band * 0.3) - inner * (k - 1)) / k));
  const group = bw * k + inner * (k - 1);
  const y = (v) => y0 - (v / scale.max) * plotH;
  return { W, H, top, plotW, y0, k, n, max, scale, band, inner, bw, group, y };
}

// Скруглён только верх: столбец «стоит» на базовой линии.
function barPath(x, y, w, y0) {
  const r = Math.min(4, w / 2, y0 - y);
  return `M${f(x)} ${f(y0)}V${f(y + r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}H${f(x + w - r)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}V${f(y0)}Z`;
}

/* spec: { id, width, height?, series: [{ name, slot }], bands: [{ label, title, values }],
           fmt(v), tick(v, axisMax), direct?, keepLabels?, aria, extra?(band) } */
export function columnsChart(spec) {
  const L = layout(spec);
  const p = [];

  for (const t of L.scale.ticks) {
    const y = f(L.y(t));
    if (t > 0) p.push(`<line class="grid" x1="0" x2="${f(L.plotW)}" y1="${y}" y2="${y}"/>`);
    p.push(`<text x="${L.W}" y="${f(y + 3.6)}" text-anchor="end">${esc(spec.tick(t, L.scale.max))}</text>`);
  }

  spec.bands.forEach((b, i) => {
    const x0 = L.band * (i + 0.5) - L.group / 2;
    b.values.forEach((v, s) => {
      if (!(v > 0)) return;
      const y = Math.min(L.y(v), L.y0 - 1.5); // даже крошечное значение остаётся видимым
      p.push(`<path class="bar s${spec.series[s].slot}" data-i="${i}" d="${barPath(x0 + s * (L.bw + L.inner), y, L.bw, L.y0)}"/>`);
    });
  });

  p.push(`<line class="axis" x1="0" x2="${f(L.plotW)}" y1="${L.y0}" y2="${L.y0}"/>`);

  const labelW = Math.max(...spec.bands.map((b) => String(b.label ?? '').length)) * 6 + 6;
  const stride = spec.keepLabels ? 1 : Math.max(1, Math.ceil(labelW / L.band));
  spec.bands.forEach((b, i) => {
    if (!b.label || i % stride) return;
    p.push(`<text x="${f(L.band * (i + 0.5))}" y="${L.H - 6}" text-anchor="middle">${esc(b.label)}</text>`);
  });

  // Подписываем только максимум — остальные значения дают шкала, подсказка и таблица.
  if (spec.direct && L.k === 1 && L.max > 0) {
    const i = spec.bands.findIndex((b) => b.values[0] === L.max);
    const txt = spec.tick(L.max, L.scale.max);
    const half = txt.length * 3.3 + 2;
    const cx = Math.min(L.plotW - half, Math.max(half, L.band * (i + 0.5)));
    p.push(`<text class="dl" x="${f(cx)}" y="${f(L.y(L.max) - 6)}" text-anchor="middle">${esc(txt)}</text>`);
  }

  return `<div class="chart" id="${esc(spec.id)}" tabindex="0" role="group" aria-label="${esc(spec.aria ?? '')}">
    <svg viewBox="0 0 ${L.W} ${L.H}" width="${L.W}" height="${L.H}">${p.join('')}</svg>
    <div class="tip" role="status" hidden></div>
  </div>`;
}

export function legend(series) {
  return `<div class="legend">${series.map((s) => `<span><i class="s${s.slot}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

// Табличный двойник графика: те же значения без наведения.
export function chartTable(spec, head) {
  const rows = spec.bands.filter((b) => b.values.some((v) => v > 0));
  if (!rows.length) return '<p class="hint">За этот период записей нет</p>';
  const sums = spec.series.map((_, i) => rows.reduce((s, b) => s + b.values[i], 0));
  return `<table class="tbl">
    <thead><tr><th>${esc(head)}</th>${spec.series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((b) => `<tr><td>${esc(b.title)}</td>${b.values.map((v) => `<td>${esc(spec.fmt(v))}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><td>Итого</td>${sums.map((v) => `<td>${esc(spec.fmt(v))}</td>`).join('')}</tr></tfoot>
  </table>`;
}

/* ───────── Подсказка по нажатию, наведению и с клавиатуры ───────── */

let current = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    if (current && !current.root.contains(e.target)) current.hide();
  }, true);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // подписи — пользовательские данные, только textContent
  return n;
}

function tipNodes(spec, band) {
  if (spec.series.length === 1) return [el('div', 'tip-val', spec.fmt(band.values[0])), el('div', 'tip-lbl', band.title)];
  const nodes = [el('div', 'tip-lbl', band.title)];
  const row = (cls, value, name) => {
    const r = el('div', 'tip-row');
    r.append(el('i', cls), el('b', '', value), el('span', '', name));
    nodes.push(r);
  };
  spec.series.forEach((s, i) => row(`tip-key s${s.slot}`, spec.fmt(band.values[i]), s.name));
  for (const [name, value] of spec.extra?.(band) ?? []) row('tip-key', value, name);
  return nodes;
}

export function bindChart(root, spec) {
  const L = layout(spec);
  const svg = root.querySelector('svg');
  const tip = root.querySelector('.tip');
  const bars = [...root.querySelectorAll('.bar')];
  let active = -1;

  function show(i) {
    if (i === active) return;
    active = i;
    for (const b of bars) b.classList.toggle('on', Number(b.dataset.i) === i);
    root.classList.toggle('active', i >= 0);
    if (i < 0) {
      tip.hidden = true;
      if (current?.root === root) current = null;
      return;
    }
    if (current && current.root !== root) current.hide();
    current = { root, hide: () => show(-1) };
    tip.replaceChildren(...tipNodes(spec, spec.bands[i]));
    tip.hidden = false;
    // Подсказка встаёт сбоку от столбца и не закрывает его.
    const k = svg.getBoundingClientRect().width / L.W;
    const cx = L.band * (i + 0.5) * k;
    const side = (L.group / 2 + 8) * k;
    const w = tip.offsetWidth;
    const room = root.clientWidth;
    let left = cx + side;
    if (left + w > room) left = cx - side - w;
    if (left < 0) left = Math.max(0, Math.min(room - w, cx - w / 2));
    tip.style.transform = `translateX(${Math.round(left)}px)`;
  }

  const indexAt = (clientX) => {
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * L.W;
    return x < 0 || x > L.plotW ? -1 : Math.min(L.n - 1, Math.floor(x / L.band));
  };

  root.addEventListener('pointerdown', (e) => {
    const i = indexAt(e.clientX);
    show(e.pointerType !== 'mouse' && i === active ? -1 : i); // повторное касание скрывает
  });
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.pressure > 0) show(indexAt(e.clientX));
  });
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') show(-1);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return show(-1);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    show(active < 0 ? (step > 0 ? 0 : L.n - 1) : Math.max(0, Math.min(L.n - 1, active + step)));
  });
  root.addEventListener('blur', () => show(-1));
}
