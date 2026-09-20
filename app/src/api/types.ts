export interface CodeRef {
  code: string;
  title: string;
  section: string;
  sort_order: number;
}

export type TxnKind = 'expense' | 'transfer' | 'auth' | 'void';

export interface MonthTxn {
  external_id: string;
  source: string;
  txn_date: string;
  txn_at: string;
  merchant_name: string | null;
  amount: number;
  currency: string;
  base_amount: number | null;
  base_currency: string;
  code: string | null;
  kind: TxnKind;
  status: string;
  note: string | null;
  code_override: string | null;
}

export interface MonthRange {
  from: string;
  to: string;
}

export interface AddTxnArgs {
  date: string;
  amount: number;
  currency: string;
  code: string;
  note: string | null;
}

export interface UpdateTxnArgs extends AddTxnArgs {
  id: string;
}

export interface SetCodeArgs {
  source: string;
  id: string;
  code: string | null;
}

export interface AppError {
  message: string;
  // Временная ошибка: связи нет, сервер лежит или сессия протухла.
  // Такую запись не отвергают — её повторяют, а чтение отдают из кэша.
  transient?: boolean;
}

export interface MonthlyStat {
  month: string;
  code: string;
  amount: number;
  txn_count: number;
}

export interface AddTxnWithId extends AddTxnArgs {
  id: string;
}

// Строка списка: транзакция с сервера или ещё не отправленная запись.
export type DisplayTxn = MonthTxn & { pending?: boolean };

export type CodeSection = 'Базовые' | 'Комфорт' | 'Путешествия' | 'Саморазвитие';

export interface SettingsSource {
  code: string;
  title: string;
  txn_count: number;
  last_sync_at: string | null;
  last_sync_ok: boolean | null;
}

export interface SettingsCode {
  code: string;
  title: string;
  section: CodeSection;
  sort_order: number;
  hidden: boolean;
  in_use: boolean;
}

export interface MerchantRule {
  id: number;
  pattern: string;
  code: string;
  priority: number;
  note: string | null;
}

export interface UnmappedRow {
  merchant: string;
  mcc: string | null;
  mcc_desc: string | null;
  txn_count: number;
  amount: number;
  last_seen: string;
}

export interface Settings {
  base_currency: string;
  sources: SettingsSource[];
  codes: SettingsCode[];
  rules: MerchantRule[];
  unmapped: UnmappedRow[];
}

export interface CodeUpsertArgs {
  code: string;
  title: string;
  section: CodeSection;
  sort_order: number;
  hidden: boolean;
}

export interface RuleUpsertArgs {
  id: number | null;
  pattern: string;
  code: string;
  priority: number;
  note: string | null;
}
