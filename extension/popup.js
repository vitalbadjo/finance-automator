const go = document.getElementById("go");
const status = document.getElementById("status");

const fmt = (ts) =>
  new Date(ts).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

async function showLast() {
  const { lastRun } = await chrome.storage.local.get("lastRun");
  if (!lastRun) {
    status.textContent = "Ещё ни разу не выгружалось.";
    return;
  }
  if (lastRun.ok) {
    status.className = "ok";
    status.textContent =
      `${fmt(lastRun.at)}\nполучено ${lastRun.fetched}, записано ${lastRun.upserted}`;
  } else {
    status.className = "err";
    status.textContent = `${fmt(lastRun.at)}\n${lastRun.error}`;
  }
}

go.addEventListener("click", async () => {
  go.disabled = true;
  status.className = "";
  status.textContent = "Выгружаю…";
  const res = await chrome.runtime.sendMessage({
    type: "sync",
    source: go.dataset.source,
  });
  go.disabled = false;
  if (res?.ok) {
    status.className = "ok";
    status.textContent = `Готово: получено ${res.fetched}, записано ${res.upserted}`;
  } else {
    status.className = "err";
    status.textContent = res?.error || "неизвестная ошибка";
  }
});

document.getElementById("opts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

showLast();
// Открытие попапа — самый частый момент, когда на бейдж вообще смотрят.
chrome.runtime.sendMessage({ type: "refreshBadge" }).catch(() => {});
