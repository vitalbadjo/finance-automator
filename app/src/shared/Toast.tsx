import styles from './Toast.module.scss';

interface Props {
  message: string | null;
  kind?: 'ok' | 'err';
}

export function Toast({ message, kind = 'ok' }: Props) {
  if (!message) return null;
  return (
    <div role="status" className={[styles.toast, kind === 'err' ? styles.err : ''].join(' ')}>
      {message}
    </div>
  );
}
