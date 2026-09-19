# LFS Spend Pipeline

One-button export of card transaction history into Postgres. There is a single
source for now, the Bybit Card; adding a bank means adding one object to
`extension/sources.js`.

```
[extension] --click--> source page (same-origin, browser cookies)
      |                      |
      |<---- raw records ----+
      v
[Edge Function /ingest] --rpc--> public.spend_ingest() --upsert--> spend.raw_txn
                                                                      |
                                                  spend.v_txn (categories, currency)
                                                                      |
                              v_daily · v_unmapped · v_zero_auth · v_fees_monthly · v_missing_rates
                                                                      |
                                       public.spend_sheet_rows() --> Apps Script --> "Мониторинг" sheet
```

## Layout

```
spent-authomator/
├── .github/workflows/
│   └── keepalive.yml           daily ping so the Supabase project is not paused
├── db/                         applied by hand, in numeric order
│   ├── 001_schema.sql          tables, views, normalization function
│   ├── 002_seed.sql            category codes, MCC rules, merchant rules
│   ├── 003_ingest_fn.sql       spend_ingest: receive and upsert in one call
│   ├── 004_verify.sql          regression check, not a migration — read-only
│   ├── 005_manual.sql          manual entries and code_override
│   ├── 006_sheet_read.sql      spend_sheet_rows: the slice for the spreadsheet
│   ├── 007_currency.sql        base currency, FX rates, conversion in views
│   ├── 008_implied_rates.sql   trigger: card_implied rates refreshed after each sync
│   ├── 009_fee_inside.sql      fees are inside amount: true_cost fixed, net_amount added
│   ├── 010_small_fixes.sql     manual-entry timezone, rule pattern guard, card-only fees view
│   └── 011_ping.sql            public.ping() for the keepalive workflow
├── supabase/
│   └── functions/
│       └── ingest/
│           └── index.ts        Edge Function: token check, call spend_ingest
├── docs/
│   └── HANDOFF.md              decisions and findings — local only, gitignored
├── apps-script/                Google Sheets script: database → "Мониторинг"
│   ├── Code.gs
│   └── appsscript.json
├── extension/                  unpacked Chrome extension (MV3)
│   ├── manifest.json
│   ├── background.js           service worker: orchestration, badge
│   ├── sources.js              source registry — a bank is added here
│   ├── popup.html / popup.js   the button and status
│   └── options.html / options.js   function URL and token
└── README.md
```

## Setup

**0. Supabase CLI.** The database and the dashboard live in the browser, but
the Edge Function code lives here and has to be uploaded. That takes the local
CLI:

```bash
brew install supabase/tap/supabase
supabase login                        # opens the browser
supabase link --project-ref <ref>     # ref is in the project URL in the dashboard
```

The commands below run from the repository root.

**1. Database.** In Supabase → SQL Editor, run in order, against an empty
schema:

```
db/001_schema.sql
db/002_seed.sql
db/003_ingest_fn.sql
db/005_manual.sql
db/006_sheet_read.sql
db/007_currency.sql
db/008_implied_rates.sql
db/009_fee_inside.sql
db/010_small_fixes.sql
db/011_ping.sql
```

Skip `004`: it is a check, not a migration. `001` uses bare `create table`
and fails on a schema that already exists.

**2. Ingest function.**

```bash
openssl rand -hex 32                        # keep the output: the extension needs it too
supabase secrets set INGEST_TOKEN="<paste>"
supabase functions deploy ingest --no-verify-jwt
```

`--no-verify-jwt` is required: the extension holds no user JWT, authorization
is the `x-ingest-token` header. The token cannot be read back later,
`secrets list` shows only a digest. If it is lost, set a new one with the same
command and update it in the extension options.

**3. Extension.** `chrome://extensions` → enable Developer mode → Load
unpacked → the `extension/` folder. Then open Options and paste the function
URL and the token.

**4. First run.** Click the button in the popup. The first sync pulls the whole
available history (as of 2026-09-19: 128 transactions since 2026-07-08).
Every later run overwrites existing records by key and adds new ones.

