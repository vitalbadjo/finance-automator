import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (typeof url !== 'string' || typeof key !== 'string' || url === '' || key === '') {
  throw new Error('Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (см. app/.env.example)');
}

export const supabase = createClient(url, key);
