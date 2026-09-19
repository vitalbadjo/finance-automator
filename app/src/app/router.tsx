import { createBrowserRouter } from 'react-router';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { RequireAuth } from '@/features/auth/RequireAuth';

// EntryScreen подключается в задаче 7; до неё здесь заглушка.
const Placeholder = () => <div style={{ padding: 16 }}>Экран ввода — скоро</div>;

export const router = createBrowserRouter([
  { path: '/login', element: <LoginScreen /> },
  {
    element: <RequireAuth />,
    children: [{ path: '/', element: <Placeholder /> }],
  },
]);
