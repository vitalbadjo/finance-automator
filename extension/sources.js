// Реестр источников.
//
// Добавить банк = дописать сюда один объект. Всё остальное — приём, upsert,
// кнопка, бейдж — работает без изменений, потому что normalize() у всех
// источников возвращает один и тот же конверт.
//
// Конверт (совпадает с колонками spend.raw_txn):
//   external_id, txn_at (ISO), merchant_raw, merchant_name, mcc, mcc_desc,
//   amount (>= 0), currency, local_amount, local_currency,
//   foreign_fee, withdrawal_fee, fx_pad, fx_pad_rate, markup_rate,
//   txn_type, message_type, display_status, card_last4, payload
//
// ВАЖНО про fetchInPage: функция сериализуется и выполняется в контексте
// страницы источника через chrome.scripting.executeScript. Она не видит
// внешние переменные и импорты — всё внутри. Именно поэтому запрос идёт
// из страницы, а не из service worker: у воркера origin chrome-extension://,
// и сессионная кука с SameSite в его запрос не уедет.
//
// И ещё: fetchInPage обязана быть `fetchInPage: async function () {}`, а не
// сокращённым методом `async fetchInPage() {}`. Chrome сериализует её через
// toString() и подставляет как выражение: `(async fetchInPage() {...})()` —
// это SyntaxError, инъекция молча падает и результат приходит пустым.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const SOURCES = {
  bybit_card: {
    code: "bybit_card",
    title: "Bybit Card",
    urlMatch: "https://www.bybit.com/*",
    openUrl: "https://www.bybit.com/en/cards/dashboard/transactions",

    fetchInPage: async function () {
      const ENDPOINT =
        "/x-api/fiat/card/transaction/api/queryUserAssetRecordsV3";
      const LIMIT = 100; // 200 сервер молча ломает, отдаёт 10

      const page = async (p) => {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", platform: "pc" },
          body: JSON.stringify({ page: p, limit: LIMIT }),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("AUTH: сессия Bybit истекла, залогинься заново");
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (j.ret_code !== 0 && j.retCode !== 0) {
          throw new Error(j.ret_msg || j.retMsg || "неизвестная ошибка API");
        }
        return j.result;
      };

      const first = await page(1);
      const out = [...first.data];
      const total = first.total ?? out.length;
      for (let p = 2; (p - 1) * LIMIT < total; p++) {
        const r = await page(p);
        if (!r.data?.length) break;
        out.push(...r.data);
      }
      return out;
    },

    normalize: function (records) {
      return records.map((t) => ({
        external_id: String(t.txnId || t.recordId),
        txn_at: new Date(Number(t.txnTime)).toISOString(),
        merchant_raw: t.merchName ?? null,
        merchant_name: t.enrichment?.merchantName ?? t.merchName ?? null,
        mcc: t.mccCode ? String(t.mccCode) : null,
        mcc_desc: t.merchIsoDesc ?? t.merchMccCategoryName ?? null,
        amount: num(t.totalTransactionAmount),
        currency: t.basicCurrency || "USD",
        local_amount: t.localAmount != null ? num(t.localAmount) : null,
        local_currency: t.localCurrency ?? null,
        foreign_fee: num(t.foreignTransactionFee),
        withdrawal_fee: num(t.withdrawalFee),
        fx_pad: num(t.fxPad),
        fx_pad_rate: num(t.fxPadRate),
        markup_rate: num(t.markUpRate),
        txn_type: t.txnType ?? null,          // deduct | freeze | unfreeze
        message_type: String(t.messageType ?? ""),
        display_status: String(t.displayStatus ?? ""),
        card_last4: t.pan4 ?? null,
        payload: t,
      }));
    },
  },
};
