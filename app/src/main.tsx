import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router';
import { store } from '@/app/store';
import { router } from '@/app/router';
import { useSessionListener } from '@/features/auth/useSession';
import { useOffline } from '@/offline/useOffline';
import '@/styles/globals.scss';

function App() {
  useSessionListener();
  useOffline();
  return <RouterProvider router={router} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента #root');

createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
