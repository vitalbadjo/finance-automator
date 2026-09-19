const url = document.getElementById("url");
const token = document.getElementById("token");
const saved = document.getElementById("saved");

const say = (text, ms = 2500) => {
  saved.textContent = text;
  if (ms) setTimeout(() => (saved.textContent = ""), ms);
};

chrome.storage.local.get(["ingestUrl", "ingestToken"]).then((v) => {
  url.value = v.ingestUrl || "";
  token.value = v.ingestToken || "";
});

document.getElementById("save").addEventListener("click", async () => {
  const ingestUrl = url.value.trim();
  const ingestToken = token.value.trim();

  if (!ingestUrl || !ingestToken) return say("заполни оба поля");

  let origin;
  try {
    origin = new URL(ingestUrl).origin + "/*";
  } catch {
    return say("адрес не похож на URL");
  }

  // Разрешение на домен функции запрашивается здесь, по клику: иначе запрос
  // из service worker пойдёт через CORS с preflight и упадёт на шлюзе.
  // Домен у каждого свой (проект Supabase или собственный), поэтому он в
  // optional_host_permissions, а не зашит в манифест.
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    return say("без доступа к домену выгрузка работать не будет", 5000);
  }

  await chrome.storage.local.set({ ingestUrl, ingestToken });
  say("сохранено, доступ выдан");
});
