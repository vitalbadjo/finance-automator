// Supabase Edge Function: приём выгрузок из расширения.
//
// Деплой:
//   supabase secrets set INGEST_TOKEN=<длинная случайная строка>
//   supabase functions deploy ingest --no-verify-jwt
//
// --no-verify-jwt обязателен: расширение не держит пользовательский JWT,
// авторизация идёт по собственному заголовку x-ingest-token.
//
// Зависимостей нет намеренно. Единственное обращение к базе — вызов
// public.spend_ingest через PostgREST обычным fetch: импорт клиентской
// библиотеки — лишняя точка отказа на старте функции, а любая ошибка загрузки
// модуля даёт платформенный 500 без тела, в котором нечего читать.

const INGEST_TOKEN = Deno.env.get("INGEST_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-ingest-token",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    // Отсутствующий секрет — это ошибка настройки, а не отказ в доступе.
    // Раньше она выглядела как 401 и уводила искать не там.
    if (!INGEST_TOKEN) return json({ error: "INGEST_TOKEN не задан в secrets" }, 500);
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "нет SUPABASE_URL или SERVICE_ROLE_KEY в окружении" }, 500);
    }
    if (req.headers.get("x-ingest-token") !== INGEST_TOKEN) {
      return json({ error: "неверный x-ingest-token" }, 401);
    }

    let body: { source?: string; txns?: unknown[] };
    try {
      body = await req.json();
    } catch {
      return json({ error: "тело запроса не разобралось как JSON" }, 400);
    }

    if (!body.source) return json({ error: "не указан source" }, 400);
    const txns = Array.isArray(body.txns) ? body.txns : [];

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/spend_ingest`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_source: body.source, p_txns: txns }),
    });

    const text = await res.text();
    if (!res.ok) {
      // PostgREST кладёт причину в message; отдаём её наружу как есть,
      // иначе на клиенте останется голый код статуса.
      let message = text;
      try {
        message = JSON.parse(text).message ?? text;
      } catch { /* не JSON — отдаём как есть */ }
      return json({ error: `база отказала: ${message}` }, 500);
    }

    return json(JSON.parse(text));
  } catch (e) {
    // Последний рубеж: без него любое необработанное исключение превращается
    // в платформенный 500 с пустым телом.
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
