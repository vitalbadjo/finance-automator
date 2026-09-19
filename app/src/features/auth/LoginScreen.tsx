import { useState, type SubmitEvent } from 'react';
import { Navigate } from 'react-router';
import { supabase } from '@/api/supabase';
import { toAppError } from '@/api/errors';
import { Button } from '@/shared/Button';
import { Field } from '@/shared/Field';
import { useSession } from './useSession';
import styles from './LoginScreen.module.scss';

export function LoginScreen() {
  const { session, status } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return null;
  if (session) return <Navigate to="/" replace />;

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(toAppError(err).message);
  };

  return (
    <form
      className={styles.wrap}
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <h1 className={styles.title}>Вход</h1>
      <Field
        id="email"
        label="Почта"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
        required
      />
      <Field
        id="password"
        label="Пароль"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
        }}
        required
      />
      {error && <div className={styles.error}>{error}</div>}
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? 'Входим…' : 'Войти'}
      </Button>
    </form>
  );
}
