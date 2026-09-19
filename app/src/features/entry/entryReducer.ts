export interface EntryState {
  amount: string;
  currency: string;
  code: string | null;
  date: string;
  note: string;
}

export type EntryAction =
  | { type: 'amount'; value: string }
  | { type: 'currency'; value: string }
  | { type: 'code'; value: string }
  | { type: 'date'; value: string }
  | { type: 'note'; value: string }
  | { type: 'saved' };

export const initialEntry = (currency: string, date: string): EntryState => ({
  amount: '',
  currency,
  code: null,
  date,
  note: '',
});

export function entryReducer(state: EntryState, action: EntryAction): EntryState {
  switch (action.type) {
    case 'amount':
      return { ...state, amount: action.value };
    case 'currency':
      return { ...state, currency: action.value };
    case 'code':
      return { ...state, code: action.value };
    case 'date':
      return { ...state, date: action.value };
    case 'note':
      return { ...state, note: action.value };
    case 'saved':
      // Две записи подряд в одну категорию — частый случай, поэтому
      // категория, валюта и дата остаются.
      return { ...state, amount: '', note: '' };
  }
}
