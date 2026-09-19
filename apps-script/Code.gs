/**
 * LFS-2026 · «Мониторинг» ← Supabase
 *
 * Тянет суммы по кодам из базы и раскладывает в месячный блок листа.
 * Таблица здесь — витрина: источник правды в Postgres, лист можно в любой
 * момент перезалить заново.
 *
 * Настройка: Расширения → Apps Script → Настройки проекта → Свойства скрипта
 *   SUPABASE_URL  https://<ref>.supabase.co
 *   SERVICE_KEY   service_role ключ
 * Ключ живёт в свойствах, а не в коде: код уезжает в git, свойства — нет.
 */

const SHEET_NAME = 'Мониторинг';

// Блоки месяцев лежат горизонтально: 6 колонок данных + 1 пустая-разделитель.
const COLS_PER_MONTH = 7;

// Внутри блока: 0 дата · 1 код · 2 сумма · 3 валюта · 4 курс · 5 итог.
// Скрипт пишет дату, код и сумму — для сентября это BE, BF, BG.
// Валюта и курс в листе уже проставлены, «итог» — формула листа; их скрипт
// трогает только если строка ниже того места, докуда их дотянули (см.
// ensureScaffold_) — иначе сумма в такой строке не попала бы в «Деньги».
const COL_DATE = 0, COL_CODE = 1, COL_SUM = 2, COL_CUR = 3, COL_RATE = 4, COL_TOTAL = 5;

// 'day' — строка на каждую пару (день, код); 'month' — одна строка на код.
const GRANULARITY = 'day';

// Лист рассчитан на один год: двенадцать блоков, года в них нет. Без этой
// проверки запуск в 2027-м молча положил бы новые данные поверх старых.
const SHEET_YEAR = 2026;

// Раньше сентября 2026 данных на карте нет, а блоки июля и августа заполнены
// вручную по рублёвым тратам. Перезапись их уничтожила бы историю.
const FIRST_MANAGED = { year: 2026, month: 9 };

// Сколько строк ниже своих чистить на первом прогоне, когда счётчик ещё пуст.
const FIRST_RUN_CLEAR = 40;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Расходы')
    .addItem('Обновить текущий месяц', 'syncCurrentMonth')
    .addItem('Обновить текущий месяц (пробный прогон)', 'dryRunCurrentMonth')
    .addSeparator()
    .addItem('Обновить другой месяц…', 'syncPickedMonth')
    .addToUi();
}

function syncCurrentMonth() { const d = new Date(); syncMonth(d.getFullYear(), d.getMonth() + 1, false); }
function dryRunCurrentMonth() { const d = new Date(); syncMonth(d.getFullYear(), d.getMonth() + 1, true); }

/** Спрашивает номер месяца, сначала показывает пробный прогон, потом пишет. */
function syncPickedMonth() {
  const ui = SpreadsheetApp.getUi();
  const ans = ui.prompt('Какой месяц обновить?', 'Номер месяца, 1–12', ui.ButtonSet.OK_CANCEL);
  if (ans.getSelectedButton() !== ui.Button.OK) return;
  const m = Number(String(ans.getResponseText()).trim());
  if (!(m >= 1 && m <= 12)) { ui.alert('Нужен номер от 1 до 12'); return; }

  syncMonth(SHEET_YEAR, m, true);
  const go = ui.alert('Записать в лист?',
    'Выше показано, что уедет в блок ' + m + '.' + SHEET_YEAR + '.', ui.ButtonSet.YES_NO);
  if (go === ui.Button.YES) syncMonth(SHEET_YEAR, m, false);
}

/**
 * @param {number} year
 * @param {number} month 1–12
 * @param {boolean} dryRun только показать, что будет записано
 */
