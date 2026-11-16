// Синхронизация между устройствами через приватный GitHub Gist.
// Каждый проход: скачать gist → слить с локальными данными → записать обратно, если есть отличия.
import { mergeStates, normalize, canonical } from './store.js';

const API = 'https://api.github.com';
export const GIST_FILE = 'wallet-data.json';
const GIST_DESC = 'Кошелёк — данные приложения (не удалять)';

// Принимает id или ссылку вида https://gist.github.com/user/<id>.
export function parseGistId(input) {
  const m = String(input ?? '').trim().match(/([0-9a-f]{20,40})\/?$/i);
  return m ? m[1].toLowerCase() : '';
}

function explain(e) {
  if (e.status === 0) return 'Нет связи с GitHub';
  if (e.status === 401) return 'Токен не подходит — проверьте его или создайте новый';
  if (e.status === 403) return 'GitHub отклонил запрос: у токена нет доступа к gist или превышен лимит';
  if (e.status === 404) return 'Gist не найден — проверьте его ID';
  if (e.status === 422) return 'GitHub не принял данные';
  return `Ошибка GitHub (${e.status ?? '?'})`;
}

export function createSync(store, env = {}) {
  const doFetch = env.fetch ?? ((...a) => globalThis.fetch(...a));
  const isOnline = env.online ?? (() => globalThis.navigator?.onLine !== false);

  const status = { state: store.local.token ? 'idle' : 'off', error: '' };
  const subs = new Set();
  let timer = null;
  let running = null;
  let again = false;

  function set(state, error = '') {
    status.state = state;
    status.error = error;
    for (const fn of [...subs]) fn(status);
  }

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await doFetch(API + path, {
        method,
        cache: 'no-store', // без кэша: иначе можно слить устаревшую копию
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${store.local.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error('network'), { status: 0 });
    }
    if (!res.ok) throw Object.assign(new Error(`http ${res.status}`), { status: res.status });
    return res.json();
  }

  // Ищет среди gist пользователя тот, где лежит наш файл; если их несколько — самый старый.
  async function findGist() {
    let best = null;
    for (let page = 1; page <= 10; page++) {
      const list = await api(`/gists?per_page=100&page=${page}`);
      for (const g of list) {
        if (g.files?.[GIST_FILE] && (!best || g.created_at < best.created_at)) best = g;
      }
      if (list.length < 100) break;
    }
    return best?.id ?? '';
  }

  async function readGist(id) {
    const g = await api(`/gists/${id}`);
    const f = g.files?.[GIST_FILE];
    if (!f) return null;
    let text = f.content;
    if (f.truncated && f.raw_url) {
      let r;
      try { r = await doFetch(f.raw_url, { cache: 'no-store' }); } catch { throw Object.assign(new Error('network'), { status: 0 }); }
      if (!r.ok) throw Object.assign(new Error(`http ${r.status}`), { status: r.status });
      text = await r.text();
    }
    try { return JSON.parse(text); } catch { return null; }
  }

  async function run() {
    const token = store.local.token;
    if (!token) { set('off'); return false; }
    if (!isOnline()) { set('offline'); return false; }
    set('syncing');
    // Если за время запроса синхронизацию отключили или сменили токен, результат не применяем.
    const stale = () => store.local.token !== token;
    try {
      let id = store.local.gistId;
      let remote = null;
      if (id) {
        try {
          remote = await readGist(id);
        } catch (e) {
          if (e.status !== 404 || store.local.gistManual) throw e;
          id = ''; // gist удалили — найдём другой или создадим новый
        }
      }
      if (!id) {
        id = await findGist();
        if (id) remote = await readGist(id);
      }

      if (stale()) return false;

      // Слияние — синхронно, без await: так не теряются правки, сделанные во время запроса.
      const theirs = remote ? normalize(remote) : null;
      const mine = store.state;
      const merged = theirs ? mergeStates(mine, theirs) : mine;
      const text = canonical(merged);
      if (text !== canonical(mine)) store.replace(merged, 'sync');

      if (!id) {
        const created = await api('/gists', {
          method: 'POST',
          body: { description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: text } } },
        });
        id = created.id;
      } else if (!theirs || text !== canonical(theirs)) {
        await api(`/gists/${id}`, { method: 'PATCH', body: { files: { [GIST_FILE]: { content: text } } } });
      }

      if (stale()) return false;
      store.saveLocal({ gistId: id, lastSync: Date.now() });
      set('idle');
      return true;
    } catch (e) {
      if (!stale()) set('error', explain(e));
      return false;
    }
  }

  function syncNow() {
    clearTimeout(timer);
    timer = null;
    if (running) {
      again = true;
      return running;
    }
    running = run().finally(() => {
      running = null;
      if (again) {
        again = false;
        schedule(300);
      }
    });
    return running;
  }

  function schedule(ms = 1000) {
    if (!store.local.token) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, ms);
  }

  return {
    status,
    syncNow,
    schedule,

    // Выполняет отложенную синхронизацию сразу (когда приложение сворачивают).
    flush() {
      if (timer) syncNow();
    },

    onStatus(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    async connect(token, gistInput = '') {
      const gistId = parseGistId(gistInput);
      store.saveLocal({ token: token.trim(), gistId, gistManual: Boolean(gistId), lastSync: 0 });
      const ok = await syncNow();
      if (ok) return { ok: true };
      const error = status.error || 'Не удалось подключиться';
      this.disconnect();
      return { ok: false, error };
    },

    disconnect() {
      clearTimeout(timer);
      timer = null;
      store.saveLocal({ token: '', gistId: '', gistManual: false, lastSync: 0 });
      set('off');
    },
  };
}
