import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.scss';

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента #root');

createRoot(root).render(
  <StrictMode>
    <div>Траты</div>
  </StrictMode>,
);