**5. Keepalive ping.** A free Supabase project is paused after a week without
requests and can only be resumed by hand from the dashboard. The workflow in
`.github/workflows/keepalive.yml` calls `public.ping()` (from `011`) once a
day. In the GitHub repository set two secrets: `SUPABASE_URL` and
`SUPABASE_ANON_KEY`. The key is the public one: `sb_publishable_…` from
Project Settings → API Keys, or the legacy `anon` JWT. Never the secret /
service_role key. Verify with Run workflow on the Actions tab. GitHub caveat: after 60 days without commits the schedule is
disabled and has to be re-enabled on the same tab.

## How it works

**Cookies.** The extension never sees or stores the Bybit session. The
request runs via `chrome.scripting.executeScript` inside the bybit.com page
itself, and the browser attaches the cookies. The same request from the
service worker would not work: its origin is `chrome-extension://`, and a
`SameSite` cookie is not sent there.

**If the session has expired** the adapter returns
`AUTH: сессия Bybit истекла`. Log in and press the button again.

**The badge on the icon** is the number of days since the last successful
sync. Green up to 5 days, yellow up to 10, red after that, `!` if it never
succeeded. This is the only protection against a silent failure: the button
cannot "quietly stop working", because the counter is visible. The counter is
recomputed by an alarm every hour and on every popup open, so it keeps
counting without a browser restart.

## Categorization

Two layers, in priority order:

1. **`merchant_rule`**: substring match on the merchant name. This is the
   primary mechanism, because Serbian acquirers report wrong MCCs: Lidl,
   dm-drogerie and HAIRGUARD all sit in 5999, and a clothing shop is tagged as
   household appliances.
2. **`mcc_rule`**: fallback where the MCC is reliable: subscriptions, telecom,
   taxi, hotels, cash withdrawals.

An unknown merchant does not break the sync, it lands in `v_unmapped`. Add a
rule and the whole history is recomputed, because the category lives in a
view, not in the data.

## What does not count as an expense

| kind | what it is | why |
|---|---|---|
| `transfer` | cash withdrawal (MCC 6010/6011) | money moved, not spent; otherwise it is counted twice when the cash is spent |
| `auth` | zero-amount authorization | a service linking the card |
| `void` | `display_status` 2 and 3 | declined and reversed |

## Source codes

| field | values |
|---|---|
| `txn_type` | `deduct` settled · `freeze` hold · `unfreeze` hold released |
| `message_type` | `1` purchase · `2` cash |
| `display_status` | `0` in progress · `1` success · `2` declined · `3` reversed |

## Useful queries

```sql
-- what goes to the "Мониторинг" sheet for a period
select * from spend.v_daily
where txn_date between '2026-09-01' and '2026-09-18'
order by txn_date, code;

-- what the rules could not classify
select * from spend.v_unmapped;

-- zero-amount authorizations: unfamiliar names here are worth a look
select * from spend.v_zero_auth;

-- what the card costs: fees as a share of net turnover, per month
select * from spend.v_fees_monthly;
```

Fees are included in `amount`: the card reports the total that left the
account, and `foreignTransactionFee` is 2% of the net purchase inside it.
`net_amount` in `v_txn` is the amount without fees.


## The LFS-2026 spreadsheet

The script in `apps-script/` lays out daily sums per code into the month block
of the "Мониторинг" sheet. The spreadsheet is a display: the source of truth
is Postgres, and the sheet can be rebuilt from the database at any time.

Setup: Extensions → Apps Script, paste `Code.gs`, then Project Settings →
Script Properties:

| property | where to find it in the Supabase dashboard |
|---|---|
| `SUPABASE_URL` | Project Settings → API → **Project URL**, like `https://<ref>.supabase.co` |
| `SERVICE_KEY` | Project Settings → API Keys → **service_role** (in the new scheme **secret key**, `sb_secret_…`) |

The key lives in properties, not in code: code goes to git, properties stay in
the project.

**service_role bypasses RLS: it is the key to the whole database.** Script
properties are visible to anyone with editor rights on the spreadsheet, so a
sheet with this script should not be shared for editing. If that is ever
needed, rework `spend_sheet_rows` to accept its own token and grant it to the
`anon` role: a leaked key would then open one read-only function, not the
whole schema.

