import type { CodeSection, MerchantRule, SettingsCode } from '@/api/types';

export const SECTIONS: readonly CodeSection[] = ['Базовые', 'Комфорт', 'Путешествия', 'Саморазвитие'];

export interface CodeGroup {
  section: CodeSection;
  codes: SettingsCode[];
}

// Разделы в порядке таблицы пользователя; скрытые — в конце своего раздела.
export function groupCodes(codes: SettingsCode[]): CodeGroup[] {
  return SECTIONS.map((section) => ({
    section,
    codes: codes
      .filter((c) => c.section === section)
      .sort(
        (a, b) =>
          Number(a.hidden) - Number(b.hidden) || a.sort_order - b.sort_order || a.code.localeCompare(b.code, 'ru'),
      ),
  })).filter((g) => g.codes.length > 0);
}

// Тот же порядок, в котором v_txn выбирает правило: приоритет, затем
// длиннее шаблон — важнее. Чтобы список показывал, какое правило победит.
export const sortRules = (rules: MerchantRule[]): MerchantRule[] =>
  [...rules].sort((a, b) => a.priority - b.priority || b.pattern.length - a.pattern.length || a.id - b.id);

// Заготовка шаблона из строки «Без категории»: без подстановочных знаков,
// не длиннее 40 символов.
export const patternFromMerchant = (merchant: string): string =>
  merchant.replace(/[%_]/g, '').trim().slice(0, 40).trim();
