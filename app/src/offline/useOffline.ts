import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '@/app/store';
import { onlineSet } from './state';
import { flushQueue, loadQueue } from './thunks';

// Очередь отправляется при появлении сети, при возвращении в приложение и
// один раз при старте. Периодического опроса нет: он ничего не добавляет.
export function useOffline(): void {
  const dispatch = useDispatch<AppDispatch>();
  useEffect(() => {
    void dispatch(loadQueue()).then(() => dispatch(flushQueue()));

    const goOnline = (): void => {
      dispatch(onlineSet(true));
      void dispatch(flushQueue());
    };
    const goOffline = (): void => {
      dispatch(onlineSet(false));
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void dispatch(flushQueue());
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [dispatch]);
}
