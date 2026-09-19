/// <reference types="vite/client" />

// Включаем строгую типизацию import.meta.env вместо `Record<string, any>` по умолчанию —
// иначе supabase.ts получает `any` и падает на eslint no-unsafe-assignment.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}
