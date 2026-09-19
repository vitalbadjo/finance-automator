import { SOURCES } from "./sources.js";

// ── настройки ────────────────────────────────────────────────────────────
// Токен и URL лежат в chrome.storage.local, а не в коде: код расширения
// читается кем угодно, у кого есть доступ к профилю.

const cfg = () =>
  chrome.storage.local.get(["ingestUrl", "ingestToken", "lastRun"]);

// ── бейдж ────────────────────────────────────────────────────────────────
// Единственная страховка против молчаливого сбоя: видно, сколько дней
// прошло с последней успешной выгрузки.

async function refreshBadge() {
  const { lastRun } = await cfg();
  if (!lastRun?.ok) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#b3261e" });
    return;
  }
  const days = Math.floor((Date.now() - lastRun.at) / 86400000);
  chrome.action.setBadgeText({ text: days === 0 ? "" : String(days) });
  chrome.action.setBadgeBackgroundColor({
    color: days >= 10 ? "#b3261e" : days >= 5 ? "#8a6100" : "#1c6b3c",
  });
}

// Счётчик дней должен тикать сам. Service worker живёт секунды, а браузер
// может не перезапускаться неделями, поэтому onStartup недостаточно:
// без будильника бейдж застывал бы на значении в момент последней выгрузки.
const BADGE_ALARM = "refresh-badge";

function scheduleBadge() {
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 60 });
  return refreshBadge();
}

chrome.runtime.onStartup.addListener(scheduleBadge);
chrome.runtime.onInstalled.addListener(scheduleBadge);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === BADGE_ALARM) refreshBadge();
});

// ── вкладка источника ────────────────────────────────────────────────────

async function withSourceTab(source, fn) {
  const existing = await chrome.tabs.query({ url: source.urlMatch });
  let tab = existing[0];
  let opened = false;

  if (!tab) {
    tab = await chrome.tabs.create({ url: source.openUrl, active: false });
    opened = true;
    await new Promise((resolve) => {
      const onUpdated = (id, info) => {
        if (id === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  }

  try {
    return await fn(tab);
  } finally {
    if (opened) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ── выгрузка ─────────────────────────────────────────────────────────────

export async function sync(sourceCode) {
  const source = SOURCES[sourceCode];
  if (!source) throw new Error(`неизвестный источник: ${sourceCode}`);

  const { ingestUrl, ingestToken } = await cfg();
  if (!ingestUrl || !ingestToken) {
    throw new Error("не заданы адрес и токен — открой настройки расширения");
  }

  // Самопроверка сериализации: Chrome подставляет функцию в страницу как
  // выражение, и сокращённый метод (`async f() {}`) даёт SyntaxError уже на
  // инъекции — результат приходит пустым, а причина нигде не видна.
  const src = source.fetchInPage.toString();
  if (!/^(async\s+)?(function\b|\()/.test(src.trim())) {
    throw new Error(
      `${source.code}: fetchInPage должна быть function-выражением или стрелкой, ` +
        "а не сокращённым методом — иначе инъекция не скомпилируется"
    );
  }

  const raw = await withSourceTab(source, async (tab) => {
    let res;
    try {
      [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: source.fetchInPage,
      });
    } catch (e) {
      throw new Error(`инъекция не выполнилась: ${e.message || e}`);
    }
    if (!res) throw new Error("страница источника не ответила");
    if (res.error) throw new Error(`ошибка на странице: ${res.error.message || res.error}`);
    if (res.result === undefined) {
      throw new Error(
        "страница вернула пустой результат — скорее всего инъекция упала до выполнения; " +
          "смотри консоль вкладки источника"
      );
    }
    return res.result;
  });

  if (!Array.isArray(raw)) {
    throw new Error(`источник вернул ${typeof raw}, а не список`);
  }

  const txns = source.normalize(raw);

  // Без host-разрешения на домен функции запрос из service worker идёт как
  // обычный кросс-origin: браузер шлёт preflight (его вызывает заголовок
  // x-ingest-token), и если шлюз Supabase его не пропускает — fetch падает
  // с невнятным «Failed to fetch», хотя сам POST в Network выглядит живым.
  // С разрешением CORS не применяется вовсе и preflight не отправляется.
  const origin = new URL(ingestUrl).origin + "/*";
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    throw new Error(
      `нет доступа к ${new URL(ingestUrl).host} — открой настройки и нажми «Сохранить», ` +
        "чтобы выдать разрешение"
    );
  }

  let res;
  try {
    res = await fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-token": ingestToken },
      body: JSON.stringify({ source: source.code, txns }),
    });
  } catch (e) {
    throw new Error(
      `функция приёма недоступна (${e.message}). Проверь адрес и что деплой был ` +
        "с --no-verify-jwt: иначе шлюз Supabase отвергает запрос до функции"
    );
  }

  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    throw new Error("функция отклонила токен (401) — сверь INGEST_TOKEN в настройках и в secrets");
  }
  if (!res.ok) throw new Error(body.error || `ingest HTTP ${res.status}`);

  const lastRun = {
    at: Date.now(),
    ok: true,
    source: source.code,
    fetched: body.fetched,
    upserted: body.upserted,
  };
  await chrome.storage.local.set({ lastRun });
  await refreshBadge();
  return lastRun;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "refreshBadge") {
    refreshBadge().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type !== "sync") return false;
  sync(msg.source)
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch(async (e) => {
      const lastRun = {
        at: Date.now(),
        ok: false,
        source: msg.source,
        error: String(e.message || e),
      };
      await chrome.storage.local.set({ lastRun });
      await refreshBadge();
      sendResponse({ ok: false, error: lastRun.error });
    });
  return true; // ответ придёт асинхронно
});
