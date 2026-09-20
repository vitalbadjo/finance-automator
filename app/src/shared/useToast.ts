import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  message: string;
  kind: 'ok' | 'err';
}

// Тост с таймером: успех гаснет через 2 с, ошибка — через 5 с. Тот же
// порядок, что на экранах ввода и месяца.
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: 'ok' | 'err') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, kind });
    timer.current = setTimeout(() => {
      setToast(null);
    }, kind === 'ok' ? 2000 : 5000);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { toast, show };
}
