// Создание и правка категории.
import { store, cats } from './ctx.js';
import { esc, openSheet, closeSheet, sheetHead, formValues, formError, confirmSheet } from './ui.js';
import { uid } from './store.js';

const EMOJI = ['🍔', '🍕', '🍺', '🍷', '🧋', '🥐', '🚇', '⛽', '🚗', '✈️', '🏋️', '🎬', '🎵', '📚', '🎓', '🐶', '💇', '🧴', '🧾', '💡', '🛠️', '💳', '🏦', '👶', '🎟️', '🏥', '🪙', '🌿', '❤️', '💰'];

// Первый видимый символ строки (эмодзи бывают составными).
function firstGlyph(s) {
  const text = String(s ?? '').trim();
  if (!text) return '';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    for (const part of new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(text)) return part.segment;
  }
  return [...text][0];
}

// Возвращает сохранённую категорию или null, если форму закрыли.
export function openCatForm({ id = null, type = 'exp' } = {}) {
  return new Promise((resolve) => {
    const orig = id ? store.state.cats.find((c) => c.id === id) : null;
    const kind = orig?.type ?? type;
    const sheet = openSheet(
      `${sheetHead(orig ? 'Категория' : kind === 'exp' ? 'Новая категория расходов' : 'Новая категория доходов')}
      <form novalidate>
        <div class="cat-form">
          <input class="input emoji-input" name="emoji" value="${esc(orig?.emoji ?? (kind === 'exp' ? '🛍️' : '💰'))}" maxlength="12" aria-label="Значок" autocomplete="off">
          <input class="input" name="name" placeholder="Название" maxlength="24" value="${esc(orig?.name ?? '')}" autocomplete="off" autocapitalize="sentences" enterkeyhint="done">
        </div>
        <div class="emoji-grid">${EMOJI.map((e) => `<button type="button" class="emoji" data-emoji="${e}">${e}</button>`).join('')}</div>
        <p class="form-error" hidden></p>
        <button class="btn primary" type="submit">Сохранить</button>
        ${orig ? '<button type="button" class="btn danger" data-del>Удалить категорию</button>' : ''}
      </form>`,
      { onClose: (r) => resolve(r ?? null) },
    );
    const form = sheet.inner.querySelector('form');

    form.addEventListener('click', async (e) => {
      const pick = e.target.closest('[data-emoji]');
      if (pick) {
        form.elements.emoji.value = pick.dataset.emoji;
        return;
      }
      if (e.target.closest('[data-del]')) {
        const ok = await confirmSheet({ title: `Удалить «${orig.name}»?`, text: 'Записи с этой категорией останутся в истории и статистике.' });
        if (!ok) return;
        store.put('cats', { ...orig, del: 1 });
        closeSheet(sheet, null);
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(form);
      const name = v.name.trim();
      if (!name) return formError(form, 'Введите название');
      const emoji = firstGlyph(v.emoji) || '🏷️';
      const order = orig?.order ?? Math.max(-1, ...cats.of(kind).map((c) => c.order)) + 1;
      const saved = store.put('cats', { id: orig?.id ?? uid(), type: kind, name, emoji, order });
      closeSheet(sheet, saved);
    });
  });
}