After reloading the spreadsheet a **Расходы** menu appears: current month
(write and dry run) and "Обновить другой месяц…", which asks for a month
number, shows a dry run and writes only after confirmation.

The script writes **three columns: date, code and amount**. For September
these are `BE`, `BF` and `BG`; the layout is `7 × (month − 1)`, the separator
column between blocks is accounted for:

| month | Jan | … | Aug | **Sep** | Oct | … | Dec |
|---|---|---|---|---|---|---|---|
| date / code / amount | A B C | | AX AY AZ | **BE BF BG** | BL BM BN | | BZ CA CB |

Granularity is one row per (day, code) pair, as in `v_daily`. The
`GRANULARITY` constant at the top of `Code.gs` switches to `'month'` for one
row per code per month.

The script normally leaves currency, rate and "итог" alone, they are already
filled in the sheet. The one exception: if a month has more rows than were
pulled down by hand, `ensureScaffold_` fills in the missing cells. Without it
the amount in such a row would never reach the summary on the "Деньги" tab,
because "итог" would stay empty. Only empty cells are touched, and the "итог"
formula is copied from the first row of the block so that Sheets shifts the
references itself.

Things the script does deliberately carefully:

- **Does not overwrite currency, rate and "итог"** where they already exist,
  it only fills rows below the hand-filled area.
- **Does not touch blocks before September 2026**: July and August were filled
  by hand from ruble expenses, and there is no card data for them. An attempt
  to update such a month fails with an error instead of a silent overwrite.
- **Checks the year.** The sheet has twelve blocks and the year is written
  nowhere. Running in 2027 without the check would write over the 2026 data.
  A new year means a new spreadsheet and a new `SHEET_YEAR` value.
- **Backs up the sheet once** before the first automated write, as
  "Мониторинг (до автоматизации)".

The header row is found by the "дата" cell in column A, not remembered by
number: a row inserted at the top would silently shift everything.

### Before the first run

The September block (columns BE:BJ) holds eleven rows entered by hand. Nine of
them came from the card and are now taken from the database; if left in
place, the sums would double. The remaining two (`жил` and `юр`) move into the
database via `005_manual.sql` as the `manual` source.

So: clear `BE`, `BF` and `BG` in all eleven rows of the September block, then
run a dry run and, if it matches, a write.

### Manual entries

Anything not on the card, such as rent, cash expenses, transfers, is added
with:

```sql
select public.spend_add_manual('2026-10-01', 'жил', 1955, 'Аренда жилья');
```

Calling it again with the same date, code and note updates the entry instead
of duplicating it.

### Fixing a single payment

When the merchant rule is right but one particular purchase is an exception:

```sql
update spend.raw_txn set code_override = 'под'
where source = 'bybit_card' and external_id = '<txnId>';
```

`code_override` is not in the column list the sync writes, so the fix
survives any number of later syncs.


## Currencies

The base currency lives in `spend.app_config` (USD for now). `raw_txn` stores
the amount in the transaction's own currency; conversion to base is computed
in the view, like every other interpretation. It surfaces as the
`base_amount`, `base_fee` and `signed_base_amount` columns; `v_daily` returns
only the base currency, so its values are safe to sum.

Rates are in `spend.fx_rate`, where `rate` is **units of the currency per one
unit of base** (about 100 for RSD, exactly the card's `local_amount / amount`).
Lookup takes the nearest date not after the required one, and on an equal
date prefers `source = 'ecb'` over `'card_implied'`.

The initial rates come from the card's own transactions: each has both the USD
amount and the local amount, which gives the actual rate for every day with
purchases. This is the rate including Bybit's spread. A market feed (ECB) can
be added later with `source = 'ecb'`; it takes priority without rewriting
anything. Since `008` the card-implied rates are refreshed by a trigger after
every sync.

Adding a rate by hand:

```sql
select public.spend_set_rate('2026-10-01', 'RSD', 100.42, 'ecb');
```

**An expense with no rate silently drops out of `v_daily`**: it is not zeroed,
it disappears. `select * from spend.v_missing_rates;` shows such cases, and
`004_verify.sql` asserts there are none.
