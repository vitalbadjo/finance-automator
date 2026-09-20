import type { MerchantRule, SettingsCode } from '@/api/types';
import { groupCodes, patternFromMerchant, sortRules } from './settings';

const code = (over: Partial<SettingsCode>): SettingsCode => ({
  code: 'x', title: 'X', section: 'Базовые', sort_order: 100, hidden: false, in_use: false, ...over,
});
const rule = (over: Partial<MerchantRule>): MerchantRule => ({
  id: 1, pattern: 'A', code: 'прод', priority: 100, note: null, ...over,
});

describe('groupCodes', () => {
  it('разделы в фиксированном порядке, пустые пропущены, внутри по порядку и коду, скрытые в конце', () => {
    const groups = groupCodes([
      code({ code: 'б', section: 'Комфорт', sort_order: 20 }),
      code({ code: 'а', section: 'Комфорт', sort_order: 20 }),
      code({ code: 'скр', section: 'Комфорт', sort_order: 1, hidden: true }),
      code({ code: 'з', section: 'Базовые', sort_order: 5 }),
      code({ code: 'с', section: 'Саморазвитие', sort_order: 1 }),
    ]);
    expect(groups.map((g) => g.section)).toEqual(['Базовые', 'Комфорт', 'Саморазвитие']);
    expect(groups[1]?.codes.map((c) => c.code)).toEqual(['а', 'б', 'скр']);
  });
});

describe('sortRules', () => {
  it('по приоритету, затем длиннее шаблон раньше, затем id; вход не меняется', () => {
    const input = [
      rule({ id: 1, pattern: 'AB', priority: 100 }),
      rule({ id: 2, pattern: 'ABCD', priority: 100 }),
      rule({ id: 3, pattern: 'Z', priority: 10 }),
      rule({ id: 4, pattern: 'AB', priority: 100 }),
    ];
    expect(sortRules(input).map((r) => r.id)).toEqual([3, 2, 1, 4]);
    expect(input.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('patternFromMerchant', () => {
  it('убирает % и _, обрезает пробелы и длину', () => {
    expect(patternFromMerchant('  LIDL_121 %SUBOTICA  ')).toBe('LIDL121 SUBOTICA');
    expect(patternFromMerchant('A'.repeat(50))).toHaveLength(40);
    expect(patternFromMerchant('A'.repeat(39) + ' B')).toBe('A'.repeat(39));
  });
});