function syncMonth(year, month, dryRun) {
  if (year !== SHEET_YEAR) {
    throw new Error(
      'Этот лист на ' + SHEET_YEAR + ' год, а запрошен ' + year +
      '. Для нового года нужна своя таблица и своё значение SHEET_YEAR.'
    );
  }
  if (year < FIRST_MANAGED.year ||
      (year === FIRST_MANAGED.year && month < FIRST_MANAGED.month)) {
    throw new Error(
      'Блоки до ' + FIRST_MANAGED.month + '.' + FIRST_MANAGED.year +
      ' заполнены вручную, скрипт их не трогает'
    );
  }

  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SERVICE_KEY');
  if (!url || !key) throw new Error('Не заданы SUPABASE_URL и SERVICE_KEY в свойствах скрипта');

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const daily = fetchRows_(url, key, iso_(from), iso_(to));
  const rows = GRANULARITY === 'month' ? rollUp_(daily) : daily;

  if (dryRun) {
    const total = rows.reduce(function (s, r) { return s + Number(r.amount); }, 0);
    SpreadsheetApp.getUi().alert(
      'Пробный прогон ' + month + '.' + year + '\n\n' +
      'Строк: ' + rows.length + '\nСумма: ' + total.toFixed(2) + ' USD\n\n' +
      rows.map(function (r) {
        return (r.txn_date ? r.txn_date + '  ' : '') + r.code + '  ' + r.amount;
      }).join('\n')
    );
    return;
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Не найден лист «' + SHEET_NAME + '»');

  backupOnce_(sheet);

  // Строку заголовков ищем, а не хардкодим: вставят строку сверху —
  // хардкод молча начнёт писать не туда, поиск переживёт.
  const headerRow = findHeaderRow_(sheet);
  const firstRow = headerRow + 1;
  const startCol = 1 + COLS_PER_MONTH * (month - 1);

  const prevKey = 'rows_' + year + '_' + month;
  const prev = Number(props.getProperty(prevKey) || FIRST_RUN_CLEAR);

  if (rows.length > 0) {
    // Дата, код и сумма лежат подряд — пишем одним setValues.
    sheet.getRange(firstRow, startCol + COL_DATE, rows.length, 3).setValues(
      rows.map(function (r) {
        return [r.txn_date ? parseDate_(r.txn_date) : '', r.code, Number(r.amount)];
      })
    );
    ensureScaffold_(sheet, firstRow, startCol, rows.length);
  }

  // Хвост от прошлого прогона — те же три колонки. Валюту, курс и «итог»
  // оставляем: они есть и в незаполненных строках листа, а «итог» без суммы
  // сам станет нулём.
  const tail = prev - rows.length;
  if (tail > 0) {
    sheet.getRange(firstRow + rows.length, startCol + COL_DATE, tail, 3).clearContent();
  }

  props.setProperty(prevKey, String(rows.length));

  SpreadsheetApp.getActive().toast(
    'Записано строк: ' + rows.length + (tail > 0 ? ', очищено: ' + tail : ''),
    month + '.' + year, 5
  );
}

/**
 * Достраивает валюту, курс и «итог» в строках, куда их не дотянули вручную.
 * Трогает только пустые ячейки: если блок заполнен на 24 строки, а записать
 * надо 40, в последних шестнадцати «итог» остался бы пустым и деньги просто
 * не попали бы в сводку на вкладке «Деньги».
 */
function ensureScaffold_(sheet, firstRow, startCol, n) {
  // Всё пакетно: за полный месяц строк втрое больше, чем за половину
  // сентября, а поячеечная запись в Apps Script упирается во время выполнения.
  const scaffold = sheet.getRange(firstRow, startCol + COL_CUR, n, 2);
  const vals = scaffold.getValues();
  let touched = false;
  for (let i = 0; i < n; i++) {
    if (vals[i][0] === '' || vals[i][0] === null) { vals[i][0] = 'USD'; touched = true; }
    if (vals[i][1] === '' || vals[i][1] === null) { vals[i][1] = 1; touched = true; }
  }
  if (touched) scaffold.setValues(vals);

  // «Итог» — формула листа. Находим первую строку без неё: незаполненные идут
  // подряд с конца, поэтому хватает одного copyTo на хвост. Копируем именно
  // формулу, без форматирования, чтобы не тащить чужой стиль.
  const formulas = sheet.getRange(firstRow, startCol + COL_TOTAL, n, 1).getFormulas();
  let firstMissing = -1;
  for (let i = 0; i < n; i++) {
    if (!formulas[i][0]) { firstMissing = i; break; }
  }
  if (firstMissing === -1) return;

  const sample = sheet.getRange(firstRow, startCol + COL_TOTAL, 1, 1);
  if (sample.getFormula()) {
    sample.copyTo(
      sheet.getRange(firstRow + firstMissing, startCol + COL_TOTAL, n - firstMissing, 1),
      SpreadsheetApp.CopyPasteType.PASTE_FORMULA,
      false
    );
    return;
  }

  // Формулы нет вообще — значит в листе просто значения. Пишем сумму × курс.
  const out = [];
  for (let i = firstMissing; i < n; i++) {
    const row = firstRow + i;
    out.push(['=' + colA1_(startCol + COL_SUM) + row + '*' + colA1_(startCol + COL_RATE) + row]);
  }
  sheet.getRange(firstRow + firstMissing, startCol + COL_TOTAL, out.length, 1).setFormulas(out);
}

/** Номер колонки (1-based) → буквенное обозначение: 57 → BE. */
function colA1_(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Суточные строки → одна строка на код, по убыванию суммы. */
function rollUp_(daily) {
  const acc = {};
  daily.forEach(function (r) {
    acc[r.code] = (acc[r.code] || 0) + Number(r.amount);
  });
  return Object.keys(acc)
    .map(function (code) { return { code: code, amount: Math.round(acc[code] * 100) / 100 }; })
    .sort(function (a, b) { return b.amount - a.amount; });
}

function fetchRows_(url, key, from, to) {
  const res = UrlFetchApp.fetch(url + '/rest/v1/rpc/spend_sheet_rows', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ p_from: from, p_to: to }),
    muteHttpExceptions: true
  });
  const body = res.getContentText();
  if (res.getResponseCode() !== 200) {
    throw new Error('База отказала (' + res.getResponseCode() + '): ' + body);
  }
  return JSON.parse(body);
}

function findHeaderRow_(sheet) {
  const probe = sheet.getRange(1, 1, Math.min(30, sheet.getMaxRows()), 1).getValues();
  for (let i = 0; i < probe.length; i++) {
    if (String(probe[i][0]).trim().toLowerCase() === 'дата') return i + 1;
  }
  throw new Error('Не нашёл строку заголовков: в колонке A нет ячейки «дата»');
}

/** Один раз снимает копию листа — до первой автоматической записи. */
function backupOnce_(sheet) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('backup_done')) return;
  const ss = SpreadsheetApp.getActive();
  const name = SHEET_NAME + ' (до автоматизации)';
  if (!ss.getSheetByName(name)) {
    sheet.copyTo(ss).setName(name);
  }
  props.setProperty('backup_done', '1');
}

function parseDate_(iso) {
  const p = String(iso).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function iso_(d) {
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}
