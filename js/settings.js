// Настройки: валюта, категории, синхронизация через gist, резервные копии.
import { store, sync, cats, cur, VERSION, plural } from './ctx.js';
import { esc, toast, openSheet, closeSheet, sheetHead, confirmSheet, formValues, formError } from './ui.js';
import * as C from './calc.js';
import { I } from './icons.js';
import { live, normalize, restoreStates, canonical } from './store.js';
import { openCatForm } from './catform.js';
import { openExport } from './stats.js';

const CURRENCIES = ['сум', '$'];
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Koshelek';

function syncBox() {
  const { token, gistId, lastSync } = store.local;
  const st = sync.status;
  if (!token) {
    return `<div class="group pad">
      <p class="hint">Данные будут лежать в вашем приватном GitHub Gist. Создайте токен с единственным правом <b>gist</b> и вставьте его сюда. На другом устройстве вставьте тот же токен — записи подтянутся сами.</p>
      <a class="link" href="${TOKEN_URL}" target="_blank" rel="noopener">Создать токен на GitHub ↗</a>
      <form novalidate data-sync-form>
        <label class="field"><span class="field-label">Токен GitHub</span>
          <input class="input secret" name="token" placeholder="ghp_…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <details class="adv">
          <summary>Указать gist вручную</summary>
          <label class="field"><span class="field-label">ID или ссылка на gist <i>— необязательно</i></span>
            <input class="input" name="gist" placeholder="Найдём или создадим сами" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        </details>
        <p class="form-error" hidden></p>
        <button class="btn primary" type="submit">Подключить</button>
      </form>
    </div>`;
  }
  const line = {
    idle: lastSync ? `Синхронизировано · ${C.fmtAgo(lastSync)}` : 'Подключено',
    syncing: 'Синхронизация…',
    offline: 'Нет сети — синхронизируем позже',
    error: st.error || 'Ошибка синхронизации',
  }[st.state] ?? 'Подключено';
  return `<div class="group">
    <div class="cell"><i class="dot is-${st.state}"></i><span class="cell-main"><span class="cell-title">${esc(line)}</span>${gistId ? `<span class="cell-sub">Gist ${esc(gistId.slice(0, 10))}… · токен хранится только на этом устройстве</span>` : ''}</span></div>
    <button type="button" class="cell" data-k="sync-now"><span class="cell-main"><span class="cell-title">Синхронизировать сейчас</span></span></button>
    ${gistId ? `<a class="cell" href="https://gist.github.com/${esc(gistId)}" target="_blank" rel="noopener"><span class="cell-main"><span class="cell-title">Открыть gist на GitHub ↗</span></span></a>` : ''}
    <button type="button" class="cell danger" data-k="sync-off"><span class="cell-main"><span class="cell-title">Отключить на этом устройстве</span></span></button>
  </div>`;
}

