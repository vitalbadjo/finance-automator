import { createBrowserRouter } from 'react-router';
import { EntryScreen } from '@/features/entry/EntryScreen';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { RequireAuth } from '@/features/auth/RequireAuth';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginScreen /> },
  {
    element: <RequireAuth />,
    children: [{ path: '/', element: <EntryScreen /> }],
  },
]);
