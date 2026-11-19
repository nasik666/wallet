// Создание и правка категории: свой значок с клавиатуры iPhone или готовый из набора.
import { store, cats } from './ctx.js';
import { esc, openSheet, closeSheet, sheetHead, formValues, formError, confirmSheet } from './ui.js';
import { lastGlyph, isEmoji } from './calc.js';
import { uid } from './store.js';

const EMOJI = ['🍔', '🍕', '🍺', '🍷', '🧋', '🥐', '🚇', '⛽', '🚗', '✈️', '🏋️', '🎬', '🎵', '📚', '🎓', '🐶', '💇', '🧴', '🧾', '💡', '🛠️', '💳', '🏦', '👶', '🎟️', '🏥', '🪙', '🌿', '❤️', '💰'];

// Возвращает сохранённую категорию или null, если форму закрыли.
export function openCatForm({ id = null, type = 'exp' } = {}) {
  return new Promise((resolve) => {
    const orig = id ? store.state.cats.find((c) => c.id === id) : null;
    const kind = orig?.type ?? type;
    let chosen = orig?.emoji ?? (kind === 'exp' ? '🛍️' : '💰');
    const own = orig && !EMOJI.includes(chosen) ? chosen : '';

    const sheet = openSheet(
      `${sheetHead(orig ? 'Категория' : kind === 'exp' ? 'Новая категория расходов' : 'Новая категория доходов')}
      <form novalidate>
        <div class="cat-form">
          <button type="button" class="emoji-preview" data-own aria-label="Выбрать свой значок"></button>
          <input class="input" name="name" placeholder="Название" maxlength="24" value="${esc(orig?.name ?? '')}" autocomplete="off" autocapitalize="sentences" enterkeyhint="done">
        </div>
        <label class="emoji-own">
          <span class="emoji-own-ico" aria-hidden="true">😀</span>
          <input class="input" name="own" value="${esc(own)}" placeholder="Свой значок — нажмите и выберите" aria-label="Свой значок" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">
        </label>
        <p class="hint small">Подойдёт любой эмодзи iPhone: на клавиатуре нажмите 😀 или 🌐, найдите нужный через поиск. Или выберите из готовых:</p>
        <div class="emoji-grid">${EMOJI.map((e) => `<button type="button" class="emoji" data-emoji="${e}" aria-label="Значок ${e}">${e}</button>`).join('')}</div>
        <p class="form-error" hidden></p>
        <button class="btn primary" type="submit">Сохранить</button>
        ${orig ? '<button type="button" class="btn danger" data-del>Удалить категорию</button>' : ''}
      </form>`,
      { onClose: (r) => resolve(r ?? null) },
    );
    const form = sheet.inner.querySelector('form');
    const preview = form.querySelector('.emoji-preview');
    const ownInput = form.elements.own;

    const paint = () => {
      preview.textContent = chosen;
      for (const b of form.querySelectorAll('[data-emoji]')) b.classList.toggle('on', b.dataset.emoji === chosen);
    };
    paint();

    // Новый эмодзи с клавиатуры заменяет прежний: в поле всегда остаётся один значок.
    ownInput.addEventListener('input', () => {
      const g = lastGlyph(ownInput.value);
      if (!g) return;
      if (ownInput.value !== g) ownInput.value = g;
      chosen = g;
      paint();
      if (isEmoji(g)) ownInput.blur(); // эмодзи выбран — прячем клавиатуру, значок виден сверху
    });
    ownInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ownInput.blur();
      }
    });

    form.addEventListener('click', async (e) => {
      if (e.target.closest('[data-own]')) {
        ownInput.focus();
        return;
      }
      const pick = e.target.closest('[data-emoji]');
      if (pick) {
        chosen = pick.dataset.emoji;
        ownInput.value = '';
        paint();
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
      const name = formValues(form).name.trim();
      if (!name) return formError(form, 'Введите название');
      const order = orig?.order ?? Math.max(-1, ...cats.of(kind).map((c) => c.order)) + 1;
      const saved = store.put('cats', { id: orig?.id ?? uid(), type: kind, name, emoji: chosen || '🏷️', order });
      closeSheet(sheet, saved);
    });
  });
}
