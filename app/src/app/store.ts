import { configureStore } from '@reduxjs/toolkit';
import { api } from '@/api/api';
import { authReducer } from '@/features/auth/authSlice';
import { offlineReducer } from '@/offline/state';

export const makeStore = () =>
  configureStore({
    reducer: { [api.reducerPath]: api.reducer, auth: authReducer, offline: offlineReducer },
    middleware: (getDefault) => getDefault().concat(api.middleware),
  });

export const store = makeStore();

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
