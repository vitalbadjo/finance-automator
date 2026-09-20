import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Session } from '@supabase/supabase-js';

export interface AuthState {
  session: Session | null;
  status: 'loading' | 'ready';
}

const initialState: AuthState = { session: null, status: 'loading' };

const slice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionChanged(state, action: PayloadAction<Session | null>) {
      state.session = action.payload;
      state.status = 'ready';
    },
  },
});

export const { sessionChanged } = slice.actions;
export const authReducer = slice.reducer;
