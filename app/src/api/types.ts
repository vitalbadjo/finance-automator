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
}

export interface MonthlyStat {
  month: string;
  code: string;
  amount: number;
  txn_count: number;
}