export function openSettings() {
  const html = () => {
    const n = live(store.state.cats).length;
    return `${sheetHead('Настройки')}
      <div class="group-title">Валюта</div>
      <div class="chips wrap">${CURRENCIES.map((c) => `<button type="button" class="chip${c === cur() ? ' on' : ''}" data-k="cur" data-v="${c}">${c}</button>`).join('')}</div>

      <div class="group-title">Категории</div>
      <div class="group"><button type="button" class="cell" data-k="cats"><span class="cell-main"><span class="cell-title">Расходы и доходы</span><span class="cell-sub">${n} ${plural(n, 'категория', 'категории', 'категорий')} · добавить, переименовать, удалить</span></span>${I.right}</button></div>

      <div class="group-title">Синхронизация между устройствами</div>
      <div data-sync-box>${syncBox()}</div>

      <div class="group-title">Данные</div>
      <div class="group">
        <button type="button" class="cell" data-k="export"><span class="cell-main"><span class="cell-title">Экспорт</span><span class="cell-sub">CSV для таблиц или полная копия в JSON</span></span>${I.right}</button>
        <label class="cell"><span class="cell-main"><span class="cell-title">Восстановить из копии</span><span class="cell-sub">Файл JSON, сохранённый через экспорт</span></span>${I.right}<input type="file" accept=".json,application/json" data-import hidden></label>
        <button type="button" class="cell danger" data-k="wipe"><span class="cell-main"><span class="cell-title">Удалить все данные</span></span></button>
      </div>
      <p class="about">Кошелёк ${VERSION} · данные хранятся на этом устройстве${store.local.token ? ' и в вашем приватном gist' : ''}.</p>`;
  };

  const sheet = openSheet(html(), { tall: true, onClose: () => { offStore(); offSync(); } });
  let connecting = false; // пока идёт подключение, форму с токеном не перерисовываем
  const frozen = () => connecting || (sheet.inner.contains(document.activeElement) && document.activeElement.matches('input'));
  const paintSync = () => {
    const box = sheet.inner.querySelector('[data-sync-box]');
    if (!box || sheet.closed || frozen()) return;
    if (!store.local.token && box.querySelector('[data-sync-form]')) return; // форма уже показана — не стираем введённое
    box.innerHTML = syncBox();
  };
  const offStore = store.subscribe(() => {
    if (!sheet.closed && !frozen()) sheet.inner.innerHTML = html();
  });
  const offSync = sync.onStatus(paintSync);

  sheet.inner.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-sync-form]')) return;
    e.preventDefault();
    const form = e.target;
    const v = formValues(form);
    const token = v.token.trim();
    if (!token) return formError(form, 'Вставьте токен');
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Подключаем…';
    formError(form, '');
    connecting = true;
    const r = await sync.connect(token, v.gist);
    connecting = false;
    if (sheet.closed) return;
    if (r.ok) {
      document.activeElement?.blur?.();
      sheet.inner.innerHTML = html();
      toast('Синхронизация подключена');
    } else {
      btn.disabled = false;
      btn.textContent = 'Подключить';
      formError(form, r.error);
    }
  });

  sheet.inner.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-import]')) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast('Не получилось прочитать файл: это не JSON');
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.tx)) return toast('Это не копия данных «Кошелька»');
    const incoming = normalize(data);
    if (canonical(restoreStates(store.state, incoming)) === canonical(store.state)) return toast('В файле нет ничего нового');
    const n = live(incoming.tx).length;
    const ok = await confirmSheet({
      title: 'Восстановить из копии?',
      text: `В файле ${n} ${plural(n, 'операция', 'операции', 'операций')}. Записи из копии вернутся, даже если были удалены; текущие записи не пропадут, одинаковые не задвоятся.`,
      ok: 'Восстановить',
      danger: false,
    });
    if (!ok) return;
    store.replace(restoreStates(store.state, incoming), 'import');
    toast('Данные восстановлены');
  });

  sheet.inner.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    const { k, v } = el.dataset;
    if (k === 'cur') {
      store.setSettings({ currency: v });
    } else if (k === 'cats') {
      openCats();
    } else if (k === 'export') {
      openExport();
    } else if (k === 'sync-now') {
      const ok = await sync.syncNow();
      paintSync();
      toast(ok ? 'Синхронизировано' : sync.status.error || 'Нет сети — синхронизируем позже');
    } else if (k === 'sync-off') {
      const ok = await confirmSheet({ title: 'Отключить синхронизацию?', text: 'Данные останутся и на этом устройстве, и в gist. Токен с устройства будет удалён.', ok: 'Отключить' });
      if (!ok) return;
      sync.disconnect();
      if (!sheet.closed) sheet.inner.innerHTML = html();
    } else if (k === 'wipe') {
      const ok = await confirmSheet({
        title: 'Удалить все данные?',
        text: `Операции, долги и вклады будут удалены без возможности вернуть${store.local.token ? ' — в том числе из gist и с других устройств' : ''}. Сначала сохраните копию через «Экспорт».`,
        ok: 'Удалить всё',
      });
      if (!ok) return;
      store.wipe();
      toast('Все данные удалены');
    }
  });
}

function openCats() {
  let type = 'exp';
  const html = () => `${sheetHead('Категории')}
    <div class="seg block">
      <button type="button" class="seg-btn${type === 'exp' ? ' on' : ''}" data-k="type" data-v="exp">Расходы</button>
      <button type="button" class="seg-btn${type === 'inc' ? ' on' : ''}" data-k="type" data-v="inc">Доходы</button>
    </div>
    <div class="group">${cats.of(type).map((c) => `<button type="button" class="cell" data-k="edit" data-id="${esc(c.id)}"><span class="tile sm">${esc(c.emoji)}</span><span class="cell-main"><span class="cell-title">${esc(c.name)}</span></span>${I.right}</button>`).join('')}</div>
    <button type="button" class="btn add-btn" data-k="new">${I.plus}Новая категория</button>`;

  const sheet = openSheet(html(), { tall: true, onClose: () => off() });
  const off = store.subscribe(() => {
    if (!sheet.closed) sheet.inner.innerHTML = html();
  });
  sheet.inner.addEventListener('click', (e) => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    const k = el.dataset.k;
    if (k === 'type') {
      type = el.dataset.v;
      sheet.inner.innerHTML = html();
    } else if (k === 'edit') {
      openCatForm({ id: el.dataset.id });
    } else if (k === 'new') {
      openCatForm({ type });
    }
  });
}
