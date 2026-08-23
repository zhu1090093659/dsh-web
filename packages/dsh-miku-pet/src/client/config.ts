// 配置层：剥注释、校验 config.jsonc。运行时（ANIM）直接使用与 jsonc 同构的 ClientConfig，
// 不做字段转换；缺失/非法一律视为配置错误（throw，由加载层显式报错）。
import type { Animations, ClientConfig, Corner, Pet, Weights } from './types';

/** 剥除 JSONC 注释（行注释 // 与块注释），得到纯 JSON 字符串 */
export const stripJsonc = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\:])\/\/.*$/gm, '$1')
    .trim();

/** 支持的角落白名单 */
export const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** corner 合法性检查用的 string 集合（Corner[] 的 includes 要求 Corner 参数，无法接收未知 string） */
const CORNER_SET: ReadonlySet<string> = new Set(CORNERS);

/** ClientConfig 类型占位（data-less；PetMulti 加载后由 assertClientConfig 赋真实值） */
export const EMPTY_CONF: ClientConfig = {
  pets: [],
  animations: { idle: [], turn: [], drag: [], clicks: [], moves: { default: {}, actions: [] }, categories: [] },
  animationWeights: { idle: 0, turn: 0, move: 0 },
};

/** 校验 config.jsonc 解析结果并返回 ClientConfig；任一字段缺失/非法即视为配置错误抛出 */
export function assertClientConfig(raw: unknown): ClientConfig {
  if (!raw || typeof raw !== 'object') throw new Error('miku-pet: config 非对象');
  // raw 是 unknown 输入（jsonc 解析产物），按 Record 读取后逐字段手工校验，字段读写无法静态定型
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = raw as Record<string, any>;

  // ---- pets ----
  const petsArr = cfg.pets;
  if (!Array.isArray(petsArr) || !petsArr.length) throw new Error('miku-pet: 缺少 pets');
  const seen = new Set<string>();
  const pets: Pet[] = [];
  for (const p of petsArr) {
    const id = String(p?.id ?? '');
    if (!id || seen.has(id)) throw new Error('miku-pet: pet id 非法或重复「' + id + '」');
    const size = Number(p?.size);
    if (!Number.isFinite(size) || size <= 0) throw new Error('miku-pet: pet「' + id + '」大小非法');
    const corner = p?.position?.corner;
    if (typeof corner !== 'string' || !CORNER_SET.has(corner)) throw new Error('miku-pet: pet「' + id + '」corner 非法');
    const marginX = Number(p?.position?.marginX);
    const marginY = Number(p?.position?.marginY);
    if (!Number.isFinite(marginX) || !Number.isFinite(marginY)) throw new Error('miku-pet: pet「' + id + '」边距非法');
    // name 可选（悬停菜单改名）；非 string/超长/含控制字符则丢弃
    const rawName = typeof p?.name === 'string' ? p.name.trim() : '';
    // eslint-disable-next-line no-control-regex
    const name = rawName && rawName.length <= 32 && !/[\x00-\x1f]/.test(rawName) ? rawName : undefined;
    seen.add(id);
    pets.push({ id, size, position: { corner: corner as Corner, marginX, marginY }, ...(name ? { name } : {}) });
  }

  // ---- animations ----
  const a = cfg.animations;
  if (!a || typeof a !== 'object') throw new Error('miku-pet: 缺少 animations');
  for (const key of ['idle', 'turn', 'drag', 'clicks']) {
    if (!Array.isArray(a[key])) throw new Error('miku-pet: animations.' + key + ' 缺失');
  }
  if (
    !a.moves ||
    typeof a.moves !== 'object' ||
    typeof a.moves.default !== 'object' ||
    a.moves.default === null ||
    !Array.isArray(a.moves.actions)
  ) {
    throw new Error('miku-pet: animations.moves 结构非法');
  }
  if (!Array.isArray(a.categories)) throw new Error('miku-pet: animations.categories 缺失');

  // ---- animationWeights ----
  const w = cfg.animationWeights;
  if (!w || typeof w !== 'object') throw new Error('miku-pet: 缺少 animationWeights');
  for (const key of ['idle', 'turn', 'move']) {
    const v = Number(w[key]);
    if (!Number.isFinite(v) || v < 0) throw new Error('miku-pet: animationWeights.' + key + ' 非法');
    w[key] = v;
  }

  // ---- phrases（可选：动作名 → 台词池；非法条目丢弃） ----
  let phrases: Record<string, string[]> | undefined;
  if (cfg.phrases && typeof cfg.phrases === 'object') {
    const cleaned: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(cfg.phrases as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')) {
        cleaned[k] = v as string[];
      }
    }
    if (Object.keys(cleaned).length) phrases = cleaned;
  }

  return {
    pets,
    animations: a,
    animationWeights: w,
    ...(phrases ? { phrases } : {}),
  };
}

/** 合并宠物：用户层（{ pets }，与 jsonc 同构）全量替换默认；无用户层回落默认 */
export function resolvePets(defaults: Pet[], user: { pets?: Pet[] }): Pet[] {
  if (user && Array.isArray(user.pets)) return user.pets.length ? user.pets : defaults;
  return defaults;
}

/** 用户覆盖片段（与 jsonc 同构；高级用户直接编辑 pet-config.json，缺省字段回落默认） */
export interface UserOverrides {
  pets?: Pet[];
  animations?: Animations;
  animationWeights?: Weights;
}

/** 合并用户覆盖片段到完全体配置：pets / animations / animationWeights 有则整体替换，缺省回落默认 */
export function applyUserOverrides(base: ClientConfig, user: UserOverrides): ClientConfig {
  const next: ClientConfig = { ...base, pets: resolvePets(base.pets, user) };
  if (user.animations) next.animations = user.animations;
  if (user.animationWeights) next.animationWeights = user.animationWeights;
  return next;
}
