import { createBrowserRouter } from 'react-router';
import { EntryScreen } from '@/features/entry/EntryScreen';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { MonthScreen } from '@/features/month/MonthScreen';
import { CodesScreen } from '@/features/settings/CodesScreen';
import { RulesScreen } from '@/features/settings/RulesScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { StatsScreen } from '@/features/stats/StatsScreen';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginScreen /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <EntryScreen /> },
      { path: '/month', element: <MonthScreen /> },
      { path: '/stats', element: <StatsScreen /> },
      { path: '/settings', element: <SettingsScreen /> },
      { path: '/settings/codes', element: <CodesScreen /> },
      { path: '/settings/rules', element: <RulesScreen /> },
    ],
  },
]);
