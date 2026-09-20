import type { CodeRef, MonthTxn } from '@/api/types';

// Частые категории для верхнего ряда чипов: сначала — самые используемые в
// этом месяце (среди трат), при равенстве количества — по порядку в списке
// категорий (sort_order); если не набрался лимит — дополняем недавно
// использованными кодами (recentCodes), без дублей.
export function frequentCodes(
  txns: MonthTxn[],
  recents: string[],
  codes: CodeRef[],
  limit = 5,
): string[] {
  const known = new Map(codes.map((c) => [c.code, c] as const));
  const counts = new Map<string, number>();
  for (const t of txns) {
    if (t.kind !== 'expense' || t.code === null) continue;
    if (!known.has(t.code)) continue;
    counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
  }

  const byCount = [...counts.entries()].sort((a, b) => {
    const [codeA, countA] = a;
    const [codeB, countB] = b;
    if (countA !== countB) return countB - countA;
    const sortA = known.get(codeA)?.sort_order ?? 0;
    const sortB = known.get(codeB)?.sort_order ?? 0;
    return sortA - sortB;
  });

  const result: string[] = byCount.map(([code]) => code).slice(0, limit);

  if (result.length < limit) {
    for (const code of recents) {
      if (result.length >= limit) break;
      if (!known.has(code)) continue;
      if (result.includes(code)) continue;
      result.push(code);
    }
  }

  return result;
}
