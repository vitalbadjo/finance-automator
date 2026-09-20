import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { supabase } from '@/api/supabase';
import type { AppDispatch, RootState } from '@/app/store';
import { sessionChanged } from './authSlice';

// Один раз подписывается на изменения сессии. supabase-js сам обновляет
// токен; когда обновить не удалось, придёт SIGNED_OUT с session = null.
export function useSessionListener(): void {
  const dispatch = useDispatch<AppDispatch>();
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => dispatch(sessionChanged(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      dispatch(sessionChanged(session));
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, [dispatch]);
}

export function useSession() {
  return useSelector((s: RootState) => s.auth);
}
