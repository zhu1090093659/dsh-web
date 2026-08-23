// 纯选择逻辑：不依赖 React / DOM，可独立单测。
import type { Category, Weights } from './types';

/** 从字符串池里等概率随机抽一个；exclude 排除某个名字（避免连续重复） */
export const pick = <T>(pool: T[], exclude?: T): T => {
  const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
  // 排除后池空（单元素池 + 排除自己）：退回原池抽——宁可重复，也不要返回 undefined
  const src = entries.length ? entries : pool;
  return src[Math.floor(Math.random() * src.length)];
};

/** 生成 [min, max) 区间内的随机整数 */
export const randomBetween = (min: number, max: number): number => Math.floor(min + Math.random() * (max - min));

/**
 * 按权重在分类池中选一个分类；noMirror 分类在镜像(facing=right)时被排除，
 * 剩余权重自动归一化。分类池为空时返回 null。
 */
export const pickWeightedCategory = (categories: Category[], facing: string): Category | null => {
  const cats = categories.filter((c) => c.actions.length > 0);
  if (!cats.length) return null;
  const filtered = cats.filter((c) => !(c.noMirror && facing === 'right'));
  const eligible = filtered.length ? filtered : cats;
  const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
  let t = Math.random() * totalW;
  for (const c of eligible) {
    t -= c.weight;
    if (t <= 0) return c;
  }
  return eligible[eligible.length - 1];
};

/** 掷骰结果类别 */
export type RollKind = 'idle' | 'turn' | 'move' | 'action';

/**
 * 按权重掷骰：roll ∈ [0,1) → 下一个动画类别（纯函数，可单测）。
 * topEnd = (idle+turn+move)/100：三档权重占比之和，剩余概率归入 'action'。
 */
export const rollKind = (roll: number, w: Weights): RollKind => {
  const topEnd = (w.idle + w.turn + w.move) / 100;
  if (roll < w.idle / 100) return 'idle';
  if (roll < (w.idle + w.turn) / 100) return 'turn';
  if (roll < topEnd) return 'move';
  return 'action';
};

/** 从分类池选一个动作；无可用分类时回退 idle 池（返回 {id, name}，纯函数）。
 * facing 用于 noMirror 镜像过滤；current 用于避免连续重复（pick 的 exclude）。 */
export const pickCategoryAction = (
  categories: Category[],
  idlePool: string[],
  facing: string,
  current: string,
): { id: string; name: string } => {
  const cat = pickWeightedCategory(categories, facing);
  if (!cat) return { id: 'FALLBACK', name: pick(idlePool, current) };
  return { id: cat.id, name: pick(cat.actions, current) };
};
