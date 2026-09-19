import { Navigate, Outlet } from 'react-router';
import { useSession } from './useSession';

export function RequireAuth() {
  const { session, status } = useSession();
  if (status === 'loading') return null;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}
