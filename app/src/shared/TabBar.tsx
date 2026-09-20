import { NavLink } from 'react-router';
import styles from './TabBar.module.scss';

const TABS = [
  { to: '/', label: 'Ввод' },
  { to: '/month', label: 'Месяц' },
  { to: '/stats', label: 'Статистика' },
  { to: '/settings', label: 'Ещё' },
];

export function TabBar() {
  return (
    <nav className={styles.bar} aria-label="Разделы">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) => [styles.item, isActive ? styles.active : ''].join(' ')}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
